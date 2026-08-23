import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { E } from '../utils/errors.js';
import { validate } from '../utils/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = express.Router();
// Brute-force guard on /auth/*. Kept modest but not so tight that a shared IP
// (office NAT, or the test suite) locks itself out; bcrypt is the real cost wall.
const authLimiter = rateLimit(config.AUTH_RATE_LIMIT_PER_MIN, 60_000);

router.post('/register', authLimiter, async (req, res, next) => {
  try {
    validate({
      name:     { type: 'string', required: true, minLength: 2, maxLength: 100 },
      email:    { type: 'string', required: true, email: true },
      password: { type: 'string', required: true, minLength: 8, maxLength: 100 },
      role:     { type: 'string', enum: ['CUSTOMER', 'ORGANISER'] },
    }, req.body);

    const { name, email, password, role = 'CUSTOMER' } = req.body;

    // Hard assertion: registration CANNOT mint an ADMIN
    if (role === 'ADMIN') throw E.forbidden('Cannot register as ADMIN.');

    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (exists.rows.length > 0) throw E.conflict('EMAIL_TAKEN', 'An account with this email already exists.');

    const hash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);
    const { rows: [user] } = await pool.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, name, email, role`,
      [name, email, hash, role]
    );

    const token = jwt.sign({ sub: user.id, email: user.email, role: user.role }, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN });
    res.status(201).json({ token, user });
  } catch (err) { next(err); }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    validate({
      email:    { type: 'string', required: true, email: true },
      password: { type: 'string', required: true },
    }, req.body);

    const { email, password } = req.body;
    const { rows: [user] } = await pool.query(
      'SELECT id, name, email, role, password_hash FROM users WHERE email = $1', [email]
    );

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw E.unauthorized('Invalid email or password.');
    }

    const token = jwt.sign({ sub: user.id, email: user.email, role: user.role }, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN });
    const { password_hash, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (err) { next(err); }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { rows: [user] } = await pool.query(
      'SELECT id, name, email, role, phone, created_at FROM users WHERE id = $1', [req.user.sub]
    );
    if (!user) return next(E.notFound('User not found.'));
    res.json(user);
  } catch (err) { next(err); }
});

export default router;
