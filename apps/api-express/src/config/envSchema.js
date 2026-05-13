"use strict";

const { z } = require("zod");

function envFlagTrue(name) {
  const v = process.env[name];
  if (v == null || String(v).trim() === "") return false;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

const strict = envFlagTrue("ENV_STRICT");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).optional(),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine(
      (s) => /^(postgres(ql)?:\/\/)/i.test(s.trim()),
      "DATABASE_URL must be a postgres connection string"
    ),
  JWT_SECRET: z.string().optional(),
  REDIS_URL: z.string().optional(),
  BULLMQ_REDIS_URL: z.string().optional(),
  CORS_ORIGIN_ALLOWLIST: z.string().optional(),
  AUTH_COOKIE_DOMAIN: z.string().optional(),
  AUTH_COOKIE_PATH: z.string().optional(),
  AUTH_COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).optional(),
  AUTH_COOKIE_SECURE: z.string().optional(),
  AUTH_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().optional(),
  AUTH_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().optional(),
  CSRF_TOKEN_MAX_AGE_MS: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_AUTH_WINDOW_MS: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().optional(),
  METRICS_ENABLED: z.string().optional(),
  METRICS_PATH: z.string().optional(),
  OTEL_ENABLED: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: z.string().url().optional(),
  OTEL_SERVICE_NAME: z.string().optional(),
  BACKEND_PORT: z.coerce.number().int().positive().max(65535).optional(),
  PORT: z.coerce.number().int().positive().max(65535).optional(),
});

/**
 * Validates critical env at process start. When ENV_STRICT=true|1, invalid
 * config throws after logging. Otherwise issues are warnings only.
 */
function validateCriticalEnvAtStartup() {
  const raw = {
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    REDIS_URL: process.env.REDIS_URL,
    BULLMQ_REDIS_URL: process.env.BULLMQ_REDIS_URL,
    CORS_ORIGIN_ALLOWLIST: process.env.CORS_ORIGIN_ALLOWLIST,
    AUTH_COOKIE_DOMAIN: process.env.AUTH_COOKIE_DOMAIN,
    AUTH_COOKIE_PATH: process.env.AUTH_COOKIE_PATH,
    AUTH_COOKIE_SAMESITE: process.env.AUTH_COOKIE_SAMESITE,
    AUTH_COOKIE_SECURE: process.env.AUTH_COOKIE_SECURE,
    AUTH_ACCESS_TTL_SECONDS: process.env.AUTH_ACCESS_TTL_SECONDS,
    AUTH_REFRESH_TTL_SECONDS: process.env.AUTH_REFRESH_TTL_SECONDS,
    CSRF_TOKEN_MAX_AGE_MS: process.env.CSRF_TOKEN_MAX_AGE_MS,
    RATE_LIMIT_AUTH_WINDOW_MS: process.env.RATE_LIMIT_AUTH_WINDOW_MS,
    RATE_LIMIT_AUTH_MAX: process.env.RATE_LIMIT_AUTH_MAX,
    METRICS_ENABLED: process.env.METRICS_ENABLED,
    METRICS_PATH: process.env.METRICS_PATH,
    OTEL_ENABLED: process.env.OTEL_ENABLED,
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:
      process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
    OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,
    BACKEND_PORT: process.env.BACKEND_PORT,
    PORT: process.env.PORT,
  };

  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors;
    const text = `[env] Critical env validation failed: ${JSON.stringify(msg)}`;
    if (strict) {
      console.error(text);
      throw new Error("ENV_STRICT: fix environment variables (see .env.example)");
    }
    console.warn(text);
    return;
  }

  const data = parsed.data;
  if (data.NODE_ENV === "production") {
    const secret = (data.JWT_SECRET || "").trim();
    if (secret.length < 32) {
      const text =
        "[env] JWT_SECRET must be at least 32 characters in production.";
      if (strict) {
        console.error(text);
        throw new Error("ENV_STRICT: JWT_SECRET too short for production");
      }
      console.warn(text);
    } else {
      const lower = secret.toLowerCase();
      if (/change|placeholder|example/.test(lower) && secret.length < 48) {
        console.warn(
          "[env] JWT_SECRET may be a placeholder — rotate before real traffic."
        );
      }
    }
  }
}

module.exports = {
  validateCriticalEnvAtStartup,
  envFlagTrue,
};
