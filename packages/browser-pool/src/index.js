"use strict";

const { randomUUID } = require("crypto");

const DEFAULTS = {
  maxBrowsers: 1,
  maxContextsPerBrowser: 2,
  recycleUses: 50,
  idleTtlMs: 60_000,
  cleanupIntervalMs: 15_000,
  launchTimeoutMs: 30_000,
};

/** @type {Map<string, ReturnType<typeof createPoolEngine>>} */
const _engines = new Map();

function envInt(name, fallback, min = 1) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw < min) return fallback;
  return Math.floor(raw);
}

function getPoolConfig() {
  const maxBrowsers = envInt(
    "BROWSER_POOL_MAX_BROWSERS",
    envInt("BROWSER_POOL_MAX", DEFAULTS.maxBrowsers),
  );
  const maxContextsPerBrowser = envInt(
    "BROWSER_POOL_MAX_CONTEXTS_PER_BROWSER",
    DEFAULTS.maxContextsPerBrowser,
  );
  return {
    maxBrowsers,
    maxContextsPerBrowser,
    recycleUses: envInt("BROWSER_POOL_CONTEXT_RECYCLE_USES", DEFAULTS.recycleUses),
    idleTtlMs: envInt("BROWSER_POOL_IDLE_TTL_MS", DEFAULTS.idleTtlMs),
    cleanupIntervalMs: envInt(
      "BROWSER_POOL_CLEANUP_INTERVAL_MS",
      DEFAULTS.cleanupIntervalMs,
    ),
    launchTimeoutMs: envInt(
      "BROWSER_POOL_LAUNCH_TIMEOUT_MS",
      DEFAULTS.launchTimeoutMs,
      1000,
    ),
    softMemoryMb: Number(process.env.BROWSER_POOL_MEMORY_SOFT_LIMIT_MB) || 0,
    hardMemoryMb: Number(process.env.BROWSER_POOL_MEMORY_HARD_LIMIT_MB) || 0,
  };
}

/**
 * @param {unknown} segment
 * @param {string} fallback
 */
function normalizeSegment(segment, fallback) {
  const s = String(segment ?? fallback).trim().toLowerCase();
  const base = s.length > 0 ? s : fallback;
  return base.replace(/[^a-z0-9._-]+/g, "_").slice(0, 128);
}

/**
 * @param {unknown} tenantId
 * @param {unknown} portalId
 */
function makePoolKey(tenantId, portalId) {
  const te = normalizeSegment(tenantId, "default");
  const po = normalizeSegment(portalId, "_");
  return `${te}::${po}`;
}

/**
 * @param {{ tenantId?: unknown; portalId?: unknown }} [opts]
 */
function resolvePoolKey(opts) {
  if (!opts || typeof opts !== "object") {
    return makePoolKey("default", "_");
  }
  const fromOpts =
    opts.tenantId != null && String(opts.tenantId).trim()
      ? String(opts.tenantId).trim()
      : "";
  const tid =
    fromOpts ||
    process.env.WORKER_TENANT_SLUG?.trim() ||
    process.env.WORKER_TENANT_ID?.trim() ||
    "default";
  return makePoolKey(tid, opts.portalId);
}

function getEngine(poolKey) {
  let eng = _engines.get(poolKey);
  if (!eng) {
    eng = createPoolEngine(poolKey);
    _engines.set(poolKey, eng);
  }
  return eng;
}

/**
 * @param {string} poolKey
 */
