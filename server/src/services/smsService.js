/**
 * smsService.js — SMS delivery, dependency-free.
 *
 * Same shape as emailService: named provider adapters behind one `sendSms`, so the
 * caller never learns which carrier is in use. Every provider here speaks plain HTTPS —
 * no vendor SDK is pulled in.
 *
 * Providers:
 *   console  — default. Logs the message instead of sending. Lets the whole notification
 *              path be exercised (and tested) with no account and no spend.
 *   twilio   — global; Indian destinations additionally require DLT registration.
 *   msg91    — India-focused; needs a DLT-approved template id.
 *   fast2sms — India-only, no DLT for transactional route on some plans.
 */
import { config } from '../config.js';

const TWILIO_URL = (sid) => `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
const MSG91_URL = 'https://control.msg91.com/api/v5/flow/';
const FAST2SMS_URL = 'https://www.fast2sms.com/dev/bulkV2';

/**
 * Normalise to E.164, which every provider below expects.
 *
 * A bare 10-digit number is assumed to be in SMS_DEFAULT_COUNTRY_CODE — that is what
 * people actually type into a checkout form, and rejecting it would silently drop most
 * real numbers.
 */
export function toE164(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;

  const hadPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  if (hadPlus) return `+${digits}`;

  const cc = String(config.SMS_DEFAULT_COUNTRY_CODE || '').replace(/\D/g, '');
  // Already carries the country code (e.g. 919876543210 for +91).
  if (cc && digits.startsWith(cc) && digits.length > 10) return `+${digits}`;
  if (cc && digits.length === 10) return `+${cc}${digits}`;
  return `+${digits}`;
}

async function providerError(provider, res) {
  const text = await res.text();
  const e = new Error(`${provider} ${res.status}: ${text}`);
  e.status = res.status;
  e.providerBody = text;
  return e;
}

const providers = {
  async console(to, body) {
    console.log(`[sms] (console provider) → ${to}\n      ${body}`);
    return { id: 'console' };
  },

  async twilio(to, body) {
    // Twilio takes form-encoding, not JSON, and HTTP Basic auth.
    const params = new URLSearchParams({ To: to, From: config.TWILIO_FROM, Body: body });
    const auth = Buffer.from(`${config.TWILIO_ACCOUNT_SID}:${config.TWILIO_AUTH_TOKEN}`).toString('base64');

    const res = await fetch(TWILIO_URL(config.TWILIO_ACCOUNT_SID), {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    if (!res.ok) throw await providerError('Twilio', res);
    const json = await res.json();
    return { id: json.sid };
  },

  async msg91(to, body) {
    // MSG91 flows carry the text in a DLT-approved template; the body is passed as a
    // variable rather than as free text.
    const res = await fetch(MSG91_URL, {
      method: 'POST',
      headers: {
        authkey: config.MSG91_AUTH_KEY,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        template_id: config.MSG91_TEMPLATE_ID,
        short_url: '0',
        recipients: [{ mobiles: to.replace(/^\+/, ''), MESSAGE: body }],
      }),
    });
    if (!res.ok) throw await providerError('MSG91', res);
    const json = await res.json();
    if (json.type === 'error') {
      const e = new Error(`MSG91 error: ${json.message}`);
      e.providerBody = JSON.stringify(json);
      throw e;
    }
    return { id: json.request_id || null };
  },

  async fast2sms(to, body) {
    const res = await fetch(FAST2SMS_URL, {
      method: 'POST',
      headers: { authorization: config.FAST2SMS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        route: 'q',                                  // quick transactional route
        message: body,
        numbers: to.replace(/^\+91/, '').replace(/^\+/, ''),
        flash: 0,
      }),
    });
    if (!res.ok) throw await providerError('Fast2SMS', res);
    const json = await res.json();
    if (json.return === false) {
      const e = new Error(`Fast2SMS error: ${json.message}`);
      e.providerBody = JSON.stringify(json);
      throw e;
    }
    return { id: json.request_id || null };
  },
};

export function activeSmsProvider() {
  const name = (config.SMS_PROVIDER || 'console').toLowerCase();
  if (!providers[name]) {
    throw new Error(`Unknown SMS_PROVIDER "${name}" (expected: ${Object.keys(providers).join(', ')})`);
  }
  return name;
}

/** Whether the selected provider has the credentials it needs to actually send. */
export function smsEnabled() {
  switch (activeSmsProvider()) {
    case 'console':  return true;
    case 'twilio':   return Boolean(config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN && config.TWILIO_FROM);
    case 'msg91':    return Boolean(config.MSG91_AUTH_KEY && config.MSG91_TEMPLATE_ID);
    case 'fast2sms': return Boolean(config.FAST2SMS_API_KEY);
    default:         return false;
  }
}

/**
 * Send one SMS. Resolves to { id, to } or throws with the provider's own words.
 * Callers treat a failure as non-fatal — the booking is already confirmed.
 */
export async function sendSms(rawNumber, body) {
  const provider = activeSmsProvider();
  const to = toE164(rawNumber);

  if (!to) throw new Error(`Unusable phone number: "${rawNumber}"`);
  if (!smsEnabled()) {
    console.warn(`[sms] SMS_PROVIDER=${provider} is missing credentials — not sending to ${to}.`);
    return { id: 'unconfigured', to, skipped: true };
  }

  const result = await providers[provider](to, body);
  console.log(`[sms] sent via ${provider} to ${to} (id=${result.id})`);
  return { ...result, to };
}

/** Boot-time visibility, mirroring reportMailConfig(). */
export function reportSmsConfig() {
  if (!config.SMS_ENABLED) {
    console.log('[sms] disabled (SMS_ENABLED=false) — booking notifications go by email only.');
    return;
  }
  let provider;
  try {
    provider = activeSmsProvider();
  } catch (err) {
    console.error(`[sms] ✗ ${err.message} — no SMS will be sent.`);
    return;
  }
  if (provider === 'console') {
    console.warn('[sms] ⚠ SMS_PROVIDER=console — messages are logged, NOT delivered. ' +
      'Set a real provider (twilio, msg91, fast2sms) to reach customers.');
  } else if (!smsEnabled()) {
    console.warn(`[sms] ⚠ SMS_PROVIDER=${provider} is missing credentials — messages will be skipped.`);
  } else {
    console.log(`[sms] provider=${provider} default country code=+${config.SMS_DEFAULT_COUNTRY_CODE}`);
  }
}

export const __private = { providers, toE164 };
