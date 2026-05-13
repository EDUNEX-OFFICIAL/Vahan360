"use strict";

const http = require("http");
const log = require("./logger");

let _state = null;

function metricsEnabled() {
  return (
    process.env.METRICS_ENABLED === "true" ||
    process.env.METRICS_ENABLED === "1"
  );
}

function getState() {
  if (!metricsEnabled()) return null;
  if (_state) return _state;

  let promClient;
  try {
    promClient = require("prom-client");
  } catch (err) {
    log.warn({
      msg: "worker_metrics.prom_client_missing",
      error: err?.message || String(err),
    });
    return null;
  }

  const registry = new promClient.Registry();
  registry.setDefaultLabels({ service: "worker-ingest" });
  promClient.collectDefaultMetrics({ register: registry });

  const playwrightPageCrashes = new promClient.Counter({
    name: "playwright_page_crashes_total",
    help: "Playwright smoke failures that look like browser/page crashes or hard navigation failures.",
    registers: [registry],
  });

  const selectorValidationFailures = new promClient.Counter({
    name: "selector_validation_failures_total",
    help: "Selector registry validation reported ok=false after a successful navigation.",
    registers: [registry],
  });
  const selectorProbeResults = new promClient.Counter({
    name: "selector_probe_results_total",
    help: "Selector probe outcomes by portal/page/field and source outcome.",
    labelNames: ["portal_id", "page_key", "field_key", "outcome"],
    registers: [registry],
  });
  const selectorPortalDegraded = new promClient.Counter({
    name: "selector_portal_degraded_total",
    help: "Portal marked degraded after selector validation failures crossed threshold in window.",
    labelNames: ["portal_id"],
    registers: [registry],
  });

  const portalRequestDuration = new promClient.Histogram({
    name: "portal_request_duration_seconds",
    help: "Wall time for Playwright smoke navigation+probe (seconds).",
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 60],
    registers: [registry],
  });

  const ingestRetryReplayed = new promClient.Counter({
    name: "ingest_retry_replayed_total",
    help: "Jobs consumed from scrape-ingest-retry and re-queued to master or child.",
    labelNames: ["target"],
    registers: [registry],
  });

  const ingestRetryReplayGuarded = new promClient.Counter({
    name: "ingest_retry_replay_guarded_total",
    help: "Retry-queue jobs skipped because replayAttempts exceeded INGEST_RETRY_MAX_REPLAY_ATTEMPTS.",
    registers: [registry],
  });

  const workerJobsProcessed = new promClient.Counter({
    name: "worker_jobs_processed_total",
    help: "Worker jobs completed successfully by queue name.",
    labelNames: ["queue_name"],
    registers: [registry],
  });

  const workerJobsFailed = new promClient.Counter({
    name: "worker_jobs_failed_total",
    help: "Worker jobs failed by queue name.",
    labelNames: ["queue_name"],
    registers: [registry],
  });

  const workerJobsRetried = new promClient.Counter({
    name: "worker_jobs_retried_total",
    help: "Worker retry replays dispatched by queue name and target.",
    labelNames: ["queue_name", "target"],
    registers: [registry],
  });

  const queueDepth = new promClient.Gauge({
    name: "queue_depth",
    help: "Queue depth sampled by worker per queue.",
    labelNames: ["queue_name"],
    registers: [registry],
  });

  const browserPoolTenantQuotaRejections = new promClient.Counter({
    name: "browser_pool_tenant_quota_rejections_total",
    help: "Browser context acquire calls rejected due to per-tenant quota (single-process counts).",
    labelNames: ["tenant_id"],
    registers: [registry],
  });

  _state = {
    promClient,
    registry,
    counters: {
      playwrightPageCrashes,
      selectorValidationFailures,
      selectorProbeResults,
      selectorPortalDegraded,
      ingestRetryReplayed,
      ingestRetryReplayGuarded,
      workerJobsProcessed,
      workerJobsFailed,
      workerJobsRetried,
      browserPoolTenantQuotaRejections,
    },
    histograms: { portalRequestDuration },
    gauges: { queueDepth },
  };
  return _state;
}

function incrPlaywrightPageCrashes() {
  const s = getState();
  if (!s) return;
  s.counters.playwrightPageCrashes.inc(1);
}

function incrSelectorValidationFailures() {
  const s = getState();
  if (!s) return;
  s.counters.selectorValidationFailures.inc(1);
}

/**
 * @param {{ portalId?: string; pageKey?: string; fieldKey?: string; outcome?: string }} args
 */
