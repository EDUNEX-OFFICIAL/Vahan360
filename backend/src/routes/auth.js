const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'TaK+HaV^uvCHEFsEVfypW#7g9^k*Z8$V';
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

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(409).json({ error: 'Username already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      firstName,
      lastName,
      email,
      username,
      password: hashedPassword,
      roles: 'USER'
    });

    const savedUser = await user.save();

    res.json({
      id: savedUser._id,
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

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Invalid Credentials' });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Invalid Credentials' });
    }

    user.tokenVersion = (user.tokenVersion || 0) + 1;
    user.updatedAt = new Date();
    await user.save();

    res.json(buildSpringStyleTokenResponse(user));
  } catch (error) {
    console.error('Error generating token:', error);
    res.status(500).json({ error: 'Failed to generate token', details: error.message });
  }
});

module.exports = router;
