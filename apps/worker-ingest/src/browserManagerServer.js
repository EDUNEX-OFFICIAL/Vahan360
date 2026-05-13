"use strict";

const http = require("http");
const jwt = require("jsonwebtoken");
const Redis = require("ioredis");
const {
  leaseRemoteBrowser,
  releaseRemoteLeaseByPoolKey,
  shutdownPool,
  getPoolStats,
  makePoolKey,
} = require("./browserPool");
const log = require("./lib/logger");

const PORT =
  Number.isFinite(Number(process.env.BROWSER_MANAGER_PORT)) &&
  Number(process.env.BROWSER_MANAGER_PORT) > 0
    ? Number(process.env.BROWSER_MANAGER_PORT)
    : 3005;
const LEASE_TTL_MS = Math.max(
  5000,
  Number(process.env.BROWSER_MANAGER_LEASE_TTL_MS) || 120_000,
);

const BM_TOKEN = String(process.env.BROWSER_MANAGER_TOKEN || "").trim();
const JWT_SECRET = String(process.env.JWT_SECRET || "").trim();
const REQUIRE_AUTH =
  BM_TOKEN.length > 0 ||
  process.env.BROWSER_MANAGER_REQUIRE_AUTH === "true" ||
  process.env.BROWSER_MANAGER_REQUIRE_AUTH === "1";

