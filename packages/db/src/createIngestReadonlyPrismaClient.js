"use strict";

const { PrismaClient } = require("./generated/prisma");

/**
 * Creates a Prisma client pointed at the optional read-replica URL
 * (`INGEST_DATABASE_URL_READ_REPLICA`) when present, falling back to
 * `INGEST_DATABASE_URL` → `DATABASE_URL`.
 *
 * Services that only perform SELECT queries should prefer this factory
 * so they can transparently route reads to a replica without touching
 * write paths once `INGEST_DATABASE_URL_READ_REPLICA` is provisioned.
 *
 * If no replica URL is set the client behaves identically to
 * `createIngestPrismaClient` — zero risk of regression.
 *
 * @param {import("./generated/prisma").Prisma.PrismaClientOptions | undefined} options
 * @returns {import("./generated/prisma").PrismaClient}
 */
function createIngestReadonlyPrismaClient(options) {
  const url =
    process.env.INGEST_DATABASE_URL_READ_REPLICA?.trim() ||
    process.env.INGEST_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim();

  return new PrismaClient({
    ...options,
    datasources: { db: { url } },
  });
}

module.exports = { createIngestReadonlyPrismaClient };
