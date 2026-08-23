/**
 * concurrency.test.js ★
 *
 * The highest-value test in the project. Proves the claim in DESIGN.md:
 * two customers can never hold or book the same seat.
 *
 *   1. 20 simultaneous holds on ONE seat  → exactly 1 × 201, 19 × 409
 *   2. Overlapping multi-seat requests    → all-or-nothing (loser holds NOTHING)
 *   3. The DB-level backstop              → uq_active_booking_seat refuses a
 *                                           second booking row for the same seat
 *
 * Run: npm test   (the API server must already be running)
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  pool, call, makeUser, createTestShow, seatsOf, requireServer,
} from './helpers.js';

let show;

before(async () => {
  await requireServer();
  show = await createTestShow({ rows: ['A', 'B'], seatsPerRow: 6 });
});

after(async () => {
  await show.cleanup();
  await pool.end();
});

test('20 concurrent holds on the same seat → exactly 1 × 201 and 19 × 409', async () => {
  const [seat] = await seatsOf(show.showId);
  const users = await Promise.all(
    Array.from({ length: 20 }, (_, i) => makeUser(`conc-${show.tag}-${i}`))
  );

  // Fire all 20 at once — no staggering, no retries.
  const results = await Promise.all(users.map(u =>
    call('POST', `/shows/${show.showId}/holds`, {
      token: u.token, body: { seatIds: [seat.id] },
    }).then(r => r.status)
  ));

  const successes = results.filter(s => s === 201).length;
  const conflicts = results.filter(s => s === 409).length;

  console.log(`\n  → ${successes} × 201, ${conflicts} × 409  [${results.join(' ')}]\n`);

  assert.equal(successes, 1, `expected exactly 1 success, got ${successes}`);
  assert.equal(conflicts, 19, `expected exactly 19 conflicts, got ${conflicts}`);
  assert.equal(results.length, successes + conflicts, 'unexpected status codes present');

  const { rows: [after] } = await pool.query(
    `SELECT status, held_by, hold_group_id, hold_expires_at
       FROM show_seats WHERE id = $1`, [seat.id]
  );
  assert.equal(after.status, 'HELD');
  assert.ok(after.held_by, 'held_by must be set');
  assert.ok(after.hold_group_id, 'hold_group_id must be set');
  assert.ok(new Date(after.hold_expires_at) > new Date(), 'TTL must be in the future');

  // Exactly one audit row for one winning hold.
  const { rows: [{ count }] } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM seat_holds WHERE show_id = $1 AND status = 'ACTIVE'`,
    [show.showId]
  );
  assert.equal(count, 1, 'exactly one ACTIVE hold group should exist');
});

test('overlapping multi-seat holds are all-or-nothing — the loser holds nothing', async () => {
  const free = await seatsOf(show.showId);
  assert.ok(free.length >= 5, 'need 5 free seats for this test');

  const [s1, s2, s3, s4, s5] = free;
  const alice = await makeUser(`overlap-a-${show.tag}`);
  const bob   = await makeUser(`overlap-b-${show.tag}`);

  // A wants [1,2,3], B wants [3,4,5] — they collide on s3 only.
  const [ra, rb] = await Promise.all([
    call('POST', `/shows/${show.showId}/holds`, {
      token: alice.token, body: { seatIds: [s1.id, s2.id, s3.id] },
    }),
    call('POST', `/shows/${show.showId}/holds`, {
      token: bob.token, body: { seatIds: [s3.id, s4.id, s5.id] },
    }),
  ]);

  const statuses = [ra.status, rb.status].sort();
  assert.deepEqual(statuses, [201, 409], `expected one 201 and one 409, got ${statuses}`);

  const winnerIsAlice = ra.status === 201;
  const loserOnlySeats = winnerIsAlice ? [s4.id, s5.id] : [s1.id, s2.id];

  // The critical assertion: the failed request rolled back completely.
  // Its non-contended seats must still be AVAILABLE, not half-held.
  const { rows } = await pool.query(
    `SELECT id, status, held_by FROM show_seats WHERE id = ANY($1::uuid[])`,
    [loserOnlySeats]
  );
  for (const r of rows) {
    assert.equal(r.status, 'AVAILABLE', `seat ${r.id} leaked from a rolled-back hold`);
    assert.equal(r.held_by, null);
  }

  // And the winner holds all three of theirs.
  const winnerSeats = winnerIsAlice ? [s1.id, s2.id, s3.id] : [s3.id, s4.id, s5.id];
  const { rows: held } = await pool.query(
    `SELECT status FROM show_seats WHERE id = ANY($1::uuid[])`, [winnerSeats]
  );
  assert.equal(held.filter(r => r.status === 'HELD').length, 3);
});

test('uq_active_booking_seat makes a double booking impossible at the DB level', async () => {
  const other = await createTestShow({ rows: ['A'], seatsPerRow: 2 });
  try {
    const buyer = await makeUser(`dbl-${other.tag}`);
    const [seat] = await seatsOf(other.showId);

    const hold = await call('POST', `/shows/${other.showId}/holds`, {
      token: buyer.token, body: { seatIds: [seat.id] },
    });
    assert.equal(hold.status, 201);

    const booking = await call('POST', '/bookings', {
      token: buyer.token,
      body: {
        holdGroupId: hold.body.holdGroupId,
        customer: { name: 'Test Buyer', email: buyer.email },
      },
    });
    assert.equal(booking.status, 201);

    // Forge a second booking row for the very same seat. Even with the
    // application logic bypassed entirely, Postgres must refuse it.
    const { rows: [forged] } = await pool.query(
      `INSERT INTO bookings (reference, show_id, user_id, customer_name, customer_email,
                             total_amount, qr_payload)
       VALUES ('BKG-FORGED1', $1, $2, 'Forger', 'forger@test.local', 0, 'x')
       RETURNING id`,
      [other.showId, buyer.id]
    );

    await assert.rejects(
      () => pool.query(
        `INSERT INTO booking_seats (booking_id, show_seat_id, price_paid) VALUES ($1,$2,0)`,
        [forged.id, seat.id]
      ),
      (err) => err.code === '23505',
      'the unique index should have rejected the duplicate seat'
    );

    await pool.query(`DELETE FROM bookings WHERE id = $1`, [forged.id]);
  } finally {
    await other.cleanup();
  }
});
