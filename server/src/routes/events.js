import express from 'express';
import { pool } from '../db/pool.js';
import { E } from '../utils/errors.js';
import { optionalAuth } from '../middleware/auth.js';

const router = express.Router();

// GET /api/events — browse with filters
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { type, city, q, dateFrom, dateTo, page = 1, limit = 12 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = ['1=1'];
    const params = [];

    if (type)     { params.push(type.toUpperCase());    where.push(`e.type = $${params.length}::event_type`); }
    if (city)     { params.push(`%${city}%`);           where.push(`v.city ILIKE $${params.length}`); }
    if (q)        { params.push(`%${q}%`);              where.push(`e.title ILIKE $${params.length}`); }
    if (dateFrom) { params.push(dateFrom);               where.push(`s.starts_at >= $${params.length}`); }
    if (dateTo)   { params.push(dateTo);                 where.push(`s.starts_at <= $${params.length}`); }

    params.push(parseInt(limit), offset);

    const { rows } = await pool.query(
      `SELECT DISTINCT ON (e.id) e.id, e.title, e.type, e.description, e.poster_url,
              e.language, e.duration_min, e.created_at,
              u.name AS organiser_name,
              v.city,
              MIN(scp.price) OVER (PARTITION BY e.id) AS min_price,
              s.starts_at AS next_show_at
         FROM events e
         JOIN users u ON u.id = e.organiser_id
         JOIN shows s ON s.event_id = e.id AND s.status = 'SCHEDULED'
         JOIN venues v ON v.id = s.venue_id
         JOIN show_category_prices scp ON scp.show_id = s.id
        WHERE ${where.join(' AND ')} AND s.starts_at > now()
        ORDER BY e.id, s.starts_at ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ events: rows, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { next(err); }
});

// GET /api/events/:id — detail with upcoming shows
router.get('/:id', async (req, res, next) => {
  try {
    const { rows: [event] } = await pool.query(
      `SELECT e.*, u.name AS organiser_name
         FROM events e JOIN users u ON u.id = e.organiser_id
        WHERE e.id = $1`,
      [req.params.id]
    );
    if (!event) return next(E.notFound('Event not found.'));

    const { rows: shows } = await pool.query(
      `SELECT s.id, s.starts_at, s.status,
              v.name AS venue_name, v.city, v.address,
              json_agg(json_build_object(
                'category_id', scp.category_id,
                'category_name', sc.name,
                'price', scp.price,
                'available', (
                  SELECT COUNT(*) FROM show_seats ss
                  WHERE ss.show_id = s.id AND ss.category_id = scp.category_id
                    AND (ss.status = 'AVAILABLE' OR (ss.status = 'HELD' AND ss.hold_expires_at <= now()))
                )
              ) ORDER BY sc.display_rank) AS categories
         FROM shows s
         JOIN venues v ON v.id = s.venue_id
         JOIN show_category_prices scp ON scp.show_id = s.id
         JOIN seat_categories sc ON sc.id = scp.category_id
        WHERE s.event_id = $1 AND s.starts_at > now() AND s.status = 'SCHEDULED'
        GROUP BY s.id, v.name, v.city, v.address
        ORDER BY s.starts_at ASC`,
      [req.params.id]
    );

    res.json({ ...event, shows });
  } catch (err) { next(err); }
});

export default router;
