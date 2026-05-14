"use strict";

function parseCookies(headerValue) {
  if (!headerValue || typeof headerValue !== "string") return {};
  const out = {};
  const chunks = headerValue.split(";");
  for (const chunk of chunks) {
    const idx = chunk.indexOf("=");
    if (idx <= 0) continue;
    const name = chunk.slice(0, idx).trim();
    const value = chunk.slice(idx + 1).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

function getCookie(req, name) {
  const cookies = parseCookies(req.headers.cookie || "");
  return cookies[name] || "";
}

module.exports = {
  parseCookies,
  getCookie,
};
