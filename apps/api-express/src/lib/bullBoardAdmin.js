"use strict";

const express = require("express");
const log = require("./logger");

function isTruthyEnv(v) {
  return v === "true" || v === "1";
}

function parseAllowlist() {
  const raw = process.env.BULL_BOARD_ALLOWLIST_CSV?.trim();
  if (!raw) return null;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Mount Bull Board at `/admin/queues` when `BULL_BOARD_ENABLED=true|1` and Redis is configured.
 * @param {import("express").Express} app
 */
function mountBullBoardIfEnabled(app) {
  if (!isTruthyEnv(process.env.BULL_BOARD_ENABLED)) {
    return;
  }

  try {
    const { createBullBoard } = require("@bull-board/api");
    const { BullMQAdapter } = require("@bull-board/api/bullMQAdapter");
    const { ExpressAdapter } = require("@bull-board/express");
    const { Queue } = require("bullmq");
    const {
      getIngestBullmqConnection,
      getIngestQueueName,
      getIngestChildQueueName,
      getIngestDlqQueueName,
      getIngestRetryQueueName,
    } = require("./ingestQueue");

    const conn = getIngestBullmqConnection();
    if (!conn) {
      log.warn({ msg: "bull_board_redis_missing" });
      return;
    }

    const masterName = getIngestQueueName();
    const childName = getIngestChildQueueName();
    const dlqName = getIngestDlqQueueName();
    const retryName = getIngestRetryQueueName();
    const masterQ = new Queue(masterName, { connection: conn });
    const childQ = new Queue(childName, { connection: conn });
    const dlqQ = new Queue(dlqName, { connection: conn });
    const retryQ = new Queue(retryName, { connection: conn });

    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath("/admin/queues");

    createBullBoard({
      queues: [
        new BullMQAdapter(masterQ),
        new BullMQAdapter(childQ),
        new BullMQAdapter(dlqQ),
        new BullMQAdapter(retryQ),
      ],
      serverAdapter,
    });

    const authMiddleware = require("../middleware/auth");
    const { requireRole } = require("../middleware/requireRole");
    const allow = parseAllowlist();

    const ipGate = (req, res, next) => {
      if (!allow || allow.length === 0) return next();
      const ip = req.ip || req.socket?.remoteAddress || "";
      const ok = allow.some((entry) => ip === entry || ip.endsWith(entry));
      if (!ok) {
        return res.status(403).json({
          error: "Bull Board: caller IP not in BULL_BOARD_ALLOWLIST_CSV",
          requestId: req.requestId,
        });
      }
      return next();
    };

    const r = express.Router();
    r.use(authMiddleware);
    r.use(requireRole("ADMIN"));
    r.use(ipGate);
    r.use(serverAdapter.getRouter());

    app.use("/admin/queues", r);
    log.info({ msg: "bull_board_mounted", path: "/admin/queues" });
  } catch (err) {
    log.error({
      msg: "bull_board_mount_failed",
      error: err?.message || String(err),
    });
  }
}

module.exports = { mountBullBoardIfEnabled };
