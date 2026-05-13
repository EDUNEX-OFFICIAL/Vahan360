"use strict";

const express = require("express");
const { envFlagTrue } = require("../config/envSchema");
const { SCRAPE_JOB_KINDS } = require("../lib/jobKinds");
const log = require("../lib/logger");
const {
  getIngestQueue,
  getIngestChildQueue,
  getIngestDlqQueue,
  getIngestBullmqConnection,
} = require("../lib/ingestQueue");
const { tryGetIngestPrisma } = require("../lib/ingestPrisma");

const router = express.Router();

/**
 * @param {unknown} prisma
 * @param {{ actor: string | null; bullJobId: string; target: string; replayAttempts: number }} args
 */
async function recordDlqReplayAudit(prisma, args) {
  try {
    await prisma.auditLog.create({
      data: {
        actor: args.actor,
        action: "ingest_dlq.replay",
        resource: "bull_job",
        payload: {
          bullJobId: args.bullJobId,
          target: args.target,
          replayAttempts: args.replayAttempts,
        },
      },
    });
  } catch (err) {
    log.warn({
      msg: "admin.queue_replay.audit_write_failed",
      error: err?.message || String(err),
      bullJobId: args.bullJobId,
    });
  }
}

function stripDlqEnvelope(data) {
  if (!data || typeof data !== "object") return {};
  const { failedReason, dlqMeta, target, ...rest } = data;
  return { ...rest };
}

function readReplayAttempts(data) {
  const candidates = [data?.replayAttempts, data?.dlqMeta?.replayAttempts];
  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return 0;
}

function maxReplayEnv() {
  const n = Number(process.env.INGEST_RETRY_MAX_REPLAYS);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return 5;
}

function isValidKind(kind) {
  return typeof kind === "string" && SCRAPE_JOB_KINDS.includes(kind);
}

function childIngestTypeForStep(step) {
  if (step === "prepare") return "validation";
  if (step === "persist_stub_result") return "dedupe";
  return undefined;
}

function requireAdminQueueReplay(req, res, next) {
  if (!envFlagTrue("ADMIN_QUEUE_REPLAY_ENABLED")) {
    return res.status(404).json({
      error: "not_found",
      requestId: req.requestId,
    });
  }
  const got = String(req.get("x-admin-token") || "").trim();
  const want = String(process.env.ADMIN_QUEUE_TOKEN || "").trim();
  if (!want || got !== want) {
    return res.status(403).json({
      error: "forbidden",
      requestId: req.requestId,
    });
  }
  next();
}

/**
 * POST /retry-replay (mounted at /api/v1/admin/queues)
 * Safest path: DLQ `getJob` → strip `failedReason` / `dlqMeta` / `target` →
 * `Queue.add` to master or child → remove DLQ row (best-effort).
 *
 * Body: `{ bullJobId: string | number, queue: "dlq" }`
 */
