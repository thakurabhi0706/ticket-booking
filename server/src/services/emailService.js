/**
 * emailService.js — Email delivery, dependency-free.
 *
 * Always called after the transaction commits: a provider outage must never roll back a
 * confirmed booking. Failures are retried once, then logged.
 */
import { config } from '../config.js';
import { pool } from '../db/pool.js';

const RESEND_URL = 'https://api.resend.com/emails';
const BREVO_URL  = 'https://api.brevo.com/v3/smtp/email';

function formatDate(d) {
  return new Date(d).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'full',
    timeStyle: 'short',
  });
}

function bookingConfirmedHtml({ name, reference, eventTitle, startsAt, venueName, seats, total, copyNotice }) {
  const seatList = seats.map(s => `<li><strong>${s.row_label}${s.seat_number}</strong> — ₹${s.price}</li>`).join('');
  return `
  <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;background:#f9fafb;padding:24px;border-radius:12px;">
    <div style="background:#111827;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0;">
      <h1 style="margin:0;font-size:20px;font-weight:700;">🎟 Booking Confirmed</h1>
      <p style="margin:4px 0 0;opacity:0.7;font-size:14px;">CineWave Tickets</p>
    </div>
    <div style="background:#fff;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none;">
      <p style="color:#374151;">Hi <strong>${name}</strong>,</p>
      <p style="color:#374151;">Your booking is confirmed. See you there!</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:8px 0;color:#6b7280;font-size:14px;">Reference</td><td style="padding:8px 0;font-weight:700;color:#111827;">${reference}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:14px;">Event</td><td style="padding:8px 0;color:#111827;">${eventTitle}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:14px;">Venue</td><td style="padding:8px 0;color:#111827;">${venueName}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:14px;">Date & Time</td><td style="padding:8px 0;color:#111827;">${formatDate(startsAt)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:14px;">Total</td><td style="padding:8px 0;font-weight:700;color:#111827;">₹${total}</td></tr>
      </table>
      <p style="color:#374151;font-size:14px;margin:0 0 8px;">Seats:</p>
      <ul style="color:#374151;font-size:14px;">${seatList}</ul>
      <p style="color:#6b7280;font-size:12px;margin-top:16px;">Your QR code is attached. Present it at the venue entrance.</p>
      ${copyNotice ? `<p style="color:#6b7280;font-size:12px;margin-top:8px;border-top:1px solid #e5e7eb;padding-top:8px;">${copyNotice}</p>` : ''}
    </div>
  </div>`;
}

function waitlistOfferHtml({ name, link, expiresAt, eventTitle, startsAt, venueName, seats }) {
  const seatList = seats.map(s => `${s.row_label}${s.seat_number}`).join(', ');
  const deadline = formatDate(expiresAt);
  return `
  <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;background:#f9fafb;padding:24px;border-radius:12px;">
    <div style="background:#78350f;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0;">
      <h1 style="margin:0;font-size:20px;font-weight:700;">⏳ Seats Available — Act Fast</h1>
      <p style="margin:4px 0 0;opacity:0.7;font-size:14px;">CineWave Tickets — Waitlist Offer</p>
    </div>
    <div style="background:#fff;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none;">
      <p style="color:#374151;">Hi <strong>${name}</strong>,</p>
      <p style="color:#374151;">Good news! A seat has opened up for <strong>${eventTitle}</strong> at ${venueName} (${formatDate(startsAt)}).</p>
      <p style="color:#374151;">You have been offered: <strong>${seatList}</strong></p>
      <div style="background:#fef3c7;border:1px solid #d97706;border-radius:8px;padding:12px 16px;margin:16px 0;">
        <p style="margin:0;color:#78350f;font-weight:600;">⚠️ Offer expires: ${deadline}</p>
        <p style="margin:4px 0 0;font-size:13px;color:#92400e;">If you don't claim by then, the seat will be offered to the next person in line.</p>
      </div>
      <a href="${link}" style="display:inline-block;background:#111827;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px;">Claim My Seat</a>
    </div>
  </div>`;
}

