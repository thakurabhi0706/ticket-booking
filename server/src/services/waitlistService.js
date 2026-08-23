/**
 * waitlistService.js ★
 *
 * Waitlist FIFO queue, time-limited offer creation, expiry, and re-promotion.
 *
 * Algorithm:
 *  1. Cancel → freeBookingSeats → promoteWaitlist (same transaction)
 *  2. promoteWaitlist picks head of queue with FOR UPDATE SKIP LOCKED
 *  3. Seats move to OFFERED (reserved), not AVAILABLE — cannot be sniped
 *  4. Token is emailed; only SHA-256 stored — leaked DB cannot claim offers
 *  5. Sweeper: expired OFFERED seats → AVAILABLE → re-promote to next entry
 */
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { E } from '../utils/errors.js';
import { randomToken, sha256 } from '../utils/reference.js';
import { sendEmail } from './emailService.js';
import { sendWaitlistOffer } from '../realtime/sse.js';

/**
 * Join the waitlist for a seat category.
 * Guard: category must be genuinely sold out.
 */
export async function joinWaitlist(showId, categoryId, userId, seatsWanted) {
  const { rows: [avail] } = await pool.query(
    `SELECT COUNT(*) AS cnt
       FROM show_seats
      WHERE show_id = $1 AND category_id = $2
        AND (status = 'AVAILABLE' OR (status = 'HELD' AND hold_expires_at <= now()))`,
    [showId, categoryId]
  );
  if (parseInt(avail.cnt) > 0) {
    throw E.conflict('NOT_SOLD_OUT', 'Seats are still available in this category. Waitlist is not open yet.');
  }

  const { rows: [user] } = await pool.query(
    `SELECT name, email FROM users WHERE id = $1`, [userId]
  );

  const { rows: [entry] } = await pool.query(
    `INSERT INTO waitlist_entries (show_id, category_id, user_id, user_email, user_name, seats_wanted)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING
     RETURNING id, position`,
    [showId, categoryId, userId, user.email, user.name, seatsWanted]
  );

  if (!entry) throw E.conflict('ALREADY_ON_WAITLIST', 'You are already on the waitlist for this category.');

  const { rows: [pos] } = await pool.query(
    `SELECT COUNT(*) AS position
       FROM waitlist_entries
      WHERE show_id = $1 AND category_id = $2
        AND status = 'WAITING' AND position <= $3`,
    [showId, categoryId, entry.position]
  );

  return { entryId: entry.id, position: parseInt(pos.position) };
}

/**
 * Promote waitlist after seats become available.
 * Called inside a transaction after booking cancellation / offer expiry.
 * Uses FOR UPDATE SKIP LOCKED so concurrent cancellations don't double-offer.
 *
 * Returns an array of pending notifications. The caller MUST dispatch them with
 * `dispatchNotifications()` only AFTER the transaction commits — otherwise the
 * recipient can click the emailed link before the offer row is visible, or worse,
 * receive a link for an offer that later rolls back.
 */
