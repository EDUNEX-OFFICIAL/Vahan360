"use strict";

const { propagation, context } = require("@opentelemetry/api");

function isOtelEnabled() {
  return (
    process.env.OTEL_ENABLED === "true" || process.env.OTEL_ENABLED === "1"
  );
}

/**
 * Runs `fn` with W3C trace context from BullMQ `job.data` when OTEL is on and
 * `traceparent` is present. Otherwise calls `fn` unchanged.
 * @template T
 * @param {Record<string, unknown>|null|undefined} jobData
 * @param {() => T} fn
 * @returns {T}
 */
function runWithJobTraceContext(jobData, fn) {
  if (!isOtelEnabled()) {
    return fn();
  }
  const tp =
    jobData && typeof jobData.traceparent === "string"
      ? jobData.traceparent.trim()
      : "";
  if (!tp) {
    return fn();
  }
  const carrier = { traceparent: tp };
  const ts =
    jobData && typeof jobData.tracestate === "string"
      ? jobData.tracestate.trim()
      : "";
  if (ts) {
    carrier.tracestate = ts;
  }
  const extracted = propagation.extract(context.active(), carrier);
  return context.with(extracted, fn);
}

module.exports = { runWithJobTraceContext };
