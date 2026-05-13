const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const prisma = require("../db/prisma");
const { JWT_SECRET } = require("../config/jwtSecret");
const {
  ACCESS_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  setAuthCookies,
  setCsrfCookie,
  clearAuthCookies,
} = require("../lib/authCookies");
const { getCookie } = require("../lib/cookies");
const { authAllowBearer } = require("../lib/authAllowBearer");

const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');

const router = express.Router();

const ACCESS_TOKEN_TTL_SECONDS = Math.max(
  60,
  Number(process.env.AUTH_ACCESS_TTL_SECONDS) || 15 * 60
);
const REFRESH_TOKEN_TTL_SECONDS = Math.max(
  300,
  Number(process.env.AUTH_REFRESH_TTL_SECONDS) || 30 * 24 * 60 * 60
);
const ACCESS_TOKEN_EXPIRATION_MS = ACCESS_TOKEN_TTL_SECONDS * 1000;
const REFRESH_TOKEN_EXPIRATION_MS = REFRESH_TOKEN_TTL_SECONDS * 1000;

function authLimitWindowMs() {
  const n = Number(process.env.RATE_LIMIT_AUTH_WINDOW_MS);
  return Number.isFinite(n) && n > 0 ? n : 60_000;
}

function authLimitMax() {
  const n = Number(process.env.RATE_LIMIT_AUTH_MAX);
  return Number.isFinite(n) && n > 0 ? n : 20;
}

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

const authIpLimiter = rateLimit({
  windowMs: authLimitWindowMs(),
  max: authLimitMax(),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `auth:ip:${clientIp(req)}`,
  handler: (req, res) => {
    res.status(429).json({
      error: "Too many auth requests. Try again after the rate limit window.",
      requestId: req.requestId,
    });
  },
});

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(String(rawToken)).digest("hex");
}

function makeCsrfToken() {
  return crypto.randomBytes(24).toString("hex");
}

function signAccessToken(user) {
  const fromDb =
    user.tenantId != null && String(user.tenantId).trim() !== ""
      ? String(user.tenantId).trim()
      : null;
  const fromEnv =
    process.env.DEFAULT_TENANT_ID != null && String(process.env.DEFAULT_TENANT_ID).trim() !== ""
      ? String(process.env.DEFAULT_TENANT_ID).trim()
      : null;
  const tid = fromDb || fromEnv || "default";
  const payload = {
    v: user.tokenVersion,
    typ: "access",
    tid,
  };
  const ptidEnv = trimEnvScalar(process.env.JWT_PARENT_TID);
  if (ptidEnv) payload.ptid = ptidEnv;
  const orgIdEnv = trimEnvScalar(process.env.JWT_ORG_ID);
  if (orgIdEnv) payload.oid = orgIdEnv;
  const orgPathEnv = trimEnvScalar(process.env.JWT_ORG_PATH);
  if (orgPathEnv) payload.opath = orgPathEnv;

  return jwt.sign(payload, JWT_SECRET, {
    subject: user.username,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
}

/** Non-empty trimmed env scalar or null. Used for JWT org / parent-tenant bootstrap claims only. */
function trimEnvScalar(v) {
  if (v == null || String(v).trim() === "") return null;
  return String(v).trim();
}

function signRefreshToken(user, sessionId, jti) {
  return jwt.sign({ v: user.tokenVersion, typ: "refresh", sid: sessionId, jti }, JWT_SECRET, {
    subject: user.username,
    expiresIn: REFRESH_TOKEN_TTL_SECONDS,
  });
}

async function issueSessionTokens(user, req, res) {
  const sessionId = crypto.randomUUID();
  const jti = crypto.randomUUID();
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user, sessionId, jti);
  const refreshTokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRATION_MS);

  await prisma.refreshSession.create({
    data: {
      id: sessionId,
      userId: user.id,
      tokenHash: refreshTokenHash,
      jti,
      expiresAt,
    },
  });

  setAuthCookies(res, req, {
    accessToken,
    refreshToken,
    accessMaxAgeMs: ACCESS_TOKEN_EXPIRATION_MS,
    refreshMaxAgeMs: REFRESH_TOKEN_EXPIRATION_MS,
  });
  setCsrfCookie(res, req, makeCsrfToken());

  return {
    token: accessToken,
    type: "Bearer",
    validUntil: new Date(Date.now() + ACCESS_TOKEN_EXPIRATION_MS).toISOString(),
    refreshValidUntil: expiresAt.toISOString(),
    tokenVersion: user.tokenVersion,
    username: user.username,
  };
}