export async function promoteWaitlist(client, showId, categoryId, freedSeats) {
  let pool_seats = [...freedSeats];
  const notifications = [];

  while (pool_seats.length > 0) {
    const { rows: [entry] } = await client.query(
      `SELECT we.id, we.user_id, we.user_email, we.user_name, we.seats_wanted
         FROM waitlist_entries we
        WHERE we.show_id = $1 AND we.category_id = $2 AND we.status = 'WAITING'
        ORDER BY we.position ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
      [showId, categoryId]
    );

    if (!entry) break; // nobody waiting

    // Fairness policy: don't skip — if not enough seats, stop.
    if (entry.seats_wanted > pool_seats.length) break;

    const seats = pool_seats.splice(0, entry.seats_wanted);
    const token = randomToken();
    const tokenHash = sha256(token);
    const expiresAt = new Date(Date.now() + config.WAITLIST_OFFER_TTL_SECONDS * 1000);

    const { rows: [show] } = await client.query(
      `SELECT s.id, e.title AS event_title, s.starts_at, v.name AS venue_name
         FROM shows s
         JOIN events e ON e.id = s.event_id
         JOIN venues v ON v.id = s.venue_id
        WHERE s.id = $1`,
      [showId]
    );

    const { rows: [offer] } = await client.query(
      `INSERT INTO waitlist_offers (entry_id, show_id, user_id, seat_ids, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [entry.id, showId, entry.user_id, seats.map(s => s.id), tokenHash, expiresAt]
    );

    // Move seats to OFFERED (reserved for this user, not returned to general sale)
    const { rowCount: reserved } = await client.query(
      `UPDATE show_seats
          SET status = 'OFFERED', offered_to = $2, offer_id = $3,
              offer_expires_at = $4, updated_at = now()
        WHERE id = ANY($1::uuid[]) AND status = 'AVAILABLE'`,
      [seats.map(s => s.id), entry.user_id, offer.id, expiresAt]
    );
    // If a seat slipped away between being freed and being offered, abort the whole
    // promotion rather than emailing a link to seats we cannot deliver.
    if (reserved !== seats.length) {
      throw new Error(
        `promoteWaitlist: expected to reserve ${seats.length} seat(s), reserved ${reserved}`
      );
    }

    await client.query(
      `UPDATE waitlist_entries SET status = 'OFFERED' WHERE id = $1`,
      [entry.id]
    );

    notifications.push({
      userId: entry.user_id,
      showId,
      token,
      email: {
        to: entry.user_email,
        name: entry.user_name,
        link: `${config.APP_URL}/waitlist/offer/${token}`,
        expiresAt,
        seats,
        eventTitle: show.event_title,
        startsAt: show.starts_at,
        venueName: show.venue_name,
      },
    });
  }

  return notifications;
}

/**
 * Dispatch waitlist-offer notifications. Call AFTER the transaction commits.
 * Pushes a targeted SSE event (so an open tab reacts instantly) and sends the
 * tokenised email. Failures here never affect the committed DB state.
 */
export function dispatchNotifications(notifications = []) {
  for (const n of notifications) {
    try { sendWaitlistOffer(n.userId, n.token, n.showId); } catch { /* best effort */ }
    setImmediate(() => {
      sendEmail('WAITLIST_OFFER', n.email)
        .catch(err => console.error('[waitlist] Offer email failed:', err.message));
    });
  }
}

/**
 * Claim an offer using a time-limited token.
 * Returns booking-ready seat data.
 */
export async function getOffer(token) {
  const tokenHash = sha256(token);
  const { rows: [offer] } = await pool.query(
    `SELECT wo.*, we.seats_wanted,
            e.title AS event_title, s.starts_at, v.name AS venue_name,
            u.name AS user_name, u.email AS user_email
       FROM waitlist_offers wo
       JOIN waitlist_entries we ON we.id = wo.entry_id
       JOIN shows s ON s.id = wo.show_id
       JOIN events e ON e.id = s.event_id
       JOIN venues v ON v.id = s.venue_id
       JOIN users u ON u.id = wo.user_id
      WHERE wo.token_hash = $1 AND wo.status = 'PENDING' AND wo.expires_at > now()`,
    [tokenHash]
  );
  if (!offer) throw E.offerExpired();
  return offer;
}

/**
 * Expire old offers → re-promote to the next entry in line. Called by the sweeper.
 * Returns { shows, notifications } — shows for the SSE broadcast, notifications to
 * be dispatched by the caller after commit.
 */
export async function expireOffers(client) {
  const { rows: expired } = await client.query(
    `UPDATE waitlist_offers SET status = 'EXPIRED'
      WHERE status = 'PENDING' AND expires_at <= now()
      RETURNING id, entry_id, show_id, seat_ids`
  );

  const affectedShows = new Set();
  const notifications = [];

  for (const offer of expired) {
    await client.query(
      `UPDATE waitlist_entries SET status = 'EXPIRED' WHERE id = $1`,
      [offer.entry_id]
    );

    const { rows: freed } = await client.query(
      `UPDATE show_seats
          SET status = 'AVAILABLE', offered_to = NULL,
              offer_id = NULL, offer_expires_at = NULL, updated_at = now()
        WHERE id = ANY($1::uuid[]) AND status = 'OFFERED'
        RETURNING id, show_id, category_id`,
      [offer.seat_ids]
    );

    if (freed.length > 0) {
      affectedShows.add(offer.show_id);
      const byCat = {};
      for (const s of freed) {
        if (!byCat[s.category_id]) byCat[s.category_id] = [];
        byCat[s.category_id].push(s);
      }
      for (const [categoryId, seats] of Object.entries(byCat)) {
        notifications.push(...await promoteWaitlist(client, offer.show_id, categoryId, seats));
      }
    }
  }

  return { shows: [...affectedShows], notifications };
}
