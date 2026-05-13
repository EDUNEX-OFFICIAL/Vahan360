import "dotenv/config";
import { defineConfig } from "prisma/config";

/** Prisma CLI config (schema path). Loads `packages/db/.env` via dotenv when present. */
export default defineConfig({
  schema: "prisma/schema.prisma",
});
