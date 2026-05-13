"use strict";

/**
 * Per-tenant in-process browser-context quota.
 *
 * ## Env vars
 *
 *   BROWSER_POOL_QUOTAS_JSON
 *     JSON object mapping tenantId → max concurrent contexts.
 *     Falls back to key "default" if the exact tenant key is missing.
 *     Example: {"default":2,"org_acme":4,"org_demo":1}
 *
 *   BROWSER_POOL_TENANT_MAX_CONTEXTS
 *     Scalar fallback used when BROWSER_POOL_QUOTAS_JSON is absent or has
 *     no entry for the current tenant (and no "default" key).
 *     0 (or unset) → quota disabled (no counting, pass-through).
 *
 *   BROWSER_POOL_QUOTA_WAIT_MS
 *     How long (ms) to wait for a free slot before rejecting (default 30000).
 *     Only relevant when BROWSER_POOL_QUOTA_REJECT_FAST is not set.
 *
 *   BROWSER_POOL_QUOTA_REJECT_FAST
 *     Set to "true" or "1" to reject immediately when at quota instead of
 *     waiting. Good for latency-sensitive batch callers.
 *
 * ## Limitation
 *   Counts are in-process only. Across multiple worker replicas each process
 *   maintains an independent counter, so cluster-wide enforcement requires a
 *   shared store (e.g. Redis atomic INCR/DECR). That path is deferred pending
 *   distributed quota design; this layer gives single-pod fairness today.
 */

/** @type {Map<string, number>} active context count per normalised tenantId */
const _active = new Map();

/** @type {Map<string, number>} lifetime rejection count per tenantId */
const _rejections = new Map();

/** @type {Map<string, Array<() => void>>} pending waiters per tenantId */
const _waiters = new Map();

// ─── env helpers ─────────────────────────────────────────────────────────────

/**
 * Parse BROWSER_POOL_QUOTAS_JSON. Re-parsed on every call so hot-reload
 * (SIGHUP env updates) and tests work correctly; the overhead is negligible
 * because JSON.parse of a small map is sub-microsecond.
 * @returns {Record<string, number>}
 */
function parseQuotaMap() {
  const raw = process.env.BROWSER_POOL_QUOTAS_JSON?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return /** @type {Record<string, number>} */ (parsed);
    }
  } catch {
    /* malformed JSON — treat as empty */
  }
  return {};
}

/**
 * Effective quota for a tenantId. Returns 0 when quota is disabled.
 * @param {string} tenantId
 * @returns {number}
 */
function getQuotaForTenant(tenantId) {
  const map = parseQuotaMap();

  // Exact match first
  if (typeof map[tenantId] === "number" && map[tenantId] > 0) {
    return Math.floor(map[tenantId]);
  }

  // "default" key in map
  if (typeof map["default"] === "number" && map["default"] > 0) {
    return Math.floor(map["default"]);
  }

  // Scalar env fallback
  const scalar = Number(process.env.BROWSER_POOL_TENANT_MAX_CONTEXTS);
  if (Number.isFinite(scalar) && scalar > 0) return Math.floor(scalar);

  return 0; // 0 → quota disabled
}

// ─── counter helpers ─────────────────────────────────────────────────────────

/** @param {string} tenantId */
function getActive(tenantId) {
  return _active.get(tenantId) || 0;
}

/** @param {string} tenantId */
function increment(tenantId) {
  _active.set(tenantId, getActive(tenantId) + 1);
}

/** @param {string} tenantId */
function decrement(tenantId) {
  _active.set(tenantId, Math.max(0, getActive(tenantId) - 1));
  _signalNextWaiter(tenantId);
}

/** @param {string} tenantId */
function _signalNextWaiter(tenantId) {
  const list = _waiters.get(tenantId);
  if (list && list.length > 0) {
    const resolve = list.shift();
    if (resolve) resolve();
  }
}

/** @param {string} tenantId */
function _incrRejections(tenantId) {
  _rejections.set(tenantId, (_rejections.get(tenantId) || 0) + 1);
}

// ─── wait helper ─────────────────────────────────────────────────────────────

/**
 * Returns a Promise that resolves when signalled by the next `decrement`, or
 * rejects with a timeout error after `waitMs`.
 * @param {string} tenantId
 * @param {number} waitMs
 */
