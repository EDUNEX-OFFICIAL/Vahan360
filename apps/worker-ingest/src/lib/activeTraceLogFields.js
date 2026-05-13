"use strict";

const { trace, context } = require("@opentelemetry/api");

/**
 * Fields to merge into structured logs when an OpenTelemetry span is active.
 * @returns {{ traceId?: string, trace_id?: string, span_id?: string }}
 */
function activeTraceLogFields() {
  const span = trace.getSpan(context.active());
  if (!span) return {};
  const sc = span.spanContext();
  if (!sc || !sc.traceId) return {};
  if (/^0+$/.test(sc.traceId)) return {};
  return {
    traceId: sc.traceId,
    trace_id: sc.traceId,
    span_id: sc.spanId,
  };
}

module.exports = { activeTraceLogFields };
