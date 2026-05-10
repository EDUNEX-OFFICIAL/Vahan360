const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const bcrypt = require("bcryptjs");
const prisma = require("../src/db/prisma");

const username = process.env.SYNC_USERNAME || "admin";
const password = process.env.SYNC_PASSWORD || "admin123";
const email = process.env.SYNC_EMAIL || "admin@test.local";

async function run() {
  try {
    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.upsert({
      where: { username },
      update: {
        email,
        password: passwordHash,
        firstName: "Local",
        lastName: "Admin",
        roles: "ADMIN",
        updatedAt: new Date(),
      },
      create: {
        username,
        email,
        password: passwordHash,
        firstName: "Local",
        lastName: "Admin",
        roles: "ADMIN",
      },
    });

    console.log(`Synced local Express user: ${user.username} (id=${user.id})`);
  } catch (error) {
    console.error("Failed to sync local user:", error.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

run();
