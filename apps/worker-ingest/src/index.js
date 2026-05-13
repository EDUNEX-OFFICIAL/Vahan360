"use strict";

const path = require("path");
const os = require("os");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
require("./telemetry");

const { releaseContext, shutdownPool } = require("./browserPool");
const { acquirePlaywrightContext } = require("./lib/browserManagerClient");
const { getQuotaStats } = require("./lib/tenantQuota");
const log = require("./lib/logger");
const workerMetrics = require("./lib/workerMetrics");
const { SelectorHealthMonitor } = require("./lib/selectorHealthMonitor");
const { runWithJobTraceContext } = require("./lib/runWithJobTraceContext");
const { trace, SpanStatusCode } = require("@opentelemetry/api");

const { Queue, Worker } = require("bullmq");
const IORedis = require("ioredis");
const {
  SCRAPE_JOB_KINDS,
  isIngestChildJobType,
  INGEST_CHILD_JOB_TYPES,
} = require("@vahan360/contracts");
const { createIngestPrismaClient } = require("@vahan360/db/ingest-client");

const { persistIngestArtifacts } = require("./persistJobArtifacts");
const { classifyPortalError, logClassifiedError } = require("./lib/portalErrorClassifier");

const DEFAULT_MASTER_QUEUE = "scrape-ingest";
const DEFAULT_CHILD_QUEUE = "scrape-ingest-child";
const DEFAULT_DLQ_QUEUE = "scrape-ingest-dlq";
const DEFAULT_RETRY_QUEUE = "scrape-ingest-retry";

/** Consecutive terminal child-queue failures (reset on successful child completion). */
let consecutiveChildFailures = 0;
const tracer = trace.getTracer("worker-ingest");

function isOtelEnabled() {
  return process.env.OTEL_ENABLED === "true" || process.env.OTEL_ENABLED === "1";
}

/**
 * @param {{ queueName: string, operation: string, bullJob: import("bullmq").Job }} args
 * @param {() => Promise<unknown>} fn
 */
async function withJobLifecycleSpan(args, fn) {
  if (!isOtelEnabled()) {
    return fn();
  }
  const { queueName, operation, bullJob } = args;
  return tracer.startActiveSpan(
    `worker.${operation}`,
    {
      attributes: {
        "messaging.system": "bullmq",
        "messaging.destination": queueName,
        "messaging.operation": "process",
        "app.job_id": bullJob?.id != null ? String(bullJob.id) : "unknown",
        ...(typeof bullJob?.data?.scrapeJobId === "string"
          ? { "app.scrape_job_id": bullJob.data.scrapeJobId }
          : {}),
        ...(typeof bullJob?.data?.correlationId === "string"
          ? { "app.correlation_id": bullJob.data.correlationId }
          : {}),
      },
    },
    async (span) => {
      try {
        const result = await fn();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        span.recordException(err);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err?.message || String(err),
        });
        throw err;
      } finally {
        span.end();
      }
    }
  );
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @returns {{ baseMs: number; maxMs: number; mult: number }} */
function getIngestChildBackoffConfig() {
  const rawBase = Number(process.env.INGEST_BACKOFF_BASE_MS);
  const baseMs =
    Number.isFinite(rawBase) && rawBase > 0 ? Math.floor(rawBase) : 0;
  const rawMax = Number(process.env.INGEST_BACKOFF_MAX_MS);
  const maxMs =
    Number.isFinite(rawMax) && rawMax > 0
      ? Math.floor(rawMax)
      : 30_000;
  const rawMult = Number(process.env.INGEST_BACKOFF_MULTIPLIER);
  const mult =
    Number.isFinite(rawMult) && rawMult > 0 ? rawMult : 2;
  return { baseMs, maxMs, mult };
}

/**
 * Map ScrapeJobKind → portal id for the selector registry. Unknown kinds skip
 * the registry probe (Playwright smoke still runs if URL is set).
 */
const KIND_TO_PORTAL = {
  khanan_date_range: "khanan-bihar",
  vehicle_permit_snapshot: "vahan-permit",
  vehicle_insurance_snapshot: "vahan-permit",
  vehicle_fitness_snapshot: "vahan-permit",
  vehicle_registration_snapshot: "vahan-permit",
  consigner_digest: "khanan-bihar",
  trip_intelligence_rollup: "khanan-bihar",
  raw_challan_backfill: null,
};

function isPlaywrightSmokeEnabled() {
  return (
    (process.env.PLAYWRIGHT_ENABLED === "true" ||
      process.env.PLAYWRIGHT_ENABLED === "1") &&
    typeof process.env.PLAYWRIGHT_SMOKE_URL === "string" &&
    process.env.PLAYWRIGHT_SMOKE_URL.trim().length > 0
  );
}

function envFlagTrue(name) {
  const v = process.env[name];
  if (v == null || String(v).trim() === "") return false;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function parsePositiveIntEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function getSelectorValidationConfig() {
  return {
    strict: envFlagTrue("SELECTOR_VALIDATION_STRICT"),
    failureThreshold: parsePositiveIntEnv("SELECTOR_ALERT_FAILURE_THRESHOLD", 5),
    windowMs: parsePositiveIntEnv("SELECTOR_ALERT_WINDOW_MS", 600_000),
    degradedCooldownMs: parsePositiveIntEnv(
      "SELECTOR_DEGRADED_COOLDOWN_MS",
      300_000
    ),
    pageKey: process.env.PLAYWRIGHT_SMOKE_PAGE_KEY?.trim() || "default",
  };
}

function getRequiredRedisUrl() {
  const redisUrl =
    process.env.BULLMQ_REDIS_URL?.trim() || process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    throw new Error("Set REDIS_URL or BULLMQ_REDIS_URL for BullMQ ingest worker");
  }
  return redisUrl;
}

