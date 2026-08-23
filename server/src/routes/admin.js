import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../utils/validate.js';
import { pool } from '../db/pool.js';
import { E } from '../utils/errors.js';

const router = express.Router();
const isAdmin = [requireAuth, requireRole('ADMIN')];

/**
 * GET /api/admin/stats — platform-wide counters for the admin control centre.
 *
 * Deliberately one round trip: the dashboard renders these together, and six separate
 * queries against a hosted DB is six times the latency for the same screen.
 */
router.get('/stats', ...isAdmin, async (req, res, next) => {
  try {
    const { rows: [stats] } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM events)::int  AS events_total,
        (SELECT COUNT(DISTINCT e.id) FROM events e
           JOIN shows s ON s.event_id = e.id
          WHERE s.status = 'SCHEDULED' AND s.starts_at > now())::int AS events_live,
        (SELECT COUNT(*) FROM shows
          WHERE status = 'SCHEDULED' AND starts_at > now())::int      AS shows_upcoming,
        (SELECT COUNT(*) FROM venues)::int                            AS venues_total,
        (SELECT COUNT(*) FROM bookings WHERE status = 'CONFIRMED')::int AS bookings_confirmed,
        (SELECT COUNT(*) FROM booking_seats bs
           JOIN bookings b ON b.id = bs.booking_id
          WHERE b.status = 'CONFIRMED')::int                          AS tickets_sold,
        (SELECT COALESCE(SUM(total_amount), 0) FROM bookings
          WHERE status = 'CONFIRMED')                                 AS gross_revenue,
        (SELECT COUNT(*) FROM users WHERE role = 'CUSTOMER')::int      AS customers,
        (SELECT COUNT(*) FROM users WHERE role = 'ORGANISER')::int     AS organisers,
        (SELECT COUNT(*) FROM waitlist_entries WHERE status = 'WAITING')::int AS waitlist_waiting,
        (SELECT COUNT(*) FROM show_seats WHERE status = 'HELD'
            AND hold_expires_at > now())::int                          AS seats_held_now
    `);
    res.json(stats);
  } catch (err) { next(err); }
});

// POST /api/admin/venues
router.post('/venues', ...isAdmin, async (req, res, next) => {
  try {
    validate({
      name:    { type: 'string', required: true },
      city:    { type: 'string', required: true },
      address: { type: 'string' },
    }, req.body);

    const { rows: [venue] } = await pool.query(
      `INSERT INTO venues (name, city, address, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.body.name, req.body.city, req.body.address || null, req.user.sub]
    );
    res.status(201).json(venue);
  } catch (err) { next(err); }
});