router.post("/register-user", authIpLimiter, authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { firstName, lastName, email, username, password } = req.body;
    const usernameTrim = String(username || "").trim();

    if (!usernameTrim || !password) {
      return res.status(400).json({ error: "Username and password are required." });
    }

    const existingUser = await prisma.user.findFirst({
      where: { username: { equals: usernameTrim, mode: "insensitive" } },
    });
    if (existingUser) {
      return res.status(409).json({ error: "Username already exists." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const savedUser = await prisma.user.create({
      data: {
        firstName,
        lastName,
        email,
        username: usernameTrim,
        password: hashedPassword,
        roles: ['USER'],
      },
    });

    res.json({
      id: String(savedUser.id),
      username: savedUser.username,
      email: savedUser.email,
      roles: savedUser.roles,
    });
  } catch (error) {
    console.error("Error registering user:", error);
    res.status(500).json({ error: "Failed to register user", details: error.message });
  }
});

router.get("/csrf", (req, res) => {
  const token = makeCsrfToken();
  setCsrfCookie(res, req, token);
  res.json({ csrfToken: token });
});

async function handleLogin(req, res) {
  try {
    const { username, password } = req.body;
    const usernameNorm = String(username || "").trim();

    if (!usernameNorm || !password) {
      return res.status(400).json({ error: "Username and password are required." });
    }

    const user = await prisma.user.findFirst({
      where: { username: { equals: usernameNorm, mode: "insensitive" } },
    });
    if (!user) {
      return res.status(401).json({ error: "Invalid Credentials" });
    }

    const passwordMatches = await bcrypt.compare(String(password), user.password);
    if (!passwordMatches) {
      return res.status(401).json({ error: "Invalid Credentials" });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        tokenVersion: (user.tokenVersion || 0) + 1,
        updatedAt: new Date(),
      },
    });

    await prisma.refreshSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    res.json(await issueSessionTokens(updated, req, res));
  } catch (error) {
    console.error("Error generating token:", error);
    const code = error && error.code;
    const msg = String((error && error.message) || "");
    if (
      code === "P1001" ||
      /Can't reach database server|Unable to connect to the database/i.test(msg)
    ) {
      return res.status(503).json({
        error:
          "Database is not reachable. Start Postgres (e.g. Docker Desktop → docker compose up -d postgres redis) and ensure DATABASE_URL points at it (compose uses host port 5433).",
        details: error.message,
      });
    }
    if (code === "P2021" || /does not exist in the current database/i.test(msg)) {
      return res.status(503).json({
        error:
          "Database is not ready (tables missing). From repo root: pnpm --filter @vahan360/api-express run prisma:push && pnpm --filter @vahan360/api-express run sync:user - then sign in with admin / admin123.",
        details: error.message,
      });
    }
    res.status(500).json({ error: "Failed to generate token", details: error.message });
  }
}

// Legacy path kept for backward compat with existing non-browser clients.
router.post("/generate-token", authIpLimiter, handleLogin);

// Preferred path per security roadmap Phase B — same handler, cleaner surface.
router.post("/login", authIpLimiter, handleLogin);

