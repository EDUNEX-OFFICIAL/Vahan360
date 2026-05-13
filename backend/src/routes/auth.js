const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../db/prisma');
const { JWT_SECRET } = require('../config/jwtSecret');

const router = express.Router();
const TOKEN_EXPIRATION = '24h';
const TOKEN_EXPIRATION_MS = 24 * 60 * 60 * 1000;

/** Prisma often wraps P1000 on `cause` or only puts the code in `message`. */
function getPrismaConnectivityInfo(err) {
  const seen = new Set();
  let depth = 0;
  let e = err;
  while (e && typeof e === "object" && depth < 10 && !seen.has(e)) {
    seen.add(e);
    const code = e.code || e.errorCode;
    if (code === "P1000" || code === "P1001" || code === "P1017") {
      return { code };
    }
    const msg = String(e.message || "");
    if (
      /\bP1000\b/.test(msg) ||
      /\bP1001\b/.test(msg) ||
      /\bP1017\b/.test(msg) ||
      /Authentication failed against database server/i.test(msg) ||
      /Can't reach database server/i.test(msg)
    ) {
      const m = msg.match(/\b(P10\d{2})\b/);
      return { code: m ? m[1] : "DB_CONNECT" };
    }
    e = e.cause;
    depth += 1;
  }
  return null;
}

function buildSpringStyleTokenResponse(user) {
  const token = jwt.sign({ v: user.tokenVersion }, JWT_SECRET, {
    subject: user.username,
    expiresIn: TOKEN_EXPIRATION
  });
  return {
    token,
    type: 'Bearer',
    validUntil: new Date(Date.now() + TOKEN_EXPIRATION_MS).toISOString(),
    tokenVersion: user.tokenVersion,
    username: user.username
  };
}

router.post('/register-user', async (req, res) => {
  try {
    const { firstName, lastName, email, username, password } = req.body;
    const usernameTrim = String(username || '').trim();

    if (!usernameTrim || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const existingUser = await prisma.user.findFirst({
      where: { username: { equals: usernameTrim, mode: 'insensitive' } },
    });
    if (existingUser) {
      return res.status(409).json({ error: 'Username already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const savedUser = await prisma.user.create({
      data: {
        firstName,
        lastName,
        email,
        username: usernameTrim,
        password: hashedPassword,
        roles: 'USER'
      }
    });

    res.json({
      id: String(savedUser.id),
      username: savedUser.username,
      email: savedUser.email,
      roles: savedUser.roles
    });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ error: 'Failed to register user', details: error.message });
  }
});

router.post('/generate-token', async (req, res) => {
  try {
    const { username, password } = req.body;
    const usernameNorm = String(username || '').trim();

    if (!usernameNorm || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const user = await prisma.user.findFirst({
      where: { username: { equals: usernameNorm, mode: 'insensitive' } },
    });
    if (!user) {
      return res.status(401).json({ error: 'Invalid Credentials' });
    }

    const passwordMatches = await bcrypt.compare(String(password), user.password);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Invalid Credentials' });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        tokenVersion: (user.tokenVersion || 0) + 1,
        updatedAt: new Date()
      }
    });

    res.json(buildSpringStyleTokenResponse(updated));
  } catch (error) {
    console.error('Error generating token:', error);
    const dbInfo = getPrismaConnectivityInfo(error);
    if (dbInfo) {
      return res.status(503).json({
        error:
          'Database unavailable or credentials do not match this Postgres data volume. Align V360_POSTGRES_* in /opt/vahan360/.env with the password used when the volume was first created, or recreate the volume. See docs/DEPLOY_VPS_WORKFLOW.md section 5.2.',
        code: dbInfo.code,
      });
    }
    res.status(500).json({ error: 'Failed to generate token', details: error.message });
  }
});

module.exports = router;
