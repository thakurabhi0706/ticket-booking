/**
 * auth.js — JWT authentication middleware.
 */
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { E } from '../utils/errors.js';

/**
 * Extract a bearer token from the Authorization header, or — for transports that
 * cannot set headers (EventSource, navigator.sendBeacon) — from ?token= / body.token.
 */
function extractToken(req) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  if (typeof req.query?.token === 'string' && req.query.token) return req.query.token;
  if (typeof req.body?.token === 'string' && req.body.token) return req.body.token;
  return null;
}

export function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return next(E.unauthorized('No token provided'));

  try {
    req.user = jwt.verify(token, config.JWT_SECRET);
    next();
  } catch {
    next(E.unauthorized('Invalid or expired token'));
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(E.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(E.forbidden(`Route requires role: ${roles.join(' or ')}`));
    }
    next();
  };
}

export function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return next();
  try {
    req.user = jwt.verify(token, config.JWT_SECRET);
  } catch { /* ignore */ }
  next();
}
