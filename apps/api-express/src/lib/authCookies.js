"use strict";

const ACCESS_COOKIE_NAME = "spybot_access";
const REFRESH_COOKIE_NAME = "spybot_refresh";
const CSRF_COOKIE_NAME = "spybot_csrf";

function envFlagTrue(name) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return false;
  const v = String(raw).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function cookieDomain() {
  const v = String(process.env.AUTH_COOKIE_DOMAIN || "").trim();
  return v || undefined;
}

function authCookiePath() {
  const v = String(process.env.AUTH_COOKIE_PATH || "/").trim();
  return v || "/";
}

function isHttpsLikeRequest(req) {
  if (req.secure) return true;
  const proto = String(req.get("x-forwarded-proto") || "").toLowerCase();
  return proto.includes("https");
}

function useSecureCookies(req) {
  if (envFlagTrue("AUTH_COOKIE_SECURE")) return true;
  if (process.env.NODE_ENV === "production") return true;
  return isHttpsLikeRequest(req);
}

function parseSameSite() {
  const raw = String(process.env.AUTH_COOKIE_SAMESITE || "lax").trim().toLowerCase();
  if (raw === "strict" || raw === "none" || raw === "lax") return raw;
  return "lax";
}

function buildCookieBaseOptions(req) {
  const secure = useSecureCookies(req);
  const sameSite = parseSameSite();
  return {
    httpOnly: true,
    secure,
    sameSite,
    path: authCookiePath(),
    domain: cookieDomain(),
  };
}

function clearCookie(res, name, req) {
  const opts = buildCookieBaseOptions(req);
  res.clearCookie(name, opts);
}

function setAuthCookies(res, req, { accessToken, refreshToken, accessMaxAgeMs, refreshMaxAgeMs }) {
  const base = buildCookieBaseOptions(req);
  res.cookie(ACCESS_COOKIE_NAME, accessToken, {
    ...base,
    maxAge: accessMaxAgeMs,
  });
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    ...base,
    maxAge: refreshMaxAgeMs,
  });
}

function setCsrfCookie(res, req, csrfToken) {
  const authBase = buildCookieBaseOptions(req);
  res.cookie(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false,
    secure: authBase.secure,
    sameSite: authBase.sameSite,
    path: authBase.path,
    domain: authBase.domain,
    maxAge: Number(process.env.CSRF_TOKEN_MAX_AGE_MS) || 24 * 60 * 60 * 1000,
  });
}

function clearAuthCookies(res, req) {
  clearCookie(res, ACCESS_COOKIE_NAME, req);
  clearCookie(res, REFRESH_COOKIE_NAME, req);
  clearCookie(res, CSRF_COOKIE_NAME, req);
}

module.exports = {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  setAuthCookies,
  setCsrfCookie,
  clearAuthCookies,
};
