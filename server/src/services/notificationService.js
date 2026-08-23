/**
 * notificationService.js — Who gets told about a booking, over which channel.
 *
 * Checkout supplies whatever address the buyer typed, which need not be the one they
 * registered with, so recipients are resolved from the ACCOUNT first and the checkout
 * contact is added only when it differs. Delivery itself stays in email/smsService.
 */
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { sendEmail } from './emailService.js';
import { sendSms, smsEnabled } from './smsService.js';

/** Returns null rather than throwing: a notification must never break a paid booking. */
async function loadAccount(userId) {
  try {
    const { rows: [user] } = await pool.query(
      'SELECT name, email, phone FROM users WHERE id = $1', [userId]
    );
    return user || null;
  } catch (err) {
    console.error('[notify] Could not load account for', userId, '—', err.message);
    return null;
  }
}

const normalise = (email) => (email || '').trim().toLowerCase();

/**
 * Addresses to notify, registered first. De-duplicated case-insensitively: email is
 * CITEXT, so "A@b.com" and "a@b.com" are one account and must not be mailed twice.
 */
export function resolveEmailRecipients(account, contactEmail) {
  const seen = new Set();
  const out = [];

  for (const [email, kind] of [[account?.email, 'registered'], [contactEmail, 'contact']]) {
    const key = normalise(email);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ email: email.trim(), kind });
  }
  return out;
}

/** One number only — SMS is billed per message. Account's, else checkout's. */
export function resolvePhone(account, contactPhone) {
  const registered = (account?.phone || '').trim();
  if (registered) return { phone: registered, kind: 'registered' };
  const contact = (contactPhone || '').trim();
  if (contact) return { phone: contact, kind: 'contact' };
  return null;
}

/** Compact body — carriers bill per 160 chars. */
function bookingSms({ name, reference, eventTitle, startsAt, venueName, seatCount }) {
  const when = new Date(startsAt).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
  return `Hi ${name}, your CineWave booking is confirmed. `
       + `${eventTitle} at ${venueName} on ${when}. `
       + `${seatCount} seat(s). Ref ${reference}. Show the QR from your email at the gate.`;
}

/**
 * Fan out to every channel independently: a failing SMS must not stop the email, and
 * neither may throw into the caller, which has already committed the booking.
 */
export async function notifyBookingConfirmed({ userId, customer, booking }) {
  const account = await loadAccount(userId);
  const recipients = resolveEmailRecipients(account, customer.email);
  const name = account?.name || customer.name;

  for (const { email, kind } of recipients) {
    try {
      await sendEmail('BOOKING_CONFIRMED', {
        ...booking,
        to: email,
        name,
        // Labelled, so a second address does not read as a second charge.
        copyNotice: kind === 'contact'
          ? 'This is a copy sent to the contact address you entered at checkout.'
          : null,
      });
    } catch (err) {
      console.error(`[notify] Email to ${kind} address failed:`, err.message);
    }
  }

  if (config.SMS_ENABLED) {
    const target = resolvePhone(account, customer.phone);
    if (!target) {
      console.log('[notify] No phone number on file — SMS skipped for', booking.reference);
    } else {
      try {
        await sendSms(target.phone, bookingSms({ ...booking, name }));
      } catch (err) {
        console.error('[notify] SMS failed:', err.message);
      }
    }
  }

  return {
    emails: recipients.map(r => r.email),
    smsAttempted: config.SMS_ENABLED && smsEnabled(),
  };
}

/** Cancellations go to the same audience, email only — an SMS here is rarely wanted. */
export async function notifyBookingCancelled({ userId, customerEmail, customerName, reference }) {
  const account = await loadAccount(userId);
  const recipients = resolveEmailRecipients(account, customerEmail);

  for (const { email } of recipients) {
    try {
      await sendEmail('BOOKING_CANCELLED', {
        to: email,
        name: account?.name || customerName,
        reference,
      });
    } catch (err) {
      console.error('[notify] Cancellation email failed:', err.message);
    }
  }
}
