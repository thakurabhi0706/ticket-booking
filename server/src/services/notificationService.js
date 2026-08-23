/**
 * notificationService.js — Who gets told about a booking, and over which channel.
 *
 * The booking routes accept a `customer` block straight from the checkout form, so the
 * address on a booking is whatever the buyer typed — not necessarily the address they
 * registered with. A confirmation sent only there can miss the account holder entirely.
 *
 * This module resolves recipients from the ACCOUNT first, then adds the checkout contact
 * as an extra recipient when it differs, and fans the message out over every configured
 * channel. Delivery itself stays in emailService / smsService; this decides the audience.
 */
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { sendEmail } from './emailService.js';
import { sendSms, smsEnabled } from './smsService.js';

/**
 * Load the registered contact details for an account.
 * Returns null rather than throwing: a notification must never break a booking that has
 * already been committed and paid for.
 */
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
 * Email addresses to notify, registered address first.
 *
 * De-duplicated case-insensitively, because CITEXT means "A@b.com" and "a@b.com" are the
 * same account and sending twice would just look broken to the customer.
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

/**
 * Phone numbers to notify, registered first. SMS costs money per message and a booking
 * confirmation is not worth sending twice, so only one number is used: the account's,
 * falling back to whatever checkout collected.
 */
export function resolvePhone(account, contactPhone) {
  const registered = (account?.phone || '').trim();
  if (registered) return { phone: registered, kind: 'registered' };
  const contact = (contactPhone || '').trim();
  if (contact) return { phone: contact, kind: 'contact' };
  return null;
}

/** Compact SMS body — one segment where possible, since carriers bill per 160 chars. */
function bookingSms({ name, reference, eventTitle, startsAt, venueName, seatCount }) {
  const when = new Date(startsAt).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
  return `Hi ${name}, your CineWave booking is confirmed. `
       + `${eventTitle} at ${venueName} on ${when}. `
       + `${seatCount} seat(s). Ref ${reference}. Show the QR from your email at the gate.`;
}

/**
 * Fan a confirmed booking out to every channel.
 *
 * Each channel is awaited independently: a failing SMS provider must not stop the email,
 * and neither may throw into the caller, which has already committed the booking.
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
        // A copy to the checkout address is labelled, so a customer who typed a second
        // address does not think they were charged twice.
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
