/**
 * reference.js — Booking reference and QR payload generation.
 * Uses node:crypto only — no external uuid dependency.
 */
import crypto from 'node:crypto';
import { config } from '../config.js';

export function generateReference() {
  return 'BKG-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

export function generateQrPayload(reference) {
  const sig = crypto
    .createHmac('sha256', config.TICKET_SIGNING_SECRET)
    .update(reference)
    .digest('hex')
    .slice(0, 16);
  return `${config.APP_URL}/verify/${reference}?s=${sig}`;
}

export function verifyQrSignature(reference, sig) {
  // Reject anything that isn't exactly 16 hex chars BEFORE decoding: Buffer.from()
  // silently drops non-hex bytes, which would make timingSafeEqual throw on a
  // length mismatch and surface as a 500 instead of an honest "invalid ticket".
  if (typeof sig !== 'string' || !/^[0-9a-f]{16}$/i.test(sig)) return false;

  const expected = crypto
    .createHmac('sha256', config.TICKET_SIGNING_SECRET)
    .update(reference)
    .digest('hex')
    .slice(0, 16);
  return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
}

export function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}
