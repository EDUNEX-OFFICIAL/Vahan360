"use strict";

const { CSRF_COOKIE_NAME } = require("../lib/authCookies");
const { getCookie } = require("../lib/cookies");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function shouldSkipCsrf(req) {
  const path = req.path || "";
  if (!path.startsWith("/api/")) return true;
  if (path.startsWith("/api/auth/generate-token")) return true;
  if (path.startsWith("/api/auth/login")) return true;
  if (path.startsWith("/api/auth/register-user")) return true;
  if (path.startsWith("/api/health")) return true;
  if (path === "/api/auth/csrf") return true;
  // Logout: allow even when CSRF cookie has expired so users can always log out.
  if (path.startsWith("/api/auth/logout")) return true;
  // Refresh: httpOnly refresh cookie already proves possession; CSRF here would
  // block silent token rotation when CSRF cookie outlives a 15-min access window.
  if (path.startsWith("/api/auth/refresh")) return true;
  return false;
}

function csrfMiddleware(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (shouldSkipCsrf(req)) return next();

  const cookieToken = getCookie(req, CSRF_COOKIE_NAME);
  const headerToken = String(req.get("x-csrf-token") || "").trim();

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({
      error: "Invalid CSRF token.",
      requestId: req.requestId,
    });
  }
  return next();
}

module.exports = {
  csrfMiddleware,
};
