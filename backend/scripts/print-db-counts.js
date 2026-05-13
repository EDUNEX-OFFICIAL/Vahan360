/**
 * One-off: print row counts for main tables (uses backend/.env DATABASE_URL).
 * Run: node scripts/print-db-counts.js
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const [users, khanan, summaries, runs] = await Promise.all([
      prisma.user.count(),
      prisma.khananData.count(),
      prisma.vehicleTripSummary.count(),
      prisma.scraperRunState.count(),
    ]);
    console.log(JSON.stringify({ users, khanan_data: khanan, vehicle_trip_summary: summaries, scraper_run_state: runs }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
