import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../utils/validate.js';
import { pool, tx } from '../db/pool.js';
import { E } from '../utils/errors.js';

const router = express.Router();
const isOrg = [requireAuth, requireRole('ORGANISER', 'ADMIN')];

const isAdmin = (req) => req.user.role === 'ADMIN';

/**
 * Ownership scope. An organiser is filtered to `organiser_id = $n`; an admin passes NULL,
 * making the `($n IS NULL OR organiser_id = $n)` guard fall through to every event.
 */
const scopeId = (req) => (isAdmin(req) ? null : req.user.sub);

/** Admins may create on another organiser's behalf; organisers may not. */
async function resolveOrganiserId(req) {
  const requested = req.body.organiserId;
  if (!requested) return req.user.sub;

  if (!isAdmin(req)) {
    if (requested !== req.user.sub) {
      throw E.forbidden('Only an admin can create events on behalf of another organiser.');
    }
    return req.user.sub;
  }

  const { rows: [target] } = await pool.query(
    `SELECT id FROM users WHERE id = $1 AND role IN ('ORGANISER','ADMIN')`, [requested]
  );
  if (!target) throw E.validation('organiserId must be an existing organiser or admin account.');
  return target.id;
}

// GET /api/organiser/organisers — accounts an admin can assign an event to.
router.get('/organisers', ...isOrg, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return res.json([]);
    const { rows } = await pool.query(
      `SELECT id, name, email, role
         FROM users
        WHERE role IN ('ORGANISER','ADMIN')
        ORDER BY role DESC, name`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/organiser/events
router.post('/events', ...isOrg, async (req, res, next) => {
  try {
    validate({
      title:       { type: 'string', required: true, minLength: 2 },
      type:        { type: 'string', required: true, enum: ['MOVIE', 'CONCERT'] },
      description: { type: 'string' },
      language:    { type: 'string' },
      duration_min:{ type: 'number', min: 1 },
      poster_url:  { type: 'string', maxLength: 2048 },
      organiserId: { type: 'string' },
    }, req.body);

    const organiserId = await resolveOrganiserId(req);

    const { title, type, description, language, duration_min, poster_url } = req.body;
    const { rows: [event] } = await pool.query(
      `INSERT INTO events (organiser_id, title, type, description, language, duration_min, poster_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [organiserId, title, type, description || null, language || null,
       duration_min || null, poster_url || null]
    );
    res.status(201).json(event);
  } catch (err) { next(err); }
});

// GET /api/organiser/events
router.get('/events', ...isOrg, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.*, u.name AS organiser_name,
              COUNT(DISTINCT s.id)::int AS show_count,
              -- Same condition /api/events filters on, so live/draft cannot disagree.
              COUNT(DISTINCT s.id) FILTER (
                WHERE s.status = 'SCHEDULED' AND s.starts_at > now()
              )::int AS upcoming_show_count,
              MIN(s.starts_at) FILTER (
                WHERE s.status = 'SCHEDULED' AND s.starts_at > now()
              ) AS next_show_at
         FROM events e
         JOIN users u ON u.id = e.organiser_id
         LEFT JOIN shows s ON s.event_id = e.id
        WHERE ($1::uuid IS NULL OR e.organiser_id = $1)
        GROUP BY e.id, u.name
        ORDER BY e.created_at DESC`,
      [scopeId(req)]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/organiser/events/:id/shows
router.post('/events/:id/shows', ...isOrg, async (req, res, next) => {
  try {
    validate({
      venueId:  { type: 'string', required: true },
      startsAt: { type: 'string', required: true },
      prices:   { type: 'array',  required: true, minItems: 1 },
    }, req.body);

    const { venueId, startsAt, prices } = req.body;

    const result = await tx(async (c) => {
      const { rows: [event] } = await c.query(
        `SELECT id FROM events WHERE id = $1 AND ($2::uuid IS NULL OR organiser_id = $2)`,
        [req.params.id, scopeId(req)]
      );
      if (!event) throw E.notFound('Event not found or not owned by you.');

      const { rows: [show] } = await c.query(
        `INSERT INTO shows (event_id, venue_id, starts_at) VALUES ($1,$2,$3) RETURNING id`,
        [req.params.id, venueId, startsAt]
      );

      for (const { categoryId, price } of prices) {
        await c.query(
          `INSERT INTO show_category_prices (show_id, category_id, price) VALUES ($1,$2,$3)`,
          [show.id, categoryId, price]
        );
      }

      // One statement, not one per seat: 120 round-trips is seconds against a hosted DB.
      // Price is snapshotted per seat at creation time.
      const { rowCount: seatsCreated } = await c.query(
        `INSERT INTO show_seats
           (show_id, venue_seat_id, category_id, row_label, seat_number, grid_row, grid_col, price)
         SELECT $1, vs.id, vs.category_id, vs.row_label, vs.seat_number, vs.grid_row, vs.grid_col, scp.price
           FROM venue_seats vs
           JOIN show_category_prices scp
             ON scp.show_id = $1 AND scp.category_id = vs.category_id
          WHERE vs.venue_id = $2 AND vs.is_active = TRUE
         ON CONFLICT (show_id, venue_seat_id) DO NOTHING`,
        [show.id, venueId]
      );

      if (seatsCreated === 0) {
        throw E.validation('No seats were created — check the venue has seats and every seat category is priced.');
      }

      return { showId: show.id, seatsCreated };
    });

    res.status(201).json(result);
  } catch (err) { next(err); }
});

// GET /api/organiser/events/:id/summary — Revenue dashboard
router.get('/events/:id/summary', ...isOrg, async (req, res, next) => {
  try {
    const { rows: [event] } = await pool.query(
      `SELECT id, title, type FROM events WHERE id = $1 AND ($2::uuid IS NULL OR organiser_id = $2)`,
      [req.params.id, scopeId(req)]
    );
    if (!event) throw E.notFound('Event not found.');

    // Overall totals
    const { rows: [totals] } = await pool.query(
      `SELECT
         -- tickets = seats, not bookings; a 4-seat booking is 4 tickets.
         COALESCE(SUM(b.seat_count) FILTER (WHERE b.status='CONFIRMED'), 0)::int AS tickets_sold,
         COUNT(*) FILTER (WHERE b.status='CANCELLED')::int                        AS cancellations,
         COALESCE(SUM(b.total_amount) FILTER (WHERE b.status='CONFIRMED'), 0)     AS gross_revenue,
         COALESCE(SUM(b.total_amount) FILTER (WHERE b.status='CANCELLED'), 0)     AS refunded_value,
         COUNT(*) FILTER (WHERE b.status='CONFIRMED')::int                        AS bookings_count
       FROM (
         SELECT bk.id, bk.status, bk.total_amount,
                (SELECT COUNT(*) FROM booking_seats bs WHERE bs.booking_id = bk.id) AS seat_count
           FROM bookings bk
           JOIN shows s ON s.id = bk.show_id
          WHERE s.event_id = $1
       ) b`,
      [req.params.id]
    );

    // Per-category breakdown
    const { rows: byCategory } = await pool.query(
      `SELECT sc.name AS category, sc.colour_hex,
              COUNT(bs.show_seat_id) FILTER (WHERE b.status='CONFIRMED') AS tickets,
              COALESCE(SUM(bs.price_paid) FILTER (WHERE b.status='CONFIRMED'), 0) AS revenue,
              COUNT(ss.id) AS total_seats,
              ROUND(
                COUNT(bs.show_seat_id) FILTER (WHERE b.status='CONFIRMED') * 100.0 /
                NULLIF(COUNT(ss.id), 0), 1
              ) AS occupancy_pct
         FROM seat_categories sc
         JOIN show_seats ss ON ss.category_id = sc.id
         JOIN shows sh ON sh.id = ss.show_id AND sh.event_id = $1
         LEFT JOIN booking_seats bs ON bs.show_seat_id = ss.id
         LEFT JOIN bookings b ON b.id = bs.booking_id
        GROUP BY sc.id
        ORDER BY sc.display_rank`,
      [req.params.id]
    );

    // Per-show breakdown
    const { rows: byShow } = await pool.query(
      `SELECT s.id, s.starts_at, v.name AS venue_name,
              (SELECT COUNT(*) FROM show_seats ss WHERE ss.show_id = s.id)::int          AS total_seats,
              (SELECT COUNT(*) FROM show_seats ss
                WHERE ss.show_id = s.id AND ss.status='BOOKED')::int                      AS tickets_sold,
              (SELECT COALESCE(SUM(b.total_amount), 0) FROM bookings b
                WHERE b.show_id = s.id AND b.status='CONFIRMED')                          AS revenue,
              (SELECT COUNT(*) FROM waitlist_entries we
                WHERE we.show_id = s.id AND we.status='WAITING')::int                     AS waitlist_depth
         FROM shows s
         JOIN venues v ON v.id = s.venue_id
        WHERE s.event_id = $1
        ORDER BY s.starts_at`,
      [req.params.id]
    );

    res.json({ event, totals, byCategory, byShow });
  } catch (err) { next(err); }
});

// GET /api/organiser/shows/:showId/bookings
router.get('/shows/:showId/bookings', ...isOrg, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.id, b.reference, b.customer_name, b.customer_email, b.total_amount,
              b.status, b.created_at, b.source,
              json_agg(json_build_object('row_label', ss.row_label, 'seat_number', ss.seat_number)) AS seats
         FROM bookings b
         JOIN shows s ON s.id = b.show_id
         JOIN events e ON e.id = s.event_id
         LEFT JOIN booking_seats bs ON bs.booking_id = b.id
         LEFT JOIN show_seats ss ON ss.id = bs.show_seat_id
        WHERE b.show_id = $1 AND ($2::uuid IS NULL OR e.organiser_id = $2)
        GROUP BY b.id
        ORDER BY b.created_at DESC`,
      [req.params.showId, scopeId(req)]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// PATCH /api/organiser/events/:id — edit event metadata
router.patch('/events/:id', ...isOrg, async (req, res, next) => {
  try {
    validate({
      title:       { type: 'string', minLength: 2 },
      type:        { type: 'string', enum: ['MOVIE', 'CONCERT'] },
      description: { type: 'string' },
      language:    { type: 'string' },
      duration_min:{ type: 'number', min: 1 },
      poster_url:  { type: 'string', maxLength: 2048 },
    }, req.body);

    const b = req.body;
    const { rows: [event] } = await pool.query(
      `UPDATE events
          SET title        = COALESCE($3, title),
              type         = COALESCE($4::event_type, type),
              description  = COALESCE($5, description),
              language     = COALESCE($6, language),
              duration_min = COALESCE($7, duration_min),
              poster_url   = COALESCE($8, poster_url)
        WHERE id = $1 AND ($2::uuid IS NULL OR organiser_id = $2)
        RETURNING *`,
      [req.params.id, scopeId(req),
       b.title ?? null, b.type ?? null, b.description ?? null,
       b.language ?? null, b.duration_min ?? null, b.poster_url ?? null]
    );
    if (!event) return next(E.notFound('Event not found or not owned by you.'));
    res.json(event);
  } catch (err) { next(err); }
});

// DELETE /api/organiser/events/:id — refused once any show exists, since that would
// cascade into seats and bookings customers have already paid for.
router.delete('/events/:id', ...isOrg, async (req, res, next) => {
  try {
    const { rows: [event] } = await pool.query(
      `SELECT id FROM events WHERE id = $1 AND ($2::uuid IS NULL OR organiser_id = $2)`,
      [req.params.id, scopeId(req)]
    );
    if (!event) return next(E.notFound('Event not found or not owned by you.'));

    const { rows: [{ count }] } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM shows WHERE event_id = $1', [req.params.id]
    );
    if (count > 0) {
      throw E.conflict('EVENT_HAS_SHOWS',
        `Cannot delete: ${count} show(s) are scheduled. Remove the shows first.`);
    }

    await pool.query('DELETE FROM events WHERE id = $1', [req.params.id]);
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

export default router;