router.post("/refresh", authIpLimiter, async (req, res) => {
  const rawRefresh = getCookie(req, REFRESH_COOKIE_NAME);
  if (!rawRefresh) {
    clearAuthCookies(res, req);
    return res.status(401).json({ error: "Refresh token missing." });
  }

  let decoded;
  try {
    decoded = jwt.verify(rawRefresh, JWT_SECRET);
  } catch {
    clearAuthCookies(res, req);
    return res.status(401).json({ error: "Invalid refresh token." });
  }

  const username = decoded?.sub;
  const sessionId = decoded?.sid;
  const jti = decoded?.jti;
  const tokenVersion = decoded?.v ?? 0;
  const tokenType = decoded?.typ;
  if (!username || !sessionId || !jti || tokenType !== "refresh") {
    clearAuthCookies(res, req);
    return res.status(401).json({ error: "Invalid refresh token." });
  }

  const session = await prisma.refreshSession.findUnique({
    where: { id: String(sessionId) },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    clearAuthCookies(res, req);
    return res.status(401).json({ error: "Refresh session expired." });
  }

  if (session.jti !== String(jti) || session.tokenHash !== hashToken(rawRefresh)) {
    await prisma.refreshSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    clearAuthCookies(res, req);
    return res.status(401).json({ error: "Refresh token has been rotated." });
  }

  if (session.user.username !== String(username) || (session.user.tokenVersion ?? 0) !== tokenVersion) {
    await prisma.refreshSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    clearAuthCookies(res, req);
    return res.status(401).json({ error: "Refresh token is no longer valid." });
  }

  const nextJti = crypto.randomUUID();
  const accessToken = signAccessToken(session.user);
  const refreshToken = signRefreshToken(session.user, session.id, nextJti);
  const nextExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRATION_MS);

  await prisma.refreshSession.update({
    where: { id: session.id },
    data: {
      tokenHash: hashToken(refreshToken),
      jti: nextJti,
      rotatedAt: new Date(),
      expiresAt: nextExpiresAt,
      updatedAt: new Date(),
    },
  });

  setAuthCookies(res, req, {
    accessToken,
    refreshToken,
    accessMaxAgeMs: ACCESS_TOKEN_EXPIRATION_MS,
    refreshMaxAgeMs: REFRESH_TOKEN_EXPIRATION_MS,
  });
  setCsrfCookie(res, req, makeCsrfToken());
  return res.json({
    type: "Bearer",
    token: accessToken,
    validUntil: new Date(Date.now() + ACCESS_TOKEN_EXPIRATION_MS).toISOString(),
    refreshValidUntil: nextExpiresAt.toISOString(),
    tokenVersion: session.user.tokenVersion,
    username: session.user.username,
  });
});

router.post("/logout", async (req, res) => {
  const rawRefresh = getCookie(req, REFRESH_COOKIE_NAME);
  if (rawRefresh) {
    try {
      const decoded = jwt.verify(rawRefresh, JWT_SECRET);
      if (decoded?.sid) {
        await prisma.refreshSession.updateMany({
          where: { id: String(decoded.sid), revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    } catch {
      // ignore token parse failure for logout
    }
  }
  clearAuthCookies(res, req);
  return res.json({ ok: true });
});

router.get("/me", async (req, res) => {
  const accessHeader = req.get("authorization") || "";
  const bearer = accessHeader.startsWith("Bearer ") ? accessHeader.slice(7) : "";
  if (!authAllowBearer() && bearer) {
    return res.status(401).json({
      error: "Bearer authentication is deprecated. Use httpOnly cookie session.",
      code: "bearer_deprecated",
    });
  }
  const accessToken =
    (authAllowBearer() ? bearer : "") || getCookie(req, ACCESS_COOKIE_NAME);
  if (!accessToken) return res.status(401).json({ error: "Not authenticated." });

  try {
    const decoded = jwt.verify(accessToken, JWT_SECRET);
    const username = decoded?.sub;
    if (!username) return res.status(401).json({ error: "Not authenticated." });
    const user = await prisma.user.findUnique({
      where: { username },
      select: { username: true, roles: true, tokenVersion: true },
    });
    if (!user) return res.status(401).json({ error: "Not authenticated." });
    if ((decoded.v ?? 0) !== (user.tokenVersion ?? 0)) {
      return res.status(401).json({ error: "Session expired." });
    }
    if (!getCookie(req, CSRF_COOKIE_NAME)) {
      setCsrfCookie(res, req, makeCsrfToken());
    }
    return res.json({ username: user.username, roles: user.roles });
  } catch {
    return res.status(401).json({ error: "Not authenticated." });
  }
});

module.exports = router;
