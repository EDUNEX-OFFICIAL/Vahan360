const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../db/prisma');
const { JWT_SECRET } = require('../config/jwtSecret');

const router = express.Router();
const TOKEN_EXPIRATION = '24h';
const TOKEN_EXPIRATION_MS = 24 * 60 * 60 * 1000;

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
    res.status(500).json({ error: 'Failed to generate token', details: error.message });
  }
});

module.exports = router;
