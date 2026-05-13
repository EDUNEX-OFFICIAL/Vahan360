"use strict";

/**
 * @param {unknown} raw
 */
function rolesFromUserField(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map((r) => String(r).trim().toUpperCase())
      .filter(Boolean);
  }
  return String(raw || '')
    .split(',')
    .map((r) => r.trim().toUpperCase())
    .filter(Boolean);
}

/**
 * Express middleware factory: enforces that req.user (set by authMiddleware) holds
 * at least one of the required roles. Roles live in Postgres as `users.roles text[]`
 * (comma-string still accepted for transitional rows).
 *
 * Usage (always pair with authMiddleware upstream):
 *   router.post('/admin-only', authMiddleware, requireRole('ADMIN'), handler)
 *
 * @param {...string} roles  One or more role strings (e.g. 'ADMIN', 'USER').
 *   A caller passes if they hold ANY of the listed roles.
 * @returns {import('express').RequestHandler}
 */
function requireRole(...roles) {
  const normalised = roles.map((r) => String(r).trim().toUpperCase());

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required.',
        requestId: req.requestId,
      });
    }

    const userRoles = rolesFromUserField(req.user.roles);

    const allowed = normalised.some((role) => userRoles.includes(role));
    if (!allowed) {
      return res.status(403).json({
        error: 'Forbidden. Insufficient role.',
        required: normalised,
        requestId: req.requestId,
      });
    }

    return next();
  };
}

module.exports = { requireRole };
