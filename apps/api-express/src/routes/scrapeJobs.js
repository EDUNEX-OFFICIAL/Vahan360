"use strict";

const express = require("express");
const crypto = require("crypto");
const { trace, SpanStatusCode } = require("@opentelemetry/api");
const rateLimit = require("express-rate-limit");
const { getIngestPrisma } = require("../lib/ingestPrisma");
const { enqueueScrapeIngestJob } = require("../lib/ingestQueue");
const { isScrapeJobKind } = require("../lib/jobKinds");
const { incrScrapeJobsEnqueued } = require("../lib/metrics");
const log = require("../lib/logger");
const { validateScrapeRange } = require("../utils/scrapeRangeValidation");
const { tenantScopeMiddleware } = require("../middleware/tenantScope");

const router = express.Router();
const tracer = trace.getTracer("vahan360-api-express");

function scrapeLimitWindowMs() {
  const n = Number(process.env.RATE_LIMIT_WINDOW_MS);
  return Number.isFinite(n) && n > 0 ? n : 60_000;
}

function scrapeLimitMax() {
  const n = Number(process.env.RATE_LIMIT_SCRAPE_MAX);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

/** @param {import("express").Request} req */
function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

const scrapeEnqueueIpLimiter = rateLimit({
  windowMs: scrapeLimitWindowMs(),
  max: scrapeLimitMax(),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `scrape-enqueue:ip:${clientIp(req)}`,
  handler: (req, res) => {
    res.status(429).json({
      error:
        "Too many scrape-job enqueue requests for this IP. Try again after the rate limit window.",
      requestId: req.requestId,
    });
  },
});

const scrapeEnqueueUserLimiter = rateLimit({
  windowMs: scrapeLimitWindowMs(),
  max: scrapeLimitMax(),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !req.user?.username,
  keyGenerator: (req) => `scrape-enqueue:user:${req.user.username}`,
  handler: (req, res) => {
    res.status(429).json({
      error:
        "Too many scrape-job enqueue requests for this user account. Try again after the rate limit window.",
      requestId: req.requestId,
    });
  },
});

/**
 * @param {ReturnType<typeof getIngestPrisma>} prisma
 * @param {{ actor: string | null, resourceId: string, extra?: Record<string, unknown> }} args
 */
async function recordScrapeJobEnqueueAudit(prisma, { actor, resourceId, extra }) {
  try {
    await prisma.auditLog.create({
      data: {
        actor,
        action: "scrape_job.enqueue",
        resource: "scrape_job",
        payload: { resourceId, ...(extra || {}) },
      },
    });
  } catch (err) {
    log.warn({
      msg: "scrape_job.audit_write_failed",
      error: err?.message || String(err),
      resourceId,
    });
  }
}

/**
 * @param {unknown} body
 * @returns {{ ok: true, payload: Record<string, unknown>, scrapePriority?: number } | { ok: false, error: string, status?: number }}
 */
function validateEnqueueBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "JSON body object required", status: 400 };
  }
  const o = /** @type {Record<string, unknown>} */ (body);
  const kind = o.kind;
  if (!isScrapeJobKind(kind)) {
    return { ok: false, error: "Invalid or missing scrape job kind", status: 400 };
  }
  const correlationId = o.correlationId;
  if (
    typeof correlationId !== "string" ||
    correlationId.trim().length === 0
  ) {
    return {
      ok: false,
      error: "correlationId (non-empty string) is required",
      status: 400,
    };
  }
  if (Object.prototype.hasOwnProperty.call(o, "priority")) {
    const p = o.priority;
    if (
      typeof p !== "number" ||
      !Number.isInteger(p) ||
      p < 1 ||
      p > 10
    ) {
      return {
        ok: false,
        error: "priority must be an integer from 1 to 10 when provided",
        status: 400,
      };
    }
    return { ok: true, payload: o, scrapePriority: p };
  }
  return { ok: true, payload: o };
}

/**
 * @param {{ jobId: string, kind: string, reused: boolean, bullmq?: Record<string, unknown> }} args
 */
function acceptedJobResponse({ jobId, kind, reused, bullmq }) {
  return {
    jobId,
    kind,
    status: "queued",
    reused,
    acceptedAt: new Date().toISOString(),
    ...(bullmq ? { bullmq } : {}),
  };
}

