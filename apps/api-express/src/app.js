const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const { validateCriticalEnvAtStartup } = require("./config/envSchema");
validateCriticalEnvAtStartup();
require("./telemetry");

const express = require("express");
const dns = require("dns");
const { SCRAPE_JOB_KINDS } = require("./lib/jobKinds");
const { startIngestJobPoller } = require("./workers/ingestJobPoller");
const {
  metricsEnabled,
  metricsHandler,
  refreshQueueDepthGauge,
} = require("./lib/metrics");
const { tryGetIngestPrisma } = require("./lib/ingestPrisma");
const {
  getIngestBullmqConnection,
  getIngestQueue,
  getIngestChildQueue,
  getIngestDlqQueue,
  getIngestRetryQueue,
  getIngestQueueName,
  getIngestChildQueueName,
  getIngestDlqQueueName,
  getIngestRetryQueueName,
} = require("./lib/ingestQueue");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const log = require("./lib/logger");
const { requestContextMiddleware } = require("./middleware/requestContext");
const { observabilityMiddleware } = require("./middleware/observability");
const { createProxyMiddleware } = require("http-proxy-middleware");
const { csrfMiddleware } = require("./middleware/csrf");
const { getCookie } = require("./lib/cookies");
const { ACCESS_COOKIE_NAME } = require("./lib/authCookies");
const { authAllowBearer } = require("./lib/authAllowBearer");