function createPoolEngine(poolKey) {
  /** @type {Array<{ id: string, browser: import("playwright-core").Browser, activeContexts: number, createdContexts: number, lastUsedAt: number, closing: boolean }>} */
  const _browsers = [];
  /** @type {Array<() => void>} */
  const _waiters = [];
  /** @type {Map<string, { slot: (typeof _browsers)[number] }>} */
  const _remoteLeases = new Map();
  let _cleanupTimer = null;
  let _launchInFlight = 0;
  let _nextId = 1;

  function getMaxConcurrency() {
    const cfg = getPoolConfig();
    return cfg.maxBrowsers * cfg.maxContextsPerBrowser;
  }

  function currentRssMb() {
    return Math.round(process.memoryUsage().rss / (1024 * 1024));
  }

  function memoryAllowsBrowserLaunch() {
    const cfg = getPoolConfig();
    const rss = currentRssMb();
    if (cfg.hardMemoryMb > 0 && rss >= cfg.hardMemoryMb) {
      throw new Error(
        `browser_pool_memory_hard_limit_exceeded rss_mb=${rss} hard_limit_mb=${cfg.hardMemoryMb}`,
      );
    }
    if (cfg.softMemoryMb > 0 && rss >= cfg.softMemoryMb) {
      return false;
    }
    return true;
  }

  function ensureCleanupLoop() {
    if (_cleanupTimer) return;
    _cleanupTimer = setInterval(() => {
      void cleanupIdleBrowsers();
    }, getPoolConfig().cleanupIntervalMs);
    _cleanupTimer.unref?.();
  }

  function pickBrowserWithCapacity() {
    const cfg = getPoolConfig();
    const available = _browsers
      .filter((slot) => !slot.closing && slot.activeContexts < cfg.maxContextsPerBrowser)
      .sort(
        (a, b) =>
          a.activeContexts - b.activeContexts || a.lastUsedAt - b.lastUsedAt,
      );
    return available[0] || null;
  }

  function signalNextWaiter() {
    const next = _waiters.shift();
    if (next) next();
  }

  async function launchBrowserSlot() {
    if (!memoryAllowsBrowserLaunch()) return null;
    const { chromium } = require("playwright-core");
    const cfg = getPoolConfig();
    _launchInFlight += 1;
    try {
      const browser = await Promise.race([
        chromium.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-dev-shm-usage"],
        }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("browser_pool_launch_timeout")),
            cfg.launchTimeoutMs,
          ),
        ),
      ]);
      const slot = {
        id: `browser-${poolKey}-${_nextId++}`,
        browser,
        activeContexts: 0,
        createdContexts: 0,
        lastUsedAt: Date.now(),
        closing: false,
      };
      _browsers.push(slot);
      return slot;
    } finally {
      _launchInFlight = Math.max(0, _launchInFlight - 1);
    }
  }

  async function closeBrowserSlot(slot) {
    if (!slot || slot.closing) return;
    slot.closing = true;
    try {
      await slot.browser.close();
    } catch {
      /* ignore */
    } finally {
      const idx = _browsers.indexOf(slot);
      if (idx >= 0) _browsers.splice(idx, 1);
      signalNextWaiter();
    }
  }

  async function cleanupIdleBrowsers() {
    const cfg = getPoolConfig();
    const cutoff = Date.now() - cfg.idleTtlMs;
    for (const slot of [..._browsers]) {
      if (slot.closing || slot.activeContexts > 0) continue;
      if (slot.lastUsedAt >= cutoff) continue;
      if (_browsers.length <= 1) continue;
      await closeBrowserSlot(slot);
    }
  }

  function waitForSlotAvailability() {
    return new Promise((resolve) => {
      _waiters.push(resolve);
    });
  }

  async function pickOrCreateSlot() {
    const cfg = getPoolConfig();
    ensureCleanupLoop();
    while (true) {
      const reusable = pickBrowserWithCapacity();
      if (reusable) return reusable;

      const total = _browsers.length + _launchInFlight;
      if (total < cfg.maxBrowsers) {
        const launched = await launchBrowserSlot();
        if (launched) return launched;
      }

      await waitForSlotAvailability();
    }
  }

  async function acquireContext() {
    const slot = await pickOrCreateSlot();
    slot.activeContexts += 1;
    slot.createdContexts += 1;
    slot.lastUsedAt = Date.now();

    let context;
    try {
      context = await slot.browser.newContext();
    } catch (err) {
      slot.activeContexts = Math.max(0, slot.activeContexts - 1);
      signalNextWaiter();
      throw err;
    }

    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      try {
        await context.close();
      } catch {
        /* ignore */
      }
      slot.activeContexts = Math.max(0, slot.activeContexts - 1);
      slot.lastUsedAt = Date.now();
      const cfg = getPoolConfig();
      if (
        slot.activeContexts === 0 &&
        slot.createdContexts >= cfg.recycleUses &&
        _browsers.length > 1
      ) {
        await closeBrowserSlot(slot);
      } else {
        signalNextWaiter();
      }
    };

    return { browser: slot.browser, context, release };
  }

  /**
   * Reserve one browser “slot” and expose Playwright CDP ws endpoint for a remote worker.
   * Occupies the same capacity as one in-process context until `releaseRemoteLease`.
   */
  async function leaseRemoteBrowser() {
    const slot = await pickOrCreateSlot();
    const leaseId = randomUUID();
    slot.activeContexts += 1;
    slot.lastUsedAt = Date.now();
    _remoteLeases.set(leaseId, { slot });
    let wsEndpoint;
    try {
      wsEndpoint = slot.browser.wsEndpoint();
    } catch (err) {
      slot.activeContexts = Math.max(0, slot.activeContexts - 1);
      _remoteLeases.delete(leaseId);
      signalNextWaiter();
      throw err;
    }
    return { leaseId, wsEndpoint };
  }

  /**
   * @param {string} leaseId
   */
  async function releaseRemoteLease(leaseId) {
    const rec = _remoteLeases.get(leaseId);
    if (!rec) return false;
    _remoteLeases.delete(leaseId);
    const slot = rec.slot;
    slot.activeContexts = Math.max(0, slot.activeContexts - 1);
    slot.lastUsedAt = Date.now();
    signalNextWaiter();
    return true;
  }

  function getPoolStats() {
    return {
      poolKey,
      maxConcurrency: getMaxConcurrency(),
      inUseContexts: _browsers.reduce((acc, b) => acc + b.activeContexts, 0),
      remoteLeases: _remoteLeases.size,
      browsers: _browsers.map((slot) => ({
        id: slot.id,
        activeContexts: slot.activeContexts,
        createdContexts: slot.createdContexts,
        lastUsedAt: slot.lastUsedAt,
        closing: slot.closing,
      })),
      rssMb: currentRssMb(),
      waitingRequests: _waiters.length,
    };
  }

  async function shutdownPool() {
    if (_cleanupTimer) {
      clearInterval(_cleanupTimer);
      _cleanupTimer = null;
    }
    _waiters.length = 0;
    _remoteLeases.clear();
    for (const slot of [..._browsers]) {
      await closeBrowserSlot(slot);
    }
  }

  return {
    acquireContext,
    leaseRemoteBrowser,
    releaseRemoteLease,
    getPoolStats,
    shutdownPool,
  };
}