/**
 * Idempotency-Key header (preferred) or body.idempotencyKey
 * @param {import("express").Request} req
 * @param {Record<string, unknown>} body
 * @returns {string | undefined}
 */
function resolveIdempotencyKey(req, body) {
  const h = req.get("Idempotency-Key")?.trim();
  if (h) return h.length > 0 ? h : undefined;
  const b = body.idempotencyKey;
  if (typeof b === "string" && b.trim().length > 0) return b.trim();
  return undefined;
}

/** @param {string} id */
function isUuid(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id
  );
}

const MAX_EVENT_LIMIT = 200;
const DEFAULT_EVENT_LIMIT = 25;

/** Kinds that require `vehicleRegNo` on the enqueue body. */
const VEHICLE_REG_KINDS = new Set([
  "vehicle_permit_snapshot",
  "vehicle_insurance_snapshot",
  "vehicle_fitness_snapshot",
  "vehicle_registration_snapshot",
  "trip_intelligence_rollup",
]);

/**
 * @param {string} kind
 * @param {Record<string, unknown>} payload
 * @returns {{ ok: true } | { ok: false, error: string, status: number }}
 */
function validateKindSpecificFields(kind, payload) {
  if (VEHICLE_REG_KINDS.has(kind)) {
    const v = payload.vehicleRegNo;
    if (typeof v !== "string" || v.trim().length === 0) {
      return {
        ok: false,
        error: `${kind} requires a non-empty string vehicleRegNo`,
        status: 400,
      };
    }
  }
  if (kind === "consigner_digest") {
    const c = payload.consignerKey;
    if (typeof c !== "string" || c.trim().length === 0) {
      return {
        ok: false,
        error: "consigner_digest requires a non-empty string consignerKey",
        status: 400,
      };
    }
  }
  return { ok: true };
}

/**
 * Pick the most recent `job.progress` / `job.completed` event and surface a
 * caller-friendly summary alongside raw payload bits. Returns `null` when no
 * recognisable progress events exist yet.
 *
 * @param {Array<{ eventType: string, occurredAt: Date, payload: unknown }>} events
 * @returns {{ percent: number | null, lastEventType: string, occurredAt: string, payload: unknown } | null}
 */
function aggregateProgress(events) {
  if (!Array.isArray(events) || events.length === 0) return null;
  const progressEvents = events.filter(
    (e) =>
      e.eventType === "job.progress" ||
      e.eventType === "job.started" ||
      e.eventType === "job.completed" ||
      e.eventType === "job.failed" ||
      e.eventType === "scrape.smoke.ok" ||
      e.eventType === "ingest.persisted"
  );
  const newest = progressEvents[0]; // events come ordered desc
  if (!newest) return null;

  let percent = null;
  if (
    newest.payload &&
    typeof newest.payload === "object" &&
    !Array.isArray(newest.payload) &&
    typeof newest.payload.progressPercent === "number"
  ) {
    percent = newest.payload.progressPercent;
  } else if (newest.eventType === "job.completed") {
    percent = 100;
  } else if (newest.eventType === "job.failed") {
    percent = null;
  } else if (newest.eventType === "ingest.persisted") {
    percent = 95;
  }

  return {
    percent,
    lastEventType: newest.eventType,
    occurredAt: newest.occurredAt.toISOString(),
    payload: newest.payload,
  };
}

/**
 * POST /api/v1/scrape-jobs — enqueue async scrape (no Puppeteer here).
 */
