"use strict";

const { activeTraceLogFields } = require("./activeTraceLogFields");

/**
 * Single-line structured logs to stdout (JSON). No external logging deps.
 * @param {Record<string, unknown>} fields
 */
function writeLine(fields) {
  const line = {
    ts: new Date().toISOString(),
    service: "vahan360-api-express",
    ...activeTraceLogFields(),
    ...fields,
  };
  try {
    console.log(JSON.stringify(line));
  } catch {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        service: "vahan360-api-express",
        level: "error",
        msg: "log_serialize_failed",
      })
    );
  }
}

/** @param {Record<string, unknown>} fields */
function info(fields) {
  writeLine({ level: "info", ...fields });
}

/** @param {Record<string, unknown>} fields */
function warn(fields) {
  writeLine({ level: "warn", ...fields });
}

/** @param {Record<string, unknown>} fields */
function error(fields) {
  writeLine({ level: "error", ...fields });
}

module.exports = { info, warn, error, writeLine };
