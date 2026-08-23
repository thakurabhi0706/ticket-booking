/**
 * waitlist.test.js ★
 *
 * The full waitlist story required by the brief:
 *
 *   join (only when sold out) → FIFO queue → cancellation promotes position 1
 *   → time-limited tokenised offer → offer lapses → position 2 is offered
 *   → claim converts the offer into a booking with source='WAITLIST'
 *
 * The offer token is only ever stored as a SHA-256 hash, so the plaintext token
 * cannot be read back out of the database. To exercise the claim endpoint the
 * test calls promoteWaitlist() in-process and reads the token off the returned
 * notification — exactly what the mailer receives.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  pool, config, call, makeUser, createTestShow, seatsOf, bookSeats, requireServer, sleep,
} from './helpers.js';
import { promoteWaitlist } from '../src/services/waitlistService.js';
import { tx } from '../src/db/pool.js';

let show, premiumId;

before(async () => {
  await requireServer();
  // 4 Premium seats and 4 Standard seats — small enough to sell out quickly.
  show = await createTestShow({
    rows: ['A', 'B'],
    seatsPerRow: 4,
    categories: [{ name: 'Premium', price: 500 }, { name: 'Standard', price: 200 }],
  });
  premiumId = show.categoryIds.Premium;
});

after(async () => {
  await show.cleanup();
  await pool.end();
});

/** Buy every Premium seat so the category is genuinely sold out. */
async function sellOutPremium() {
  const buyer = await makeUser(`buyer-${show.tag}`);
  const seats = (await seatsOf(show.showId)).filter(s => s.category_id === premiumId);
  assert.ok(seats.length > 0, 'expected Premium seats to sell');
  const booking = await bookSeats(show.showId, seats.map(s => s.id), buyer);
  return { buyer, booking, seatCount: seats.length };
}

