"use strict";

const { PrismaClient } = require("./generated/prisma");

/**
 * @param {import("./generated/prisma").Prisma.PrismaClientOptions | undefined} options
 * @returns {import("./generated/prisma").PrismaClient}
 */
function createIngestPrismaClient(options) {
  return new PrismaClient(options);
}

module.exports = { createIngestPrismaClient };
