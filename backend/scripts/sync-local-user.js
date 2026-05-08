require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../src/models/User");

const username = process.env.SYNC_USERNAME || "admin";
const password = process.env.SYNC_PASSWORD || "admin123";
const email = process.env.SYNC_EMAIL || "admin@test.local";

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/spybot", {
      dbName: process.env.MONGODB_DB_NAME || "khanan_db",
    });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.findOneAndUpdate(
      { username },
      {
        $set: {
          username,
          email,
          password: passwordHash,
          firstName: "Local",
          lastName: "Admin",
          roles: "ADMIN",
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    console.log(`Synced local Express user: ${user.username}`);
  } catch (error) {
    console.error("Failed to sync local user:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

run();
