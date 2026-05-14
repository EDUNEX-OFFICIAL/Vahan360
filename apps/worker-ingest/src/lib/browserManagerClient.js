"use strict";

const log = require("./logger");
const { withQuota } = require("./tenantQuota");

/**
 * Acquire Playwright browser + context either in-process (pooled) or via remote browser-manager (CDP).
 * Remote path: set `BROWSER_MANAGER_BASE_URL` (e.g. http://release-browser-manager:3005).
 *
 * Per-tenant quota is enforced via `withQuota` (tenantQuota.js) before any
 * real acquire happens.  Configure with:
 *   BROWSER_POOL_QUOTAS_JSON={"default":2,"org_acme":4}
 *   BROWSER_POOL_TENANT_MAX_CONTEXTS=2  (scalar fallback; 0 = disabled)
 *   BROWSER_POOL_QUOTA_WAIT_MS=30000    (wait before rejection)
 *   BROWSER_POOL_QUOTA_REJECT_FAST=true (reject immediately at cap)
 *
 * @param {{ portalId?: string|null; tenantId?: string }} opts
 * @returns {Promise<{ browser: import('playwright-core').Browser, context: import('playwright-core').BrowserContext, release: () => Promise<void> }>}
 */
async function acquirePlaywrightContext(opts) {
  const portalId = opts?.portalId != null ? String(opts.portalId) : "_";
  const tenantId =
    (opts?.tenantId != null && String(opts.tenantId).trim()
      ? String(opts.tenantId).trim()
      : "") ||
    process.env.WORKER_TENANT_SLUG?.trim() ||
    process.env.WORKER_TENANT_ID?.trim() ||
    "default";

  return withQuota(tenantId, () => {
    const base = process.env.BROWSER_MANAGER_BASE_URL?.trim();
    if (base) {
      return acquireRemoteViaHttp(base, tenantId, portalId);
    }

    const { acquireContext } = require("../browserPool");
    return acquireContext({ tenantId, portalId });
  });
}

/**
 * @param {string} base
 * @param {string} tenantId
 * @param {string} portalId
 */
async function acquireRemoteViaHttp(base, tenantId, portalId) {
  const root = base.replace(/\/$/, "");
  const headers = {
    "content-type": "application/json",
    "X-Tenant-Id": tenantId,
  };
  const tok = process.env.BROWSER_MANAGER_TOKEN?.trim();
  if (tok) {
    headers["X-Browser-Manager-Token"] = tok;
  }
  const forwardJwt = process.env.BROWSER_MANAGER_FORWARD_JWT?.trim();
  if (forwardJwt) {
    headers.authorization = `Bearer ${forwardJwt}`;
  }

  const acqUrl = `${root}/v1/context/acquire`;
  const res = await fetch(acqUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ portalId }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `browser_manager_acquire_failed status=${res.status} body=${text.slice(0, 500)}`,
    );
  }
  /** @type {{ leaseId?: string, wsEndpoint?: string }} */
  const body = await res.json();
  const { leaseId, wsEndpoint } = body;
  if (typeof leaseId !== "string" || typeof wsEndpoint !== "string") {
    throw new Error("browser_manager_acquire_invalid_response");
  }

  const { chromium } = require("playwright-core");
  const browser = await chromium.connectOverCDP(wsEndpoint);
  const context = await browser.newContext();

  const release = async () => {
    try {
      await context.close();
    } catch {
      /* ignore */
    }
    const relUrl = `${root}/v1/context/${encodeURIComponent(leaseId)}/release`;
    try {
      const rel = await fetch(relUrl, { method: "POST", headers });
      if (!rel.ok) {
        log.warn({
          msg: "browser_manager_release_non_ok",
          status: rel.status,
          leaseId,
        });
      }
    } catch (e) {
      log.warn({
        msg: "browser_manager_release_failed",
        error: e?.message || String(e),
        leaseId,
      });
    }
  };

  return { browser, context, release };
}

module.exports = { acquirePlaywrightContext };
