"use strict";

const express = require("express");
const { getIngestPrisma } = require("../lib/ingestPrisma");
const {
  isRedisCacheEnabled,
  buildKey,
  getOrSet,
} = require("../lib/redisCache");

const router = express.Router();

const QUEUE_METRICS_CACHE_TTL_SECONDS = 5;

/**
 * Bigint-safe serializer for the Prisma rows we return. We materialize the JSON
 * shape once so it can be stored in Redis and re-served identically on hits.
 */
async function buildQueueMetricsPayload(limit) {
  const prisma = getIngestPrisma();

  const items = await prisma.queueMetric.findMany({
    orderBy: { recordedAt: "desc" },
    take: limit,
    select: {
      id: true,
      queueName: true,
      sample: true,
      recordedAt: true,
    },
  });

  /** @type {Array<{ id: bigint, queue_name: string, sample: unknown, recorded_at: Date }>} */
  const latestRows = await prisma.$queryRaw`
    SELECT DISTINCT ON (queue_name) id, queue_name, sample, recorded_at
    FROM system.queue_metrics
    ORDER BY queue_name, recorded_at DESC
  `;

  const latestByQueue = {};
  for (const row of latestRows) {
    latestByQueue[row.queue_name] = {
      id: row.id.toString(),
      queueName: row.queue_name,
      sample: row.sample,
      recordedAt: row.recorded_at.toISOString(),
    };
  }

  return {
    limit,
    items: items.map((r) => ({
      id: r.id.toString(),
      queueName: r.queueName,
      sample: r.sample,
      recordedAt: r.recordedAt.toISOString(),
    })),
    latestByQueue,
  };
}

/**
 * GET /api/v1/queues/metrics?limit=50
 * Latest `system.queue_metrics` rows plus one latest snapshot per queue name.
 *
 * When REDIS_CACHE_ENABLED=true and a Redis URL is set, responses are cached
 * for QUEUE_METRICS_CACHE_TTL_SECONDS keyed by route path + clamped limit.
 * `x-cache: hit|miss|disabled` exposes the decision for ops/debug.
 */
router.get("/metrics", async (req, res) => {
  try {
    const raw = parseInt(String(req.query.limit ?? "50"), 10);
    const limit = Number.isFinite(raw) ? Math.min(200, Math.max(1, raw)) : 50;

    // Cache key: path + clamped limit ensures different limits don't collide
    // and unclamped/clamped inputs share the same cache slot.
    const cacheKey = buildKey("queues:metrics", "/api/v1/queues/metrics", `limit=${limit}`);

    if (isRedisCacheEnabled()) {
      const { value, hit } = await getOrSet({
        key: cacheKey,
        ttlSeconds: QUEUE_METRICS_CACHE_TTL_SECONDS,
        fetch: () => buildQueueMetricsPayload(limit),
      });
      res.setHeader("x-cache", hit ? "hit" : "miss");
      return res.json(value);
    }

    res.setHeader("x-cache", "disabled");
    const payload = await buildQueueMetricsPayload(limit);
    return res.json(payload);
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    return res.status(503).json({
      error: "Queue metrics unavailable (ingest DB / migrations).",
      detail: message,
    });
  }
});

module.exports = router;