/** Single-tenant browser-manager: reject other tenants (Helm sets this per deployment). */
const BM_SINGLE_TENANT = String(
  process.env.BROWSER_MANAGER_EXPECTED_TENANT_SLUG ||
    process.env.BROWSER_MANAGER_EXPECTED_TENANT_ID ||
    "",
).trim();
const BM_ALLOWED_TENANTS = String(
  process.env.BROWSER_MANAGER_ALLOWED_TENANTS || "",
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/**
 * Multi-replica note: leases stay in-memory for local Playwright release paths.
 * When `REDIS_URL`/`BROWSER_MANAGER_REDIS_URL` is set we **mirror** each lease key in Redis (`vahan360:bm:lease:*`)
 * with PX TTL so operators can correlate across pods; acquire/release/delete still prefers sticky routing for correctness.
 *
 * Fair-share policy (`BROWSER_MANAGER_FAIR_SHARE_ENABLED`):
 *   - Tracks per-tenant active lease counts locally (always) and in Redis when available.
 *   - Soft cap per tenant = floor(globalMaxContexts / max(1, activeTenantCount)) + headroom (20%).
 *   - Tenants with `BROWSER_POOL_QUOTAS_JSON` hard caps are still subject to those as the hard ceiling.
 *   - `GET /v1/pool/fairshare` returns current per-tenant distribution for ops visibility.
 *   - `X-BM-Replica-Id` header is stamped on every response so callers can implement sticky routing.
 */

/**
 * @typedef {{ kind: "remote"; poolKey: string; tenantId: string; expiresAt: number }} LeaseRec
 */

/** @type {Map<string, LeaseRec>} */
const leases = new Map();

// ---------------------------------------------------------------------------
// Fair-share state
// ---------------------------------------------------------------------------

const FAIR_SHARE_ENABLED =
  process.env.BROWSER_MANAGER_FAIR_SHARE_ENABLED === "true" ||
  process.env.BROWSER_MANAGER_FAIR_SHARE_ENABLED === "1";

const FAIR_SHARE_HEADROOM = Math.max(
  0,
  Number.isFinite(Number(process.env.BROWSER_MANAGER_FAIR_SHARE_HEADROOM))
    ? Number(process.env.BROWSER_MANAGER_FAIR_SHARE_HEADROOM)
    : 0.2,
);

/** Replica id stamped on responses for sticky-routing affinity. */
const REPLICA_ID = String(
  process.env.BROWSER_MANAGER_REPLICA_ID ||
    process.env.POD_NAME ||
    process.env.HOSTNAME ||
    `bm-${process.pid}`,
).trim();

/** In-process per-tenant active lease counter (always maintained; Redis counter is the distributed authoritative one). */
const localTenantActiveCount = /** @type {Map<string, number>} */ (new Map());

/** Track + decrement local per-tenant active count. */
function localTenantIncr(tenantId) {
  localTenantActiveCount.set(tenantId, (localTenantActiveCount.get(tenantId) || 0) + 1);
}

/** @param {string} tenantId */
function localTenantDecr(tenantId) {
  const cur = localTenantActiveCount.get(tenantId) || 0;
  const next = Math.max(0, cur - 1);
  if (next === 0) {
    localTenantActiveCount.delete(tenantId);
  } else {
    localTenantActiveCount.set(tenantId, next);
  }
}

/**
 * Fair-share soft cap: floor(globalMax / activeTenants) * (1 + headroom).
 * Returns 0 (no soft cap) when `BROWSER_MANAGER_FAIR_SHARE_ENABLED` is false.
 * Hard quota from `BROWSER_MAX_CONTEXTS_PER_TENANT` always takes precedence.
 *
 * @param {string} tenantId
 * @returns {{ allowed: boolean; softCap: number; activeTenants: number }}
 */
function fairShareCheck(tenantId) {
  if (!FAIR_SHARE_ENABLED) {
    return { allowed: true, softCap: 0, activeTenants: 0 };
  }
  const { totalContexts } = getPoolStats();
  const globalMax = Math.max(1, totalContexts || Number(process.env.BROWSER_POOL_MAX_CONTEXTS_PER_BROWSER || 3));
  const activeTenants = Math.max(1, localTenantActiveCount.size || 1);
  const rawSoftCap = Math.floor((globalMax / activeTenants) * (1 + FAIR_SHARE_HEADROOM));
  const softCap = Math.max(1, rawSoftCap);
  const tenantActive = localTenantActiveCount.get(tenantId) || 0;
  const allowed = tenantActive < softCap;
  return { allowed, softCap, activeTenants };
}

const LEASE_REDIS_PREFIX = String(
  process.env.BROWSER_MANAGER_LEASE_KEY_PREFIX || "vahan360:bm:lease:",
).trim();

/** Redis counter per tenant for optional acquire quotas (`BROWSER_MAX_CONTEXTS_PER_TENANT`). */
const TENANT_QUOTA_PREFIX = String(
  process.env.BROWSER_MANAGER_TENANT_QUOTA_PREFIX || "vahan360:bm:tenant:active:",
).trim();

/** @type {InstanceType<typeof Redis> | null} */
let leaseRedis = null;

function maxContextsPerTenant() {
  const n = Number(process.env.BROWSER_MAX_CONTEXTS_PER_TENANT);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function leaseRedisUrl() {
  const u = String(
    process.env.BROWSER_MANAGER_REDIS_URL || process.env.REDIS_URL || "",
  ).trim();
  return u.length > 0 ? u : null;
}

function getLeaseRedis() {
  const url = leaseRedisUrl();
  if (!url) return null;
  if (!leaseRedis) {
    leaseRedis = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
    });
    leaseRedis.on("error", (err) => {
      log.warn({
        msg: "browser_manager_redis_error",
        error: err?.message || String(err),
      });
    });
  }
  return leaseRedis;
}

/**
 * @param {string} leaseId
 * @param {{ tenantId: string; poolKey: string }} meta
 */
async function redisRememberLease(leaseId, meta) {
  const r = getLeaseRedis();
  if (!r) return;
  try {
    await r.set(
      `${LEASE_REDIS_PREFIX}${leaseId}`,
      JSON.stringify({ ...meta, ts: new Date().toISOString() }),
      "PX",
      LEASE_TTL_MS,
    );
  } catch (err) {
    log.warn({
      msg: "browser_manager_redis_set_failed",
      leaseId,
      error: err?.message || String(err),
    });
  }
}

/** @param {string} leaseId */
async function redisForgetLease(leaseId) {
  const r = getLeaseRedis();
  if (!r) return;
  try {
    await r.del(`${LEASE_REDIS_PREFIX}${leaseId}`);
  } catch (err) {
    log.warn({
      msg: "browser_manager_redis_del_failed",
      leaseId,
      error: err?.message || String(err),
    });
  }
}

/**
 * @returns {Promise<{ ok: true; skipped?: boolean } | { ok: false; status: number; code: string }>}
 */
