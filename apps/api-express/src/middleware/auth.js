const jwt = require('jsonwebtoken');
const prisma = require('../db/prisma');
const { JWT_SECRET } = require('../config/jwtSecret');
const { ACCESS_COOKIE_NAME } = require('../lib/authCookies');
const { getCookie } = require('../lib/cookies');
const { authAllowBearer } = require('../lib/authAllowBearer');

const authMiddleware = async (req, res, next) => {
  const allowBearer = authAllowBearer();
  const authHeader = req.header('Authorization') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const cookieToken = getCookie(req, ACCESS_COOKIE_NAME);
  if (!allowBearer && bearerToken) {
    return res.status(401).json({
      error: 'Bearer authentication is deprecated. Use httpOnly cookie session.',
      code: 'bearer_deprecated',
    });
  }
  const token = allowBearer ? (bearerToken || cookieToken) : cookieToken;

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { clockTolerance: 30 });
    const username = decoded?.sub;
    if (!username) {
      return res.status(401).json({ error: 'Invalid token.' });
    }
    // Reject refresh tokens presented as access tokens.
    if (decoded.typ && decoded.typ !== 'access') {
      return res.status(401).json({ error: 'Invalid token.' });
    }

    const user = await prisma.user.findUnique({
      where: { username },
      select: { username: true, roles: true, tokenVersion: true }
    });
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
  } catch (_ex) {
    res.status(401).json({ error: 'Invalid token.' });
  }
};

module.exports = authMiddleware;