function bookingCancelledHtml({ name, reference }) {
  return `
  <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;background:#f9fafb;padding:24px;border-radius:12px;">
    <div style="background:#374151;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0;">
      <h1 style="margin:0;font-size:20px;font-weight:700;">Booking Cancelled</h1>
    </div>
    <div style="background:#fff;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none;">
      <p style="color:#374151;">Hi <strong>${name}</strong>,</p>
      <p style="color:#374151;">Your booking <strong>${reference}</strong> has been cancelled.</p>
      <p style="color:#6b7280;font-size:14px;">Refunds (if applicable) are processed within 5–7 business days.</p>
    </div>
  </div>`;
}

const templates = {
  BOOKING_CONFIRMED: { subject: (d) => `Your ticket — ${d.eventTitle} (${d.reference})`, html: bookingConfirmedHtml },
  WAITLIST_OFFER:    { subject: (d) => `Seat offer — ${d.eventTitle} (expires soon)`,       html: waitlistOfferHtml },
  BOOKING_CANCELLED: { subject: (d) => `Booking cancelled — ${d.reference}`,                html: bookingCancelledHtml },
};

/** Resend takes MAIL_FROM as `Name <a@b.c>`; Brevo wants the parts split. */
function parseFrom() {
  const raw = (config.MAIL_FROM || '').trim();
  const m = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m
    ? { name: m[1].replace(/^"|"$/g, '') || 'CineWave Tickets', email: m[2].trim() }
    : { name: 'CineWave Tickets', email: raw };
}

/** Normalises a non-2xx into an Error carrying the provider's own words. */
async function providerError(provider, res) {
  const text = await res.text();
  const e = new Error(`${provider} ${res.status}: ${text}`);
  e.status = res.status;
  e.providerBody = text;
  return e;
}

/**
 * Transport adapters, each resolving to { id }, so the delivery policy below is written
 * once and never learns which service carries the mail. `attachments` arrive in Resend's
 * shape; the Brevo adapter renames the fields on the way out.
 */
