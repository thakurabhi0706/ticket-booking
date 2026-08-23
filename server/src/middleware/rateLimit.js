/**
 * rateLimit.js — In-memory rate limiter (~20 lines, zero dependencies).
 * Prevents seat-hoarding and brute-force auth attacks.
 */
import { E } from '../utils/errors.js';

const windows = new Map(); // key → { count, resetAt }

/**
 * @param {number} limit   Max requests
 * @param {number} windowMs Window size in ms
 * @param {function} keyFn  Derive the rate-limit key from req
 */
export function rateLimit(limit = 20, windowMs = 60_000, keyFn = (req) => req.ip) {
  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    let entry = windows.get(key);

    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + windowMs };
    }
    entry.count++;
    windows.set(key, entry);

    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - entry.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

    if (entry.count > limit) return next(E.tooManyRequests());
    next();
  };
}

// Periodically purge expired windows to avoid memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of windows.entries()) {
    if (entry.resetAt < now) windows.delete(key);
  }
}, 60_000);
