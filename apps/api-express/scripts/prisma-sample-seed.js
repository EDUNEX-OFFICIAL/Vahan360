const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function run() {
  const now = new Date();
  const ts = Date.now();

  const user = await prisma.user.upsert({
    where: { username: `sample_user_${ts}` },
    update: { updatedAt: now },
    create: {
      username: `sample_user_${ts}`,
      email: `sample_${ts}@example.com`,
      password: "$2a$10$samplehashedvalueonlyforseed",
      roles: ["USER"],
      tokenVersion: 0,
    },
  });

  const khanan = await prisma.khananData.upsert({
    where: { challanNo: `SAMPLE-CHALLAN-${ts}` },
    update: { updatedAt: now },
    create: {
      district: "ARWAL",
      consignerName: "SAMPLE CONSIGNER",
      date: "10-May-2026",
      sourceType: "Lessee",
      consigneeName: "SAMPLE CONSIGNEE",
      challanNo: `SAMPLE-CHALLAN-${ts}`,
      mineralName: "SAND",
      mineralCategory: "MINOR",
      vehicleRegNo: "BR01AA1234",
      destination: "PATNA",
      transportedDate: "10 May 2026",
      quantity: "12.500",
      unit: "MT",
      checkStatus: "DESPATCHED",
    },
  });

  const vts = await prisma.vehicleTripSummary.upsert({
    where: { vehicleRegNo: "BR01AA1234" },
    update: {
      totalTrips: { increment: 1 },
      totalMtWeight: { increment: 12.5 },
      updatedAt: now,
    },
    create: {
      vehicleRegNo: "BR01AA1234",
      totalTrips: 1,
      totalMtWeight: 12.5,
      sandTrips: 1,
      sandMtWeight: 12.5,
      stoneTrips: 0,
      stoneMtWeight: 0,
      ownerName: "SAMPLE OWNER",
      currentDistrict: "ARWAL",
      permanentDistrict: "ARWAL",
      customerType: "Individual",
      status: "pending",
      leadSource: "Seed",
    },
  });

  console.log("Seeded sample rows:");
  console.log(`- users.id=${user.id}`);
  console.log(`- khanan_data.id=${khanan.id}`);
  console.log(`- vehicle_trip_summary.id=${vts.id}`);
}

run()
  .catch((err) => {
    console.error("Prisma sample seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
