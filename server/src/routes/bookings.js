import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../utils/validate.js';
import { createBooking, cancelBooking, getUserBookings, getBookingDetail } from '../services/bookingService.js';
import { generateQRDataURL } from '../services/qrService.js';
import { pool } from '../db/pool.js';
import { verifyQrSignature } from '../utils/reference.js';
import { E } from '../utils/errors.js';

const router = express.Router();

// GET /api/bookings/me — must be before /:id
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const bookings = await getUserBookings(req.user.sub);
    res.json(bookings);
  } catch (err) { next(err); }
});

// GET /api/bookings/verify/:reference — QR scan gate (must be before /:id)
router.get('/verify/:reference', async (req, res, next) => {
  try {
    const { reference } = req.params;
    const { s: sig } = req.query;

    if (!sig || sig.length !== 16 || !verifyQrSignature(reference, sig)) {
      return res.status(400).json({ valid: false, error: 'Invalid QR signature.' });
    }

    const { rows: [booking] } = await pool.query(
      `SELECT b.reference, b.status, b.customer_name,
              e.title AS event_title, s.starts_at, v.name AS venue_name,
              json_agg(json_build_object(
                'row_label', ss.row_label, 'seat_number', ss.seat_number
              )) AS seats
         FROM bookings b
         JOIN shows s ON s.id = b.show_id
         JOIN events e ON e.id = s.event_id
         JOIN venues v ON v.id = s.venue_id
         LEFT JOIN booking_seats bs ON bs.booking_id = b.id
         LEFT JOIN show_seats ss ON ss.id = bs.show_seat_id
        WHERE b.reference = $1
        GROUP BY b.id, e.title, s.starts_at, v.name`,
      [reference]
    );

    if (!booking) return res.json({ valid: false, error: 'Booking not found.' });
    res.json({ valid: booking.status === 'CONFIRMED', ...booking });
  } catch (err) { next(err); }
});

// POST /api/bookings
router.post('/', requireAuth, async (req, res, next) => {
  try {
    validate({
      holdGroupId: { type: 'string', required: true },
      customer: { required: true },
    }, req.body);
    validate({
      name:  { type: 'string', required: true, minLength: 2 },
      email: { type: 'string', required: true, email: true },
      phone: { type: 'string' },
    }, req.body.customer);

    const result = await createBooking(req.body.holdGroupId, req.user.sub, req.body.customer);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// GET /api/bookings/:id
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const booking = await getBookingDetail(req.params.id, req.user.sub);
    const qrDataURL = await generateQRDataURL(booking.qr_payload);
    res.json({ ...booking, qrDataURL });
  } catch (err) { next(err); }
});

// POST /api/bookings/:id/cancel
router.post('/:id/cancel', requireAuth, async (req, res, next) => {
  try {
    const result = await cancelBooking(req.params.id, req.user.sub);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
