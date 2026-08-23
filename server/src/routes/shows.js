import express from 'express';
import { pool } from '../db/pool.js';
import { E } from '../utils/errors.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { getShowSeats } from '../services/seatService.js';
import { addClient, removeClient } from '../realtime/sse.js';

const router = express.Router();

// GET /api/shows/:id — show detail
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const { rows: [show] } = await pool.query(
      `SELECT s.id, s.starts_at, s.status,
              e.id AS event_id, e.title AS event_title, e.type AS event_type,
              e.description, e.poster_url, e.language, e.duration_min,
              v.id AS venue_id, v.name AS venue_name, v.city, v.address,
              json_agg(DISTINCT jsonb_build_object(
                'category_id', scp.category_id,
                'category_name', sc.name,
                'colour_hex', sc.colour_hex,
                'price', scp.price,
                'display_rank', sc.display_rank
              )) AS categories
         FROM shows s
         JOIN events e ON e.id = s.event_id
         JOIN venues v ON v.id = s.venue_id
         JOIN show_category_prices scp ON scp.show_id = s.id
         JOIN seat_categories sc ON sc.id = scp.category_id
        WHERE s.id = $1
        GROUP BY s.id, e.id, v.id`,
      [req.params.id]
    );
    if (!show) return next(E.notFound('Show not found.'));

    // Availability summary per category
    const { rows: avail } = await pool.query(
      `SELECT category_id,
              COUNT(*) FILTER (WHERE status='AVAILABLE' OR (status='HELD' AND hold_expires_at <= now())) AS available,
              COUNT(*) FILTER (WHERE status='BOOKED') AS booked,
              COUNT(*) AS total
         FROM show_seats
        WHERE show_id = $1
        GROUP BY category_id`,
      [req.params.id]
    );

    res.json({ ...show, availability: avail });
  } catch (err) { next(err); }
});

// GET /api/shows/:id/seats — full seat map
router.get('/:id/seats', async (req, res, next) => {
  try {
    const seats = await getShowSeats(req.params.id);
    res.json(seats);
  } catch (err) { next(err); }
});

// GET /api/shows/:id/stream — SSE live updates
router.get('/:id/stream', requireAuth, (req, res) => {
  const showId = req.params.id;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',   // prevent proxy buffering on Render
  });

  res.write('retry: 3000\n\n');

  // Tag the connection with the authenticated user (for targeted waitlist offer events)
  res.__userId = req.user.sub;
  addClient(showId, res);

  // Keep-alive ping every 25 s to prevent proxy timeout
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);

  req.on('close', () => {
    clearInterval(ping);
    removeClient(showId, res);
  });
});

export default router;
