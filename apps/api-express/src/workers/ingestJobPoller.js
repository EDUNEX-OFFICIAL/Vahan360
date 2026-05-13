"use strict";

const { getIngestPrisma, getIngestDatabaseUrl } = require("../lib/ingestPrisma");
const { getIngestRedisUrl } = require("../lib/ingestQueue");

const DEFAULT_INTERVAL_MS = 5000;

/**
 * Dev stub: moves one QUEUED job → RUNNING → SUCCEEDED (no real scrape).
 * Enable with `INGEST_JOB_POLLER=true` and valid `DATABASE_URL` / `INGEST_DATABASE_URL`.
 * @returns {() => void} stop function
 */
function startIngestJobPoller() {
  const enabled =
    process.env.INGEST_JOB_POLLER === "true" ||
    process.env.INGEST_JOB_POLLER === "1";
  if (!enabled) {
    return () => {};
  }
  if (!getIngestDatabaseUrl()) {
    console.warn(
      "[ingestJobPoller] INGEST_JOB_POLLER is set but INGEST_DATABASE_URL / DATABASE_URL is missing — poller not started"
    );
    return () => {};
  }
  if (getIngestRedisUrl()) {
    console.warn(
      "[ingestJobPoller] Redis is configured; skipping poller to avoid double-processing BullMQ jobs"
    );
    return () => {};
  }

  const intervalMs = Number(
    process.env.INGEST_JOB_POLL_INTERVAL_MS || DEFAULT_INTERVAL_MS
  );
  const ms = Number.isFinite(intervalMs) && intervalMs >= 1000 ? intervalMs : DEFAULT_INTERVAL_MS;

  let stopped = false;
  let timer = /** @type {ReturnType<typeof setInterval> | null} */ (null);

  async function tick() {
    if (stopped) return;
    try {
      const prisma = getIngestPrisma();
      const job = await prisma.scrapeJob.findFirst({
        where: { status: "queued" },
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
        select: { id: true },
      });
      if (!job) return;

      const claim = await prisma.scrapeJob.updateMany({
        where: { id: job.id, status: "queued" },
        data: {
          status: "running",
          startedAt: new Date(),
        },
      });
      if (claim.count === 0) return;

      await prisma.jobEvent.create({
        data: {
          jobId: job.id,
          level: "info",
          eventType: "job.started",
          payload: { runner: "poller" },
        },
      });

      await prisma.scrapeJob.update({
        where: { id: job.id },
        data: {
          status: "succeeded",
          completedAt: new Date(),
        },
      });
      await prisma.jobEvent.create({
        data: {
          jobId: job.id,
          level: "info",
          eventType: "job.completed",
          payload: { runner: "poller", progressPercent: 100 },
        },
      });
    } catch (err) {
      console.error("[ingestJobPoller]", err?.message || err);
    }
  }

  timer = setInterval(() => {
    void tick();
  }, ms);
  void tick();

  return function stopIngestJobPoller() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  };
}

module.exports = { startIngestJobPoller };
