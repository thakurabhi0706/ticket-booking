/**
 * helpers.js — Shared test harness.
 *
 * Tests run against a LIVE server (npm start) and the same database.
 * To stay independent of seed data and of each other, every suite builds its own
 * throwaway venue/event/show via `createTestShow()` and tears it down afterwards.
 *
 * Auth tokens are signed locally rather than obtained from /auth/login, so the
 * suites never trip the auth rate limiter and stay fast.
 */
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { pool } from '../src/db/pool.js';
import { config } from '../src/config.js';

export const API = process.env.API_URL || 'http://localhost:4000/api';
export { pool, config };

/** Fail fast with a clear message if the API isn't up. */
export async function requireServer() {
  try {
    const res = await fetch(`${API}/health`);
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch (err) {
    throw new Error(
      `Cannot reach the API at ${API} (${err.message}).\n` +
      `Start it first:  cd server && npm start`
    );
  }
}

/** Create (or reuse) a user and return { id, email, token }. */
export async function makeUser(label, role = 'CUSTOMER') {
  const email = `${label}@test.local`;
  const hash = await bcrypt.hash('TestPass@123', 4); // low cost — tests only
  const { rows: [user] } = await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, email, role`,
    [`Test ${label}`, email, hash, role]
  );
  return { ...user, token: signToken(user) };
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    config.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

/**
 * Build an isolated show: 1 venue, `categories.length` categories,
 * `rows × seatsPerRow` seats, priced per category. Returns ids + a cleanup fn.
 */
export async function createTestShow({
  rows = ['A', 'B'],
  seatsPerRow = 4,
  categories = [{ name: 'Premium', price: 500 }, { name: 'Standard', price: 200 }],
} = {}) {
  const tag = crypto.randomBytes(4).toString('hex');
  const admin = await makeUser(`admin-${tag}`, 'ADMIN');
  const organiser = await makeUser(`org-${tag}`, 'ORGANISER');

  const { rows: [venue] } = await pool.query(
    `INSERT INTO venues (name, city, address, created_by)
     VALUES ($1, 'Testville', 'Test Address', $2) RETURNING id`,
    [`Test Venue ${tag}`, admin.id]
  );

  const catIds = {};
  for (let i = 0; i < categories.length; i++) {
    const { rows: [c] } = await pool.query(
      `INSERT INTO seat_categories (venue_id, name, display_rank)
       VALUES ($1, $2, $3) RETURNING id`,
      [venue.id, categories[i].name, i]
    );
    catIds[categories[i].name] = c.id;
  }

  // Split rows evenly across categories: first half Premium, rest Standard, etc.
  const rowCategory = (ri) =>
    categories[Math.min(Math.floor(ri / (rows.length / categories.length)), categories.length - 1)];

  const vals = { cat: [], label: [], num: [], gr: [], gc: [] };
  rows.forEach((label, ri) => {
    for (let n = 1; n <= seatsPerRow; n++) {
      vals.cat.push(catIds[rowCategory(ri).name]);
      vals.label.push(label);
      vals.num.push(n);
      vals.gr.push(ri + 1);
      vals.gc.push(n);
    }
  });
  await pool.query(
    `INSERT INTO venue_seats (venue_id, category_id, row_label, seat_number, grid_row, grid_col)
     SELECT $1, * FROM UNNEST($2::uuid[], $3::text[], $4::int[], $5::int[], $6::int[])`,
    [venue.id, vals.cat, vals.label, vals.num, vals.gr, vals.gc]
  );

  const { rows: [event] } = await pool.query(
    `INSERT INTO events (organiser_id, title, type) VALUES ($1, $2, 'MOVIE') RETURNING id`,
    [organiser.id, `Test Event ${tag}`]
  );

  // Far enough out that CANCELLATION_CUTOFF_MINUTES never blocks a test cancel.
  const { rows: [show] } = await pool.query(
    `INSERT INTO shows (event_id, venue_id, starts_at)
     VALUES ($1, $2, now() + interval '30 days') RETURNING id`,
    [event.id, venue.id]
  );

  for (const c of categories) {
    await pool.query(
      `INSERT INTO show_category_prices (show_id, category_id, price) VALUES ($1,$2,$3)`,
      [show.id, catIds[c.name], c.price]
    );
  }

  await pool.query(
    `INSERT INTO show_seats
       (show_id, venue_seat_id, category_id, row_label, seat_number, grid_row, grid_col, price)
     SELECT $1, vs.id, vs.category_id, vs.row_label, vs.seat_number, vs.grid_row, vs.grid_col, scp.price
       FROM venue_seats vs
       JOIN show_category_prices scp ON scp.show_id = $1 AND scp.category_id = vs.category_id
      WHERE vs.venue_id = $2`,
    [show.id, venue.id]
  );

  return {
    tag, venueId: venue.id, eventId: event.id, showId: show.id,
    categoryIds: catIds, organiser, admin,
    cleanup: () => cleanupShow(show.id, event.id, venue.id),
  };
}

async function cleanupShow(showId, eventId, venueId) {
  // bookings reference shows with no ON DELETE CASCADE — remove them explicitly.
  await pool.query(
    `DELETE FROM booking_seats WHERE booking_id IN (SELECT id FROM bookings WHERE show_id = $1)`,
    [showId]
  );
  await pool.query(`DELETE FROM bookings WHERE show_id = $1`, [showId]);
  await pool.query(`DELETE FROM shows WHERE id = $1`, [showId]);      // cascades seats/holds/waitlist
  await pool.query(`DELETE FROM events WHERE id = $1`, [eventId]);
  await pool.query(`DELETE FROM venues WHERE id = $1`, [venueId]);    // cascades categories/venue_seats
}

/** Fetch the seat map straight from the DB (no auth needed). */
export async function seatsOf(showId, status = 'AVAILABLE') {
  const { rows } = await pool.query(
    `SELECT id, category_id, row_label, seat_number, status, price
       FROM show_seats WHERE show_id = $1 AND status = $2
      ORDER BY row_label, seat_number`,
    [showId, status]
  );
  return rows;
}

/** Thin API wrapper returning { status, body }. */
export async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let parsed = null;
  try { parsed = await res.json(); } catch { /* empty body */ }
  return { status: res.status, body: parsed };
}

/** Hold seats then immediately convert them to a confirmed booking. */
export async function bookSeats(showId, seatIds, user) {
  const hold = await call('POST', `/shows/${showId}/holds`, {
    token: user.token, body: { seatIds },
  });
  if (hold.status !== 201) {
    throw new Error(`hold failed: ${hold.status} ${JSON.stringify(hold.body)}`);
  }
  const booking = await call('POST', '/bookings', {
    token: user.token,
    body: {
      holdGroupId: hold.body.holdGroupId,
      customer: { name: 'Test Buyer', email: user.email, phone: '9000000000' },
    },
  });
  if (booking.status !== 201) {
    throw new Error(`booking failed: ${booking.status} ${JSON.stringify(booking.body)}`);
  }
  return booking.body;
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