const providers = {
  async resend(to, subject, html, attachments) {
    const body = { from: config.MAIL_FROM, to: [to], subject, html };
    if (attachments.length) body.attachments = attachments;

    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await providerError('Resend', res);
    return res.json();
  },

  async brevo(to, subject, html, attachments) {
    const body = {
      sender: parseFrom(),
      to: [{ email: to }],
      subject,
      htmlContent: html,
    };
    if (attachments.length) {
      body.attachment = attachments.map(a => ({ name: a.filename, content: a.content }));
    }

    const res = await fetch(BREVO_URL, {
      method: 'POST',
      headers: {
        'api-key': config.BREVO_API_KEY,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await providerError('Brevo', res);

    // Brevo returns { messageId }; the rest of this module speaks `id`.
    const json = await res.json();
    return { id: json.messageId || json.messageIds?.[0] || null };
  },
};

function activeProvider() {
  const name = (config.MAIL_PROVIDER || 'resend').toLowerCase();
  if (!providers[name]) throw new Error(`Unknown MAIL_PROVIDER "${name}" (expected: resend, brevo)`);
  return name;
}

/** True when the API key is missing for whichever provider is selected. */
function isUnconfigured() {
  return activeProvider() === 'brevo' ? !config.BREVO_API_KEY : !config.RESEND_API_KEY;
}

function post(to, subject, html, attachments) {
  return providers[activeProvider()](to, subject, html, attachments);
}

/** Boot-time report: an unusable transport otherwise shows up only as missing tickets. */
export function reportMailConfig() {
  let provider;
  try {
    provider = activeProvider();
  } catch (err) {
    console.error(`[email] ✗ ${err.message} — no mail will be sent.`);
    return;
  }

  if (isUnconfigured()) {
    const key = provider === 'brevo' ? 'BREVO_API_KEY' : 'RESEND_API_KEY';
    console.warn(`[email] ⚠ MAIL_PROVIDER=${provider} but ${key} is empty — mail is logged, not sent.`);
    return;
  }

  const from = parseFrom();
  console.log(`[email] provider=${provider} from=${from.email}` +
    (config.MAIL_REDIRECT_TO ? ` (ALL mail redirected to ${config.MAIL_REDIRECT_TO})` : '') +
    (config.MAIL_FALLBACK_TO ? ` fallback=${config.MAIL_FALLBACK_TO}` : ''));

  if (provider === 'resend' && /@resend\.dev$/i.test(from.email)) {
    console.warn('[email] ⚠ Sending from the shared resend.dev address: Resend will only ' +
      'deliver to the account owner. Customers will NOT receive their tickets.');
  }
}

/**
 * Provider policy ("sender not verified yet"), not a fault in the booking flow — so it
 * triggers the fallback copy rather than a plain failure. Resend answers 403, Brevo 400.
 */
function isRecipientNotAllowed(err) {
  if (err.status !== 403 && err.status !== 400) return false;
  const body = (err.providerBody || '').toLowerCase();
  return body.includes('testing emails')
      || body.includes('verify a domain')
      || body.includes('own email address')
      || body.includes('sender not valid')
      || body.includes('unrecognised sender')
      || body.includes('unrecognized sender')
      || body.includes('sender you used')
      || body.includes('not_enough_credits');
}

async function deliver(to, subject, html, attachments = []) {
  if (isUnconfigured()) {
    console.log(`[email] ${activeProvider()} API key not set — would send to ${to}: ${subject}`);
    return { id: 'mock', to };
  }

  // Deliberate staging override: everything to one inbox. Empty = the real booker.
  if (config.MAIL_REDIRECT_TO) {
    const result = await post(config.MAIL_REDIRECT_TO, `[To: ${to}] ${subject}`, html, attachments);
    return { ...result, to: config.MAIL_REDIRECT_TO, redirected: true };
  }

  try {
    const result = await post(to, subject, html, attachments);
    return { ...result, to };
  } catch (err) {
    // Recipient refused: keep a copy reaching the operator rather than losing the mail.
    if (isRecipientNotAllowed(err) && config.MAIL_FALLBACK_TO && config.MAIL_FALLBACK_TO !== to) {
      console.warn(
        `[email] ${activeProvider()} refused ${to}: ${err.providerBody}\n` +
        `        Falling back to ${config.MAIL_FALLBACK_TO}. Until the sender is verified, ` +
        `customers cannot receive their own tickets.`
      );
      const result = await post(
        config.MAIL_FALLBACK_TO,
        `[Undeliverable to ${to}] ${subject}`,
        html,
        attachments
      );
      return { ...result, to: config.MAIL_FALLBACK_TO, fallback: true };
    }
    throw err;
  }
}

export async function sendEmail(template, data) {
  const t = templates[template];
  if (!t) throw new Error(`Unknown email template: ${template}`);

  const subject = t.subject(data);
  const html = t.html(data);
  const attachments = [];

  if (template === 'BOOKING_CONFIRMED' && data.qrPng) {
    attachments.push({
      filename: `${data.reference}.png`,
      content: data.qrPng.toString('base64'),
    });
  }

  let status = 'SENT', error = null, providerId = null;
  // What the provider actually accepted — differs from data.to on redirect/fallback.
  let deliveredTo = data.to;

  // Try once, then retry once after 2 s
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt > 0) await new Promise(r => setTimeout(r, 2000));
      const result = await deliver(data.to, subject, html, attachments);
      providerId = result.id;
      deliveredTo = result.to || data.to;
      status = result.fallback ? 'FALLBACK' : 'SENT';
      error = result.fallback ? `Provider refused ${data.to}; delivered to ${deliveredTo}` : null;
      break;
    } catch (err) {
      error = err.message;
      status = 'FAILED';
      if (attempt === 0) continue;
      console.error(`[email] Final failure for template=${template} to=${data.to}:`, err.message);
    }
  }

  // Audit log (best-effort — don't throw if logging fails)
  try {
    await pool.query(
      `INSERT INTO email_log (to_email, template, provider_id, status, error)
       VALUES ($1,$2,$3,$4,$5)`,
      [deliveredTo, template, providerId, status, error]
    );
  } catch { /* ignore audit log failures */ }
}

/** Exposed for tests/email.test.js: lets it assert each provider's wire format. */
export const __private = { providers, parseFrom, isRecipientNotAllowed, deliver, activeProvider };
