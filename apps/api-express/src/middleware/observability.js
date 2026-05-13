"use strict";

const { trace, SpanStatusCode } = require("@opentelemetry/api");
const { observeHttpRequest } = require("../lib/metrics");

const tracer = trace.getTracer("vahan360-api-express");

function isOtelEnabled() {
  return process.env.OTEL_ENABLED === "true" || process.env.OTEL_ENABLED === "1";
}

/** @param {import("express").Request} req */
function normalizedRoute(req) {
  if (req.route && typeof req.route.path === "string") {
    const base = typeof req.baseUrl === "string" ? req.baseUrl : "";
    return `${base}${req.route.path}` || req.route.path;
  }
  return "unmatched";
}

/**
 * Request observability middleware:
 * - emits Prometheus request metrics with low-cardinality labels
 * - wraps request in an explicit OTEL span when enabled
 */
function observabilityMiddleware(req, res, next) {
  const t0 = process.hrtime.bigint();
  const otelOn = isOtelEnabled();
  const method = String(req.method || "GET").toUpperCase();
  const correlationIdHeader = req.get("x-correlation-id");
  const correlationId =
    typeof correlationIdHeader === "string" && correlationIdHeader.trim()
      ? correlationIdHeader.trim().slice(0, 256)
      : undefined;

  if (correlationId) {
    req.correlationId = correlationId;
  }

  const span = otelOn
    ? tracer.startSpan(`http.request ${method}`, {
        attributes: {
          "http.method": method,
          "http.route": req.path || "unknown",
          "http.target": req.originalUrl || req.url || "",
          ...(req.requestId ? { "app.request_id": req.requestId } : {}),
          ...(correlationId ? { "app.correlation_id": correlationId } : {}),
        },
      })
    : null;

  res.on("finish", () => {
    const elapsedNs = process.hrtime.bigint() - t0;
    const durationSeconds = Number(elapsedNs) / 1e9;
    const route = normalizedRoute(req);
    observeHttpRequest({
      method,
      route,
      statusCode: res.statusCode,
      durationSeconds,
    });

    if (span) {
      span.setAttribute("http.status_code", res.statusCode);
      span.setAttribute("http.route", route);
      if (req.requestId) span.setAttribute("app.request_id", req.requestId);
      if (req.correlationId) {
        span.setAttribute("app.correlation_id", req.correlationId);
      }
      if (res.statusCode >= 500) {
        span.setStatus({ code: SpanStatusCode.ERROR });
      }
      span.end();
    }
  });

  next();
}

module.exports = { observabilityMiddleware };
