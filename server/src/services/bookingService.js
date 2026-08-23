/**
 * bookingService.js — Booking creation, cancellation, and history.
 */
import { tx, pool } from '../db/pool.js';
import { E } from '../utils/errors.js';
import { confirmHold, freeBookingSeats } from './seatService.js';
import { promoteWaitlist, dispatchNotifications } from './waitlistService.js';
import { generateReference, generateQrPayload } from '../utils/reference.js';
import { generateQR } from './qrService.js';
import { sendEmail } from './emailService.js';
import { broadcastSeatUpdate } from '../realtime/sse.js';
import { config } from '../config.js';

export async function createBooking(holdGroupId, userId, customer) {
  let bookingRef, qrPayload, bookedSeats, show;

  await tx(async (c) => {
    // Verify hold belongs to this user and get show info
    const { rows: [hold] } = await c.query(
      `SELECT sh.*, s.starts_at, e.title AS event_title, v.name AS venue_name
         FROM seat_holds sh
         JOIN shows s ON s.id = sh.show_id
         JOIN events e ON e.id = s.event_id
         JOIN venues v ON v.id = s.venue_id
        WHERE sh.id = $1 AND sh.user_id = $2 AND sh.status = 'ACTIVE'`,
      [holdGroupId, userId]
    );
    if (!hold) throw E.gone('HOLD_NOT_FOUND', 'Hold not found or already used.');

    bookingRef = generateReference();
    qrPayload  = generateQrPayload(bookingRef);

    // Insert booking row
    const { rows: [booking] } = await c.query(
      `INSERT INTO bookings
         (reference, show_id, user_id, customer_name, customer_email, customer_phone,
          total_amount, qr_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        bookingRef, hold.show_id, userId,
        customer.name, customer.email, customer.phone || null,
        0, qrPayload,
      ]
    );
    const bookingId = booking.id;

    // Confirm seats (atomic — rolls back if any hold expired)
    // All-or-nothing: every seat in the hold group must still be HELD by this user
    // and inside its TTL. A partial match means the hold lapsed → roll back → 410.
    bookedSeats = await confirmHold(c, holdGroupId, userId, bookingId);
    if (bookedSeats.length !== hold.seat_count) throw E.holdExpired();

    const total = bookedSeats.reduce((s, r) => s + parseFloat(r.price), 0);

    // Insert booking_seats + update total
    for (const s of bookedSeats) {
      await c.query(
        `INSERT INTO booking_seats (booking_id, show_seat_id, price_paid) VALUES ($1,$2,$3)`,
        [bookingId, s.id, s.price]
      );
    }
    await c.query(`UPDATE bookings SET total_amount = $1 WHERE id = $2`, [total, bookingId]);
    await c.query(`UPDATE seat_holds SET status = 'CONVERTED' WHERE id = $1`, [holdGroupId]);

    show = hold;
  });

  // Post-commit: send email (never inside the transaction)
  setImmediate(async () => {
    try {
      const qrPng = await generateQR(qrPayload);
      await sendEmail('BOOKING_CONFIRMED', {
        to: customer.email,
        name: customer.name,
        reference: bookingRef,
        eventTitle: show.event_title,
        startsAt: show.starts_at,
        venueName: show.venue_name,
        seats: bookedSeats,
        total: bookedSeats.reduce((s, r) => s + parseFloat(r.price), 0),
        qrPng,
        qrPayload,
      });
    } catch (err) {
      console.error('[booking] Email/QR failed:', err.message);
    }
  });

  broadcastSeatUpdate(show.show_id, bookedSeats.map(s => ({ seatId: s.id, status: 'BOOKED' })));

  return { reference: bookingRef, seats: bookedSeats };
}

export async function cancelBooking(bookingId, userId) {
  let showId, freedSeats;
  let notifications = [];

  await tx(async (c) => {
    const { rows: [booking] } = await c.query(
      `SELECT b.*, s.starts_at FROM bookings b
         JOIN shows s ON s.id = b.show_id
        WHERE b.id = $1 AND b.user_id = $2`,
      [bookingId, userId]
    );
    if (!booking) throw E.notFound('Booking not found.');
    if (booking.status === 'CANCELLED') throw E.conflict('ALREADY_CANCELLED', 'Booking is already cancelled.');

    const cutoff = config.CANCELLATION_CUTOFF_MINUTES * 60 * 1000;
    if (new Date(booking.starts_at) - Date.now() < cutoff) {
      throw E.conflict('CANCELLATION_CUTOFF', `Cannot cancel within ${config.CANCELLATION_CUTOFF_MINUTES} minutes of showtime.`);
    }

    showId = booking.show_id;

    await c.query(
      `UPDATE bookings SET status = 'CANCELLED', cancelled_at = now() WHERE id = $1`,
      [bookingId]
    );

    freedSeats = await freeBookingSeats(c, bookingId);

    // Promote waitlist per category
    const byCat = {};
    for (const s of freedSeats) {
      if (!byCat[s.category_id]) byCat[s.category_id] = [];
      byCat[s.category_id].push(s);
    }
    for (const [categoryId, seats] of Object.entries(byCat)) {
      notifications.push(...await promoteWaitlist(c, showId, categoryId, seats));
    }

    // Send cancellation email
    setImmediate(() => {
      sendEmail('BOOKING_CANCELLED', {
        to: booking.customer_email,
        name: booking.customer_name,
        reference: booking.reference,
      }).catch(() => {});
    });
  });

  // Post-commit only: seats promoted to OFFERED are already reserved in the DB,
  // so the emailed link is guaranteed to resolve.
  dispatchNotifications(notifications);
  broadcastSeatUpdate(showId, freedSeats.map(s => ({ seatId: s.id, status: 'AVAILABLE' })));
  return { cancelled: true };
}

export async function getUserBookings(userId) {
  const { rows } = await pool.query(
    `SELECT b.id, b.reference, b.status, b.total_amount, b.created_at, b.cancelled_at,
            e.title AS event_title, e.type AS event_type,
            s.starts_at, v.name AS venue_name, v.city,
            json_agg(json_build_object(
              'row_label', ss.row_label, 'seat_number', ss.seat_number,
              'price_paid', bs.price_paid
            ) ORDER BY ss.row_label, ss.seat_number) AS seats
       FROM bookings b
       JOIN shows s ON s.id = b.show_id
       JOIN events e ON e.id = s.event_id
       JOIN venues v ON v.id = s.venue_id
       LEFT JOIN booking_seats bs ON bs.booking_id = b.id
       LEFT JOIN show_seats ss ON ss.id = bs.show_seat_id
      WHERE b.user_id = $1
      GROUP BY b.id, e.title, e.type, s.starts_at, v.name, v.city
      ORDER BY b.created_at DESC`,
    [userId]
  );
  return rows;
}

export async function getBookingDetail(bookingId, userId) {
  const { rows: [booking] } = await pool.query(
    `SELECT b.*, e.title AS event_title, e.type AS event_type,
            s.starts_at, v.name AS venue_name, v.city, v.address,
            json_agg(json_build_object(
              'row_label', ss.row_label, 'seat_number', ss.seat_number,
              'price_paid', bs.price_paid, 'category', sc.name
            ) ORDER BY ss.row_label, ss.seat_number) AS seats
       FROM bookings b
       JOIN shows s ON s.id = b.show_id
       JOIN events e ON e.id = s.event_id
       JOIN venues v ON v.id = s.venue_id
       LEFT JOIN booking_seats bs ON bs.booking_id = b.id
       LEFT JOIN show_seats ss ON ss.id = bs.show_seat_id
       LEFT JOIN seat_categories sc ON sc.id = ss.category_id
      WHERE b.id = $1 AND b.user_id = $2
      GROUP BY b.id, e.title, e.type, s.starts_at, v.name, v.city, v.address`,
    [bookingId, userId]
  );
  if (!booking) throw E.notFound('Booking not found.');
  return booking;
}