function envFlagTrue(name) {
  const v = process.env[name];
  if (v == null || String(v).trim() === "") return false;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

// Fix Windows/Node SRV resolver issue for MongoDB+SRV (legacy / tooling only)
dns.setServers(["8.8.8.8", "1.1.1.1"]);
log.info({ msg: "dns.resolvers_set", resolvers: dns.getServers() });

const app = express();
const PORT = process.env.BACKEND_PORT || process.env.PORT || 5000;

function parseCorsAllowlist() {
  const raw =
    process.env.CORS_ORIGIN_ALLOWLIST ||
    process.env.CORS_ORIGIN ||
    "";
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function corsOriginHandler() {
  const allowlist = parseCorsAllowlist();
  const isProd = process.env.NODE_ENV === "production";
  const hasWildcard = allowlist.includes("*");
  if (isProd && hasWildcard) {
    throw new Error("CORS wildcard is not allowed in production.");
  }
  if (!isProd && (allowlist.length === 0 || hasWildcard)) {
    return true;
  }
  // Production with no explicit list: reflect each request Origin (cors `origin: true`).
  // Empty allowlist used to reject every browser Origin → 500 on /api/auth/*. Set
  // CORS_ORIGIN_ALLOWLIST when you need a strict allowlist (multiple public frontends).
  if (isProd && allowlist.length === 0) {
    log.warn({
      msg: "cors.production_empty_allowlist",
      hint: "Reflecting request Origin. Set CORS_ORIGIN_ALLOWLIST to lock origins.",
    });
    return true;
  }
  const allowed = new Set(allowlist);
  return (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowed.has(origin)) return cb(null, true);
    return cb(new Error("CORS origin not allowed"));
  };
}

// Behind reverse proxies / ingress: trust `X-Forwarded-For` so `req.ip` and
// express-rate-limit keys reflect the client (not the proxy hop).
if (envFlagTrue("TRUST_PROXY")) {
  const hops = Number(process.env.TRUST_PROXY_HOPS);
  const n =
    Number.isFinite(hops) && hops > 0 ? Math.min(32, Math.floor(hops)) : 1;
  app.set("trust proxy", n);
}

// Middleware — API-friendly Helmet defaults.
// CSP is ON in production (Phase D default). Set HELMET_DISABLE_CSP=1 only in a
// dev-override or when Bull Board / SSE proxies fail under the default policy.
// Never set HELMET_DISABLE_CSP in production Helm values — see deploy/helm/vahan360/values.yaml.
const helmetCspOff =
  process.env.HELMET_DISABLE_CSP === "true" ||
  process.env.HELMET_DISABLE_CSP === "1";
app.use(
  helmet({
    contentSecurityPolicy: helmetCspOff ? false : {
      directives: {
        ...require("helmet").contentSecurityPolicy.getDefaultDirectives(),
        // Allow SSE streams from same origin (default-src already covers this
        // but explicit connect-src avoids issues with some nginx proxy configs).
        "connect-src": ["'self'"],
        // upgrade-insecure-requests: only injected when running over HTTPS.
        ...(process.env.AUTH_COOKIE_SECURE === "true" ||
            process.env.NODE_ENV === "production"
          ? { "upgrade-insecure-requests": [] }
          : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(
  cors({
    origin: corsOriginHandler(),
    credentials: true,
  })
);
app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(requestContextMiddleware);
app.use(observabilityMiddleware);
app.use(csrfMiddleware);

// Optional global soft rate limit (all routes). Enable with RATE_LIMIT_GLOBAL_MAX > 0.
const globalMax = Number(process.env.RATE_LIMIT_GLOBAL_MAX);
if (Number.isFinite(globalMax) && globalMax > 0) {
  const globalWindow = Number(process.env.RATE_LIMIT_GLOBAL_WINDOW_MS);
  app.use(
    rateLimit({
      windowMs:
        Number.isFinite(globalWindow) && globalWindow > 0
          ? globalWindow
          : 15 * 60 * 1000,
      max: globalMax,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );
}

// Optional: forward /api/v2/* to Nest (vahan360-api-nest). Unmounted when API_V2_PROXY_ENABLED is off → 404 on /api/v2.
const nestInternalUrl = (
  process.env.NEST_INTERNAL_URL || "http://127.0.0.1:4000"
).trim();

/** @param {import('http').ClientRequest} proxyReq */
function forwardProxyHeaders(proxyReq, req) {
  /** @param {string} headerName */
  function forwardIfPresent(headerName) {
    const v = req.headers[headerName];
    if (v == null || v === "") return;
    proxyReq.setHeader(
      headerName,
      Array.isArray(v) ? v.join(", ") : String(v)
    );
  }
  forwardIfPresent("x-request-id");
  forwardIfPresent("traceparent");
  forwardIfPresent("tracestate");
  forwardIfPresent("authorization");
  forwardIfPresent("x-csrf-token");
  forwardIfPresent("x-tenant-id");
  forwardIfPresent("x-org-id");
  forwardIfPresent("x-org-path");
  forwardIfPresent("x-parent-tid");
  forwardIfPresent("cookie");
  const accessCookie = getCookie(req, ACCESS_COOKIE_NAME);
  if (authAllowBearer() && !req.headers.authorization && accessCookie) {
    proxyReq.setHeader("authorization", `Bearer ${accessCookie}`);
  }
}

if (envFlagTrue("API_V2_PROXY_ENABLED") && nestInternalUrl) {
  app.use(
    "/api/v2",
    createProxyMiddleware({
      target: nestInternalUrl,
      changeOrigin: true,
      pathRewrite: { "^/api/v2": "" },
      onProxyReq(proxyReq, req) {
        forwardProxyHeaders(proxyReq, req);
      },
    })
  );
  log.info({
    msg: "api_v2_proxy_enabled",
    target: nestInternalUrl,
  });
}

// Public auth routes
app.use("/api/auth", require("./routes/auth"));
app.use("/auth", require("./routes/auth"));

// Liveness only (no Redis/DB/worker). Use for Docker/K8s healthchecks and
// compose `depends_on: condition: service_healthy` — `/health` may return 503 when degraded.
app.get("/health/live", (_req, res) => {
  res.status(200).json({
    status: "live",
    service: "vahan360-api-express",
    ts: new Date().toISOString(),
  });
});

// Postgres connectivity smoke (safe in production — only SELECT 1 / count)
app.get("/api/health/pg", async (req, res) => {
  try {
    const prisma = require("./db/prisma");
    await prisma.$queryRaw`SELECT 1`;
    const userCount = await prisma.user.count();
    res.json({ ok: true, database: "postgresql", userCount });
  } catch (err) {
    log.error({
      msg: "health_pg_failed",
      error: err.message,
    });
    res.status(503).json({ ok: false, error: err.message });
  }
});

// Auth middleware
const authMiddleware = require("./middleware/auth");
const { requireRole } = require("./middleware/requireRole");

// Processed vehicle intelligence (Nest `/vehicle/*`) via Express prefix — requires Nest reachable + JWT/cookies.
if (envFlagTrue("VEHICLE_INTEL_PROXY_TO_NEST") && nestInternalUrl) {
  app.use(
    "/api/vehicle/v2-intel",
    authMiddleware,
    createProxyMiddleware({
      target: nestInternalUrl,
      changeOrigin: true,
      pathRewrite: { "^/api/vehicle/v2-intel": "/vehicle" },
      onProxyReq(proxyReq, req) {
        forwardProxyHeaders(proxyReq, req);
      },
    })
  );
  log.info({
    msg: "vehicle_intel_proxy_enabled",
    mount: "/api/vehicle/v2-intel",
    target: nestInternalUrl,
  });
}

// Protected routes
app.use("/api/khanan", authMiddleware, require("./routes/khanan"));
app.use("/api/vehicle", authMiddleware, require("./routes/vehicle"));
app.use(
  "/api/v1/scrape-jobs",
  authMiddleware,
  require("./routes/scrapeJobs")
);
app.use("/api/v1/workers", authMiddleware, require("./routes/workers"));
app.use("/api/v1/queues", authMiddleware, require("./routes/queues"));
app.use(
  "/api/v1/admin/queues",
  authMiddleware,
  requireRole("ADMIN"),
  require("./routes/adminQueues")
);

const { mountBullBoardIfEnabled } = require("./lib/bullBoardAdmin");
mountBullBoardIfEnabled(app);

// OpenAPI v1 docs (Swagger UI via CDN + static JSON spec).
// Enable with OPENAPI_ENABLED=true. Accessible at /api/docs and /api/docs/openapi.json.
// Intended for internal/dev use — protect behind network policy or basic auth in prod.
if (envFlagTrue("OPENAPI_ENABLED")) {
  const { mountOpenApi } = require("./lib/openapi");
  mountOpenApi(app, { basePath: "/api/docs" });
  log.info({ msg: "openapi_docs_enabled", path: "/api/docs" });
}

/** @param {Record<string, number>} counts */
function queueDepthFromCounts(counts) {
  return (
    (counts?.waiting || 0) +
    (counts?.delayed || 0) +
    (counts?.active || 0) +
    (counts?.prioritized || 0)
  );
}

async function collectQueueDepthByName() {
  const entries = [
    [getIngestQueueName(), getIngestQueue()],
    [getIngestChildQueueName(), getIngestChildQueue()],
    [getIngestDlqQueueName(), getIngestDlqQueue()],
    [getIngestRetryQueueName(), getIngestRetryQueue()],
  ];
  const out = {};
  for (const [queueName, queue] of entries) {
    if (!queue) {
      out[queueName] = 0;
      continue;
    }
    try {
      const counts = await queue.getJobCounts();
      out[queueName] = queueDepthFromCounts(counts);
    } catch {
      out[queueName] = 0;
    }
  }
  return out;
}

// Health check with queue/worker/redis snapshot for machine consumers.
app.get("/health", async (req, res) => {
  const now = Date.now();
  const ingestPrisma = tryGetIngestPrisma();
  let redisOk = false;
  let redisLatencyMs = null;
  let queueConnected = false;
  let queueDepthByName = {};
  let workerLastHeartbeatAgeMs = null;
  let workerFresh = null;
  let workerRows = 0;

  try {
    const redis = getIngestBullmqConnection();
    if (redis) {
      const t0 = Date.now();
      const pong = await redis.ping();
      redisLatencyMs = Date.now() - t0;
      redisOk = pong === "PONG";
      queueConnected = redisOk;
      queueDepthByName = await collectQueueDepthByName();
    }
  } catch (err) {
    log.warn({
      msg: "health.redis_probe_failed",
      requestId: req.requestId,
      error: err?.message || String(err),
    });
  }

  if (ingestPrisma) {
    try {
      const workers = await ingestPrisma.workerStatus.findMany({
        orderBy: { lastHeartbeat: "desc" },
        take: 20,
        select: { workerId: true, status: true, queueName: true, lastHeartbeat: true },
      });
      workerRows = workers.length;
      if (workers[0]?.lastHeartbeat) {
        workerLastHeartbeatAgeMs = Math.max(
          0,
          now - workers[0].lastHeartbeat.getTime()
        );
        const staleMs = Math.max(
          10_000,
          Number(process.env.WORKER_HEARTBEAT_STALE_MS) || 60_000
        );
        workerFresh = workerLastHeartbeatAgeMs <= staleMs;
      }
    } catch (err) {
      log.warn({
        msg: "health.worker_status_probe_failed",
        requestId: req.requestId,
        error: err?.message || String(err),
      });
    }
  }

  const ok = redisOk && (workerFresh !== false);
  const code = ok ? 200 : 503;
  return res.status(code).json({
    status: ok ? "ok" : "degraded",
    service: "vahan360-api-express",
    ts: new Date(now).toISOString(),
    contractScrapeJobKindCount: SCRAPE_JOB_KINDS.length,
    metricsEnabled: metricsEnabled(),
    checks: {
      redis: { ok: redisOk, latencyMs: redisLatencyMs },
      queue: { connected: queueConnected, depthByName: queueDepthByName },
      worker: {
        rows: workerRows,
        fresh: workerFresh,
        lastHeartbeatAgeMs: workerLastHeartbeatAgeMs,
      },
    },
  });
});

// Phase 7 — Prometheus scrape endpoint. Gated by METRICS_ENABLED=true; intended
// for internal/private network scraping only (no auth here on purpose to keep
// the scrape path cheap — front it with a network policy or sidecar).
if (metricsEnabled()) {
  const metricsPath = process.env.METRICS_PATH?.trim() || "/metrics";
  const refreshIntervalMs = Math.min(
    300_000,
    Math.max(10_000, Number(process.env.QUEUE_METRICS_INTERVAL_MS) || 30_000)
  );
  const refreshQueueGauge = async () => {
    try {
      refreshQueueDepthGauge(await collectQueueDepthByName());
    } catch (err) {
      log.warn({
        msg: "metrics_queue_depth_refresh_failed",
        error: err?.message || String(err),
      });
    }
  };
  void refreshQueueGauge();
  const refreshTimer = setInterval(() => {
    void refreshQueueGauge();
  }, refreshIntervalMs);
  refreshTimer.unref?.();
  app.get(metricsPath, metricsHandler(tryGetIngestPrisma));
  log.info({ msg: "metrics_endpoint_enabled", path: metricsPath });
}

// Error handling middleware
app.use((err, req, res, _next) => {
  log.error({
    msg: "unhandled_error",
    requestId: req.requestId,
    error: err?.message || String(err),
    stack: typeof err?.stack === "string" ? err.stack : undefined,
  });
  res.status(500).json({ error: "Something went wrong!" });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.listen(PORT, () => {
  log.info({ msg: "server_listen", port: PORT });
  startIngestJobPoller();
  setImmediate(async () => {
    try {
      const prisma = require("./db/prisma");
      const n = await prisma.user.count();
      if (n === 0) {
        log.warn({
          msg: "bootstrap_no_users",
          hint: "pnpm --filter @vahan360/api-express run sync:user (default admin / admin123)",
        });
      }
    } catch {
      /* DB unreachable — DATABASE_URL / Postgres */
    }
  });
});

module.exports = app;
