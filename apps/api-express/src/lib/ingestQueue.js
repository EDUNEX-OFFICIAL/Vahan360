"use strict";

const { Queue } = require("bullmq");
const IORedis = require("ioredis");
const { propagation, context, trace } = require("@opentelemetry/api");

const DEFAULT_QUEUE_NAME = "scrape-ingest";
const DEFAULT_CHILD_QUEUE_NAME = "scrape-ingest-child";
/** Dedicated queue for terminal dead-letter payloads (worker pushes on final failure). */
const DEFAULT_DLQ_QUEUE_NAME = "scrape-ingest-dlq";
/** Reserved for manual / delayed retry fan-in; optional consumer when `INGEST_RETRY_WORKER_ENABLED`. */
const DEFAULT_RETRY_QUEUE_NAME = "scrape-ingest-retry";

let connection = null;
let queue = null;
let childQueue = null;
let dlqQueue = null;
let retryQueue = null;

const DEFAULT_MASTER_JOB_OPTIONS = {
  attempts: 5,
  backoff: {
    type: "exponential",
    delay: 5000,
  },
  removeOnComplete: {
    age: 24 * 60 * 60,
    count: 1000,
  },
  removeOnFail: {
    age: 7 * 24 * 60 * 60,
    count: 5000,
  },
};

function getIngestRedisUrl() {
  return (
    process.env.BULLMQ_REDIS_URL?.trim() ||
    process.env.REDIS_URL?.trim() ||
    undefined
  );
}

function getIngestQueueName() {
  return process.env.INGEST_QUEUE_NAME?.trim() || DEFAULT_QUEUE_NAME;
}

function getIngestChildQueueName() {
  return process.env.INGEST_CHILD_QUEUE_NAME?.trim() || DEFAULT_CHILD_QUEUE_NAME;
}

function getIngestDlqQueueName() {
  return process.env.INGEST_DLQ_QUEUE_NAME?.trim() || DEFAULT_DLQ_QUEUE_NAME;
}

function getIngestRetryQueueName() {
  return process.env.INGEST_RETRY_QUEUE_NAME?.trim() || DEFAULT_RETRY_QUEUE_NAME;
}

function isOtelEnabled() {
  return (
    process.env.OTEL_ENABLED === "true" || process.env.OTEL_ENABLED === "1"
  );
}

/**
 * When OTEL is on and a real span is active, inject W3C headers into a carrier
 * and merge `traceparent` / optional `tracestate` onto job payload.
 * @param {Record<string, unknown>} data
 */
function mergeW3CTraceIntoJobData(data) {
  if (!isOtelEnabled()) {
    return data;
  }
  const active = context.active();
  const span = trace.getSpan(active);
  if (!span) {
    return data;
  }
  const sc = span.spanContext();
  if (!sc?.traceId || /^0+$/.test(sc.traceId)) {
    return data;
  }
  const carrier = {};
  propagation.inject(active, carrier);
  const out = { ...data };
  if (
    typeof carrier.traceparent === "string" &&
    carrier.traceparent.length > 0
  ) {
    out.traceparent = carrier.traceparent;
    if (
      typeof carrier.tracestate === "string" &&
      carrier.tracestate.length > 0
    ) {
      out.tracestate = carrier.tracestate;
    }
  }
  return out;
}

function createConnection(redisUrl) {
  return new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

/**
 * Shared BullMQ Redis connection for ingest master queue, Bull Board, etc.
 * @returns {import("ioredis").default | null}
 */
function getIngestBullmqConnection() {
  const redisUrl = getIngestRedisUrl();
  if (!redisUrl) {
    return null;
  }
  if (!connection) {
    connection = createConnection(redisUrl);
    connection.on("error", (err) => {
      console.warn("[ingestQueue] Redis connection warning:", err?.message || err);
    });
  }
  return connection;
}

function getIngestQueue() {
  const redisUrl = getIngestRedisUrl();
  if (!redisUrl) {
    return null;
  }

  getIngestBullmqConnection();

  if (!queue) {
    queue = new Queue(getIngestQueueName(), {
      connection,
      defaultJobOptions: DEFAULT_MASTER_JOB_OPTIONS,
    });
  }

  return queue;
}

/**
 * @returns {import("bullmq").Queue | null}
 */
function getIngestChildQueue() {
  const redisUrl = getIngestRedisUrl();
  if (!redisUrl) {
    return null;
  }
  getIngestBullmqConnection();
  if (!childQueue) {
    childQueue = new Queue(getIngestChildQueueName(), {
      connection,
      defaultJobOptions: DEFAULT_MASTER_JOB_OPTIONS,
    });
  }
  return childQueue;
}

/**
 * DLQ handle for `getJob` / admin replay (no dedicated consumer).
 * @returns {import("bullmq").Queue | null}
 */
function getIngestDlqQueue() {
  const redisUrl = getIngestRedisUrl();
  if (!redisUrl) {
    return null;
  }
  getIngestBullmqConnection();
  if (!dlqQueue) {
    dlqQueue = new Queue(getIngestDlqQueueName(), { connection });
  }
  return dlqQueue;
}

/**
 * Retry queue handle for status / metrics reads.
 * @returns {import("bullmq").Queue | null}
 */
function getIngestRetryQueue() {
  const redisUrl = getIngestRedisUrl();
  if (!redisUrl) {
    return null;
  }
  getIngestBullmqConnection();
  if (!retryQueue) {
    retryQueue = new Queue(getIngestRetryQueueName(), {
      connection,
      defaultJobOptions: DEFAULT_MASTER_JOB_OPTIONS,
    });
  }
  return retryQueue;
}

/**
 * @param {{ scrapeJobId: string, kind: string, correlationId: string, requestId?: string, queuePriority?: number }} args
 * @param {number} [args.queuePriority] Optional **1–10** (caller-validated). Passed to BullMQ `JobsOptions.priority`:
 * **larger values are higher priority** (run before jobs with smaller priority / default unprioritized jobs).
 */
async function enqueueScrapeIngestJob({
  scrapeJobId,
  kind,
  correlationId,
  requestId,
  queuePriority,
}) {
  const queueInstance = getIngestQueue();
  if (!queueInstance) {
    return { enqueued: false, reason: "redis_not_configured" };
  }

  const data = mergeW3CTraceIntoJobData({
    scrapeJobId,
    kind,
    correlationId,
    ...(typeof requestId === "string" && requestId.length > 0 ? { requestId } : {}),
    ...(typeof queuePriority === "number" &&
    Number.isInteger(queuePriority) &&
    queuePriority >= 1 &&
    queuePriority <= 10
      ? { queuePriority }
      : {}),
  });

  /** @type {import("bullmq").JobsOptions} */
  const addOpts = { jobId: scrapeJobId };
  if (
    typeof queuePriority === "number" &&
    Number.isInteger(queuePriority) &&
    queuePriority >= 1 &&
    queuePriority <= 10
  ) {
    addOpts.priority = queuePriority;
  }

  await queueInstance.add("master", data, addOpts);

  return { enqueued: true };
}

module.exports = {
  enqueueScrapeIngestJob,
  getIngestQueue,
  getIngestChildQueue,
  getIngestDlqQueue,
  getIngestRetryQueue,
  getIngestQueueName,
  getIngestChildQueueName,
  getIngestDlqQueueName,
  getIngestRetryQueueName,
  getIngestRedisUrl,
  getIngestBullmqConnection,
};