router.post("/", tenantScopeMiddleware, scrapeEnqueueIpLimiter, scrapeEnqueueUserLimiter, async (req, res) => {
  const parsed = validateEnqueueBody(req.body);
  if (!parsed.ok) {
    return res.status(parsed.status || 400).json({ error: parsed.error });
  }

  if (String(parsed.payload.kind) === "khanan_date_range") {
    const p = /** @type {Record<string, unknown>} */ (parsed.payload);
    const fromDate = p.fromDate;
    const toDate = p.toDate;
    if (typeof fromDate !== "string" || typeof toDate !== "string") {
      return res.status(400).json({
        error: "khanan_date_range requires string fromDate and toDate",
      });
    }
    const rangeOk = validateScrapeRange(fromDate, toDate);
    if (!rangeOk.ok) {
      return res.status(rangeOk.status).json({ error: rangeOk.error });
    }
  }

  const kindStr = String(parsed.payload.kind);
  const kindFields = validateKindSpecificFields(
    kindStr,
    /** @type {Record<string, unknown>} */ (parsed.payload)
  );
  if (!kindFields.ok) {
    return res.status(kindFields.status || 400).json({ error: kindFields.error });
  }

  const idempotencyKey = resolveIdempotencyKey(req, parsed.payload);
  const prisma = getIngestPrisma();

  const scrapePriority =
    "scrapePriority" in parsed ? parsed.scrapePriority : undefined;
  const { idempotencyKey: _ik, priority: _priorityField, ...rest } =
    parsed.payload;
  const payloadJson = /** @type {import("@prisma/client").Prisma.InputJsonValue} */ (
    rest
  );

  if (idempotencyKey) {
    const existing = await prisma.scrapeJob.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (existing) {
      await recordScrapeJobEnqueueAudit(prisma, {
        actor: req.user?.username ?? null,
        resourceId: existing.id,
        extra: {
          reused: true,
          idempotencyKey: idempotencyKey || undefined,
        },
      });
      log.info({
        msg: "scrape_job.accepted",
        requestId: req.requestId,
        jobId: existing.id,
        kind: String(parsed.payload.kind),
        reused: true,
      });
      return res.status(202).json(
        acceptedJobResponse({
          jobId: existing.id,
          kind: String(parsed.payload.kind),
          reused: true,
        })
      );
    }
  }

  try {
    const job = await prisma.scrapeJob.create({
      data: {
        id: crypto.randomUUID(),
        kind: String(parsed.payload.kind),
        status: "queued",
        payload: payloadJson,
        idempotencyKey: idempotencyKey ?? null,
        priority: typeof scrapePriority === "number" ? scrapePriority : 0,
        tenantId: req.tenantId || "default",
      },
      select: { id: true },
    });

    const kind = String(parsed.payload.kind);
    const correlationId = String(parsed.payload.correlationId);
    let bullmq = { enqueued: false };
    await tracer.startActiveSpan("queue.enqueue.scrape_job", async (span) => {
      span.setAttribute("messaging.system", "bullmq");
      span.setAttribute("messaging.destination", "scrape-ingest");
      span.setAttribute("app.scrape_job_id", job.id);
      span.setAttribute("app.kind", kind);
      span.setAttribute("app.correlation_id", correlationId);
      try {
        bullmq = await enqueueScrapeIngestJob({
          scrapeJobId: job.id,
          kind,
          correlationId,
          requestId: req.requestId,
          queuePriority: scrapePriority,
        });
        if (bullmq?.enqueued) {
          span.setStatus({ code: SpanStatusCode.OK });
        } else {
          span.setStatus({ code: SpanStatusCode.ERROR, message: "enqueue_not_acknowledged" });
        }
      } catch (err) {
        span.recordException(err);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err?.message || String(err),
        });
        log.warn({
          msg: "scrape_job.enqueue_failed",
          requestId: req.requestId,
          scrapeJobId: job.id,
          kind,
          correlationId,
          error: err?.message || String(err),
        });
        bullmq = { enqueued: false, reason: "enqueue_failed" };
      } finally {
        span.end();
      }
    });

    incrScrapeJobsEnqueued(
      kind,
      bullmq?.enqueued ? "success" : "failure"
    );
    if (!bullmq?.enqueued) {
      log.warn({
        msg: "scrape_job.enqueue_fallback_to_db_queue",
        requestId: req.requestId,
        scrapeJobId: job.id,
        kind,
        correlationId,
        reason: bullmq?.reason || "enqueue_failed",
      });
    }

    await recordScrapeJobEnqueueAudit(prisma, {
      actor: req.user?.username ?? null,
      resourceId: job.id,
      extra: {
        reused: false,
        kind,
        correlationId,
        bullmq,
        idempotencyKey: idempotencyKey || undefined,
        ...(typeof scrapePriority === "number"
          ? { priority: scrapePriority }
          : {}),
      },
    });
    log.info({
      msg: "scrape_job.accepted",
      requestId: req.requestId,
      correlationId,
      jobId: job.id,
      kind,
      reused: false,
      bullmqEnqueued: Boolean(bullmq?.enqueued),
      ...(typeof scrapePriority === "number"
        ? { priority: scrapePriority }
        : {}),
    });
    return res.status(202).json(
      acceptedJobResponse({
        jobId: job.id,
        kind: String(parsed.payload.kind),
        reused: false,
        bullmq,
      })
    );
  } catch (e) {
    if (
      e &&
      typeof e === "object" &&
      "code" in e &&
      e.code === "P2002" &&
      idempotencyKey
    ) {
      const row = await prisma.scrapeJob.findUnique({
        where: { idempotencyKey },
        select: { id: true },
      });
      if (row) {
        await recordScrapeJobEnqueueAudit(prisma, {
          actor: req.user?.username ?? null,
          resourceId: row.id,
          extra: { reused: true, race: true, idempotencyKey: idempotencyKey || undefined },
        });
        log.info({
          msg: "scrape_job.accepted",
          requestId: req.requestId,
          jobId: row.id,
          kind: String(parsed.payload.kind),
          reused: true,
          race: true,
        });
        return res.status(202).json(
          acceptedJobResponse({
            jobId: row.id,
            kind: String(parsed.payload.kind),
            reused: true,
          })
        );
      }
    }
    incrScrapeJobsEnqueued(
      String(parsed.payload.kind),
      "failure"
    );
    log.error({
      msg: "scrape_job.enqueue_unhandled_error",
      requestId: req.requestId,
      correlationId:
        typeof parsed.payload?.correlationId === "string"
          ? parsed.payload.correlationId
          : undefined,
      error: e?.message || String(e),
    });
    return res.status(500).json({ error: "Failed to enqueue job" });
  }
});

