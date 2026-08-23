/**
 * auth.test.js — Authentication and role-based access control.
 *
 * The mark-loser this guards against: registration being able to mint an ADMIN.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { pool, config, call, makeUser, createTestShow, requireServer } from './helpers.js';

const tag = crypto.randomBytes(3).toString('hex');
const created = [];

before(requireServer);

after(async () => {
  if (created.length) {
    await pool.query(`DELETE FROM users WHERE email = ANY($1::citext[])`, [created]);
  }
  await pool.end();
});

function newEmail(label) {
  const email = `auth-${label}-${tag}@test.local`;
  created.push(email);
  return email;
}

test('registration issues a token and defaults to the CUSTOMER role', async () => {
  const res = await call('POST', '/auth/register', {
    body: { name: 'Reg Tester', email: newEmail('basic'), password: 'TestPass@123' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.role, 'CUSTOMER');
  assert.ok(res.body.token);
});

test('registration can NEVER mint an ADMIN', async () => {
  const email = newEmail('escalate');
  const res = await call('POST', '/auth/register', {
    body: { name: 'Escalator', email, password: 'TestPass@123', role: 'ADMIN' },
  });

  // Rejected outright by the enum validation — and, critically, no ADMIN exists.
  assert.ok(res.status === 400 || res.status === 403, `expected 400/403, got ${res.status}`);

  const { rows } = await pool.query(`SELECT role FROM users WHERE email = $1`, [email]);
  assert.equal(rows.length, 0, 'no user should have been created at all');
});

test('duplicate email is rejected with 409', async () => {
  const email = newEmail('dupe');
  const body = { name: 'First', email, password: 'TestPass@123' };

  const first = await call('POST', '/auth/register', { body });
  assert.equal(first.status, 201);

  const second = await call('POST', '/auth/register', { body });
  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, 'EMAIL_TAKEN');
});

test('a short password is rejected before any user is created', async () => {
  const email = newEmail('weak');
  const res = await call('POST', '/auth/register', {
    body: { name: 'Weak', email, password: 'short' },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('login works with the right password and 401s with the wrong one', async () => {
  const email = newEmail('login');
  await call('POST', '/auth/register', {
    body: { name: 'Login Tester', email, password: 'TestPass@123' },
  });

  const good = await call('POST', '/auth/login', { body: { email, password: 'TestPass@123' } });
  assert.equal(good.status, 200);
  assert.ok(good.body.token);
  assert.equal(good.body.password_hash, undefined, 'the hash must never leave the server');

  const bad = await call('POST', '/auth/login', { body: { email, password: 'WrongPass@123' } });
  assert.equal(bad.status, 401);

  const missing = await call('POST', '/auth/login', {
    body: { email: `nobody-${tag}@test.local`, password: 'TestPass@123' },
  });
  assert.equal(missing.status, 401, 'a missing account must not be distinguishable from a bad password');
});

test('an expired or forged token is rejected', async () => {
  const user = await makeUser(`auth-exp-${tag}`);

  const expired = jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    config.JWT_SECRET,
    { expiresIn: '-1s' }
  );
  const a = await call('GET', '/auth/me', { token: expired });
  assert.equal(a.status, 401);

  const forged = jwt.sign({ sub: user.id, role: 'ADMIN' }, 'not-the-real-secret');
  const b = await call('GET', '/auth/me', { token: forged });
  assert.equal(b.status, 401);

  const none = await call('GET', '/auth/me');
  assert.equal(none.status, 401);
});

test('RBAC: a customer is refused on admin and organiser routes', async () => {
  const customer = await makeUser(`auth-cust-${tag}`, 'CUSTOMER');

  const admin = await call('GET', '/admin/venues', { token: customer.token });
  assert.equal(admin.status, 403);
  assert.equal(admin.body.error.code, 'FORBIDDEN');

  const org = await call('GET', '/organiser/events', { token: customer.token });
  assert.equal(org.status, 403);
});

test('RBAC: an organiser cannot read another organiser\'s revenue summary', async () => {
  const mine = await createTestShow({ rows: ['A'], seatsPerRow: 2 });
  const theirs = await createTestShow({ rows: ['A'], seatsPerRow: 2 });
  try {
    // The owner can read it.
    const own = await call('GET', `/organiser/events/${mine.eventId}/summary`, {
      token: mine.organiser.token,
    });
    assert.equal(own.status, 200);
    assert.ok(own.body.totals);

    // A different organiser cannot.
    const other = await call('GET', `/organiser/events/${mine.eventId}/summary`, {
      token: theirs.organiser.token,
    });
    assert.equal(other.status, 404, 'another organiser\'s event must not be readable');
  } finally {
    await mine.cleanup();
    await theirs.cleanup();
  }
});