// GET /api/admin/venues
router.get('/venues', ...isAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT v.*, u.name AS created_by_name,
              COUNT(DISTINCT vs.id) AS seat_count
         FROM venues v
         JOIN users u ON u.id = v.created_by
         LEFT JOIN venue_seats vs ON vs.venue_id = v.id
        GROUP BY v.id, u.name
        ORDER BY v.created_at DESC`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/admin/venues/:id
router.get('/venues/:id', ...isAdmin, async (req, res, next) => {
  try {
    const { rows: [venue] } = await pool.query('SELECT * FROM venues WHERE id=$1', [req.params.id]);
    if (!venue) return next(E.notFound('Venue not found.'));
    const { rows: categories } = await pool.query(
      'SELECT * FROM seat_categories WHERE venue_id=$1 ORDER BY display_rank', [req.params.id]
    );
    res.json({ ...venue, categories });
  } catch (err) { next(err); }
});

// PATCH /api/admin/venues/:id
router.patch('/venues/:id', ...isAdmin, async (req, res, next) => {
  try {
    validate({
      name:    { type: 'string' },
      city:    { type: 'string' },
      address: { type: 'string' },
    }, req.body);

    const { rows: [venue] } = await pool.query(
      `UPDATE venues
          SET name    = COALESCE($2, name),
              city    = COALESCE($3, city),
              address = COALESCE($4, address)
        WHERE id = $1
        RETURNING *`,
      [req.params.id, req.body.name ?? null, req.body.city ?? null, req.body.address ?? null]
    );
    if (!venue) return next(E.notFound('Venue not found.'));
    res.json(venue);
  } catch (err) { next(err); }
});

// DELETE /api/admin/venues/:id
// Refused while any show references the venue — deleting would orphan live bookings.
router.delete('/venues/:id', ...isAdmin, async (req, res, next) => {
  try {
    const { rows: [{ count }] } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM shows WHERE venue_id = $1', [req.params.id]
    );
    if (count > 0) {
      throw E.conflict('VENUE_IN_USE', `Cannot delete: ${count} show(s) are scheduled at this venue.`);
    }

    const { rowCount } = await pool.query('DELETE FROM venues WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return next(E.notFound('Venue not found.'));
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// POST /api/admin/venues/:id/categories
router.post('/venues/:id/categories', ...isAdmin, async (req, res, next) => {
  try {
    validate({
      name:         { type: 'string', required: true },
      colour_hex:   { type: 'string' },
      display_rank: { type: 'number' },
    }, req.body);

    const { rows: [cat] } = await pool.query(
      `INSERT INTO seat_categories (venue_id, name, colour_hex, display_rank)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, req.body.name, req.body.colour_hex || '#888888', req.body.display_rank || 0]
    );
    res.status(201).json(cat);
  } catch (err) { next(err); }
});

// POST /api/admin/venues/:id/seats/bulk — generate a grid
router.post('/venues/:id/seats/bulk', ...isAdmin, async (req, res, next) => {
  try {
    validate({
      rows:           { type: 'array', required: true, minItems: 1 },  // ['A','B',...]
      seatsPerRow:    { type: 'number', required: true, min: 1, max: 50 },
      categoryMap:    { required: true },  // { 'A': catId, 'B': catId }
      aisleAfterCols: { type: 'array' },   // [4, 8]
    }, req.body);

    const { rows: rowLabels, seatsPerRow, categoryMap, aisleAfterCols = [] } = req.body;

    // Build the whole grid in memory, then insert it in one statement.
    // grid_col skips a column after each aisle position so the map renders real gaps.
    const cats = [], labels = [], numbers = [], gridRows = [], gridCols = [];
    for (let ri = 0; ri < rowLabels.length; ri++) {
      const rowLabel = rowLabels[ri];
      const catId = categoryMap[rowLabel];
      if (!catId) throw E.validation(`No category mapped for row ${rowLabel}`);

      let gridCol = 1;
      for (let seatNum = 1; seatNum <= seatsPerRow; seatNum++) {
        cats.push(catId);
        labels.push(rowLabel);
        numbers.push(seatNum);
        gridRows.push(ri + 1);
        gridCols.push(gridCol);
        gridCol++;
        if (aisleAfterCols.includes(seatNum)) gridCol++;
      }
    }

    const { rowCount: created } = await pool.query(
      `INSERT INTO venue_seats (venue_id, category_id, row_label, seat_number, grid_row, grid_col)
       SELECT $1, * FROM UNNEST($2::uuid[], $3::text[], $4::int[], $5::int[], $6::int[])
       ON CONFLICT (venue_id, row_label, seat_number) DO NOTHING`,
      [req.params.id, cats, labels, numbers, gridRows, gridCols]
    );

    res.status(201).json({ created, requested: cats.length });
  } catch (err) { next(err); }
});

// GET /api/admin/venues/:id/layout — full layout for editor
router.get('/venues/:id/layout', ...isAdmin, async (req, res, next) => {
  try {
    const { rows: seats } = await pool.query(
      `SELECT vs.*, sc.name AS category_name, sc.colour_hex
         FROM venue_seats vs
         JOIN seat_categories sc ON sc.id = vs.category_id
        WHERE vs.venue_id = $1
        ORDER BY vs.grid_row, vs.grid_col`,
      [req.params.id]
    );
    res.json(seats);
  } catch (err) { next(err); }
});

export default router;
