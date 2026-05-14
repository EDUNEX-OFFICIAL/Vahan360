"use strict";

const { createIngestPrismaClient } = require("@vahan360/db/ingest-client");

/** @type {ReturnType<typeof createIngestPrismaClient> | null} */
let _ingestClient = null;

/**
 * Ingest DB URL: optional dedicated `INGEST_DATABASE_URL`, else same as app `DATABASE_URL`
 * (single Postgres, multiple schemas: `public` + `ingest`).
 * @returns {string | undefined}
 */
function getIngestDatabaseUrl() {
  return (
    process.env.INGEST_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    undefined
  );
}

/**
 * Lazy singleton Prisma client for `ingest` schema (`@vahan360/db`).
 * Uses explicit datasource URL so we never clobber `DATABASE_URL` for the main app Prisma.
 * @returns {import("@prisma/client").PrismaClient}
 */
function getIngestPrisma() {
  const url = getIngestDatabaseUrl();
  if (!url) {
    throw new Error(
      "Ingest database not configured: set INGEST_DATABASE_URL or DATABASE_URL"
    );
  }
  if (!_ingestClient) {
    _ingestClient = createIngestPrismaClient({
      datasources: { db: { url } },
    });
  }
  return _ingestClient;
}

/**
 * @returns {ReturnType<typeof createIngestPrismaClient> | null}
 */
function tryGetIngestPrisma() {
  try {
    return getIngestDatabaseUrl() ? getIngestPrisma() : null;
  } catch {
    return null;
  }
}

module.exports = {
  getIngestDatabaseUrl,
  getIngestPrisma,
  tryGetIngestPrisma,
};