/**
 * Acquire a Playwright browser context from the pool.
 * @param {{ tenantId?: unknown; portalId?: unknown }} [opts]
 * @returns {Promise<{ browser: import('playwright-core').Browser, context: import('playwright-core').BrowserContext, release: () => Promise<void> }>}
 */
async function acquireContext(opts) {
  const key = resolvePoolKey(opts);
  return getEngine(key).acquireContext();
}

/**
 * @param {{ browser: import('playwright-core').Browser, context: import('playwright-core').BrowserContext, release: () => Promise<void> }} handle
 */
async function releaseContext(handle) {
  if (handle && typeof handle.release === "function") {
    await handle.release();
  }
}

/**
 * @param {{ tenantId?: unknown; portalId?: unknown }} [opts]
 * @returns {Promise<{ leaseId: string, wsEndpoint: string }>}
 */
async function leaseRemoteBrowser(opts) {
  const key = resolvePoolKey(opts);
  return getEngine(key).leaseRemoteBrowser();
}

/**
 * @param {string} leaseId
 * @param {{ tenantId?: unknown; portalId?: unknown }} [opts] required when leases are keyed per pool
 */
async function releaseRemoteLease(leaseId, opts) {
  if (opts && typeof opts === "object") {
    const key = resolvePoolKey(opts);
    return getEngine(key).releaseRemoteLease(leaseId);
  }
  for (const eng of _engines.values()) {
    if (await eng.releaseRemoteLease(leaseId)) return true;
  }
  return false;
}

/**
 * @param {string} poolKey
 * @param {string} leaseId
 */
async function releaseRemoteLeaseByPoolKey(poolKey, leaseId) {
  return getEngine(poolKey).releaseRemoteLease(leaseId);
}

function getPoolStats() {
  /** @type {Record<string, unknown>} */
  const pools = {};
  let inUseContexts = 0;
  let waitingRequests = 0;
  let remoteLeases = 0;
  for (const [k, eng] of _engines.entries()) {
    const s = eng.getPoolStats();
    pools[k] = s;
    inUseContexts += s.inUseContexts;
    waitingRequests += s.waitingRequests;
    remoteLeases += s.remoteLeases;
  }
  return {
    maxConcurrency: getMaxConcurrency(),
    inUseContexts,
    remoteLeases,
    browsers: Object.values(pools).flatMap(
      (p) => /** @type {{ browsers: unknown[] }} */ (p).browsers || [],
    ),
    rssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    waitingRequests,
    pools,
    poolKeys: Object.keys(pools),
  };
}

function getMaxConcurrency() {
  const cfg = getPoolConfig();
  return cfg.maxBrowsers * cfg.maxContextsPerBrowser;
}

/**
 * Test hook / graceful shutdown for workers.
 */
async function shutdownPool() {
  for (const eng of _engines.values()) {
    await eng.shutdownPool().catch(() => {});
  }
  _engines.clear();
}

module.exports = {
  acquireContext,
  releaseContext,
  leaseRemoteBrowser,
  releaseRemoteLease,
  releaseRemoteLeaseByPoolKey,
  shutdownPool,
  getMaxConcurrency,
  getPoolStats,
  makePoolKey,
  resolvePoolKey,
};
