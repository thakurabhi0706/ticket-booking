/**
 * venues.js — Read-only venue directory.
 *
 * Organisers need to see venues (and their seat categories) to schedule a show and
 * price each category, but they must not be able to mutate them — that stays on the
 * ADMIN-only /api/admin/venues routes.
 */
import express from 'express';
import { pool } from '../db/pool.js';
import { E } from '../utils/errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = express.Router();
const canRead = [requireAuth, requireRole('ORGANISER', 'ADMIN')];

// GET /api/venues — every venue with its seat categories and seat count
router.get('/', ...canRead, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT v.id, v.name, v.city, v.address,
              (SELECT COUNT(*) FROM venue_seats vs
                WHERE vs.venue_id = v.id AND vs.is_active)::int AS seat_count,
              COALESCE(
                (SELECT json_agg(json_build_object(
                          'id', sc.id, 'name', sc.name,
                          'colour_hex', sc.colour_hex, 'display_rank', sc.display_rank)
                        ORDER BY sc.display_rank)
                   FROM seat_categories sc WHERE sc.venue_id = v.id),
                '[]'::json
              ) AS categories
         FROM venues v
        ORDER BY v.city, v.name`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/venues/:id — one venue with its categories
router.get('/:id', ...canRead, async (req, res, next) => {
  try {
    const { rows: [venue] } = await pool.query(
      `SELECT id, name, city, address FROM venues WHERE id = $1`, [req.params.id]
    );
    if (!venue) return next(E.notFound('Venue not found.'));

    const { rows: categories } = await pool.query(
      `SELECT id, name, colour_hex, display_rank
         FROM seat_categories WHERE venue_id = $1 ORDER BY display_rank`,
      [req.params.id]
    );
    res.json({ ...venue, categories });
  } catch (err) { next(err); }
});

export default router;