function incrSelectorProbeResult(args = {}) {
  const s = getState();
  if (!s) return;
  const allowed = new Set([
    "matched_primary",
    "matched_fallback",
    "missing",
    "error",
  ]);
  const outcome = allowed.has(args.outcome) ? args.outcome : "error";
  s.counters.selectorProbeResults.inc(
    {
      portal_id: args.portalId || "unknown",
      page_key: args.pageKey || "default",
      field_key: args.fieldKey || "unknown",
      outcome,
    },
    1
  );
}

/** @param {string} portalId */
function incrSelectorPortalDegraded(portalId) {
  const s = getState();
  if (!s) return;
  s.counters.selectorPortalDegraded.inc({ portal_id: portalId || "unknown" }, 1);
}

/** @param {number} seconds */
function observePortalRequestDuration(seconds) {
  const s = getState();
  if (!s) return;
  if (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0) {
    s.histograms.portalRequestDuration.observe(seconds);
  }
}

function incrIngestRetryReplayGuarded() {
  const s = getState();
  if (!s) return;
  s.counters.ingestRetryReplayGuarded.inc(1);
}

/** @param {string} queueName */
function incrWorkerJobsProcessed(queueName) {
  const s = getState();
  if (!s) return;
  s.counters.workerJobsProcessed.inc({ queue_name: queueName || "unknown" }, 1);
}

/** @param {string} queueName */
function incrWorkerJobsFailed(queueName) {
  const s = getState();
  if (!s) return;
  s.counters.workerJobsFailed.inc({ queue_name: queueName || "unknown" }, 1);
}

/** @param {string} queueName @param {"master"|"child"} target */
function incrWorkerJobsRetried(queueName, target) {
  const s = getState();
  if (!s) return;
  s.counters.workerJobsRetried.inc(
    {
      queue_name: queueName || "unknown",
      target: target === "child" ? "child" : "master",
    },
    1
  );
}

/** @param {Record<string, number>} depthsByQueue */
function refreshQueueDepthGauge(depthsByQueue) {
  const s = getState();
  if (!s || !depthsByQueue || typeof depthsByQueue !== "object") return;
  s.gauges.queueDepth.reset();
  for (const [queueName, depth] of Object.entries(depthsByQueue)) {
    if (
      typeof queueName !== "string" ||
      queueName.trim().length === 0 ||
      typeof depth !== "number" ||
      !Number.isFinite(depth) ||
      depth < 0
    ) {
      continue;
    }
    s.gauges.queueDepth.set({ queue_name: queueName }, depth);
  }
}

/**
 * Starts a minimal `/metrics` listener when METRICS_ENABLED. Port from
 * WORKER_METRICS_PORT (default 9101). Internal scrape only.
 * @returns {import("http").Server | null}
 */
function startMetricsHttpServer() {
  const state = getState();
  if (!state) return null;

  const portRaw = process.env.WORKER_METRICS_PORT;
  const port =
    Number.isFinite(Number(portRaw)) && Number(portRaw) > 0
      ? Number(portRaw)
      : 9101;

  const server = http.createServer(async (req, res) => {
    if (req.url !== "/metrics" && req.url !== "/metrics/") {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.setHeader("Content-Type", state.registry.contentType);
    try {
      res.end(await state.registry.metrics());
    } catch (e) {
      res.statusCode = 500;
      res.end(String(e?.message || e));
    }
  });

  server.listen(port, "0.0.0.0", () => {
    log.info({ msg: "worker_metrics_listen", path: "/metrics", port });
  });
  return server;
}

/** @param {"master"|"child"} target */
function incrIngestRetryReplayed(target) {
  const s = getState();
  if (!s) return;
  const t = target === "child" ? "child" : "master";
  s.counters.ingestRetryReplayed.inc({ target: t });
}

/**
 * Increment the per-tenant quota rejection counter (Prometheus).
 * Called by `browserManagerClient` / `tenantQuota` error handler in index.js.
 * @param {string} tenantId
 */
function incrBrowserPoolTenantQuotaRejection(tenantId) {
  const s = getState();
  if (!s) return;
  s.counters.browserPoolTenantQuotaRejections.inc(
    { tenant_id: tenantId || "unknown" },
    1,
  );
}

module.exports = {
  metricsEnabled,
  incrPlaywrightPageCrashes,
  incrSelectorValidationFailures,
  incrSelectorProbeResult,
  incrSelectorPortalDegraded,
  incrIngestRetryReplayed,
  incrIngestRetryReplayGuarded,
  incrWorkerJobsProcessed,
  incrWorkerJobsFailed,
  incrWorkerJobsRetried,
  observePortalRequestDuration,
  refreshQueueDepthGauge,
  startMetricsHttpServer,
  incrBrowserPoolTenantQuotaRejection,
};
