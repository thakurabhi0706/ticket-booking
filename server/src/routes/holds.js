import express from 'express';
import { pool } from '../db/pool.js';
import { E } from '../utils/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { holdSeats, releaseHold } from '../services/seatService.js';
import { validate } from '../utils/validate.js';
import { broadcastSeatUpdate } from '../realtime/sse.js';

const router = express.Router();
// Keyed by user, not IP: several genuine customers can share an IP (office NAT,
// mobile carrier, or a load test), and we only want to stop one account hoarding seats.
const holdLimiter = rateLimit(15, 60_000, (req) => `hold:${req.user?.sub || req.ip}`);

// POST /api/shows/:showId/holds
router.post('/shows/:showId/holds', requireAuth, holdLimiter, async (req, res, next) => {
  try {
    validate({ seatIds: { type: 'array', required: true, minItems: 1 } }, req.body);

    const { seatIds } = req.body;
    const { holdGroupId, expiresAt, seats, total } = await holdSeats(req.params.showId, seatIds, req.user.sub);

    broadcastSeatUpdate(req.params.showId, seats.map(s => ({ seatId: s.id, status: 'HELD' })));

    res.status(201).json({
      holdGroupId, expiresAt, total,
      seats: seats.map(s => ({ ...s, price: Number(s.price) })),
    });
  } catch (err) { next(err); }
});

// GET /api/holds/:groupId — TTL remaining (server-authoritative)
router.get('/holds/:groupId', requireAuth, async (req, res, next) => {
  try {
    const { rows: [hold] } = await pool.query(
      `SELECT sh.id, sh.status, sh.expires_at,
              json_agg(json_build_object(
                'id', ss.id, 'row_label', ss.row_label,
                'seat_number', ss.seat_number, 'price', ss.price
              )) AS seats,
              SUM(ss.price) AS total
         FROM seat_holds sh
         JOIN show_seats ss ON ss.hold_group_id = sh.id
        WHERE sh.id = $1 AND sh.user_id = $2
        GROUP BY sh.id`,
      [req.params.groupId, req.user.sub]
    );
    if (!hold) return next(E.notFound('Hold not found.'));
    if (hold.status !== 'ACTIVE' || new Date(hold.expires_at) <= new Date()) {
      return next(E.holdExpired());
    }
    // Normalise the shape so it matches POST /shows/:id/holds exactly —
    // the checkout page consumes either interchangeably.
    res.json({
      holdGroupId: hold.id,
      status:      hold.status,
      expiresAt:   hold.expires_at,
      seats:       hold.seats.map(s => ({ ...s, price: Number(s.price) })),
      total:       Number(hold.total),
    });
  } catch (err) { next(err); }
});

// Shared handler for explicit hold release.
async function releaseHandler(req, res, next) {
  try {
    const released = await releaseHold(req.params.groupId, req.user.sub);
    if (released.length > 0) {
      broadcastSeatUpdate(released[0].show_id, released.map(s => ({ seatId: s.id, status: 'AVAILABLE' })));
    }
    res.json({ released: released.length });
  } catch (err) { next(err); }
}

// DELETE /api/holds/:groupId — explicit release from the UI (Cancel button)
router.delete('/holds/:groupId', requireAuth, releaseHandler);

// POST /api/holds/:groupId/release — navigator.sendBeacon target on `beforeunload`.
// Beacons are always POST and cannot set an Authorization header, so requireAuth
// falls back to ?token= (see middleware/auth.js). Body is parsed as text/plain too.
router.post('/holds/:groupId/release',
  express.text({ type: '*/*', limit: '4kb' }),
  requireAuth,
  releaseHandler
);

export default router;