async function redisTenantQuotaTryAcquire(tenantId) {
  const max = maxContextsPerTenant();
  if (max <= 0) return { ok: true, skipped: true };
  const r = getLeaseRedis();
  if (!r) {
    log.warn({
      msg: "browser_quota_redis_required",
      tenantId,
    });
    return { ok: false, status: 503, code: "quota_redis_unconfigured" };
  }
  const key = `${TENANT_QUOTA_PREFIX}${tenantId}`;
  try {
    const n = await r.incr(key);
    if (n > max) {
      await r.decr(key);
      return { ok: false, status: 429, code: "quota_exceeded" };
    }
    await r.pexpire(
      key,
      Math.min(86_400_000, Math.max(LEASE_TTL_MS * 50, 60_000)),
    );
    return { ok: true };
  } catch (err) {
    log.warn({
      msg: "browser_quota_acquire_failed",
      tenantId,
      error: err?.message || String(err),
    });
    return { ok: false, status: 503, code: "quota_redis_error" };
  }
}

/** @param {string} tenantId */
async function redisTenantQuotaRelease(tenantId) {
  const max = maxContextsPerTenant();
  if (max <= 0) return;
  const r = getLeaseRedis();
  if (!r) return;
  const key = `${TENANT_QUOTA_PREFIX}${tenantId}`;
  try {
    const n = await r.decr(key);
    if (n < 0) await r.set(key, "0");
  } catch {
    /* ignore */
  }
}

