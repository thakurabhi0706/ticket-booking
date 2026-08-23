/**
 * email.test.js — Transport-layer tests for the mail providers.
 *
 * Unlike the other suites these need no running server and no database: `fetch` is
 * stubbed, so each test asserts on the exact request that would go out. That is the part
 * worth pinning down, because a wrong field name reaches you as "the ticket never
 * arrived" hours later rather than as an error.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { __private } from '../src/services/emailService.js';
import { config } from '../src/config.js';

const { providers, parseFrom, isRecipientNotAllowed, deliver } = __private;

const realFetch = globalThis.fetch;
let calls = [];

/** Stub fetch, recording every request and replying with a canned response. */
function stubFetch(status = 200, body = { id: 'msg_1', messageId: 'brevo_1' }) {
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  };
}

// The transport reads config at call time, so save and restore what each test changes.
const saved = {};
const setConfig = (patch) => {
  for (const k of Object.keys(patch)) {
    if (!(k in saved)) saved[k] = config[k];
    config[k] = patch[k];
  }
};

beforeEach(() => { calls = []; });
afterEach(() => {
  globalThis.fetch = realFetch;
  Object.assign(config, saved);
});

describe('MAIL_FROM parsing', () => {
  test('splits "Name <addr>" into the fields Brevo requires', () => {
    setConfig({ MAIL_FROM: 'CineWave Tickets <tickets@example.com>' });
    assert.deepEqual(parseFrom(), { name: 'CineWave Tickets', email: 'tickets@example.com' });
  });

  test('accepts a bare address', () => {
    setConfig({ MAIL_FROM: 'tickets@example.com' });
    assert.deepEqual(parseFrom(), { name: 'CineWave Tickets', email: 'tickets@example.com' });
  });
});

describe('Brevo adapter', () => {
  test('posts the documented v3 payload, with the API key in the api-key header', async () => {
    setConfig({ MAIL_FROM: 'CineWave Tickets <me@gmail.com>', BREVO_API_KEY: 'xkeysib-test' });
    stubFetch(201, { messageId: 'brevo_abc' });

    const res = await providers.brevo(
      'customer@example.com', 'Your ticket', '<p>hi</p>',
      [{ filename: 'BKG-1.png', content: 'BASE64DATA' }]
    );

    assert.equal(calls.length, 1);
    const { url, options, body } = calls[0];

    assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(options.headers['api-key'], 'xkeysib-test');
    assert.deepEqual(body.sender, { name: 'CineWave Tickets', email: 'me@gmail.com' });
    assert.deepEqual(body.to, [{ email: 'customer@example.com' }]);
    assert.equal(body.subject, 'Your ticket');
    assert.equal(body.htmlContent, '<p>hi</p>');
    // Brevo names these differently from Resend — the adapter must translate.
    assert.deepEqual(body.attachment, [{ name: 'BKG-1.png', content: 'BASE64DATA' }]);
    assert.equal(body.html, undefined, 'must not send Resend field names');

    assert.equal(res.id, 'brevo_abc', 'messageId is normalised to id');
  });

  test('omits the attachment key entirely when there is nothing to attach', async () => {
    setConfig({ MAIL_FROM: 'a@b.com', BREVO_API_KEY: 'k' });
    stubFetch(201, { messageId: 'x' });
    await providers.brevo('c@d.com', 's', '<p>h</p>', []);
    assert.ok(!('attachment' in calls[0].body));
  });

  test('surfaces the provider body on an error status', async () => {
    setConfig({ MAIL_FROM: 'a@b.com', BREVO_API_KEY: 'k' });
    stubFetch(400, { code: 'invalid_parameter', message: 'sender not valid' });
    await assert.rejects(
      () => providers.brevo('c@d.com', 's', '<p>h</p>', []),
      (err) => err.status === 400 && err.providerBody.includes('sender not valid')
    );
  });
});

