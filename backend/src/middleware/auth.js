const jwt = require('jsonwebtoken');
const User = require('../models/User');
const JWT_SECRET = process.env.JWT_SECRET || 'TaK+HaV^uvCHEFsEVfypW#7g9^k*Z8$V';

const authMiddleware = async (req, res, next) => {
  const authHeader = req.header('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const username = decoded?.sub;
    if (!username) {
      return res.status(401).json({ error: 'Invalid token.' });
    }

    const user = await User.findOne({ username }).select('username roles tokenVersion');
    if (!user) {
      return res.status(401).json({ error: 'Invalid token.' });
    }

    if ((decoded.v ?? 0) !== (user.tokenVersion ?? 0)) {
      return res.status(401).json({ error: 'Token expired due to newer login.' });
    }

    req.user = {
      username: user.username,
      roles: user.roles,
      tokenVersion: user.tokenVersion
    };
    next();
  } catch (ex) {
    res.status(401).json({ error: 'Invalid token.' });
  }
};

module.exports = authMiddleware;
