import type { PrismaClient } from "./generated/prisma";

/**
 * Creates a Prisma client that prefers `INGEST_DATABASE_URL_READ_REPLICA`
 * when set, falling back to `INGEST_DATABASE_URL` → `DATABASE_URL`.
 *
 * Use for analytics/dashboard read-only queries to enable transparent
 * read-replica routing without modifying write service clients.
 */
export function createIngestReadonlyPrismaClient(
  options?: import("./generated/prisma").Prisma.PrismaClientOptions
): PrismaClient;
