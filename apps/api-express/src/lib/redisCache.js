"use strict";

/**
 * Tiny opt-in Redis cache helper for hot read paths.
 *
 * Activation:
 *   REDIS_CACHE_ENABLED=true  AND  one of REDIS_URL / BULLMQ_REDIS_URL is set.
 * When inactive (default), every operation is a no-op and routes serve fresh data.
 *
 * Failure model: any Redis error (timeout, refused, parse error) downgrades to a
 * silent miss — the wrapped handler runs and serves fresh data. We never throw
 * out of the cache layer so cache outages can't break the API.
 */

const IORedis = require("ioredis");

const DEFAULT_KEY_PREFIX = "vahan360:cache:";
const NS_VERSION = "v1";

/** @type {import("ioredis").default | null} */
let connection = null;
/** Memoized flag so the connection only attaches listeners once. */
let listenersAttached = false;

function envFlagTrue(name) {
  const v = process.env[name];
  if (v == null || String(v).trim() === "") return false;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function getCacheRedisUrl() {
  return (
    process.env.REDIS_URL?.trim() ||
    process.env.BULLMQ_REDIS_URL?.trim() ||
    undefined
  );
}

/**
 * Returns true when REDIS_CACHE_ENABLED is truthy AND a Redis URL is configured.
 */
function isRedisCacheEnabled() {
  if (!envFlagTrue("REDIS_CACHE_ENABLED")) return false;
  return Boolean(getCacheRedisUrl());
}

/**
 * Lazily construct (and memoize) a dedicated cache connection. Returns null
 * when caching is disabled / unconfigured so callers can fall through cleanly.
 * @returns {import("ioredis").default | null}
 */
function getCacheRedis() {
  if (!isRedisCacheEnabled()) return null;
  if (connection) return connection;

  const url = getCacheRedisUrl();
  if (!url) return null;

  connection = new IORedis(url, {
    // Cache reads should fail fast — don't queue commands forever if Redis is gone.
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    // 200ms per command keeps the API responsive when Redis is degraded.
    commandTimeout: 200,
    lazyConnect: false,
    enableOfflineQueue: false,
    keyPrefix: DEFAULT_KEY_PREFIX,
  });

  if (!listenersAttached) {
    listenersAttached = true;
    connection.on("error", (err) => {
      // Stay quiet but visible; do not crash. Cache misses serve fresh data.
      console.warn("[redisCache] connection warning:", err?.message || err);
    });
  }

  return connection;
}

/**
 * Compose a stable cache key from a fixed namespace + ordered parts.
 * @param {string} namespace e.g. "queues:metrics"
 * @param  {...(string|number|undefined|null)} parts
 */
function buildKey(namespace, ...parts) {
  const tail = parts
    .filter((p) => p !== undefined && p !== null && String(p) !== "")
    .map((p) => String(p))
    .join(":");
  return tail ? `${NS_VERSION}:${namespace}:${tail}` : `${NS_VERSION}:${namespace}`;
}

/**
 * @template T
 * @param {string} key
 * @returns {Promise<T | null>}
 */
async function readJson(key) {
  const r = getCacheRedis();
  if (!r) return null;
  try {
    const raw = await r.get(key);
    if (raw == null) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * @param {string} key
 * @param {unknown} value
 * @param {number} ttlSeconds positive integer (caller guarantees ≥ 1)
 */
async function writeJson(key, value, ttlSeconds) {
  const r = getCacheRedis();
  if (!r) return;
  try {
    const payload = JSON.stringify(value);
    await r.set(key, payload, "EX", Math.max(1, Math.floor(ttlSeconds)));
  } catch {
    /* swallow — cache writes are best-effort */
  }
}

/**
 * Cache-aside wrapper for JSON-returning fetchers.
 * @template T
 * @param {{ key: string, ttlSeconds: number, fetch: () => Promise<T> }} args
 * @returns {Promise<{ value: T, hit: boolean }>}
 */
async function getOrSet({ key, ttlSeconds, fetch }) {
  const cached = await readJson(key);
  if (cached !== null) {
    return { value: cached, hit: true };
  }
  const value = await fetch();
  await writeJson(key, value, ttlSeconds);
  return { value, hit: false };
}

module.exports = {
  isRedisCacheEnabled,
  getCacheRedis,
  buildKey,
  readJson,
  writeJson,
  getOrSet,
};
