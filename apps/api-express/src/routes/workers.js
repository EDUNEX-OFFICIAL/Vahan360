"use strict";

const express = require("express");
const { getIngestPrisma } = require("../lib/ingestPrisma");
const log = require("../lib/logger");

const router = express.Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * GET /api/v1/workers/status — latest `system.worker_status` rows (ingest Prisma).
 */
router.get("/status", async (req, res) => {
  const raw = Number(req.query.limit);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(
      1,
      Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_LIMIT
    )
  );

  try {
    const prisma = getIngestPrisma();
    const rows = await prisma.workerStatus.findMany({
      orderBy: { lastHeartbeat: "desc" },
      take: limit,
      select: {
        workerId: true,
        queueName: true,
        status: true,
        lastHeartbeat: true,
        detail: true,
      },
    });

    return res.json({
      limit,
      workers: rows.map((r) => ({
        workerId: r.workerId,
        queueName: r.queueName,
        status: r.status,
        lastHeartbeat: r.lastHeartbeat.toISOString(),
        detail: r.detail,
      })),
    });
  } catch (e) {
    log.error({
      msg: "workers.status_failed",
      requestId: req.requestId,
      error: e?.message || String(e),
    });
    return res.status(503).json({ error: "Worker status unavailable" });
  }
});

module.exports = router;