function _waitForSlot(tenantId, waitMs) {
  return new Promise((resolve, reject) => {
    if (!_waiters.has(tenantId)) _waiters.set(tenantId, []);
    const list = /** @type {Array<() => void>} */ (_waiters.get(tenantId));

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const idx = list.indexOf(resolveSlot);
      if (idx >= 0) list.splice(idx, 1);
      _incrRejections(tenantId);
      reject(
        new Error(
          `browser_pool_tenant_quota_timeout tenantId=${tenantId} waitMs=${waitMs}`,
        ),
      );
    }, waitMs);

    function resolveSlot() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    }

    list.push(resolveSlot);
  });
}

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Enforce per-tenant quota then call `acquire`.
 *
 * When quota is disabled (0) this is a transparent pass-through.
 * Otherwise:
 *  - If `active < quota`: increment counter, call acquire, wrap release to decrement.
 *  - If `active >= quota` and REJECT_FAST: throw immediately.
 *  - If `active >= quota` and not REJECT_FAST: wait up to BROWSER_POOL_QUOTA_WAIT_MS, then retry.
 *
 * @template T
 * @param {string} tenantId
 * @param {() => Promise<T & { release: () => Promise<void> }>} acquire
 * @returns {Promise<T & { release: () => Promise<void> }>}
 */
async function withQuota(tenantId, acquire) {
  const quota = getQuotaForTenant(tenantId);

  if (quota === 0) {
    // Quota disabled — transparent pass-through
    return acquire();
  }

  const rejectFast =
    process.env.BROWSER_POOL_QUOTA_REJECT_FAST === "true" ||
    process.env.BROWSER_POOL_QUOTA_REJECT_FAST === "1";

  const waitMs = Math.max(
    1000,
    Number(process.env.BROWSER_POOL_QUOTA_WAIT_MS) || 30_000,
  );

  // Spin until a slot opens (or timeout / fast-reject)
  while (getActive(tenantId) >= quota) {
    if (rejectFast) {
      _incrRejections(tenantId);
      throw new Error(
        `browser_pool_tenant_quota_exceeded tenantId=${tenantId} active=${getActive(tenantId)} quota=${quota}`,
      );
    }
    await _waitForSlot(tenantId, waitMs);
  }

  increment(tenantId);

  /** @type {T & { release: () => Promise<void> }} */
  let handle;
  try {
    handle = await acquire();
  } catch (err) {
    decrement(tenantId);
    throw err;
  }

  // Wrap release to decrement counter regardless of success/failure
  const origRelease = handle.release;
  handle.release = async () => {
    try {
      if (typeof origRelease === "function") {
        await origRelease();
      }
    } finally {
      decrement(tenantId);
    }
  };

  return handle;
}

/**
 * Returns a snapshot of current quota state (useful for diagnostics / health).
 * @returns {{ enabled: boolean; tenants: Record<string, { active: number; quota: number; waiting: number; rejections: number }> }}
 */
function getQuotaStats() {
  const allTenants = new Set([
    ..._active.keys(),
    ..._waiters.keys(),
    ..._rejections.keys(),
  ]);

  /** @type {Record<string, { active: number; quota: number; waiting: number; rejections: number }>} */
  const tenants = {};
  for (const tid of allTenants) {
    tenants[tid] = {
      active: getActive(tid),
      quota: getQuotaForTenant(tid),
      waiting: (_waiters.get(tid) || []).length,
      rejections: _rejections.get(tid) || 0,
    };
  }

  return { enabled: true, tenants };
}

/**
 * Reset all counters — intended for unit tests / graceful shutdown.
 * Do NOT call in production worker hot paths.
 */
function resetQuotaState() {
  _active.clear();
  _rejections.clear();
  // Signal and clear all waiters so pending callers get rejected cleanly
  for (const [, list] of _waiters.entries()) {
    for (const resolve of list) {
      try {
        resolve();
      } catch {
        /* ignore */
      }
    }
  }
  _waiters.clear();
}

module.exports = {
  withQuota,
  getQuotaStats,
  getQuotaForTenant,
  resetQuotaState,
};