/**
 * GET /api/v1/scrape-jobs/:id
 * Returns job row + last 5 events + a structured `progress` summary computed
 * across recent events.
 */
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    return res.status(400).json({ error: "Invalid job id" });
  }
  const prisma = getIngestPrisma();
  const job = await prisma.scrapeJob.findUnique({
    where: { id },
    select: {
      id: true,
      kind: true,
      status: true,
      priority: true,
      lastError: true,
      createdAt: true,
      updatedAt: true,
      startedAt: true,
      completedAt: true,
      events: {
        orderBy: { occurredAt: "desc" },
        take: 5,
        select: {
          id: true,
          level: true,
          eventType: true,
          occurredAt: true,
          payload: true,
        },
      },
    },
  });
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }
  return res.json({
    id: job.id,
    kind: job.kind,
    status: job.status,
    priority: job.priority,
    lastError: job.lastError,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    startedAt: job.startedAt ? job.startedAt.toISOString() : null,
    completedAt: job.completedAt ? job.completedAt.toISOString() : null,
    progress: aggregateProgress(job.events),
    events: job.events.map((event) => ({
      id: event.id.toString(),
      level: event.level,
      eventType: event.eventType,
      occurredAt: event.occurredAt.toISOString(),
      payload: event.payload,
    })),
  });
});

/**
 * GET /api/v1/scrape-jobs/:id/events?cursor=&limit=
 *
 * Cursor-paginated, newest-first stream of `job_events`. Cursor is the
 * opaque BigInt `id` of the last event the caller received (we paginate by
 * id desc to stay stable when occurredAt ties — id is monotonic). Backed by
 * the composite `(job_id, occurred_at DESC)` index from the initial
 * migration; no schema change required.
 */