function getRequiredDatabaseUrl() {
  const databaseUrl =
    process.env.INGEST_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("Set INGEST_DATABASE_URL or DATABASE_URL for ingest worker");
  }
  return databaseUrl;
}

function createConnection() {
  return new IORedis(getRequiredRedisUrl(), {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

function getQueueOptions(connection) {
  return {
    connection,
    defaultJobOptions: {
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
    },
  };
}

/** DLQ jobs are intentionally long-lived for ops triage. */
function getDlqQueueOptions(connection) {
  return {
    connection,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: {
        age: 14 * 24 * 60 * 60,
        count: 50_000,
      },
      removeOnFail: {
        age: 30 * 24 * 60 * 60,
        count: 10_000,
      },
    },
  };
}

function isIngestDlqEnabled() {
  return (
    process.env.INGEST_DLQ_ENABLED === "true" ||
    process.env.INGEST_DLQ_ENABLED === "1"
  );
}

function isIngestRetryWorkerEnabled() {
  return (
    process.env.INGEST_RETRY_WORKER_ENABLED === "true" ||
    process.env.INGEST_RETRY_WORKER_ENABLED === "1"
  );
}

/** When false, master + child BullMQ workers are not started (dedicated retry pod). */
function isMainWorkersEnabled() {
  const v = process.env.INGEST_MAIN_WORKERS_ENABLED;
  if (v === "false" || v === "0") return false;
  return true;
}

/** Spec §3: optional extra child jobs — one per `INGEST_CHILD_JOB_TYPES` entry (off by default). */
function isIngestFanoutAllChildTypesEnabled() {
  const v = process.env.INGEST_FANOUT_ALL_CHILD_TYPES;
  return v === "true" || v === "1";
}

/** @returns {number} */
function getIngestRetryMaxReplays() {
  const attempts = Number(process.env.INGEST_RETRY_MAX_REPLAY_ATTEMPTS);
  const legacy = Number(process.env.INGEST_RETRY_MAX_REPLAYS);
  if (Number.isFinite(attempts) && attempts > 0) return Math.floor(attempts);
  if (Number.isFinite(legacy) && legacy > 0) return Math.floor(legacy);
  return 5;
}

/**
 * Bull-side replay counter (survives DLQ copy). Prefer `replayAttempts`; optional
 * `dlqMeta.replayAttempts` when operators only touched DLQ metadata.
 * @param {Record<string, unknown>} data
 */
function readReplayAttempts(data) {
  const candidates = [data?.replayAttempts, data?.dlqMeta?.replayAttempts];
  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return 0;
}

/** Maps stub child steps to `IngestChildJobType` hints (contracts union). */
function childIngestTypeForStep(step) {
  if (step === "prepare") return "validation";
  if (step === "persist_stub_result") return "dedupe";
  return undefined;
}

/**
 * Drop DLQ-only fields and routing key `target` before enqueueing to master/child.
 * @param {Record<string, unknown>} data
 */
function stripForTargetQueue(data) {
  if (!data || typeof data !== "object") return {};
  const { failedReason, dlqMeta, target, ...rest } = data;
  return { ...rest };
}

/**
 * @param {Record<string, unknown>} raw
 * @param {string} childQueueName
 * @param {string} masterQueueName
 * @returns {"master"|"child"}
 */
function resolveRetryTarget(raw, childQueueName, masterQueueName) {
  const t = raw?.target;
  if (t === "master" || t === "child") return t;
  const src = raw?.dlqMeta?.sourceQueue;
  if (typeof src === "string") {
    if (src === childQueueName) return "child";
    if (src === masterQueueName) return "master";
  }
  return "master";
}

/**
 * BullMQ worker tuning for stuck / long-running jobs. Omit keys when unset.
 * @param {import("ioredis").Redis} connection
 * @param {number} concurrency
 */
function buildWorkerRuntimeOptions(connection, concurrency) {
  const out = { connection, concurrency };
  const lockMs = Number(process.env.BULLMQ_LOCK_DURATION_MS);
  if (Number.isFinite(lockMs) && lockMs >= 5000) {
    out.lockDuration = lockMs;
  }
  const stalledMs = Number(process.env.BULLMQ_STALLED_INTERVAL_MS);
  if (Number.isFinite(stalledMs) && stalledMs >= 5000) {
    out.stalledInterval = stalledMs;
  }
  return out;
}

/** @param {import("bullmq").Job} job */
function isTerminalBullFailure(job) {
  const attempts = Math.max(1, Number(job?.opts?.attempts) || 1);
  const made = Number(job?.attemptsMade) || 0;
  return made >= attempts;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @param {unknown} v */
function optionalUuidScrapeJobId(v) {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return UUID_RE.test(s) ? s : undefined;
}

/**
 * Best-effort row in `system.failed_jobs` when a Bull job exhausts retries.
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {import("bullmq").Job|undefined|null} job
 * @param {unknown} err
 * @param {string} queueName
 */
async function persistSystemFailedJob(prisma, job, err, queueName) {
  if (!job || !isTerminalBullFailure(job)) return;
  const raw = job.data && typeof job.data === "object" ? job.data : {};
  const errorMessage =
    err && typeof err === "object" && err !== null && "message" in err &&
    typeof err.message === "string"
      ? err.message
      : String(err);
  const errorStack =
    err && typeof err === "object" && err !== null && "stack" in err &&
    typeof err.stack === "string"
      ? err.stack
      : undefined;
  const scrapeJobId = optionalUuidScrapeJobId(raw.scrapeJobId);
  const correlationId =
    typeof raw.correlationId === "string" && raw.correlationId.trim()
      ? raw.correlationId.trim()
      : undefined;
  /** @type {Record<string, unknown>} */
  const payload = {};
  if (typeof raw.kind === "string") payload.kind = raw.kind;
  if (typeof raw.step === "string") payload.step = raw.step;
  if (typeof raw.type === "string") payload.type = raw.type;
  const attempts = Number.isFinite(Number(job.attemptsMade))
    ? Math.max(0, Math.floor(Number(job.attemptsMade)))
    : 0;
  try {
    await prisma.failedJob.create({
      data: {
        queueName,
        jobName:
          typeof job.name === "string" && job.name.trim() ? job.name : undefined,
        bullJobId: job.id != null ? String(job.id) : undefined,
        correlationId,
        scrapeJobId,
        payload: Object.keys(payload).length > 0 ? payload : undefined,
        errorMessage,
        errorStack,
        attempts,
      },
    });
  } catch (e) {
    log.warn({
      msg: "ingest.system_failed_jobs.write_failed",
      queueName,
      error: e?.message || String(e),
    });
  }
}

function isPlaywrightCrashLikeMessage(message) {
  if (typeof message !== "string" || !message.trim()) return false;
  return /crash|Target closed|has been closed|Browser closed|Protocol error|Chromium|SIGKILL|Target page/i.test(
    message
  );
}

function isValidKind(kind) {
  return SCRAPE_JOB_KINDS.includes(kind);
}

/** @param {Record<string, unknown>|undefined} data */
function w3cTraceJobFields(data) {
  if (!data) return {};
  const out = {};
  if (typeof data.traceparent === "string" && data.traceparent.trim()) {
    out.traceparent = data.traceparent.trim();
  }
  if (typeof data.tracestate === "string" && data.tracestate.trim()) {
    out.tracestate = data.tracestate.trim();
  }
  return out;
}

async function appendEvent(prisma, jobId, eventType, payload, level = "info") {
  await prisma.jobEvent.create({
    data: {
      jobId,
      level,
      eventType,
      payload,
    },
  });
}

async function runOptionalPlaywrightSmoke(
  prisma,
  scrapeJobId,
  kind,
  correlationId,
  selectorValidationConfig,
  selectorHealthMonitor
) {
  const smokeUrl = process.env.PLAYWRIGHT_SMOKE_URL.trim();
  const portalId = KIND_TO_PORTAL[kind] || null;
  const t0 = Date.now();
  /** @type {{ context: import("playwright-core").BrowserContext, release: () => Promise<void> }|null} */
  let browserHandle = null;

  try {
    // Lazy-load: keeps the worker bootable when playwright-core isn't on disk.
    const { runPlaywrightSmoke } = require("@vahan360/scraper-core");
    const tenantSlug =
      process.env.WORKER_TENANT_SLUG?.trim() ||
      process.env.WORKER_TENANT_ID?.trim() ||
      "default";
    browserHandle = await acquirePlaywrightContext({
      tenantId: tenantSlug,
      portalId: portalId || "_",
    });
    const result = await runPlaywrightSmoke({
      url: smokeUrl,
      portalId: portalId || undefined,
      timeoutMs: Number(process.env.PLAYWRIGHT_TIMEOUT_MS) || 20000,
      pageKey: selectorValidationConfig.pageKey,
      context: browserHandle.context,
    });
    const elapsedSec = (Date.now() - t0) / 1000;
    workerMetrics.observePortalRequestDuration(elapsedSec);
    if (result?.validation) {
      for (const probe of result.validation.probes || []) {
        workerMetrics.incrSelectorProbeResult({
          portalId: result.validation.portalId,
          pageKey: result.validation.pageKey,
          fieldKey: probe.fieldKey,
          outcome: probe.outcome,
        });
      }
    }
    if (result?.validation && result.validation.ok === false) {
      workerMetrics.incrSelectorValidationFailures();
      const failures = selectorHealthMonitor.recordFailure(
        result.validation.portalId || portalId || "unknown"
      );
      log.warn({
        msg: "selector_validation_failed",
        jobId: scrapeJobId,
        kind,
        correlationId,
        portalId: result.validation.portalId || portalId,
        pageKey: result.validation.pageKey,
        registryVersion: result.validation.version,
        missingCritical: result.validation.missingCritical,
        fallbackHits: result.validation.fallbackHits,
        failuresInWindow: failures.failuresInWindow,
        strict: selectorValidationConfig.strict,
      });
      await appendEvent(
        prisma,
        scrapeJobId,
        "selector.validation.failed",
        {
          runner: "playwright",
          kind,
          correlationId,
          portalId: result.validation.portalId || portalId,
          pageKey: result.validation.pageKey,
          registryVersion: result.validation.version,
          missingCritical: result.validation.missingCritical,
          fallbackHits: result.validation.fallbackHits,
          failuresInWindow: failures.failuresInWindow,
        },
        "warn"
      );
      if (failures.shouldAlert) {
        workerMetrics.incrSelectorPortalDegraded(
          result.validation.portalId || portalId || "unknown"
        );
        log.error({
          msg: "selector_portal_degraded",
          portalId: result.validation.portalId || portalId,
          pageKey: result.validation.pageKey,
          failuresInWindow: failures.failuresInWindow,
          threshold: selectorValidationConfig.failureThreshold,
          windowMs: selectorValidationConfig.windowMs,
        });
        await appendEvent(
          prisma,
          scrapeJobId,
          "selector.health.degraded",
          {
            runner: "playwright",
            portalId: result.validation.portalId || portalId,
            pageKey: result.validation.pageKey,
            failuresInWindow: failures.failuresInWindow,
            threshold: selectorValidationConfig.failureThreshold,
            windowMs: selectorValidationConfig.windowMs,
          },
          "warn"
        );
      }
      if (selectorValidationConfig.strict) {
        const err = new Error(
          `Selector validation failed for portal=${result.validation.portalId || portalId} page=${result.validation.pageKey} missing=${result.validation.missingCritical.join(",")}`
        );
        err.name = "SelectorValidationError";
        throw err;
      }
    }
    await appendEvent(prisma, scrapeJobId, "scrape.smoke.ok", {
      runner: "playwright",
      kind,
      correlationId,
      smokeUrl,
      portalId,
      title: result.title,
      finalUrl: result.finalUrl,
      loadMs: result.loadMs,
      registry: result.registry,
      validation: result.validation,
      progressPercent: 20,
    });
  } catch (err) {
    const elapsedSec = (Date.now() - t0) / 1000;
    workerMetrics.observePortalRequestDuration(elapsedSec);
    const message = err && err.message ? err.message : String(err);
    if (isPlaywrightCrashLikeMessage(message)) {
      workerMetrics.incrPlaywrightPageCrashes();
    }
    // Track quota rejections separately so ops can alert on them
    if (
      message.startsWith("browser_pool_tenant_quota_exceeded") ||
      message.startsWith("browser_pool_tenant_quota_timeout")
    ) {
      const tenantSlug =
        process.env.WORKER_TENANT_SLUG?.trim() ||
        process.env.WORKER_TENANT_ID?.trim() ||
        "default";
      workerMetrics.incrBrowserPoolTenantQuotaRejection(tenantSlug);
      log.warn({
        msg: "browser_pool_tenant_quota_rejected",
        jobId: scrapeJobId,
        kind,
        correlationId,
        tenantId: tenantSlug,
        error: message,
        quotaStats: getQuotaStats(),
      });
    }
    log.warn({
      msg: "playwright_smoke_failed",
      jobId: scrapeJobId,
      kind,
      correlationId,
      error: message,
    });
    await appendEvent(
      prisma,
      scrapeJobId,
      "scrape.smoke.failed",
      {
        runner: "playwright",
        kind,
        correlationId,
        smokeUrl,
        portalId,
        message: message.slice(0, 2000),
      },
      "warn"
    );
    if (
      selectorValidationConfig.strict &&
      err &&
      typeof err === "object" &&
      err.name === "SelectorValidationError"
    ) {
      throw err;
    }
  } finally {
    if (browserHandle) {
      await releaseContext(browserHandle).catch(() => {});
    }
  }
}

async function processMasterJob(
  bullJob,
  prisma,
  childQueue,
  selectorValidationConfig,
  selectorHealthMonitor
) {
  const { scrapeJobId, kind, correlationId, requestId } = bullJob.data || {};
  if (typeof scrapeJobId !== "string" || !isValidKind(kind)) {
    throw new Error("Invalid scrape-ingest job data");
  }

  log.info({
    msg: "ingest.master.job",
    jobId: scrapeJobId,
    bullJobId: String(bullJob.id),
    requestId: typeof requestId === "string" ? requestId : undefined,
    kind,
  });

  const row = await prisma.scrapeJob.findUnique({
    where: { id: scrapeJobId },
    select: { id: true, status: true, payload: true },
  });
  if (!row) {
    throw new Error(`Scrape job not found: ${scrapeJobId}`);
  }
  if (row.status === "succeeded") {
    return { skipped: true, reason: "already_succeeded" };
  }

  const claim = await prisma.scrapeJob.updateMany({
    where: {
      id: scrapeJobId,
      status: { in: ["queued", "failed"] },
    },
    data: {
      status: "running",
      startedAt: new Date(),
      completedAt: null,
      lastError: null,
    },
  });
  if (claim.count === 0) {
    await appendEvent(prisma, scrapeJobId, "job.skipped", {
      runner: "bullmq",
      status: row.status,
    });
    return { skipped: true, reason: `status_${row.status}` };
  }

  await appendEvent(prisma, scrapeJobId, "job.started", {
    runner: "bullmq",
    kind,
    correlationId,
    progressPercent: 0,
  });

  if (isPlaywrightSmokeEnabled()) {
    await runOptionalPlaywrightSmoke(
      prisma,
      scrapeJobId,
      kind,
      correlationId,
      selectorValidationConfig,
      selectorHealthMonitor
    );
  }

  const childSpecs = [
    { step: "prepare", progressPercent: 50 },
    { step: "persist_stub_result", progressPercent: 90 },
  ];

  const replayFromMaster =
    Number.isFinite(Number(bullJob.data?.replayAttempts)) &&
    Number(bullJob.data.replayAttempts) > 0
      ? { replayAttempts: Number(bullJob.data.replayAttempts) }
      : {};

  for (const child of childSpecs) {
    await childQueue.add(
      "child",
      {
        scrapeJobId,
        kind,
        correlationId,
        ...(typeof requestId === "string" && requestId.length > 0
          ? { requestId }
          : {}),
        ...replayFromMaster,
        ...w3cTraceJobFields(bullJob.data),
        ...child,
        type: childIngestTypeForStep(child.step),
      },
      {
        jobId: `${scrapeJobId}:${child.step}`,
      }
    );
  }

  let extraFanoutChildren = 0;
  if (isIngestFanoutAllChildTypesEnabled()) {
    const parentJobId = String(bullJob.id);
    log.warn({
      msg: "ingest.master.fanout_all_child_types",
      jobId: scrapeJobId,
      bullJobId: parentJobId,
      correlationId,
      kind,
      childTypes: INGEST_CHILD_JOB_TYPES.length,
      note: "high_queue_pressure_risk — tune INGEST_CHILD_CONCURRENCY / replicas / Redis",
    });
    for (const ingestType of INGEST_CHILD_JOB_TYPES) {
      const sliceKey = `${ingestType}:${Date.now()}`;
      await childQueue.add(
        "child",
        {
          scrapeJobId,
          kind,
          correlationId,
          parentJobId,
          ...(typeof requestId === "string" && requestId.length > 0
            ? { requestId }
            : {}),
          ...replayFromMaster,
          ...w3cTraceJobFields(bullJob.data),
          step: "multi_type_slice",
          progressPercent: 52,
          type: ingestType,
          sliceKey,
        },
        {
          jobId: `${scrapeJobId}:fanout-all:${ingestType}:${sliceKey}`,
        }
      );
      extraFanoutChildren += 1;
    }
  }

  await bullJob.updateProgress(90);
  return { enqueuedChildren: childSpecs.length + extraFanoutChildren };
}

async function processChildJob(bullJob, prisma) {
  const { scrapeJobId, kind, correlationId, step, progressPercent, requestId } =
    bullJob.data || {};
  if (typeof scrapeJobId !== "string" || !isValidKind(kind)) {
    throw new Error("Invalid scrape-ingest-child job data");
  }

  log.info({
    msg: "ingest.child.job",
    jobId: scrapeJobId,
    bullJobId: String(bullJob.id),
    requestId: typeof requestId === "string" ? requestId : undefined,
    kind,
    step,
  });

  const row = await prisma.scrapeJob.findUnique({
    where: { id: scrapeJobId },
    select: { id: true, status: true },
  });
  if (!row || row.status === "succeeded") {
    return { skipped: true };
  }

  await appendEvent(prisma, scrapeJobId, "job.progress", {
    runner: "bullmq-child",
    kind,
    correlationId,
    step,
    progressPercent,
  });
  await bullJob.updateProgress(progressPercent || 0);

  if (step === "persist_stub_result") {
    const jobRow = await prisma.scrapeJob.findUnique({
      where: { id: scrapeJobId },
      select: { payload: true, kind: true },
    });
    if (jobRow) {
      const effectiveKind =
        typeof jobRow.kind === "string" && jobRow.kind.length > 0
          ? jobRow.kind
          : kind;
      const artifactSummary = await persistIngestArtifacts(
        prisma,
        scrapeJobId,
        effectiveKind,
        jobRow.payload
      );
      if (
        artifactSummary.wrote.length > 0 ||
        artifactSummary.skippedDuplicate.length > 0
      ) {
        await appendEvent(prisma, scrapeJobId, "ingest.persisted", {
          runner: "bullmq-child",
          kind,
          correlationId,
          ...artifactSummary,
        });
      }
    }

    await prisma.scrapeJob.update({
      where: { id: scrapeJobId },
      data: {
        status: "succeeded",
        completedAt: new Date(),
        lastError: null,
      },
    });
    await appendEvent(prisma, scrapeJobId, "job.completed", {
      runner: "bullmq-child",
      kind,
      correlationId,
      progressPercent: 100,
    });
    await bullJob.updateProgress(100);
  }

  return { ok: true };
}

/**
 * Consumes `scrape-ingest-retry`: strips DLQ metadata, respects replay caps, then
 * re-adds to master or child (`target: 'child'` else master).
 * @param {import("bullmq").Job} bullJob
 * @param {import("bullmq").Queue} masterQueue
 * @param {import("bullmq").Queue} childQueue
 */
async function processRetryJob(
  bullJob,
  masterQueue,
  childQueue,
  retryQueueName,
  masterQueueName,
  childQueueName
) {
  const raw =
    bullJob.data && typeof bullJob.data === "object"
      ? /** @type {Record<string, unknown>} */ (bullJob.data)
      : {};
  const maxRepl = getIngestRetryMaxReplays();
  const attemptCount = readReplayAttempts(raw);
  if (maxRepl > 0 && attemptCount >= maxRepl) {
    workerMetrics.incrIngestRetryReplayGuarded();
    log.warn({
      msg: "ingest.retry.skipped_cap",
      scrapeJobId: raw.scrapeJobId,
      bullJobId: bullJob.id != null ? String(bullJob.id) : undefined,
      replayAttempts: attemptCount,
      maxRepl,
    });
    return { skipped: true, reason: "replay_cap" };
  }

  const nextReplay = attemptCount + 1;
  const base = stripForTargetQueue(raw);
  const withReplay = { ...base, replayAttempts: nextReplay };
  const tgt = resolveRetryTarget(raw, childQueueName, masterQueueName);

  if (tgt === "child") {
    const scrapeJobId = withReplay.scrapeJobId;
    const kind = withReplay.kind;
    const correlationId = withReplay.correlationId;
    const step = withReplay.step;
    if (
      typeof scrapeJobId !== "string" ||
      !isValidKind(kind) ||
      typeof correlationId !== "string" ||
      typeof step !== "string"
    ) {
      throw new Error(
        "ingest.retry.invalid_child_payload (need scrapeJobId, kind, correlationId, step)"
      );
    }
    const typeHint =
      typeof withReplay.type === "string" && isIngestChildJobType(withReplay.type)
        ? withReplay.type
        : childIngestTypeForStep(step);
    await childQueue.add(
      "child",
      {
        scrapeJobId,
        kind,
        correlationId,
        step,
        progressPercent:
          typeof withReplay.progressPercent === "number"
            ? withReplay.progressPercent
            : undefined,
        ...(typeof withReplay.requestId === "string" && withReplay.requestId.length > 0
          ? { requestId: withReplay.requestId }
          : {}),
        ...w3cTraceJobFields(withReplay),
        type: typeHint,
        replayAttempts: nextReplay,
      },
      { jobId: `${scrapeJobId}:${step}` }
    );
  } else {
    const scrapeJobId = withReplay.scrapeJobId;
    const kind = withReplay.kind;
    const correlationId = withReplay.correlationId;
    if (
      typeof scrapeJobId !== "string" ||
      !isValidKind(kind) ||
      typeof correlationId !== "string"
    ) {
      throw new Error(
        "ingest.retry.invalid_master_payload (need scrapeJobId, kind, correlationId)"
      );
    }
    await masterQueue.add(
      "master",
      {
        scrapeJobId,
        kind,
        correlationId,
        ...(typeof withReplay.requestId === "string" && withReplay.requestId.length > 0
          ? { requestId: withReplay.requestId }
          : {}),
        ...w3cTraceJobFields(withReplay),
        replayAttempts: nextReplay,
      },
      { jobId: scrapeJobId }
    );
  }

  workerMetrics.incrIngestRetryReplayed(tgt);
  workerMetrics.incrWorkerJobsRetried(retryQueueName, tgt);
  log.info({
    msg: "ingest.retry.replayed",
    target: tgt,
    scrapeJobId: withReplay.scrapeJobId,
    bullJobId: bullJob.id != null ? String(bullJob.id) : undefined,
    replayAttempts: nextReplay,
  });
  return { replayed: true, target: tgt };
}

async function markFailed(prisma, jobData, err) {
  const scrapeJobId = jobData?.scrapeJobId;
  if (typeof scrapeJobId !== "string") return;

  const message = err?.message || String(err);
  await prisma.scrapeJob.updateMany({
    where: { id: scrapeJobId },
    data: {
      status: "failed",
      completedAt: new Date(),
      lastError: message.slice(0, 4000),
    },
  });
  await appendEvent(
    prisma,
    scrapeJobId,
    "job.failed",
    {
      runner: "bullmq",
      message,
    },
    "error"
  );
}

async function main() {
  const masterQueueName =
    process.env.INGEST_QUEUE_NAME?.trim() || DEFAULT_MASTER_QUEUE;
  const childQueueName =
    process.env.INGEST_CHILD_QUEUE_NAME?.trim() || DEFAULT_CHILD_QUEUE;
  const dlqQueueName =
    process.env.INGEST_DLQ_QUEUE_NAME?.trim() || DEFAULT_DLQ_QUEUE;
  const retryQueueName =
    process.env.INGEST_RETRY_QUEUE_NAME?.trim() || DEFAULT_RETRY_QUEUE;
  const selectorValidationConfig = getSelectorValidationConfig();
  const selectorHealthMonitor = new SelectorHealthMonitor(selectorValidationConfig);

  const prisma = createIngestPrismaClient({
    datasources: { db: { url: getRequiredDatabaseUrl() } },
  });
  const connection = createConnection();
  connection.on("error", (err) => {
    log.warn({
      msg: "worker_ingest_redis_connection_warning",
      error: err?.message || String(err),
    });
  });

  const childQueue = new Queue(childQueueName, getQueueOptions(connection));
  const masterQueueForMetrics = new Queue(
    masterQueueName,
    getQueueOptions(connection)
  );
  const dlqQueue = new Queue(dlqQueueName, getDlqQueueOptions(connection));
  const retryQueue = new Queue(retryQueueName, getQueueOptions(connection));

  const metricsServer = workerMetrics.startMetricsHttpServer();
  const METRICS_MS = Math.min(
    300_000,
    Math.max(10_000, Number(process.env.QUEUE_METRICS_INTERVAL_MS) || 30_000)
  );

  function jobDepth(counts) {
    return (
      (counts.waiting || 0) +
      (counts.delayed || 0) +
      (counts.active || 0) +
      (counts.prioritized || 0)
    );
  }

  async function recordQueueMetrics() {
    const [masterCounts, childCounts, dlqCounts, retryCounts] =
      await Promise.all([
        masterQueueForMetrics.getJobCounts(),
        childQueue.getJobCounts(),
        dlqQueue.getJobCounts(),
        retryQueue.getJobCounts(),
      ]);
    workerMetrics.refreshQueueDepthGauge({
      [masterQueueName]: jobDepth(masterCounts),
      [childQueueName]: jobDepth(childCounts),
      [dlqQueueName]: jobDepth(dlqCounts),
      [retryQueueName]: jobDepth(retryCounts),
    });
    const takenAt = new Date().toISOString();
    await prisma.queueMetric.createMany({
      data: [
        {
          queueName: masterQueueName,
          sample: {
            takenAt,
            jobCounts: masterCounts,
            depth: jobDepth(masterCounts),
          },
        },
        {
          queueName: childQueueName,
          sample: {
            takenAt,
            jobCounts: childCounts,
            depth: jobDepth(childCounts),
          },
        },
        {
          queueName: dlqQueueName,
          sample: {
            takenAt,
            jobCounts: dlqCounts,
            depth: jobDepth(dlqCounts),
          },
        },
        {
          queueName: retryQueueName,
          sample: {
            takenAt,
            jobCounts: retryCounts,
            depth: jobDepth(retryCounts),
          },
        },
      ],
    });
  }

  await recordQueueMetrics().catch((e) => {
    log.warn({
      msg: "worker_ingest_initial_queue_metrics_failed",
      error: e?.message || String(e),
    });
  });
  const metricsTimer = setInterval(() => {
    void recordQueueMetrics().catch((e) => {
      log.warn({
        msg: "queue_metrics.write_failed",
        error: e?.message || String(e),
      });
    });
  }, METRICS_MS);

  if (!isMainWorkersEnabled() && !isIngestRetryWorkerEnabled()) {
    throw new Error(
      "[worker-ingest] Refusing to start: INGEST_MAIN_WORKERS_ENABLED=false and INGEST_RETRY_WORKER_ENABLED is off"
    );
  }

  const masterConc = Number(process.env.INGEST_WORKER_CONCURRENCY || 2);
  const childConc = Number(process.env.INGEST_CHILD_CONCURRENCY || 4);

  /** @type {import("bullmq").Worker | null} */
  let masterWorker = null;
  /** @type {import("bullmq").Worker | null} */
  let childWorker = null;

  if (isMainWorkersEnabled()) {
    masterWorker = new Worker(
      masterQueueName,
      (job) =>
        runWithJobTraceContext(job.data, () =>
          withJobLifecycleSpan(
            {
              queueName: masterQueueName,
              operation: "process_master",
              bullJob: job,
            },
            () =>
              processMasterJob(
                job,
                prisma,
                childQueue,
                selectorValidationConfig,
                selectorHealthMonitor
              )
          )
        ),
      buildWorkerRuntimeOptions(connection, masterConc)
    );
    childWorker = new Worker(
      childQueueName,
      (job) =>
        runWithJobTraceContext(job.data, () =>
          withJobLifecycleSpan(
            {
              queueName: childQueueName,
              operation: "process_child",
              bullJob: job,
            },
            () => processChildJob(job, prisma)
          )
        ),
      buildWorkerRuntimeOptions(connection, childConc)
    );
    masterWorker.on("completed", () => {
      workerMetrics.incrWorkerJobsProcessed(masterQueueName);
    });
    childWorker.on("completed", () => {
      consecutiveChildFailures = 0;
      workerMetrics.incrWorkerJobsProcessed(childQueueName);
    });
  } else {
    log.info({
      msg: "ingest_main_workers_disabled",
    });
  }

  /** @type {import("bullmq").Worker | null} */
  let retryWorker = null;
  const retryConc = Math.max(
    1,
    Math.floor(Number(process.env.INGEST_RETRY_WORKER_CONCURRENCY) || 1)
  );
  if (isIngestRetryWorkerEnabled()) {
    retryWorker = new Worker(
      retryQueueName,
      (job) =>
        runWithJobTraceContext(job.data, () =>
          withJobLifecycleSpan(
            {
              queueName: retryQueueName,
              operation: "process_retry",
              bullJob: job,
            },
            () =>
              processRetryJob(
                job,
                masterQueueForMetrics,
                childQueue,
                retryQueueName,
                masterQueueName,
                childQueueName
              )
          )
        ),
      buildWorkerRuntimeOptions(connection, retryConc)
    );
    retryWorker.on("completed", () => {
      workerMetrics.incrWorkerJobsProcessed(retryQueueName);
    });
    retryWorker.on("failed", async (job, err) => {
      workerMetrics.incrWorkerJobsFailed(retryQueueName);
      log.error({
        msg: "ingest.retry.worker_job_failed",
        jobId: job?.data?.scrapeJobId,
        bullJobId: job?.id != null ? String(job.id) : undefined,
        error: err?.message || String(err),
      });
      await persistSystemFailedJob(prisma, job, err, retryQueueName);
    });
  }

  async function recordTerminalFailureOnDlq(job, err, sourceQueueName) {
    if (!isIngestDlqEnabled() || !job) return;
    if (!isTerminalBullFailure(job)) return;
    const failedReason = err?.message || String(err);
    const raw = job.data && typeof job.data === "object" ? job.data : {};
    const payload = {
      ...raw,
      failedReason,
      dlqMeta: {
        sourceQueue: sourceQueueName,
        sourceJobId: job.id != null ? String(job.id) : undefined,
        sourceJobName: job.name,
        failedAt: new Date().toISOString(),
        attemptsMade: job.attemptsMade,
        maxAttempts: job.opts?.attempts,
      },
    };
    const sid =
      typeof raw.scrapeJobId === "string" ? raw.scrapeJobId : "unknown";
    try {
      await dlqQueue.add("dlq", payload, {
        jobId: `dlq:${sourceQueueName}:${String(job.id)}:${Date.now()}`,
      });
      await persistSystemFailedJob(prisma, job, err, dlqQueueName);
    } catch (e) {
      log.error({
        msg: "ingest.dlq.enqueue_failed",
        jobId: sid,
        error: e?.message || String(e),
      });
    }
  }

  const workerId =
    process.env.WORKER_ID?.trim() ||
    `${os.hostname()}-${crypto.randomBytes(4).toString("hex")}`;

  const HEARTBEAT_MS = Math.min(
    120_000,
    Math.max(5000, Number(process.env.WORKER_HEARTBEAT_INTERVAL_MS) || 15_000)
  );

  async function upsertWorkerHeartbeat(reason) {
    let leaseCount = null;
    try {
      let a = 0;
      let b = 0;
      let c = 0;
      if (
        masterWorker &&
        typeof masterWorker.getRunningCount === "function"
      ) {
        a = await masterWorker.getRunningCount();
      }
      if (childWorker && typeof childWorker.getRunningCount === "function") {
        b = await childWorker.getRunningCount();
      }
      if (retryWorker && typeof retryWorker.getRunningCount === "function") {
        c = await retryWorker.getRunningCount();
      }
      leaseCount = a + b + c;
    } catch {
      /* optional BullMQ version surface */
    }

    await prisma.workerStatus.upsert({
      where: { workerId },
      create: {
        workerId,
        queueName: `${masterQueueName},${childQueueName},${dlqQueueName},${retryQueueName}`,
        status: "alive",
        lastHeartbeat: new Date(),
        detail: {
          reason,
          masterQueueName,
          childQueueName,
          dlqQueueName,
          retryQueueName,
          ingestDlqEnabled: isIngestDlqEnabled(),
          ingestMainWorkersEnabled: isMainWorkersEnabled(),
          ingestRetryWorkerEnabled: isIngestRetryWorkerEnabled(),
          leaseCount,
        },
      },
      update: {
        queueName: `${masterQueueName},${childQueueName},${dlqQueueName},${retryQueueName}`,
        status: "alive",
        lastHeartbeat: new Date(),
        detail: {
          reason,
          masterQueueName,
          childQueueName,
          dlqQueueName,
          retryQueueName,
          ingestDlqEnabled: isIngestDlqEnabled(),
          ingestMainWorkersEnabled: isMainWorkersEnabled(),
          ingestRetryWorkerEnabled: isIngestRetryWorkerEnabled(),
          leaseCount,
        },
      },
    });
  }

  await upsertWorkerHeartbeat("startup").catch((e) => {
    log.warn({
      msg: "worker_ingest_initial_heartbeat_failed",
      error: e?.message || String(e),
    });
  });
  const heartbeatTimer = setInterval(() => {
    void upsertWorkerHeartbeat("interval").catch((e) => {
      log.warn({
        msg: "worker_ingest_heartbeat_failed",
        error: e?.message || String(e),
      });
    });
  }, HEARTBEAT_MS);

  if (masterWorker) {
    masterWorker.on("failed", async (job, err) => {
      workerMetrics.incrWorkerJobsFailed(masterQueueName);
      const kind = typeof job?.data?.kind === "string" ? job.data.kind : undefined;
      const portalId = kind ? (KIND_TO_PORTAL[kind] ?? null) : null;
      const classified = classifyPortalError(err, portalId);
      logClassifiedError(log, {
        portalId,
        kind: kind || "unknown",
        scrapeJobId: typeof job?.data?.scrapeJobId === "string" ? job.data.scrapeJobId : "unknown",
        classified,
      });
      log.error({
        msg: "ingest.master.failed",
        jobId: job?.data?.scrapeJobId,
        bullJobId: job?.id != null ? String(job.id) : undefined,
        requestId:
          typeof job?.data?.requestId === "string" ? job.data.requestId : undefined,
        error: err?.message || String(err),
        errorClass: classified.class,
        retryable: classified.retryable,
      });
      await recordTerminalFailureOnDlq(job, err, masterQueueName);
      await persistSystemFailedJob(prisma, job, err, masterQueueName);
      await markFailed(prisma, job?.data, err);
    });
  }
  if (childWorker) {
    childWorker.on("failed", async (job, err) => {
      workerMetrics.incrWorkerJobsFailed(childQueueName);
      const kind = typeof job?.data?.kind === "string" ? job.data.kind : undefined;
      const portalId = kind ? (KIND_TO_PORTAL[kind] ?? null) : null;
      const classified = classifyPortalError(err, portalId);
      logClassifiedError(log, {
        portalId,
        kind: kind || "unknown",
        scrapeJobId: typeof job?.data?.scrapeJobId === "string" ? job.data.scrapeJobId : "unknown",
        classified,
      });
      log.error({
        msg: "ingest.child.failed",
        jobId: job?.data?.scrapeJobId,
        bullJobId: job?.id != null ? String(job.id) : undefined,
        requestId:
          typeof job?.data?.requestId === "string" ? job.data.requestId : undefined,
        error: err?.message || String(err),
        errorClass: classified.class,
        retryable: classified.retryable,
      });
      if (isTerminalBullFailure(job)) {
        consecutiveChildFailures += 1;
        const { baseMs, maxMs, mult } = getIngestChildBackoffConfig();
        if (baseMs > 0) {
          const rawBackoff = baseMs * mult ** consecutiveChildFailures;
          const backoffMs = Math.min(Math.floor(rawBackoff), maxMs);
          log.warn({
            msg: "ingest.child.backoff",
            jobId: job?.data?.scrapeJobId,
            bullJobId: job?.id != null ? String(job.id) : undefined,
            backoffMs,
            consecutiveChildFailures,
          });
          await sleep(backoffMs);
        }
      }
      await recordTerminalFailureOnDlq(job, err, childQueueName);
      await persistSystemFailedJob(prisma, job, err, childQueueName);
      await markFailed(prisma, job?.data, err);
    });
  }

  const listenParts = [];
  if (isMainWorkersEnabled()) {
    listenParts.push(`${masterQueueName}, ${childQueueName}`);
  }
  if (isIngestRetryWorkerEnabled()) {
    listenParts.push(`retry consumer ${retryQueueName}`);
  }
  log.info({
    msg: "worker_ingest_listen",
    queues: listenParts.join(" | "),
    dlqQueueName,
    ingestRetry: isIngestRetryWorkerEnabled(),
    ingestDlq: isIngestDlqEnabled(),
    ingestMainWorkers: isMainWorkersEnabled(),
  });

  async function shutdown(signal) {
    log.info({ msg: "worker_ingest_shutdown", signal });
    clearInterval(heartbeatTimer);
    clearInterval(metricsTimer);
    const closes = [
      masterWorker ? masterWorker.close() : Promise.resolve(),
      childWorker ? childWorker.close() : Promise.resolve(),
      masterQueueForMetrics.close(),
      childQueue.close(),
      dlqQueue.close(),
      retryQueue.close(),
      prisma.$disconnect(),
      connection.quit(),
      shutdownPool().catch(() => {}),
    ];
    if (retryWorker) closes.push(retryWorker.close());
    await Promise.allSettled(closes);
    if (metricsServer && typeof metricsServer.close === "function") {
      await new Promise((resolve) => {
        metricsServer.close(() => resolve(undefined));
      });
    }
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log.error({
    msg: "worker_ingest_fatal",
    error: err?.message || String(err),
    stack: typeof err?.stack === "string" ? err.stack : undefined,
  });
  process.exit(1);
});
