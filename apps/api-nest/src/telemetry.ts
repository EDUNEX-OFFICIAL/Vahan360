/**
 * OpenTelemetry SDK bootstrap for api-nest.
 * MUST be the first import in main.ts so the SDK patches Node.js internals
 * before NestJS or any other module loads.
 *
 * Mirrors the pattern in apps/api-express/src/telemetry.js.
 * Gated by OTEL_ENABLED=true|1 — no-op when unset (zero overhead).
 */

const enabled =
  process.env.OTEL_ENABLED === 'true' || process.env.OTEL_ENABLED === '1';

let _shutdown: (() => Promise<void>) | null = null;

if (enabled) {
  if (
    !process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() &&
    !process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim()
  ) {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://127.0.0.1:4318';
  }
  if (!process.env.OTEL_SERVICE_NAME?.trim()) {
    process.env.OTEL_SERVICE_NAME = 'vahan360-api-nest';
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { NodeSDK } = require('@opentelemetry/sdk-node') as typeof import('@opentelemetry/sdk-node');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node') as typeof import('@opentelemetry/auto-instrumentations-node');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http') as typeof import('@opentelemetry/exporter-trace-otlp-http');

  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME,
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();

  _shutdown = async (): Promise<void> => {
    try {
      await sdk.shutdown();
    } catch {
      /* ignore */
    }
  };

  process.once('SIGTERM', () => {
    _shutdown?.().catch(() => {});
  });
  process.once('SIGINT', () => {
    _shutdown?.().catch(() => {});
  });
}
