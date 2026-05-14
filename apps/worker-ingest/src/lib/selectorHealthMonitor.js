"use strict";

/**
 * Process-local selector health monitor used for lightweight degraded alerts.
 * This intentionally avoids external state/infra while still surfacing bursts.
 */
class SelectorHealthMonitor {
  /**
   * @param {{ failureThreshold: number; windowMs: number; degradedCooldownMs: number }} config
   */
  constructor(config) {
    this.failureThreshold = Math.max(1, Number(config.failureThreshold) || 5);
    this.windowMs = Math.max(1_000, Number(config.windowMs) || 600_000);
    this.degradedCooldownMs = Math.max(
      1_000,
      Number(config.degradedCooldownMs) || 300_000
    );
    /** @type {Map<string, number[]>} */
    this.failureTimestamps = new Map();
    /** @type {Map<string, number>} */
    this.lastDegradedAt = new Map();
  }

  /**
   * @param {string} portalId
   * @param {number} nowMs
   * @returns {{ shouldAlert: boolean; failuresInWindow: number }}
   */
  recordFailure(portalId, nowMs = Date.now()) {
    const id = portalId || "unknown";
    const timestamps = this.failureTimestamps.get(id) || [];
    timestamps.push(nowMs);
    const floor = nowMs - this.windowMs;
    const recent = timestamps.filter((ts) => ts >= floor);
    this.failureTimestamps.set(id, recent);

    const failuresInWindow = recent.length;
    const last = this.lastDegradedAt.get(id) || 0;
    const coolingDown = nowMs - last < this.degradedCooldownMs;
    const shouldAlert = failuresInWindow >= this.failureThreshold && !coolingDown;

    if (shouldAlert) {
      this.lastDegradedAt.set(id, nowMs);
    }

    return { shouldAlert, failuresInWindow };
  }
}

module.exports = { SelectorHealthMonitor };
