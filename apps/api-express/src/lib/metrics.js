"use strict";

/**
 * Phase 7 — minimal Prometheus metrics surface.
 *
 * - Gated behind `METRICS_ENABLED=true|1`. When disabled, every exported
 *   function becomes a cheap no-op so callers don't have to branch.
 * - Lazy-requires `prom-client` so backends that never enable metrics never
 *   pay the dep cost.
 * - `/metrics` is intended to be scraped from an internal network only.
 */

const METRICS_ENV_KEYS = ["METRICS_ENABLED"];
const log = require("./logger");

let _state = null;

function metricsEnabled() {
  return METRICS_ENV_KEYS.some(
    (key) => process.env[key] === "true" || process.env[key] === "1"
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
      msg: "metrics.prom_client_missing",
      error: err?.message || String(err),
    });
    return null;
  }

  const registry = new promClient.Registry();
  registry.setDefaultLabels({ service: "vahan360-api-express" });
  promClient.collectDefaultMetrics({ register: registry });

  const scrapeJobsEnqueued = new promClient.Counter({
    name: "scrape_jobs_enqueued_total",
    help: "Scrape jobs enqueue attempts by kind and result.",
    labelNames: ["kind", "result"],
    registers: [registry],
  });

  const scrapeJobsCompleted = new promClient.Counter({
    name: "scrape_jobs_completed_total",
    help: "Scrape jobs that reached a terminal state observed by /metrics.",
    labelNames: ["status"],
    registers: [registry],
  });

  const scrapeJobsStatus = new promClient.Gauge({
    name: "scrape_jobs_status",
    help: "Current scrape job row count by status (refreshed on each scrape).",
    labelNames: ["status"],
    registers: [registry],
  });

  const httpRequestsTotal = new promClient.Counter({
    name: "http_requests_total",
    help: "HTTP request count by normalized route/method/status family.",
    labelNames: ["method", "route", "status_family"],
    registers: [registry],
  });

  const httpRequestDurationSeconds = new promClient.Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds by normalized route/method/status family.",
    labelNames: ["method", "route", "status_family"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
    registers: [registry],
  });

  const httpRequestErrorsTotal = new promClient.Counter({
    name: "http_request_errors_total",
    help: "HTTP 4xx/5xx responses by normalized route/method/status family.",
    labelNames: ["method", "route", "status_family"],
    registers: [registry],
  });

  const queueDepth = new promClient.Gauge({
    name: "queue_depth",
    help: "Queue depth sampled from BullMQ by queue name.",
    labelNames: ["queue_name"],
    registers: [registry],
  });

  _state = {
    promClient,
    registry,
    counters: {
      scrapeJobsEnqueued,
      scrapeJobsCompleted,
      httpRequestsTotal,
      httpRequestErrorsTotal,
    },
    histograms: { httpRequestDurationSeconds },
    gauges: { scrapeJobsStatus, queueDepth },
  };
  return _state;
}

function incrScrapeJobsEnqueued(kind, result = "success") {
  const state = getState();
  if (!state) return;
  state.counters.scrapeJobsEnqueued.inc(
    {
      kind: kind || "unknown",
      result: result === "failure" ? "failure" : "success",
    },
    1
  );
}

function incrScrapeJobsCompleted(status) {
  const state = getState();
  if (!state) return;
  state.counters.scrapeJobsCompleted.inc({ status: status || "unknown" }, 1);
}

/**
 * Refresh status-gauge from current DB counts. Cheap query via Prisma
 * groupBy. Errors are swallowed — metrics must never break the request path.
 */
async function refreshScrapeJobsStatusGauge(prisma) {
  const state = getState();
  if (!state || !prisma) return;
  try {
    const rows = await prisma.scrapeJob.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    state.gauges.scrapeJobsStatus.reset();
    for (const row of rows) {
      state.gauges.scrapeJobsStatus.set(
        { status: row.status },
        Number(row._count._all || 0)
      );
    }
  } catch (err) {
    log.warn({
      msg: "metrics.scrape_status_refresh_failed",
      error: err?.message || String(err),
    });
  }
}

/**
 * @param {{ method?: string, route?: string, statusCode?: number, durationSeconds?: number }} labels
 */
function observeHttpRequest(labels) {
  const state = getState();
  if (!state) return;
  const method = String(labels?.method || "GET").toUpperCase();
  const route = String(labels?.route || "unknown");
  const code = Number.isFinite(Number(labels?.statusCode))
    ? Number(labels.statusCode)
    : 0;
  const statusFamily =
    code >= 100 && code < 600 ? `${Math.floor(code / 100)}xx` : "unknown";
  const common = { method, route, status_family: statusFamily };
  state.counters.httpRequestsTotal.inc(common, 1);
  if (code >= 400) {
    state.counters.httpRequestErrorsTotal.inc(common, 1);
  }
  if (
    typeof labels?.durationSeconds === "number" &&
    Number.isFinite(labels.durationSeconds) &&
    labels.durationSeconds >= 0
  ) {
    state.histograms.httpRequestDurationSeconds.observe(
      common,
      labels.durationSeconds
    );
  }
}

/** @param {Record<string, number>} depthsByQueue */
function refreshQueueDepthGauge(depthsByQueue) {
  const state = getState();
  if (!state || !depthsByQueue || typeof depthsByQueue !== "object") return;
  state.gauges.queueDepth.reset();
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
    state.gauges.queueDepth.set({ queue_name: queueName }, depth);
  }
}

function metricsHandler(getPrisma) {
  return async function metricsRouteHandler(req, res) {
    const state = getState();
    if (!state) {
      res.status(404).type("text/plain").send("metrics disabled");
      return;
    }
    if (typeof getPrisma === "function") {
      try {
        await refreshScrapeJobsStatusGauge(getPrisma());
      } catch {
        // best-effort
      }
    }
    res.set("Content-Type", state.registry.contentType);
    res.end(await state.registry.metrics());
  };
}

module.exports = {
  metricsEnabled,
  metricsHandler,
  incrScrapeJobsEnqueued,
  incrScrapeJobsCompleted,
  refreshScrapeJobsStatusGauge,
  observeHttpRequest,
  refreshQueueDepthGauge,
};
