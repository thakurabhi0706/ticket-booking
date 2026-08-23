/**
 * ttl.test.js ★
 *
 * Seat-hold TTL is enforced by TWO independent mechanisms (DESIGN.md §5.3):
 *
 *   (a) DB-level lazy expiry — the availability predicate treats
 *       `hold_expires_at <= now()` as available, so a lapsed hold is claimable
 *       the instant it expires, whether or not any job has run. Correctness
 *       does NOT depend on the scheduler.
 *   (b) The sweeper — materialises lapsed rows back to AVAILABLE and pushes SSE,
 *       so the seat map is visibly correct, not just logically correct.
 *
 * Each mechanism is tested in isolation here.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  pool, config, call, makeUser, createTestShow, seatsOf, requireServer, sleep,
} from './helpers.js';

let show;

before(async () => {
  await requireServer();
  show = await createTestShow({ rows: ['A'], seatsPerRow: 6 });
});

after(async () => {
  await show.cleanup();
  await pool.end();
});

/** Force a hold to have already lapsed, without waiting out the real TTL. */
async function expireHold(seatIds) {
  await pool.query(
    `UPDATE show_seats SET hold_expires_at = now() - interval '1 second'
      WHERE id = ANY($1::uuid[]) AND status = 'HELD'`,
    [seatIds]
  );
}

test('a hold sets HELD with a future TTL and blocks other customers', async () => {
  const [seat] = await seatsOf(show.showId);
  const alice = await makeUser(`ttl-a-${show.tag}`);
  const bob   = await makeUser(`ttl-b-${show.tag}`);

  const hold = await call('POST', `/shows/${show.showId}/holds`, {
    token: alice.token, body: { seatIds: [seat.id] },
  });
  assert.equal(hold.status, 201);

  const ttlSeconds = (new Date(hold.body.expiresAt) - Date.now()) / 1000;
  assert.ok(
    ttlSeconds > 0 && ttlSeconds <= config.SEAT_HOLD_TTL_SECONDS + 5,
    `TTL should be ~SEAT_HOLD_TTL_SECONDS (${config.SEAT_HOLD_TTL_SECONDS}s), got ${ttlSeconds}s`
  );

  // While the hold is live, nobody else can take the seat.
  const bobTry = await call('POST', `/shows/${show.showId}/holds`, {
    token: bob.token, body: { seatIds: [seat.id] },
  });
  assert.equal(bobTry.status, 409);
  assert.equal(bobTry.body.error.code, 'SEAT_UNAVAILABLE');

  await call('DELETE', `/holds/${hold.body.holdGroupId}`, { token: alice.token });
});

test('lazy expiry: a lapsed hold is claimable immediately, WITHOUT the sweeper', async () => {
  const [seat] = await seatsOf(show.showId);
  const alice = await makeUser(`lazy-a-${show.tag}`);
  const bob   = await makeUser(`lazy-b-${show.tag}`);

  const hold = await call('POST', `/shows/${show.showId}/holds`, {
    token: alice.token, body: { seatIds: [seat.id] },
  });
  assert.equal(hold.status, 201);

  await expireHold([seat.id]);

  // The row still literally says 'HELD' — the sweeper hasn't touched it.
  const { rows: [before] } = await pool.query(
    `SELECT status FROM show_seats WHERE id = $1`, [seat.id]
  );
  assert.equal(before.status, 'HELD', 'precondition: the stale row is still marked HELD');

  // Yet Bob can claim it right now, because the predicate honours the timestamp.
  const bobHold = await call('POST', `/shows/${show.showId}/holds`, {
    token: bob.token, body: { seatIds: [seat.id] },
  });
  assert.equal(bobHold.status, 201, 'lazy expiry should make the seat immediately claimable');

  const { rows: [now] } = await pool.query(
    `SELECT status, held_by FROM show_seats WHERE id = $1`, [seat.id]
  );
  assert.equal(now.status, 'HELD');
  assert.equal(now.held_by, bob.id, 'the seat should now belong to Bob');

  await call('DELETE', `/holds/${bobHold.body.holdGroupId}`, { token: bob.token });
});

