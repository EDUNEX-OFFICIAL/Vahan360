import type { PrismaClient } from "./generated/prisma";

export function createIngestPrismaClient(
  options?: import("./generated/prisma").Prisma.PrismaClientOptions
): PrismaClient;