describe('Resend adapter', () => {
  test('keeps its own field names', async () => {
    setConfig({ MAIL_FROM: 'CineWave <a@b.com>', RESEND_API_KEY: 're_test' });
    stubFetch(200, { id: 'resend_1' });

    await providers.resend('c@d.com', 'subj', '<p>h</p>', [{ filename: 'f.png', content: 'B64' }]);

    const { options, body } = calls[0];
    assert.equal(options.headers.Authorization, 'Bearer re_test');
    assert.equal(body.from, 'CineWave <a@b.com>');
    assert.deepEqual(body.to, ['c@d.com']);
    assert.equal(body.html, '<p>h</p>');
    assert.deepEqual(body.attachments, [{ filename: 'f.png', content: 'B64' }]);
  });
});

describe('recipient-refused detection', () => {
  const cases = [
    [403, 'You can only send testing emails to your own email address', true,  'Resend unverified domain'],
    [403, 'please verify a domain at resend.com/domains',               true,  'Resend verify-domain wording'],
    [400, 'sender not valid',                                           true,  'Brevo unverified sender'],
    [403, 'Some unrelated permission problem',                          false, 'other 403s are real failures'],
    [500, 'You can only send testing emails',                           false, 'server errors are not policy'],
    [422, 'Invalid `to` field',                                         false, 'validation errors are not policy'],
  ];

  for (const [status, body, expected, label] of cases) {
    test(`${label} → ${expected}`, () => {
      assert.equal(isRecipientNotAllowed({ status, providerBody: body }), expected);
    });
  }
});

describe('delivery policy', () => {
  test('sends to the actual booker when nothing is overridden', async () => {
    setConfig({
      MAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'k', MAIL_FROM: 'a@b.com',
      MAIL_REDIRECT_TO: '', MAIL_FALLBACK_TO: 'ops@example.com',
    });
    stubFetch(201, { messageId: 'ok' });

    const res = await deliver('booker@example.com', 'Your ticket', '<p>h</p>');

    assert.equal(res.to, 'booker@example.com');
    assert.ok(!res.fallback);
    assert.deepEqual(calls[0].body.to, [{ email: 'booker@example.com' }]);
  });

  test('a refused recipient falls back to the operator, tagged and flagged', async () => {
    setConfig({
      MAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'k', MAIL_FROM: 'a@b.com',
      MAIL_REDIRECT_TO: '', MAIL_FALLBACK_TO: 'ops@example.com',
    });

    // First call refuses the customer; the retry to the fallback address succeeds.
    let n = 0;
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      n += 1;
      return n === 1
        ? { ok: false, status: 400, text: async () => 'sender not valid', json: async () => ({}) }
        : { ok: true, status: 201, json: async () => ({ messageId: 'fb' }), text: async () => '' };
    };

    const res = await deliver('customer@example.com', 'Your ticket', '<p>h</p>');

    assert.equal(res.to, 'ops@example.com');
    assert.equal(res.fallback, true);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].body.to, [{ email: 'ops@example.com' }]);
    assert.match(calls[1].body.subject, /^\[Undeliverable to customer@example\.com\]/);
  });

  test('MAIL_REDIRECT_TO overrides every recipient', async () => {
    setConfig({
      MAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'k', MAIL_FROM: 'a@b.com',
      MAIL_REDIRECT_TO: 'staging@example.com', MAIL_FALLBACK_TO: '',
    });
    stubFetch(201, { messageId: 'ok' });

    const res = await deliver('customer@example.com', 'Your ticket', '<p>h</p>');

    assert.equal(res.to, 'staging@example.com');
    assert.equal(res.redirected, true);
    assert.match(calls[0].body.subject, /^\[To: customer@example\.com\]/);
  });

  test('an unset API key logs instead of throwing, so a booking never fails on mail', async () => {
    setConfig({ MAIL_PROVIDER: 'brevo', BREVO_API_KEY: '', MAIL_REDIRECT_TO: '' });
    stubFetch(201);
    const res = await deliver('customer@example.com', 'Your ticket', '<p>h</p>');
    assert.equal(res.id, 'mock');
    assert.equal(calls.length, 0, 'no network call without a key');
  });
});