test('confirming a lapsed hold is refused with 410 HOLD_EXPIRED', async () => {
  const [seat] = await seatsOf(show.showId);
  const alice = await makeUser(`exp-a-${show.tag}`);

  const hold = await call('POST', `/shows/${show.showId}/holds`, {
    token: alice.token, body: { seatIds: [seat.id] },
  });
  assert.equal(hold.status, 201);

  await expireHold([seat.id]);

  const booking = await call('POST', '/bookings', {
    token: alice.token,
    body: {
      holdGroupId: hold.body.holdGroupId,
      customer: { name: 'Alice', email: alice.email },
    },
  });
  assert.equal(booking.status, 410);
  assert.equal(booking.body.error.code, 'HOLD_EXPIRED');

  // The rolled-back booking must not have left a bookings row behind.
  const { rows: [{ count }] } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM bookings WHERE show_id = $1`, [show.showId]
  );
  assert.equal(count, 0, 'a failed confirmation must not persist a booking');
});

test('explicit release frees the seat straight away', async () => {
  const [seat] = await seatsOf(show.showId);
  const alice = await makeUser(`rel-a-${show.tag}`);

  const hold = await call('POST', `/shows/${show.showId}/holds`, {
    token: alice.token, body: { seatIds: [seat.id] },
  });
  assert.equal(hold.status, 201);

  const rel = await call('DELETE', `/holds/${hold.body.holdGroupId}`, { token: alice.token });
  assert.equal(rel.status, 200);
  assert.equal(rel.body.released, 1);

  const { rows: [row] } = await pool.query(
    `SELECT status, held_by, hold_expires_at FROM show_seats WHERE id = $1`, [seat.id]
  );
  assert.equal(row.status, 'AVAILABLE');
  assert.equal(row.held_by, null);
  assert.equal(row.hold_expires_at, null);

  const { rows: [audit] } = await pool.query(
    `SELECT status FROM seat_holds WHERE id = $1`, [hold.body.holdGroupId]
  );
  assert.equal(audit.status, 'RELEASED', 'the audit trail should record the release');
});

test('holding more than MAX_SEATS_PER_BOOKING is rejected', async () => {
  const free = await seatsOf(show.showId);
  const max = config.MAX_SEATS_PER_BOOKING;
  if (free.length <= max) {
    console.log(`  (skipped — need > ${max} free seats, have ${free.length})`);
    return;
  }
  const greedy = await makeUser(`greedy-${show.tag}`);
  const res = await call('POST', `/shows/${show.showId}/holds`, {
    token: greedy.token, body: { seatIds: free.slice(0, max + 1).map(s => s.id) },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('the sweeper materialises lapsed holds back to AVAILABLE', async () => {
  const [seat] = await seatsOf(show.showId);
  const alice = await makeUser(`sweep-a-${show.tag}`);

  const hold = await call('POST', `/shows/${show.showId}/holds`, {
    token: alice.token, body: { seatIds: [seat.id] },
  });
  assert.equal(hold.status, 201);
  await expireHold([seat.id]);

  // Poll for up to two sweeper intervals plus slack.
  const deadline = Date.now() + config.SWEEPER_INTERVAL_MS * 2 + 10_000;
  let status = 'HELD';
  while (Date.now() < deadline) {
    await sleep(1000);
    const { rows: [row] } = await pool.query(
      `SELECT status FROM show_seats WHERE id = $1`, [seat.id]
    );
    status = row.status;
    if (status === 'AVAILABLE') break;
  }

  assert.equal(status, 'AVAILABLE',
    `sweeper did not release the seat within ${config.SWEEPER_INTERVAL_MS * 2 + 10_000}ms`);

  const { rows: [audit] } = await pool.query(
    `SELECT status FROM seat_holds WHERE id = $1`, [hold.body.holdGroupId]
  );
  assert.equal(audit.status, 'EXPIRED', 'the audit trail should record the expiry');
});
