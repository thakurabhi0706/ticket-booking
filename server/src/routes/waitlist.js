import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../utils/validate.js';
import { joinWaitlist, getOffer, promoteWaitlist, dispatchNotifications } from '../services/waitlistService.js';
import { pool, tx } from '../db/pool.js';
import { E } from '../utils/errors.js';
import { broadcastSeatUpdate } from '../realtime/sse.js';
import { config } from '../config.js';

const router = express.Router();

// POST /api/shows/:showId/waitlist
router.post('/shows/:showId/waitlist', requireAuth, async (req, res, next) => {
  try {
    validate({
      categoryId:  { type: 'string', required: true },
      seatsWanted: { type: 'number', required: true, min: 1, max: config.WAITLIST_MAX_SEATS },
    }, req.body);

    const result = await joinWaitlist(
      req.params.showId, req.body.categoryId,
      req.user.sub, req.body.seatsWanted
    );
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// GET /api/me/waitlist  (alias: /api/waitlist/me)
router.get(['/me/waitlist', '/waitlist/me'], requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT we.id, we.show_id, we.category_id, we.seats_wanted, we.status, we.position, we.created_at,
              e.title AS event_title, s.starts_at, v.name AS venue_name,
              sc.name AS category_name,
              (SELECT COUNT(*) FROM waitlist_entries w2
               WHERE w2.show_id = we.show_id AND w2.category_id = we.category_id
                 AND w2.status = 'WAITING' AND w2.position < we.position) + 1 AS queue_position
         FROM waitlist_entries we
         JOIN shows s ON s.id = we.show_id
         JOIN events e ON e.id = s.event_id
         JOIN venues v ON v.id = s.venue_id
         JOIN seat_categories sc ON sc.id = we.category_id
        WHERE we.user_id = $1
        ORDER BY we.created_at DESC`,
      [req.user.sub]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// DELETE /api/waitlist/:entryId
router.delete('/waitlist/:entryId', requireAuth, async (req, res, next) => {
  try {
    const { rows: [entry] } = await pool.query(
      `UPDATE waitlist_entries SET status = 'CANCELLED'
        WHERE id = $1 AND user_id = $2 AND status = 'WAITING'
        RETURNING id`,
      [req.params.entryId, req.user.sub]
    );
    if (!entry) return next(E.notFound('Waitlist entry not found or cannot be cancelled.'));
    res.json({ cancelled: true });
  } catch (err) { next(err); }
});

// GET /api/waitlist/offers/:token — validate offer
router.get('/waitlist/offers/:token', async (req, res, next) => {
  try {
    const offer = await getOffer(req.params.token);
    const secondsRemaining = Math.max(0, Math.floor((new Date(offer.expires_at) - Date.now()) / 1000));

    // Get seat details
    const { rows: seats } = await pool.query(
      `SELECT ss.id, ss.row_label, ss.seat_number, ss.price, sc.name AS category_name
         FROM show_seats ss
         JOIN seat_categories sc ON sc.id = ss.category_id
        WHERE ss.id = ANY($1::uuid[])`,
      [offer.seat_ids]
    );

    res.json({
      offerId: offer.id,
      showId: offer.show_id,
      eventTitle: offer.event_title,
      startsAt: offer.starts_at,
      venueName: offer.venue_name,
      seats,
      expiresAt: offer.expires_at,
      secondsRemaining,
      userEmail: offer.user_email,
    });
  } catch (err) { next(err); }
});

// POST /api/waitlist/offers/:token/claim
router.post('/waitlist/offers/:token/claim', requireAuth, async (req, res, next) => {
  try {
    validate({
      customer: { required: true },
    }, req.body);
    validate({
      name:  { type: 'string', required: true, minLength: 2 },
      email: { type: 'string', required: true, email: true },
      phone: { type: 'string' },
    }, req.body.customer);

    const offer = await getOffer(req.params.token);
    if (offer.user_id !== req.user.sub) throw E.forbidden('This offer is not for your account.');

    const { generateReference, generateQrPayload } = await import('../utils/reference.js');
    const { generateQR } = await import('../services/qrService.js');
    const { sendEmail } = await import('../services/emailService.js');

    let bookingRef, qrPayload, bookedSeats;

    await tx(async (c) => {
      const bookingRef_ = generateReference();
      const qrPayload_  = generateQrPayload(bookingRef_);
      bookingRef = bookingRef_;
      qrPayload  = qrPayload_;

      const { rows: [booking] } = await c.query(
        `INSERT INTO bookings
           (reference, show_id, user_id, customer_name, customer_email, customer_phone,
            total_amount, source, qr_payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'WAITLIST',$8) RETURNING id`,
        [bookingRef, offer.show_id, req.user.sub,
         req.body.customer.name, req.body.customer.email, req.body.customer.phone || null,
         0, qrPayload]
      );

      const { rows: confirmed } = await c.query(
        `UPDATE show_seats
            SET status='BOOKED', booking_id=$1, offered_to=NULL,
                offer_id=NULL, offer_expires_at=NULL, updated_at=now()
          WHERE id = ANY($2::uuid[]) AND status='OFFERED' AND offer_expires_at > now()
          RETURNING id, row_label, seat_number, price`,
        [booking.id, offer.seat_ids]
      );
      if (confirmed.length !== offer.seat_ids.length) throw E.offerExpired();

      bookedSeats = confirmed;
      const total = confirmed.reduce((s, r) => s + parseFloat(r.price), 0);

      for (const s of confirmed) {
        await c.query(
          `INSERT INTO booking_seats (booking_id, show_seat_id, price_paid) VALUES ($1,$2,$3)`,
          [booking.id, s.id, s.price]
        );
      }
      await c.query(`UPDATE bookings SET total_amount = $1 WHERE id = $2`, [total, booking.id]);
      await c.query(`UPDATE waitlist_offers SET status='CLAIMED', claimed_at=now() WHERE id=$1`, [offer.id]);
      await c.query(`UPDATE waitlist_entries SET status='FULFILLED' WHERE id=$1`, [offer.entry_id]);
    });

    broadcastSeatUpdate(offer.show_id, bookedSeats.map(s => ({ seatId: s.id, status: 'BOOKED' })));

    setImmediate(async () => {
      try {
        const qrPng = await generateQR(qrPayload);
        await sendEmail('BOOKING_CONFIRMED', {
          to: req.body.customer.email,
          name: req.body.customer.name,
          reference: bookingRef,
          eventTitle: offer.event_title,
          startsAt: offer.starts_at,
          venueName: offer.venue_name,
          seats: bookedSeats,
          total: bookedSeats.reduce((s, r) => s + parseFloat(r.price), 0),
          qrPng, qrPayload,
        });
      } catch { /* best effort */ }
    });

    res.status(201).json({ reference: bookingRef, seats: bookedSeats });
  } catch (err) { next(err); }
});

// POST /api/waitlist/offers/:token/decline
router.post('/waitlist/offers/:token/decline', requireAuth, async (req, res, next) => {
  try {
    const offer = await getOffer(req.params.token);
    if (offer.user_id !== req.user.sub) throw E.forbidden('This offer is not for your account.');

    let notifications = [];

    await tx(async (c) => {
      await c.query(`UPDATE waitlist_offers SET status='EXPIRED' WHERE id=$1`, [offer.id]);
      await c.query(`UPDATE waitlist_entries SET status='EXPIRED' WHERE id=$1`, [offer.entry_id]);
      const { rows: freed } = await c.query(
        `UPDATE show_seats SET status='AVAILABLE', offered_to=NULL, offer_id=NULL,
                offer_expires_at=NULL, updated_at=now()
          WHERE id=ANY($1::uuid[]) AND status='OFFERED'
          RETURNING id, show_id, category_id`,
        [offer.seat_ids]
      );

      const byCat = {};
      for (const s of freed) {
        if (!byCat[s.category_id]) byCat[s.category_id] = [];
        byCat[s.category_id].push(s);
      }
      for (const [catId, seats] of Object.entries(byCat)) {
        notifications.push(...await promoteWaitlist(c, offer.show_id, catId, seats));
      }
    });

    dispatchNotifications(notifications);
    broadcastSeatUpdate(offer.show_id, offer.seat_ids.map(id => ({ seatId: id, status: 'AVAILABLE' })));
    res.json({ declined: true });
  } catch (err) { next(err); }
});

export default router;
