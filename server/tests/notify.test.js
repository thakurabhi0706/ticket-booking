/**
 * notify.test.js — Recipient resolution and SMS transport.
 *
 * No server and no database: these are the pure decision functions plus stubbed `fetch`.
 * They cover the case that motivated the feature — a booking made with a checkout address
 * that differs from the address the customer registered with.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEmailRecipients, resolvePhone } from '../src/services/notificationService.js';
import { __private, toE164, sendSms, smsEnabled } from '../src/services/smsService.js';
import { config } from '../src/config.js';

const { providers } = __private;

const realFetch = globalThis.fetch;
let calls = [];

function stubFetch(status = 201, body = { sid: 'SM123' }) {
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options, body: options.body });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
}

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

describe('email recipient resolution', () => {
  const account = { name: 'Chetan', email: 'registered@gmail.com', phone: '9876543210' };

  test('registered address is notified even when checkout used a different one', () => {
    const out = resolveEmailRecipients(account, 'typed-at-checkout@college.edu');
    assert.deepEqual(out, [
      { email: 'registered@gmail.com', kind: 'registered' },
      { email: 'typed-at-checkout@college.edu', kind: 'contact' },
    ]);
  });

  test('registered address comes first, so the account holder is the primary recipient', () => {
    const out = resolveEmailRecipients(account, 'other@x.com');
    assert.equal(out[0].kind, 'registered');
  });

  test('no duplicate when the checkout address matches the account', () => {
    const out = resolveEmailRecipients(account, 'registered@gmail.com');
    assert.equal(out.length, 1);
  });

  test('de-duplication ignores case and surrounding space (email is CITEXT)', () => {
    const out = resolveEmailRecipients(account, '  REGISTERED@Gmail.COM  ');
    assert.equal(out.length, 1, 'same address in a different case must not be mailed twice');
  });

  test('falls back to the checkout address when the account could not be loaded', () => {
    const out = resolveEmailRecipients(null, 'guest@x.com');
    assert.deepEqual(out, [{ email: 'guest@x.com', kind: 'contact' }]);
  });

  test('an account with no checkout address still gets its own mail', () => {
    const out = resolveEmailRecipients(account, '');
    assert.deepEqual(out, [{ email: 'registered@gmail.com', kind: 'registered' }]);
  });

  test('returns nothing rather than inventing a recipient', () => {
    assert.deepEqual(resolveEmailRecipients(null, null), []);
  });
});

describe('phone resolution', () => {
  test('prefers the registered number', () => {
    assert.deepEqual(
      resolvePhone({ phone: '9876543210' }, '9000000000'),
      { phone: '9876543210', kind: 'registered' }
    );
  });

  test('falls back to the checkout number when the account has none', () => {
    assert.deepEqual(
      resolvePhone({ phone: null }, '9000000000'),
      { phone: '9000000000', kind: 'contact' }
    );
  });

  test('null when neither exists, so nothing is sent into the void', () => {
    assert.equal(resolvePhone({ phone: '  ' }, ''), null);
  });
});

describe('E.164 normalisation', () => {
  beforeEach(() => setConfig({ SMS_DEFAULT_COUNTRY_CODE: '91' }));

  const cases = [
    ['9876543210',       '+919876543210', 'bare 10-digit gets the default country code'],
    ['+919876543210',    '+919876543210', 'already E.164 is untouched'],
    ['919876543210',     '+919876543210', 'country code without + is recognised'],
    ['98765 43210',      '+919876543210', 'spaces stripped'],
    ['+1 (415) 555-0199', '+14155550199', 'a foreign number keeps its own code'],
  ];

  for (const [input, expected, label] of cases) {
    test(`${label}: "${input}" → ${expected}`, () => {
      assert.equal(toE164(input), expected);
    });
  }

  test('unusable input yields null instead of a malformed number', () => {
    assert.equal(toE164(''), null);
    assert.equal(toE164(null), null);
    assert.equal(toE164('abc'), null);
  });
});

describe('SMS transports', () => {
  test('twilio posts form-encoded with basic auth', async () => {
    setConfig({
      SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM: '+15550001111',
    });
    stubFetch(201, { sid: 'SMabc' });

    const res = await sendSms('9876543210', 'Booking confirmed');

    const { url, options, body } = calls[0];
    assert.match(url, /Accounts\/AC1\/Messages\.json$/);
    assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded');
    assert.equal(options.headers.Authorization, `Basic ${Buffer.from('AC1:tok').toString('base64')}`);

    const form = new URLSearchParams(body);
    assert.equal(form.get('To'), '+919876543210');
    assert.equal(form.get('From'), '+15550001111');
    assert.equal(form.get('Body'), 'Booking confirmed');
    assert.equal(res.id, 'SMabc');
  });

  test('msg91 sends the DLT template id and a plus-less number', async () => {
    setConfig({ SMS_PROVIDER: 'msg91', MSG91_AUTH_KEY: 'key', MSG91_TEMPLATE_ID: 'tpl_1' });
    stubFetch(200, { type: 'success', request_id: 'req1' });

    await sendSms('+919876543210', 'hi');

    const sent = JSON.parse(calls[0].body);
    assert.equal(calls[0].options.headers.authkey, 'key');
    assert.equal(sent.template_id, 'tpl_1');
    assert.equal(sent.recipients[0].mobiles, '919876543210');
  });

  test('msg91 reports an application-level error even on HTTP 200', async () => {
    setConfig({ SMS_PROVIDER: 'msg91', MSG91_AUTH_KEY: 'k', MSG91_TEMPLATE_ID: 't' });
    stubFetch(200, { type: 'error', message: 'invalid template' });
    await assert.rejects(() => sendSms('9876543210', 'hi'), /invalid template/);
  });

  test('fast2sms strips the +91 prefix it does not accept', async () => {
    setConfig({ SMS_PROVIDER: 'fast2sms', FAST2SMS_API_KEY: 'k' });
    stubFetch(200, { return: true, request_id: 'r1' });

    await sendSms('9876543210', 'hi');

    const sent = JSON.parse(calls[0].body);
    assert.equal(sent.numbers, '9876543210');
  });

  test('missing credentials skip the send instead of throwing at a paid booking', async () => {
    setConfig({ SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', TWILIO_FROM: '' });
    stubFetch();
    const res = await sendSms('9876543210', 'hi');
    assert.equal(res.skipped, true);
    assert.equal(calls.length, 0, 'no network call without credentials');
  });

  test('an unusable number is rejected before any provider is called', async () => {
    setConfig({ SMS_PROVIDER: 'console' });
    await assert.rejects(() => sendSms('', 'hi'), /Unusable phone number/);
  });

  test('the console provider is always considered enabled', () => {
    setConfig({ SMS_PROVIDER: 'console' });
    assert.equal(smsEnabled(), true);
  });

  test('an unknown provider name is a loud error, not a silent no-op', () => {
    setConfig({ SMS_PROVIDER: 'pigeon' });
    assert.throws(() => smsEnabled(), /Unknown SMS_PROVIDER/);
  });

  test('every provider is reachable by name', () => {
    assert.deepEqual(Object.keys(providers).sort(), ['console', 'fast2sms', 'msg91', 'twilio']);
  });
});