test('joining a category that is NOT sold out is refused', async () => {
  const hopeful = await makeUser(`early-${show.tag}`);
  const res = await call('POST', `/shows/${show.showId}/waitlist`, {
    token: hopeful.token, body: { categoryId: premiumId, seatsWanted: 1 },
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'NOT_SOLD_OUT');
});

test('end-to-end: sold out → FIFO queue → cancel promotes #1 → lapse promotes #2 → claim', async () => {
  const { buyer, booking, seatCount } = await sellOutPremium();

  // ── 1. Two customers join the now sold-out category, in order ────────────
  const first  = await makeUser(`wl1-${show.tag}`);
  const second = await makeUser(`wl2-${show.tag}`);

  const j1 = await call('POST', `/shows/${show.showId}/waitlist`, {
    token: first.token, body: { categoryId: premiumId, seatsWanted: seatCount },
  });
  assert.equal(j1.status, 201, JSON.stringify(j1.body));
  assert.equal(j1.body.position, 1);

  const j2 = await call('POST', `/shows/${show.showId}/waitlist`, {
    token: second.token, body: { categoryId: premiumId, seatsWanted: seatCount },
  });
  assert.equal(j2.status, 201);
  assert.equal(j2.body.position, 2, 'the queue must be strict FIFO');

  // Duplicate join by the same user is refused.
  const dupe = await call('POST', `/shows/${show.showId}/waitlist`, {
    token: first.token, body: { categoryId: premiumId, seatsWanted: 1 },
  });
  assert.equal(dupe.status, 409);
  assert.equal(dupe.body.error.code, 'ALREADY_ON_WAITLIST');

  // ── 2. The buyer cancels → position 1 is auto-offered the freed seats ────
  const bookingId = (await pool.query(
    `SELECT id FROM bookings WHERE reference = $1`, [booking.reference]
  )).rows[0].id;

  const cancel = await call('POST', `/bookings/${bookingId}/cancel`, { token: buyer.token });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.body));

  const { rows: [offer1] } = await pool.query(
    `SELECT wo.*, we.user_id AS entry_user
       FROM waitlist_offers wo JOIN waitlist_entries we ON we.id = wo.entry_id
      WHERE wo.show_id = $1 AND wo.status = 'PENDING'`,
    [show.showId]
  );
  assert.ok(offer1, 'cancelling should have created a pending offer');
  assert.equal(offer1.user_id, first.id, 'the offer must go to position 1, not position 2');
  assert.ok(new Date(offer1.expires_at) > new Date(), 'the offer must be time-limited');

  // Seats are OFFERED — reserved for that user, not returned to general sale.
  const { rows: offered } = await pool.query(
    `SELECT status, offered_to FROM show_seats WHERE id = ANY($1::uuid[])`, [offer1.seat_ids]
  );
  assert.equal(offered.length, seatCount);
  for (const s of offered) {
    assert.equal(s.status, 'OFFERED', 'promoted seats must not be snipeable by general customers');
    assert.equal(s.offered_to, first.id);
  }

  // A general customer cannot hold an OFFERED seat.
  const sniper = await makeUser(`sniper-${show.tag}`);
  const snipe = await call('POST', `/shows/${show.showId}/holds`, {
    token: sniper.token, body: { seatIds: [offer1.seat_ids[0]] },
  });
  assert.equal(snipe.status, 409, 'an OFFERED seat must not be holdable by anyone else');

  // ── 3. Position 1 ignores it → the sweeper passes it to position 2 ───────
  await pool.query(
    `UPDATE waitlist_offers SET expires_at = now() - interval '1 second' WHERE id = $1`,
    [offer1.id]
  );

  const deadline = Date.now() + config.SWEEPER_INTERVAL_MS * 2 + 15_000;
  let offer2 = null;
  while (Date.now() < deadline) {
    await sleep(1000);
    const { rows } = await pool.query(
      `SELECT * FROM waitlist_offers
        WHERE show_id = $1 AND status = 'PENDING' AND id <> $2`,
      [show.showId, offer1.id]
    );
    if (rows.length) { offer2 = rows[0]; break; }
  }

  assert.ok(offer2, 'an expired offer must roll on to the next person in line');
  assert.equal(offer2.user_id, second.id, 'position 2 should now hold the offer');

  const { rows: [entry1] } = await pool.query(
    `SELECT status FROM waitlist_entries WHERE id = $1`, [offer1.entry_id]
  );
  assert.equal(entry1.status, 'EXPIRED', 'position 1 had their turn and forfeited it');

  // ── 4. Position 2 claims it → a WAITLIST-sourced booking ─────────────────
  // Re-issue an offer through the service so the test holds the plaintext token.
  await pool.query(
    `UPDATE waitlist_offers SET status = 'SUPERSEDED' WHERE id = $1`, [offer2.id]
  );
  await pool.query(
    `UPDATE waitlist_entries SET status = 'WAITING' WHERE id = $1`, [offer2.entry_id]
  );
  await pool.query(
    `UPDATE show_seats SET status='AVAILABLE', offered_to=NULL, offer_id=NULL, offer_expires_at=NULL
      WHERE id = ANY($1::uuid[])`, [offer2.seat_ids]
  );

  const notifications = await tx(c =>
    promoteWaitlist(c, show.showId, premiumId,
      offer2.seat_ids.map(id => ({ id, category_id: premiumId })))
  );
  assert.equal(notifications.length, 1, 'promotion should produce exactly one offer');
  const token = notifications[0].token;
  assert.ok(token, 'the notification carries the plaintext token for the email link');

  // The token itself is never persisted — only its hash.
  const { rows: leaked } = await pool.query(
    `SELECT 1 FROM waitlist_offers WHERE token_hash = $1`, [token]
  );
  assert.equal(leaked.length, 0, 'the plaintext token must not be stored');

  const view = await call('GET', `/waitlist/offers/${token}`);
  assert.equal(view.status, 200, JSON.stringify(view.body));
  assert.equal(view.body.seats.length, seatCount);
  assert.ok(view.body.secondsRemaining > 0);

  // Another user cannot claim someone else's offer.
  const thief = await makeUser(`thief-${show.tag}`);
  const stolen = await call('POST', `/waitlist/offers/${token}/claim`, {
    token: thief.token, body: { customer: { name: 'Thief', email: thief.email } },
  });
  assert.equal(stolen.status, 403);

  const claim = await call('POST', `/waitlist/offers/${token}/claim`, {
    token: second.token,
    body: { customer: { name: 'Second Customer', email: second.email } },
  });
  assert.equal(claim.status, 201, JSON.stringify(claim.body));

  const { rows: [claimed] } = await pool.query(
    `SELECT source, status, total_amount FROM bookings WHERE reference = $1`,
    [claim.body.reference]
  );
  assert.equal(claimed.source, 'WAITLIST');
  assert.equal(claimed.status, 'CONFIRMED');
  assert.ok(Number(claimed.total_amount) > 0, 'the claimed booking should be priced');

  const { rows: [entry2] } = await pool.query(
    `SELECT status FROM waitlist_entries WHERE id = $1`, [offer2.entry_id]
  );
  assert.equal(entry2.status, 'FULFILLED');

  // Reusing a claimed token is refused.
  const replay = await call('GET', `/waitlist/offers/${token}`);
  assert.equal(replay.status, 410);
  assert.equal(replay.body.error.code, 'OFFER_EXPIRED');
});

test('an unknown offer token is 410, not a 500', async () => {
  const res = await call('GET', `/waitlist/offers/${'0'.repeat(64)}`);
  assert.equal(res.status, 410);
  assert.equal(res.body.error.code, 'OFFER_EXPIRED');
});
