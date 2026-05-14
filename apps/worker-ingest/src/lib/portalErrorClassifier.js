"use strict";

/**
 * portalErrorClassifier.js — Per-portal structured error classification (§5 fidelity).
 *
 * Classifies Playwright / HTTP scrape errors into well-known buckets so that:
 *  - Retryable errors (transient network, session expiry) are distinguished from terminal ones.
 *  - Per-portal Prometheus counters are emitted for alert rule tuning.
 *  - Worker adaptive backoff can use the classification to scale retry delay.
 *
 * Classification is pure-function: no I/O, no side effects.
 */

/** @typedef {"CAPTCHA" | "SESSION_EXPIRED" | "NETWORK" | "PARSE_FAILURE" | "PORTAL_DOWN" | "TIMEOUT" | "SELECTOR_NOT_FOUND" | "UNKNOWN"} ErrorClass */

/** @typedef {{ class: ErrorClass; retryable: boolean; terminal: boolean; details?: string }} ClassifiedError */

// Portal-specific hint patterns (ordered by specificity).
// Each entry: { portals: string[] | null (= all), pattern: RegExp, class: ErrorClass, retryable: bool }
const PATTERNS = [
  // CAPTCHA / bot detection
  {
    portals: null,
    pattern: /captcha|recaptcha|hcaptcha|are you a robot|bot.?detect/i,
    class: "CAPTCHA",
    retryable: false,
  },
  // Session / auth expiry
  {
    portals: null,
    pattern: /session.?expir|logged.?out|unauthorized|401|sign.?in.?again|login.?required/i,
    class: "SESSION_EXPIRED",
    retryable: true,
  },
  // Portal maintenance / 5xx
  {
    portals: null,
    pattern: /503|502|504|service.?unavailable|gateway.?timeout|under.?maintenance|temporarily.?unavailable/i,
    class: "PORTAL_DOWN",
    retryable: true,
  },
  // Playwright navigation timeout
  {
    portals: null,
    pattern: /navigation timeout|page.timeout|Timeout.*exceeded|ERR_TIMED_OUT/i,
    class: "TIMEOUT",
    retryable: true,
  },
  // Network-level errors
  {
    portals: null,
    pattern: /net::ERR_|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|socket hang up|network.?error|fetch.?fail/i,
    class: "NETWORK",
    retryable: true,
  },
  // DOM selector not found (portal layout change)
  {
    portals: null,
    pattern: /waiting for selector|selector.*not found|Element.*not found|locator.*not found|TimeoutError.*selector/i,
    class: "SELECTOR_NOT_FOUND",
    retryable: false,
  },
  // Parse failures (JSON.parse, DOM table extraction)
  {
    portals: null,
    pattern: /JSON\.parse|SyntaxError.*JSON|unexpected token|parse error|DOM.*extract|table.*empty|no rows found/i,
    class: "PARSE_FAILURE",
    retryable: false,
  },

  // Khanan-portal–specific
  {
    portals: ["khanan-bihar"],
    pattern: /ddlDMO|ddlPassType|ctl00_MainContent/i,
    class: "SELECTOR_NOT_FOUND",
    retryable: false,
  },

  // VAHAN permit/insurance/fitness portals
  {
    portals: ["vahan-permit"],
    pattern: /RC.*not found|vehicle.?not.?found|No.?records.?found|result.?not.?found/i,
    class: "PARSE_FAILURE",
    retryable: false,
  },
];

/**
 * Classify an error (string message or Error object) for a given portalId.
 *
 * @param {unknown} err  — Error object, string, or anything
 * @param {string | null | undefined} portalId  — e.g. "khanan-bihar", "vahan-permit"
 * @returns {ClassifiedError}
 */
function classifyPortalError(err, portalId) {
  const msg =
    err instanceof Error
      ? `${err.message}\n${err.stack || ""}`
      : typeof err === "string"
        ? err
        : JSON.stringify(err);

  const pid = typeof portalId === "string" ? portalId.toLowerCase() : null;

  for (const rule of PATTERNS) {
    if (rule.portals !== null && pid && !rule.portals.includes(pid)) {
      continue;
    }
    if (rule.pattern.test(msg)) {
      return {
        class: rule.class,
        retryable: rule.retryable,
        terminal: !rule.retryable,
        details: msg.slice(0, 200),
      };
    }
  }

  return {
    class: "UNKNOWN",
    retryable: true,
    terminal: false,
    details: msg.slice(0, 200),
  };
}

/**
 * Emit a structured log entry + optional Prometheus counter increment for a classified portal error.
 *
 * @param {typeof import("../lib/logger")} log
 * @param {{ portalId: string | null; kind: string; scrapeJobId: string; classified: ClassifiedError }} args
 */
function logClassifiedError(log, { portalId, kind, scrapeJobId, classified }) {
  const level = classified.terminal ? "error" : "warn";
  log[level]({
    msg: "portal_error_classified",
    portalId: portalId || "unknown",
    kind,
    scrapeJobId,
    errorClass: classified.class,
    retryable: classified.retryable,
    terminal: classified.terminal,
    details: classified.details,
  });
}

module.exports = { classifyPortalError, logClassifiedError };
