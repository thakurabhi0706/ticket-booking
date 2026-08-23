/**
 * config.js — Environment parsing with validation and defaults.
 * All env variables are consumed ONLY from here; nothing else reads process.env directly.
 */
import 'dotenv/config';

function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env variable: ${key}`);
  return val;
}

function optional(key, fallback) {
  return process.env[key] ?? fallback;
}

function num(key, fallback) {
  const val = process.env[key];
  return val !== undefined ? Number(val) : fallback;
}

export const config = {
  NODE_ENV: optional('NODE_ENV', 'development'),
  PORT: num('PORT', 4000),
  APP_URL: optional('APP_URL', 'http://localhost:5173'),

  DATABASE_URL: required('DATABASE_URL'),
  DB_POOL_MAX: num('DB_POOL_MAX', 40),
  DB_CONNECT_TIMEOUT_MS: num('DB_CONNECT_TIMEOUT_MS', 15000),

  JWT_SECRET: required('JWT_SECRET'),
  JWT_EXPIRES_IN: optional('JWT_EXPIRES_IN', '7d'),
  BCRYPT_ROUNDS: num('BCRYPT_ROUNDS', 10),
  AUTH_RATE_LIMIT_PER_MIN: num('AUTH_RATE_LIMIT_PER_MIN', 20),

  SEAT_HOLD_TTL_SECONDS: num('SEAT_HOLD_TTL_SECONDS', 600),
  MAX_SEATS_PER_BOOKING: num('MAX_SEATS_PER_BOOKING', 6),

  WAITLIST_OFFER_TTL_SECONDS: num('WAITLIST_OFFER_TTL_SECONDS', 900),
  WAITLIST_MAX_SEATS: num('WAITLIST_MAX_SEATS', 6),

  SWEEPER_INTERVAL_MS: num('SWEEPER_INTERVAL_MS', 15000),
  SWEEP_LOCK_KEY: num('SWEEP_LOCK_KEY', 845213),

  CANCELLATION_CUTOFF_MINUTES: num('CANCELLATION_CUTOFF_MINUTES', 60),

  MAIL_PROVIDER: optional('MAIL_PROVIDER', 'resend'),   // 'resend' | 'brevo'
  RESEND_API_KEY: optional('RESEND_API_KEY', ''),
  BREVO_API_KEY: optional('BREVO_API_KEY', ''),
  MAIL_FROM: optional('MAIL_FROM', 'CineWave Tickets <onboarding@resend.dev>'),
  MAIL_REDIRECT_TO: optional('MAIL_REDIRECT_TO', ''),
  MAIL_FALLBACK_TO: optional('MAIL_FALLBACK_TO', ''),

  // ---- SMS ----
  SMS_ENABLED: optional('SMS_ENABLED', 'false') === 'true',
  SMS_PROVIDER: optional('SMS_PROVIDER', 'console'),   // console | twilio | msg91 | fast2sms
  SMS_DEFAULT_COUNTRY_CODE: optional('SMS_DEFAULT_COUNTRY_CODE', '91'),
  TWILIO_ACCOUNT_SID: optional('TWILIO_ACCOUNT_SID', ''),
  TWILIO_AUTH_TOKEN: optional('TWILIO_AUTH_TOKEN', ''),
  TWILIO_FROM: optional('TWILIO_FROM', ''),
  MSG91_AUTH_KEY: optional('MSG91_AUTH_KEY', ''),
  MSG91_TEMPLATE_ID: optional('MSG91_TEMPLATE_ID', ''),
  FAST2SMS_API_KEY: optional('FAST2SMS_API_KEY', ''),

  TICKET_SIGNING_SECRET: required('TICKET_SIGNING_SECRET'),

  ADMIN_EMAIL: optional('ADMIN_EMAIL', 'admin@ticketing.dev'),
  ADMIN_PASSWORD: optional('ADMIN_PASSWORD', 'Admin@12345'),
};
