/**
 * Optional Redis TTL cache for vehicle summary reads.
 *
 * Activation: VEHICLE_CACHE_ENABLED=true AND REDIS_URL (or BULLMQ_REDIS_URL) set.
 * When inactive every call is a silent no-op — routes serve fresh DB data.
 * Any Redis error degrades to a cache miss; the service falls through to Prisma.
 *
 * Env knobs:
 *   VEHICLE_CACHE_ENABLED       — "true" / "1" / "yes" to enable (default off)
 *   VEHICLE_SUMMARY_TTL_SECONDS — positive integer, default 60
 *   REDIS_URL / BULLMQ_REDIS_URL — connection URL (first wins)
 */

import IORedis from 'ioredis';

const KEY_PREFIX = 'vahan360:vehicle:v1:summary:';
const DEFAULT_TTL_SEC = 60;

let _client: IORedis | null = null;
let _attached = false;

function isCacheEnabled(): boolean {
  const flag = (process.env.VEHICLE_CACHE_ENABLED ?? '').trim().toLowerCase();
  if (!flag || flag === '0' || flag === 'false' || flag === 'no') return false;
  return Boolean(
    process.env.REDIS_URL?.trim() || process.env.BULLMQ_REDIS_URL?.trim(),
  );
}

function getClient(): IORedis | null {
  if (!isCacheEnabled()) return null;
  if (_client) return _client;
  const url =
    process.env.REDIS_URL?.trim() || process.env.BULLMQ_REDIS_URL?.trim();
  if (!url) return null;
  _client = new IORedis(url, {
    keyPrefix: KEY_PREFIX,
    maxRetriesPerRequest: 1,
    commandTimeout: 200,
    enableOfflineQueue: false,
    lazyConnect: false,
  });
  if (!_attached) {
    _attached = true;
    _client.on('error', (e: Error) =>
      console.warn('[vehicleCache] warn:', e?.message ?? e),
    );
  }
  return _client;
}

export function vehicleSummaryTtlSeconds(): number {
  const raw = process.env.VEHICLE_SUMMARY_TTL_SECONDS?.trim();
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_SEC;
}

/** @returns cached value or null on miss/disabled/error */
export async function getCachedSummary<T>(regNorm: string): Promise<T | null> {
  const r = getClient();
  if (!r) return null;
  try {
    const raw = await r.get(regNorm);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Writes to cache; best-effort — errors are swallowed. */
export async function setCachedSummary<T>(
  regNorm: string,
  value: T,
): Promise<void> {
  const r = getClient();
  if (!r) return;
  try {
    await r.set(
      regNorm,
      JSON.stringify(value),
      'EX',
      vehicleSummaryTtlSeconds(),
    );
  } catch {
    /* best-effort */
  }
}
