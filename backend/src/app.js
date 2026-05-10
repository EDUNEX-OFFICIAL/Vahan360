const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const express = require("express");
const dns = require("dns");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");

// Fix Windows/Node SRV resolver issue for MongoDB+SRV (legacy / tooling only)
dns.setServers(["8.8.8.8", "1.1.1.1"]);
console.log("DNS resolver set to:", dns.getServers());

const app = express();
const PORT = process.env.BACKEND_PORT || process.env.PORT || 5000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});
// app.use(limiter);

// Public auth routes
app.use("/api/auth", require("./routes/auth"));
app.use("/auth", require("./routes/auth"));

// Postgres connectivity smoke (safe in production — only SELECT 1 / count)
app.get("/api/health/pg", async (req, res) => {
  try {
    const prisma = require("./db/prisma");
    await prisma.$queryRaw`SELECT 1`;
    const userCount = await prisma.user.count();
    res.json({ ok: true, database: "postgresql", userCount });
  } catch (err) {
    console.error("PG health check failed:", err.message);
    res.status(503).json({ ok: false, error: err.message });
  }
});

// Auth middleware
const authMiddleware = require("./middleware/auth");

// Protected routes
app.use("/api/khanan", authMiddleware, require("./routes/khanan"));
app.use("/api/vehicle", authMiddleware, require("./routes/vehicle"));
app.use("/api/selenium", authMiddleware, require("./routes/selenium"));

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  setImmediate(async () => {
    try {
      const prisma = require("./db/prisma");
      const n = await prisma.user.count();
      if (n === 0) {
        console.warn(
          "⚠️  No users in PostgreSQL. Create one: cd backend && npm run sync:user (default admin / admin123)"
        );
      }
    } catch {
      /* DB unreachable — DATABASE_URL / Postgres */
    }
  });
});

module.exports = app;