router.post("/retry-replay", requireAdminQueueReplay, async (req, res) => {
  try {
    const body = req.body || {};
    const { bullJobId, queue } = body;
    if (
      bullJobId == null ||
      (typeof bullJobId !== "string" && typeof bullJobId !== "number")
    ) {
      return res.status(400).json({
        error: "invalid_body",
        detail: "bullJobId (string or number) is required",
        requestId: req.requestId,
      });
    }
    const q = String(queue || "").toLowerCase();
    if (q !== "dlq") {
      return res.status(400).json({
        error: "invalid_queue",
        detail: 'queue must be "dlq"',
        requestId: req.requestId,
      });
    }

    if (!getIngestBullmqConnection()) {
      return res.status(503).json({
        error: "redis_not_configured",
        requestId: req.requestId,
      });
    }

    const dlqQ = getIngestDlqQueue();
    const masterQ = getIngestQueue();
    const childQ = getIngestChildQueue();
    if (!dlqQ || !masterQ || !childQ) {
      return res.status(503).json({
        error: "queue_handles_unavailable",
        requestId: req.requestId,
      });
    }

    const job = await dlqQ.getJob(String(bullJobId));
    if (!job) {
      return res.status(404).json({
        error: "job_not_found",
        requestId: req.requestId,
      });
    }

    const raw = job.data && typeof job.data === "object" ? job.data : {};
    const maxRepl = maxReplayEnv();
    const attemptCount = readReplayAttempts(raw);
    if (attemptCount >= maxRepl) {
      return res.status(400).json({
        error: "replay_cap_exceeded",
        replayAttempts: attemptCount,
        maxRepl,
        requestId: req.requestId,
      });
    }
    const nextReplay = attemptCount + 1;
    const cleaned = { ...stripDlqEnvelope(raw), replayAttempts: nextReplay };
    const target = raw.target === "child" ? "child" : "master";

    if (target === "child") {
      const { scrapeJobId, kind, correlationId, step } = cleaned;
      if (
        typeof scrapeJobId !== "string" ||
        !isValidKind(kind) ||
        typeof correlationId !== "string" ||
        typeof step !== "string"
      ) {
        return res.status(400).json({
          error: "invalid_child_payload",
          requestId: req.requestId,
        });
      }
      const typeHint =
        typeof cleaned.type === "string" && cleaned.type
          ? cleaned.type
          : childIngestTypeForStep(step);
      await childQ.add(
        "child",
        {
          scrapeJobId,
          kind,
          correlationId,
          step,
          progressPercent:
            typeof cleaned.progressPercent === "number"
              ? cleaned.progressPercent
              : undefined,
          ...(typeof cleaned.requestId === "string" && cleaned.requestId
            ? { requestId: cleaned.requestId }
            : {}),
          ...(typeof cleaned.traceparent === "string"
            ? { traceparent: cleaned.traceparent }
            : {}),
          ...(typeof cleaned.tracestate === "string"
            ? { tracestate: cleaned.tracestate }
            : {}),
          type: typeHint,
          replayAttempts: nextReplay,
        },
        { jobId: `${scrapeJobId}:${step}` }
      );
    } else {
      const { scrapeJobId, kind, correlationId } = cleaned;
      if (
        typeof scrapeJobId !== "string" ||
        !isValidKind(kind) ||
        typeof correlationId !== "string"
      ) {
        return res.status(400).json({
          error: "invalid_master_payload",
          requestId: req.requestId,
        });
      }
      await masterQ.add(
        "master",
        {
          scrapeJobId,
          kind,
          correlationId,
          ...(typeof cleaned.requestId === "string" && cleaned.requestId
            ? { requestId: cleaned.requestId }
            : {}),
          ...(typeof cleaned.traceparent === "string"
            ? { traceparent: cleaned.traceparent }
            : {}),
          ...(typeof cleaned.tracestate === "string"
            ? { tracestate: cleaned.tracestate }
            : {}),
          replayAttempts: nextReplay,
        },
        { jobId: scrapeJobId }
      );
    }

    try {
      await job.remove();
    } catch (err) {
      log.warn({
        msg: "admin.queue_replay.dlq_remove_failed",
        bullJobId: String(bullJobId),
        error: err?.message || String(err),
        requestId: req.requestId,
      });
    }

    const prisma = tryGetIngestPrisma();
    if (prisma) {
      const actor =
        req.user && typeof req.user === "object"
          ? String(
              /** @type {{ username?: unknown; email?: unknown }} */ (req.user)
                .username ||
                /** @type {{ username?: unknown; email?: unknown }} */ (req.user)
                  .email ||
                "",
            ).trim() || null
          : null;
      await recordDlqReplayAudit(prisma, {
        actor,
        bullJobId: String(bullJobId),
        target,
        replayAttempts: nextReplay,
      });
    }

    return res.status(200).json({
      ok: true,
      target,
      bullJobId: String(bullJobId),
      replayAttempts: nextReplay,
    });
  } catch (err) {
    const msg = err?.message || String(err);
    if (/already exists|duplicate/i.test(msg)) {
      return res.status(409).json({
        error: "duplicate_job_id",
        detail: msg.slice(0, 500),
        requestId: req.requestId,
      });
    }
    log.error({
      msg: "admin.queue_replay.failed",
      error: msg,
      requestId: req.requestId,
    });
    return res.status(500).json({
      error: "internal_error",
      requestId: req.requestId,
    });
  }
});

module.exports = router;
