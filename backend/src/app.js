const express = require("express");
const mongoose = require("mongoose");
const dns = require("dns");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

// Fix Windows/Node SRV resolver issue for MongoDB+SRV
// Some local DNS setups refuse direct querySrv calls from Node.
// PowerShell DNS resolution may work while Node still fails with ECONNREFUSED.
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

// MongoDB connection
mongoose
  .connect(process.env.MONGODB_URI || "mongodb://localhost:27017/spybot", {
    dbName: process.env.MONGODB_DB_NAME || "khanan_db",
  })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

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
});

module.exports = app;
