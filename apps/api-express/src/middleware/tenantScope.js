"use strict";

/**
 * tenantScope.js — Express v1 tenant extraction middleware (§3 parity fix).
 *
 * Reconciles Express v1 routes with the same tenant resolution logic used by
 * the Nest TenantGuard so that tenant-scoped scrape-jobs, vehicle reads, and
 * future v1 routes all share a consistent `req.tenantId`.
 *
 * Priority:
 *   1. JWT claims: `tid` / `tenantId` / `tenant_slug` (already decoded by authMiddleware → `req.user`)
 *   2. Request headers: `X-Tenant-Id` (Helm internal calls, service-to-service)
 *   3. Fallback: `"default"` (backward-compatible with pre-multi-tenant deployments)
 *
 * Does NOT enforce tenant existence in DB — that is an optional guard for routes
 * that need full FK validation (see `tenantOrgGuard.js` if DB check required).
 */

const DEFAULT_TENANT = "default";

/**
 * @param {import("express").Request & { user?: Record<string, unknown>; tenantId?: string }} req
 * @param {import("express").Response} _res
 * @param {import("express").NextFunction} next
 */
function tenantScopeMiddleware(req, _res, next) {
  if (req.tenantId && typeof req.tenantId === "string" && req.tenantId.trim()) {
    return next();
  }

  const user = req.user;
  if (user && typeof user === "object") {
    const fromJwt =
      typeof user.tid === "string" && user.tid.trim()
        ? user.tid.trim().toLowerCase()
        : typeof user.tenantId === "string" && user.tenantId.trim()
          ? user.tenantId.trim().toLowerCase()
          : typeof user.tenant_slug === "string" && user.tenant_slug.trim()
            ? user.tenant_slug.trim().toLowerCase()
            : typeof user.tenantSlug === "string" && user.tenantSlug.trim()
              ? user.tenantSlug.trim().toLowerCase()
              : null;
    if (fromJwt) {
      req.tenantId = fromJwt;
      return next();
    }
  }

  const headerTenant = req.headers["x-tenant-id"];
  if (typeof headerTenant === "string" && headerTenant.trim()) {
    req.tenantId = headerTenant.trim().toLowerCase();
    return next();
  }

  req.tenantId = DEFAULT_TENANT;
  return next();
}

module.exports = { tenantScopeMiddleware };