router.get("/:id/events", async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    return res.status(400).json({ error: "Invalid job id" });
  }

  const rawLimit = Number(req.query.limit);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(MAX_EVENT_LIMIT, Math.floor(rawLimit))
      : DEFAULT_EVENT_LIMIT;

  /** @type {bigint | undefined} */
  let cursorId;
  if (typeof req.query.cursor === "string" && req.query.cursor.length > 0) {
    try {
      const parsed = BigInt(req.query.cursor);
      if (parsed > 0n) cursorId = parsed;
    } catch {
      return res.status(400).json({ error: "Invalid cursor" });
    }
  }

  const prisma = getIngestPrisma();
  const jobRow = await prisma.scrapeJob.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!jobRow) {
    return res.status(404).json({ error: "Job not found" });
  }

  const events = await prisma.jobEvent.findMany({
    where: {
      jobId: id,
      ...(cursorId !== undefined ? { id: { lt: cursorId } } : {}),
    },
    orderBy: [{ id: "desc" }],
    take: limit + 1,
    select: {
      id: true,
      level: true,
      eventType: true,
      occurredAt: true,
      payload: true,
    },
  });

  const hasMore = events.length > limit;
  const page = hasMore ? events.slice(0, limit) : events;
  const nextCursor = hasMore ? page[page.length - 1].id.toString() : null;

  return res.json({
    jobId: id,
    limit,
    nextCursor,
    hasMore,
    events: page.map((event) => ({
      id: event.id.toString(),
      level: event.level,
      eventType: event.eventType,
      occurredAt: event.occurredAt.toISOString(),
      payload: event.payload,
    })),
  });
});

const SSE_POLL_MS = Math.min(
  30_000,
  Math.max(500, Number(process.env.SCRAPE_JOB_SSE_POLL_MS) || 2000)
);
const SSE_HEARTBEAT_MS = Math.min(
  60_000,
  Math.max(5000, Number(process.env.SCRAPE_JOB_SSE_HEARTBEAT_MS) || 15_000)
);

/**
 * GET /api/v1/scrape-jobs/:id/stream — Server-Sent Events for job progress.
 * Sends an initial `job` snapshot, then `job_event` rows as `ingest.job_events` grow (poll),
 * plus comment heartbeats. Closes when the client disconnects.
 */
router.get("/:id/stream", async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    return res.status(400).json({ error: "Invalid job id" });
  }

  const prisma = getIngestPrisma();
  const jobRow = await prisma.scrapeJob.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      lastError: true,
      updatedAt: true,
      startedAt: true,
      completedAt: true,
    },
  });
  if (!jobRow) {
    return res.status(404).json({ error: "Job not found" });
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  let closed = false;
  /** @type {bigint} */
  let lastEventId = 0n;

  const writeSse = (eventName, payload) => {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  writeSse("job", {
    status: jobRow.status,
    lastError: jobRow.lastError,
    updatedAt: jobRow.updatedAt.toISOString(),
    startedAt: jobRow.startedAt ? jobRow.startedAt.toISOString() : null,
    completedAt: jobRow.completedAt ? jobRow.completedAt.toISOString() : null,
  });

  const tick = async () => {
    if (closed) return;
    try {
      const rows = await prisma.jobEvent.findMany({
        where: { jobId: id, id: { gt: lastEventId } },
        orderBy: { id: "asc" },
        take: 100,
        select: {
          id: true,
          level: true,
          eventType: true,
          occurredAt: true,
          payload: true,
        },
      });
      for (const row of rows) {
        lastEventId = row.id;
        writeSse("job_event", {
          id: row.id.toString(),
          level: row.level,
          eventType: row.eventType,
          occurredAt: row.occurredAt.toISOString(),
          payload: row.payload,
        });
      }
      if (rows.length > 0) {
        const latest = await prisma.scrapeJob.findUnique({
          where: { id },
          select: {
            status: true,
            lastError: true,
            updatedAt: true,
            startedAt: true,
            completedAt: true,
          },
        });
        if (latest) {
          writeSse("job", {
            status: latest.status,
            lastError: latest.lastError,
            updatedAt: latest.updatedAt.toISOString(),
            startedAt: latest.startedAt ? latest.startedAt.toISOString() : null,
            completedAt: latest.completedAt ? latest.completedAt.toISOString() : null,
          });
        }
      }
    } catch (err) {
      writeSse("error", { message: err?.message || String(err) });
    }
  };

  await tick();

  const pollTimer = setInterval(() => {
    void tick();
  }, SSE_POLL_MS);
  const hbTimer = setInterval(() => {
    if (!closed) {
      res.write(`: ping ${Date.now()}\n\n`);
    }
  }, SSE_HEARTBEAT_MS);

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(pollTimer);
    clearInterval(hbTimer);
    try {
      res.end();
    } catch {
      /* ignore */
    }
  };

  req.on("close", cleanup);
  req.on("aborted", cleanup);
});

module.exports = router;
