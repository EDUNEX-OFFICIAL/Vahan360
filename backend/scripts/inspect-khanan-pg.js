/**
 * One-off: inspect khanan_data in the DB pointed to by backend/.env (DATABASE_URL).
 * Usage: node scripts/inspect-khanan-pg.js
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const prisma = require("../src/db/prisma");

(async () => {
  try {
    const n = await prisma.khananData.count();
    const latest = await prisma.khananData.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        challanNo: true,
        district: true,
        date: true,
        createdAt: true,
        sourceType: true,
        vehicleRegNo: true,
      },
    });
    console.log("DATABASE_URL host:", process.env.DATABASE_URL?.replace(/:[^:@/]+@/, ":****@"));
    console.log("khanan_data row count:", n);
    console.log("Latest 5 rows:");
    console.log(JSON.stringify(latest, null, 2));
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
