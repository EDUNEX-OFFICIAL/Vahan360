"use strict";

const enabled =
  process.env.OTEL_ENABLED === "true" || process.env.OTEL_ENABLED === "1";

if (!enabled) {
  module.exports = {
    isOtelEnabled: () => false,
    shutdown: async () => {},
  };
} else {
  const ep =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() ||
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  if (!ep) {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://127.0.0.1:4318";
  }
  if (!process.env.OTEL_SERVICE_NAME?.trim()) {
    process.env.OTEL_SERVICE_NAME = "worker-ingest";
  }

  const { NodeSDK } = require("@opentelemetry/sdk-node");
  const { getNodeAutoInstrumentations } = require("@opentelemetry/auto-instrumentations-node");
  const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");

  const traceExporter = new OTLPTraceExporter();

  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME,
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
  });

  sdk.start();

  async function shutdown() {
    try {
      await sdk.shutdown();
    } catch {
      /* ignore */
    }
  }

  process.once("SIGTERM", () => {
    shutdown().catch(() => {});
  });
  process.once("SIGINT", () => {
    shutdown().catch(() => {});
  });

  module.exports = {
    isOtelEnabled: () => true,
    shutdown,
  };
}
