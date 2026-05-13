"use strict";

const crypto = require("crypto");
const { activeTraceLogFields } = require("../lib/activeTraceLogFields");

const HEADER = "x-request-id";
const RESPONSE_HEADER = "X-Request-Id";

/**
 * Reads `x-request-id` or generates a UUID v4; sets `req.requestId`.
 * Sets `X-Request-Id` on the response. For JSON bodies with status >= 400,
 * appends `requestId` unless `ATTACH_REQUEST_ID_TO_JSON=true` (then all JSON).
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
function requestContextMiddleware(req, res, next) {
  const raw = req.get(HEADER)?.trim();
  const requestId =
    raw && raw.length > 0 ? raw.slice(0, 256) : crypto.randomUUID();

  req.requestId = requestId;
  res.setHeader(RESPONSE_HEADER, requestId);

  const otel = activeTraceLogFields();
  if (otel.traceId) {
    req.traceId = otel.traceId;
  }

  const attachAll = process.env.ATTACH_REQUEST_ID_TO_JSON === "true";
  const origJson = res.json.bind(res);
  res.json = function jsonWithRequestId(body) {
    const code = res.statusCode;
    const attach =
      attachAll || (code >= 400 && body && typeof body === "object" && !Buffer.isBuffer(body));
    if (attach && body !== null && typeof body === "object" && !Array.isArray(body)) {
      return origJson({ ...body, requestId });
    }
    return origJson(body);
  };

  next();
}

module.exports = { requestContextMiddleware, HEADER, RESPONSE_HEADER };