function json(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

/**
 * @param {string|undefined} cookieHeader
 */
function readCookieToken(cookieHeader) {
  if (typeof cookieHeader !== "string" || !cookieHeader.trim()) return "";
  const m = cookieHeader.match(/(?:^|;\s*)browser_manager_token=([^;]+)/i);
  if (!m) return "";
  try {
    return decodeURIComponent(m[1].trim());
  } catch {
    return m[1].trim();
  }
}

/**
 * @param {import("http").IncomingMessage} req
 */
function getSharedSecretToken(req) {
  const x = req.headers["x-browser-manager-token"];
  if (typeof x === "string" && x.trim()) return x.trim();
  const c = readCookieToken(req.headers.cookie);
  if (c) return c;
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return "";
}

/**
 * @returns {{ ok: boolean; status?: number; jwtPayload?: Record<string, unknown>; authMode?: string }}
 */
function authenticateRequest(req) {
  if (!REQUIRE_AUTH) {
    return { ok: true, authMode: "open" };
  }

  const sharedSecret = getSharedSecretToken(req);
  if (BM_TOKEN && sharedSecret === BM_TOKEN) {
    return { ok: true, authMode: "shared_secret" };
  }

  if (
    JWT_SECRET &&
    typeof req.headers.authorization === "string" &&
    req.headers.authorization.toLowerCase().startsWith("bearer ")
  ) {
    const bearer = req.headers.authorization.slice(7).trim();
    if (!bearer) return { ok: false, status: 401 };
    if (BM_TOKEN && bearer === BM_TOKEN) {
      return { ok: true, authMode: "shared_secret" };
    }
    try {
      const payload = jwt.verify(bearer, JWT_SECRET);
      if (payload && typeof payload === "object") {
        return {
          ok: true,
          jwtPayload: /** @type {Record<string, unknown>} */ (payload),
          authMode: "jwt",
        };
      }
    } catch {
      return { ok: false, status: 401 };
    }
  }

  if (BM_TOKEN) {
    return { ok: false, status: 401 };
  }

  return { ok: false, status: 401 };
}

/**
 * Extract tenant id from JWT claims (Nest-style) or undefined.
 * @param {Record<string, unknown>|undefined} payload
 */
function tenantFromJwt(payload) {
  if (!payload) return "";
  const candidates = [
    payload.tenantId,
    payload.tid,
    payload.org_id,
    payload.orgId,
    payload.tenant_slug,
    payload.tenantSlug,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim().toLowerCase();
  }
  return "";
}

/**
 * @param {import("http").IncomingMessage} req
 * @param {Record<string, unknown>|undefined} jwtPayload
 */
function resolveTenantId(req, jwtPayload) {
  const headerT = req.headers["x-tenant-id"];
  const fromHeader =
    typeof headerT === "string" && headerT.trim()
      ? headerT.trim().toLowerCase()
      : "";
  const fromJwt = tenantFromJwt(jwtPayload);

  if (fromJwt && fromHeader && fromJwt !== fromHeader) {
    return { error: 403, code: "tenant_header_jwt_mismatch" };
  }
  const resolved = fromJwt || fromHeader;
  if (!resolved) {
    return { error: 400, code: "tenant_required" };
  }
  if (BM_SINGLE_TENANT && resolved !== BM_SINGLE_TENANT.toLowerCase()) {
    return { error: 403, code: "tenant_not_allowed" };
  }
  if (
    BM_ALLOWED_TENANTS.length > 0 &&
    !BM_ALLOWED_TENANTS.includes(resolved)
  ) {
    return { error: 403, code: "tenant_not_allowed" };
  }
  return { tenantId: resolved };
}

async function safeReleaseLease(leaseId) {
  const lease = leases.get(leaseId);
  if (!lease) {
    await redisForgetLease(leaseId);
    return false;
  }
  leases.delete(leaseId);
  localTenantDecr(lease.tenantId);
  await redisForgetLease(leaseId);
  await redisTenantQuotaRelease(lease.tenantId);
  if (lease.kind === "remote") {
    await releaseRemoteLeaseByPoolKey(lease.poolKey, leaseId).catch(() => {});
  }
  return true;
}

async function parseJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

const server = http.createServer(async (req, res) => {
  const method = String(req.method || "GET").toUpperCase();
  const url = req.url || "/";
  try {
    if (method === "GET" && (url === "/" || url === "/health")) {
      res.setHeader("x-bm-replica-id", REPLICA_ID);
      return json(res, 200, {
        status: "ok",
        service: "browser-manager",
        replicaId: REPLICA_ID,
        leases: leases.size,
        pool: getPoolStats(),
        leaseMirror: leaseRedisUrl() ? "redis" : "off",
        tenantQuotaMax: maxContextsPerTenant() || undefined,
        fairShareEnabled: FAIR_SHARE_ENABLED,
        ts: new Date().toISOString(),
      });
    }

    const auth = authenticateRequest(req);
    if (!auth.ok) {
      return json(res, auth.status || 401, {
        error: "unauthorized",
        hint: "Set X-Browser-Manager-Token or Authorization: Bearer (JWT or shared secret).",
      });
    }

    if (
      method === "POST" &&
      url === "/v1/context/acquire"
    ) {
      const tenantRes = resolveTenantId(req, auth.jwtPayload);
      if (tenantRes.error) {
        return json(res, tenantRes.error, {
          error: tenantRes.code || "bad_request",
        });
      }
      const { tenantId } = tenantRes;
      const payload = await parseJsonBody(req);
      const portalRaw =
        typeof payload.portalId === "string"
          ? payload.portalId
          : typeof payload.portal === "string"
            ? payload.portal
            : "_";
      const poolKey = makePoolKey(tenantId, portalRaw);

      // Fair-share soft cap check (before hard Redis quota).
      if (FAIR_SHARE_ENABLED) {
        const fs = fairShareCheck(tenantId);
        if (!fs.allowed) {
          log.warn({
            msg: "browser_manager_fair_share_rejected",
            tenantId,
            softCap: fs.softCap,
            activeTenants: fs.activeTenants,
          });
          return json(res, 429, {
            error: "fair_share_exceeded",
            hint: `Tenant ${tenantId} exceeds its fair-share soft cap of ${fs.softCap} (${fs.activeTenants} active tenants). Release leases or wait.`,
            replicaId: REPLICA_ID,
          });
        }
      }

      const quota = await redisTenantQuotaTryAcquire(tenantId);
      if (!quota.ok) {
        return json(res, quota.status, {
          error: quota.code,
          hint:
            quota.code === "quota_exceeded"
              ? "Raise BROWSER_MAX_CONTEXTS_PER_TENANT or release leases."
              : quota.code === "quota_redis_unconfigured"
                ? "Per-tenant quotas require REDIS_URL or BROWSER_MANAGER_REDIS_URL."
                : undefined,
          replicaId: REPLICA_ID,
        });
      }

      let leaseId;
      let wsEndpoint;
      try {
        ({ leaseId, wsEndpoint } = await leaseRemoteBrowser({
          tenantId,
          portalId: portalRaw,
        }));
      } catch (err) {
        await redisTenantQuotaRelease(tenantId);
        throw err;
      }
      localTenantIncr(tenantId);
      leases.set(leaseId, {
        kind: "remote",
        poolKey,
        tenantId,
        expiresAt: Date.now() + LEASE_TTL_MS,
      });
      await redisRememberLease(leaseId, { tenantId, poolKey });

      return json(res, 200, {
        leaseId,
        wsEndpoint,
        leaseTtlMs: LEASE_TTL_MS,
        tenantId,
        portalId: portalRaw,
        poolKey,
        pool: getPoolStats(),
        replicaId: REPLICA_ID,
        fairShare: FAIR_SHARE_ENABLED
          ? { enabled: true, ...fairShareCheck(tenantId) }
          : { enabled: false },
      });
    }

    if (method === "GET" && url === "/v1/pool/fairshare") {
      // Ops visibility: per-tenant active lease distribution + fair-share caps.
      const distribution = /** @type {Record<string, { active: number; softCap: number }>} */ ({});
      for (const [tenant, count] of localTenantActiveCount.entries()) {
        const fs = fairShareCheck(tenant);
        distribution[tenant] = { active: count, softCap: fs.softCap };
      }
      return json(res, 200, {
        replicaId: REPLICA_ID,
        fairShareEnabled: FAIR_SHARE_ENABLED,
        totalLeases: leases.size,
        activeTenants: localTenantActiveCount.size,
        distribution,
        pool: getPoolStats(),
        ts: new Date().toISOString(),
      });
    }

    if (method === "POST" && url.startsWith("/v1/context/") && url.endsWith("/release")) {
      const leaseId = url.replace("/v1/context/", "").replace("/release", "");
      const existing = leases.get(leaseId);
      const tenantRes = resolveTenantId(req, auth.jwtPayload);
      if (tenantRes.error) {
        return json(res, tenantRes.error, {
          error: tenantRes.code || "bad_request",
        });
      }
      if (
        existing &&
        existing.tenantId !== tenantRes.tenantId
      ) {
        return json(res, 403, { error: "tenant_mismatch_release" });
      }
      const released = await safeReleaseLease(leaseId);
      return json(res, released ? 200 : 404, { released });
    }

    return json(res, 404, { error: "not_found" });
  } catch (err) {
    log.error({
      msg: "browser_manager_request_failed",
      error: err?.message || String(err),
      method,
      url,
    });
    return json(res, 500, { error: "internal_error" });
  }
});

const leaseGcTimer = setInterval(() => {
  const now = Date.now();
  for (const [leaseId, lease] of leases.entries()) {
    if (lease.expiresAt > now) continue;
    void safeReleaseLease(leaseId);
  }
}, Math.max(1000, Math.floor(LEASE_TTL_MS / 4)));
leaseGcTimer.unref?.();

async function shutdown(signal) {
  log.info({ msg: "browser_manager_shutdown", signal });
  clearInterval(leaseGcTimer);
  for (const leaseId of [...leases.keys()]) {
    await safeReleaseLease(leaseId);
  }
  if (leaseRedis) {
    await leaseRedis.quit().catch(() => {});
    leaseRedis = null;
  }
  await shutdownPool().catch(() => {});
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

server.listen(PORT, "0.0.0.0", () => {
  log.info({
    msg: "browser_manager_listen",
    port: PORT,
    leaseTtlMs: LEASE_TTL_MS,
    requireAuth: REQUIRE_AUTH,
    singleTenant: BM_SINGLE_TENANT || null,
    replicaId: REPLICA_ID,
    fairShareEnabled: FAIR_SHARE_ENABLED,
    fairShareHeadroom: FAIR_SHARE_ENABLED ? FAIR_SHARE_HEADROOM : undefined,
  });
});
