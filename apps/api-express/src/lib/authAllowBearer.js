"use strict";

function truthyEnv(name) {
  const v = process.env[name];
  if (v == null || String(v).trim() === "") return false;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

/**
 * When true, `Authorization: Bearer` is accepted in addition to the httpOnly
 * access cookie (`spybot_access`). When false, a Bearer header is rejected
 * (401 `bearer_deprecated`) and only the cookie is used.
 *
 * If `AUTH_ALLOW_BEARER` is unset: **false** in production, **true** in
 * non-production (local DX).
 */
function authAllowBearer() {
  const raw = process.env.AUTH_ALLOW_BEARER;
  if (raw != null && String(raw).trim() !== "") {
    return truthyEnv("AUTH_ALLOW_BEARER");
  }
  return process.env.NODE_ENV !== "production";
}

module.exports = { authAllowBearer };
