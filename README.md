# CineWave — Ticket Booking System

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)]()
[![Stack](https://img.shields.io/badge/Stack-Node.js%20|%20Postgres%20|%20React-informational)]()

> A full-stack movie & concert ticket booking system with visual real-time seat maps, atomic concurrency control, configurable seat hold TTLs, and automated waitlist queue management with time-limited tokenised offers.

---

## 1. Demo Credentials

| Role | Email | Password | Access / Scope |
|---|---|---|---|
| **Admin** | `admin@ticketing.dev` | `Admin@12345` | Everything an organiser can do on **every** event, plus venue management, seat category setup and bulk grid generation |
| **Organiser** | `organiser@ticketing.dev` | `Organiser@123` | Event creation, show scheduling, revenue dashboard |
| **Customer 1** | `alice@example.com` | `Customer@123` | Seat selection, holds, checkout, bookings history |
| **Customer 2** | `bob@example.com` | `Customer@123` | Multi-user seat map testing & concurrency |
| **Customer 3** | `carol@example.com` | `Customer@123` | Waitlist queueing & token offer claim demo |

---

## 2. Screenshots

Below are the key UI views of CineWave:
- **Event Discovery & Filters**: Filter by event type (Movie/Concert), city, date range, or title search.
- **Real-Time Visual Seat Map**: Color-coded category tiers, stage orientation, seat hold indicators, selection tray.
- **Checkout & Countdown Bar**: Server-authoritative timer, customer details form, explicit hold release on exit.
- **Booking Confirmation & QR Code**: Scannable HMAC-signed ticket QR code with email notification delivery.
- **Waitlist Offer Claim Page**: Live countdown timer for tokenised time-limited seat offers.
- **Organiser Revenue Dashboard**: Ticket sales, gross revenue, cancellation metrics, category occupancy bars.

---

## 3. Features & Requirement Traceability Matrix

| # | Requirement | Implementation | Status |
|---|---|---|---|
| **S1** | Event selection, seat selection, customer details | React booking flow (`/events/:id`, `/shows/:id`, `/checkout/:id`) | ✅ |
| **S2** | Confirmed booking, QR ticket email, waitlist auto-promotion | `services/bookingService.js`, `services/emailService.js`, `services/waitlistService.js` | ✅ |
| **S3** | Admin venue & layout management | `routes/admin.js`, `/admin` route | ✅ |
| **S4** | Admin platform-wide event administration (create for any organiser, schedule shows, revenue reports) | `routes/organiser.js` (`scopeId`), `/organiser` route | ✅ |
| **S5** | Booking notification to the customer's registered email and phone | `services/notificationService.js`, `services/smsService.js` | ✅ |
| **S4** | Organiser event & show creation with per-category pricing | `routes/organiser.js`, `/organiser` dashboard | ✅ |
| **S5** | Customer browse and multi-filter events | `routes/events.js`, `Home.jsx` | ✅ |
| **S6** | Visual seat map with real-time status (AVAILABLE/HELD/OFFERED/BOOKED) | `SeatMap.jsx`, `realtime/sse.js`, `useShowStream.js` | ✅ |
| **S7** | Configurable seat hold TTL | `SEAT_HOLD_TTL_SECONDS` in `.env`, `services/seatService.js` | ✅ |
| **S8** | Abandoned checkout auto-release & SSE broadcast | `worker/sweeper.js`, `navigator.sendBeacon` handler | ✅ |
| **S9** | Atomic concurrency protection against double-booking | `SELECT ... FOR UPDATE`, atomic UPDATE, `uq_active_booking_seat` | ✅ |
| **S10** | QR code generation with HMAC verification signature | `services/qrService.js`, `routes/bookings.js` (`/verify/:reference`) | ✅ |
| **S11** | Sold-out category waitlist queueing | `services/waitlistService.js`, `POST /api/shows/:id/waitlist` | ✅ |
| **S12** | Booking cancellation & time-limited offer token dispatch | `cancelBooking()`, `promoteWaitlist()`, `waitlist_offers` | ✅ |
| **S13** | Unclaimed offer expiration & auto-promotion to next in line | `expireOffers()` in `worker/sweeper.js` | ✅ |
| **S14** | Customer booking history & cancellation | `MyBookings.jsx`, `POST /api/bookings/:id/cancel` | ✅ |
| **S15** | Organiser revenue summary & occupancy metrics | `GET /api/organiser/events/:id/summary` | ✅ |

---

## 4. Tech Stack & Minimal Dependency Policy

### Production Dependencies Justification

#### Backend (`server/package.json`) — Total: 7 dependencies
| Package | Justification |
|---|---|
| `express` | Lightweight Web API framework |
| `pg` | PostgreSQL driver supporting raw SQL, transactions & connection pooling |
| `jsonwebtoken` | Stateless JWT authentication for RBAC middleware |
| `bcryptjs` | Safe password hashing (cost factor 10) |
| `qrcode` | Server-side QR PNG buffer generation for email attachments |
| `dotenv` | Environment configuration loader |
| `cors` | Cross-Origin Resource Sharing handling for React frontend |

*Deliberately Avoided*: `socket.io` (used native Server-Sent Events), `uuid` (used native `node:crypto`), `node-cron` (used native `setInterval` + Postgres advisory locks), `nodemailer` (used Resend API via native `fetch`), ORMs (used raw SQL to show explicit locking queries).

#### Frontend (`client/package.json`) — Total: 3 production dependencies
| Package | Justification |
|---|---|
| `react` | UI view component rendering |
| `react-dom` | DOM rendering layer |
| `react-router-dom` | SPA client-side routing & protection |

---

## 5. System Architecture

```
┌─────────────────────────┐           ┌─────────────────────────────────────────┐
│   React SPA (Vite)      │           │        Express API (Node.js 20)          │
│   Vercel                │           │                                         │
│                         │   REST    │   routes/       → controllers/          │
│   - Auth pages          │◄─────────►│                 → services/             │
│   - Event search        │           │                 → db (pg Pool)          │
│   - Seat map (Grid) ────┼───────────┤   GET /api/shows/:id/stream (SSE)       │
│   - Countdown checkout  │   SSE     │                                         │
│   - Organiser summary   │◄──────────┤   worker/sweeper.js (setInterval)       │
│   - Waitlist claim      │           │     ├─ expireHolds()                    │
│                         │           │     ├─ expireOffers()                   │
└─────────────────────────┘           │     └─ promoteWaitlist()                │
                                      └────────────────────┬────────────────────┘
                                                           │
                                           ┌───────────────┴───────────────┐
                                           │   PostgreSQL Database         │
                                           │   Row locks + partial unique   │
                                           │   indexes + TIMESTAMPTZ       │
                                           └───────────────────────────────┘
                                                           │
                                                   ┌───────┴───────┐
                                                   │ Resend Email  │
                                                   │ (QR PNG)      │
                                                   └───────────────┘
```

---

## 6. Setup & Installation Guide

### Prerequisites
- Node.js >= 20.0.0
- PostgreSQL 15+ (Local or Neon PostgreSQL pooled connection)

### Local Environment Setup

1. **Clone repository**:
   ```bash
   git clone https://github.com/<you>/ticket-booking-system.git
   cd ticket-booking-system
   ```

2. **Configure Server**:
   ```bash
   cd server
   npm install
   cp .env.example .env
   ```
   *Edit `server/.env` to supply your `DATABASE_URL` and secrets.*

3. **Database Migration & Seeding**:
   ```bash
   npm run migrate
   npm run seed
   ```

4. **Start Backend Server**:
   ```bash
   npm run dev
   # Server runs at http://localhost:4000
   ```

5. **Configure & Start Frontend**:
   ```bash
   cd ../client
   npm install
   printf 'VITE_API_URL=http://localhost:4000/api\n' > .env
   npm run dev
   # App runs at http://localhost:5173
   ```

---

## 7. Environment Variables (`.env.example`)

```dotenv
# Server
NODE_ENV=development
PORT=4000
APP_URL=http://localhost:5173

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/ticketing?sslmode=require
DB_POOL_MAX=40                     # pg pool size; needs headroom for burst seat holds
DB_CONNECT_TIMEOUT_MS=15000

# Auth
JWT_SECRET=replace-with-a-long-random-string-min-32-chars
JWT_EXPIRES_IN=7d
BCRYPT_ROUNDS=10
AUTH_RATE_LIMIT_PER_MIN=20         # requests/min/IP on /auth/*

# Seat Hold & Waitlist Policy
SEAT_HOLD_TTL_SECONDS=600
MAX_SEATS_PER_BOOKING=6
WAITLIST_OFFER_TTL_SECONDS=900
WAITLIST_MAX_SEATS=6

# Scheduler
SWEEPER_INTERVAL_MS=15000
SWEEP_LOCK_KEY=845213

# Booking & Mail
CANCELLATION_CUTOFF_MINUTES=60
RESEND_API_KEY=re_xxxxxxxxxxxxxxxx
MAIL_PROVIDER=brevo        # 'brevo' (verified sender) or 'resend' (verified domain)
BREVO_API_KEY=xkeysib-xxxxxxxxxxxx
MAIL_FROM=CineWave Tickets <verified-sender@example.com>
MAIL_REDIRECT_TO=          # empty = mail goes to the actual booker
MAIL_FALLBACK_TO=          # only used if the provider refuses the real recipient
TICKET_SIGNING_SECRET=another-long-random-string-min-32-chars

# Admin Seed
ADMIN_EMAIL=admin@ticketing.dev
ADMIN_PASSWORD=Admin@12345
```

The frontend takes a single variable in `client/.env`:

```dotenv
VITE_API_URL=http://localhost:4000/api
```

**Where confirmation mail goes.** By default (`MAIL_REDIRECT_TO` empty) each booking
confirmation is sent to the address on the booking.

### Choosing a mail transport

Two transports ship, both plain HTTPS with no extra dependencies, selected by
`MAIL_PROVIDER`:

| Provider | Free tier | What it needs before it will mail your customers |
| --- | --- | --- |
| `brevo` | 300/day | **One verified sender address** — a personal Gmail is fine. No domain required. |
| `resend` | 3 000/mo | **A fully verified domain**, with `MAIL_FROM` on that domain. |

Until the sender is verified, a provider refuses every recipient except the account
owner. That refusal is detected and the message is re-sent to `MAIL_FALLBACK_TO` with an
`[Undeliverable to …]` subject and logged as `FALLBACK`, so a booking is never silently
mail-less — but the customer does not get their ticket.

**Setting up Brevo (no domain needed):**

1. Create a free account at [brevo.com](https://www.brevo.com).
2. **Senders, Domains & IPs → Senders → Add a sender** — use your own email address and
   click the confirmation link it sends you.
3. **SMTP & API → API Keys → Generate** — the key starts with `xkeysib-`.
4. In `server/.env`:
   ```dotenv
   MAIL_PROVIDER=brevo
   BREVO_API_KEY=xkeysib-…
   MAIL_FROM=CineWave Tickets <the-address-you-verified@gmail.com>
   ```
5. Restart the API. It prints its mail configuration at boot and warns loudly if the
   selected provider has no key or is using an address that cannot reach customers.

| Setting | Effect |
| --- | --- |
| `MAIL_REDIRECT_TO=x@y.com` | Forces *every* message to that one inbox, subject prefixed `[To: original@…]`. Staging only. |
| `MAIL_FALLBACK_TO=x@y.com` | Normal delivery, but a refused recipient is re-sent here as `[Undeliverable to original@…]`, logged `FALLBACK`. |

Transport behaviour is covered by `tests/email.test.js`, which stubs `fetch` and asserts
the exact payload each provider receives — no key, network or database needed.

### Booking notifications

Every confirmed booking notifies the customer on the contact details held against their
**account**, not merely whatever was typed at checkout:

| Channel | Who receives it |
| --- | --- |
| Email | The **registered** account address, always. If the checkout form carried a different address, a labelled copy goes there too. Duplicates are collapsed case-insensitively. |
| SMS | Optional (`SMS_ENABLED=true`). The registered phone number, falling back to the checkout number. Sent once — SMS is billed per message. |

Cancellations follow the same email audience. Both run after the transaction commits, and
a channel failure is logged without affecting the booking.

**Enabling SMS.** Four transports ship, all plain HTTPS with no new dependencies:

| `SMS_PROVIDER` | Notes |
| --- | --- |
| `console` | Default. Logs the message instead of sending — exercises the whole path with no account or spend. |
| `twilio` | Global. Indian destinations additionally require DLT registration. |
| `msg91` | India-focused; needs a DLT-approved `MSG91_TEMPLATE_ID`. |
| `fast2sms` | India-only. |

```dotenv
SMS_ENABLED=true
SMS_PROVIDER=twilio
SMS_DEFAULT_COUNTRY_CODE=91     # applied to bare 10-digit numbers
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxx
TWILIO_FROM=+15550001111
```

Numbers are normalised to E.164 before sending, so a customer typing `98765 43210`
becomes `+919876543210`. The API reports its SMS configuration at boot and warns when the
selected provider cannot actually deliver.

**Demo tip:** set `SEAT_HOLD_TTL_SECONDS=60` and `WAITLIST_OFFER_TTL_SECONDS=120` when
demonstrating, so hold expiry and offer roll-over are visible in under two minutes
instead of ten. Production defaults are 600 / 900.

---

## 8. Documentation Links
- **Full API Documentation**: See [`docs/api.md`](docs/api.md)
- **Database Schema & ER Diagram**: See [`docs/schema.md`](docs/schema.md)
- **System Design Write-Up (800 words max)**: See [`DESIGN.md`](DESIGN.md)

---

## 9. Seat Hold & TTL Mechanism

- **Authoritative Database Predicate**: `hold_expires_at TIMESTAMPTZ`. Queries checking availability test `status = 'AVAILABLE' OR (status = 'HELD' AND hold_expires_at <= now())`.
- **In-Process Sweeper**: `worker/sweeper.js` executes every `SWEEPER_INTERVAL_MS`, guarded by a
  **transaction-scoped** Postgres advisory lock (`pg_try_advisory_xact_lock(SWEEP_LOCK_KEY)`) so only
  one instance sweeps even when the host scales out. It materialises expired holds to `AVAILABLE`,
  expires lapsed waitlist offers, and broadcasts SSE updates.
  *Why the `xact` variant:* hosted Postgres (Neon, Supabase, PgBouncer) fronts the database with a
  **transaction-mode pooler**, where consecutive statements may land on different backends. A
  session-level `pg_advisory_lock()` would unlock on the wrong backend, leak permanently, and
  silently disable the sweeper from then on. A transaction-scoped lock is released by the
  `COMMIT`/`ROLLBACK` itself and cannot leak.
- **Client Countdown**: `useCountdown` hook derives formatted remaining time from server-authoritative `expiresAt`.
- **Explicit Release**: Navigating away or closing the checkout tab fires `navigator.sendBeacon('/api/holds/:groupId')`.

---

## 10. Concurrency Prevention

Double-booking is eliminated through single atomic conditional updates with row locking:

```sql
BEGIN;
SELECT id FROM show_seats WHERE show_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE;

UPDATE show_seats
   SET status = 'HELD', held_by = $3, hold_group_id = $4,
       hold_expires_at = now() + make_interval(secs => $5)
 WHERE show_id = $1 AND id = ANY($2::uuid[])
   AND (status = 'AVAILABLE' OR (status = 'HELD' AND hold_expires_at <= now()))
RETURNING id;
COMMIT;
```

A hard database unique index constraint `CREATE UNIQUE INDEX uq_active_booking_seat ON booking_seats (show_seat_id)` guarantees that a seat can never be double-booked even under edge cases.

### Concurrency Test Verification
With the API running, `cd server && npm test` fires 20 simultaneous hold requests at a
single seat. Actual output:

```
  → 1 × 201, 19 × 409  [201 409 409 409 409 409 409 409 409 409 409 409 409 409 409 409 409 409 409 409]

ok 9 - 20 concurrent holds on the same seat → exactly 1 × 201 and 19 × 409
ok 10 - overlapping multi-seat holds are all-or-nothing — the loser holds nothing
ok 11 - uq_active_booking_seat makes a double booking impossible at the DB level
...
# tests 20
# pass 20
# fail 0
```

Test 10 is the subtler property: when A requests seats `[1,2,3]` and B requests `[3,4,5]`
at the same instant, exactly one succeeds **fully** and the other holds *nothing* — seats
4 and 5 are verified still `AVAILABLE`, proving the losing transaction rolled back cleanly
rather than leaving a partial hold.

---

## 11. Automated Waitlist Queue & Tokenised Offers

1. **Sold-Out Gate**: Waitlist registration (`POST /api/shows/:id/waitlist`) is rejected with `409 NOT_SOLD_OUT` unless the category has zero claimable seats.
2. **FIFO Queue**: Entries are ordered by `position` (`BIGSERIAL`).
3. **Cancellation Promotion**: Cancelling a booking invokes `promoteWaitlist()` inside the same transaction. The head entry is locked using `FOR UPDATE SKIP LOCKED`.
4. **Reserved Offer Status**: Offered seats transition to `OFFERED` status (reserved) rather than `AVAILABLE`, protecting them from sniping by general users.
5. **Tokenised Security**: Random 256-bit token is emailed to the user; only its `sha256` hash is stored in `waitlist_offers`.
6. **Expiry & Re-Promotion**: Expired offers automatically transition seats back to `AVAILABLE` and trigger `promoteWaitlist()` for the next user in line.

---

## 12. Real-Time Updates (SSE)

- Native Server-Sent Events endpoint `GET /api/shows/:id/stream` provides immediate seat state sync across concurrent user sessions.
- Transmits `seat_update` deltas and `show_soldout` alerts.
- Automatic reconnect handler in `useShowStream` hook triggers full seat map resynchronization and maintains a 20-second polling fallback.

---

## 13. QR Code Ticket Verification & Email

- **Payload Signature**: QR codes encode `${APP_URL}/verify/${reference}?s=${sig}` where `sig` is an HMAC-SHA256 hash signed with `TICKET_SIGNING_SECRET`.
- **Scan Verification**: `GET /api/bookings/verify/:reference` verifies the signature and returns ticket validity for venue ticket checkers.
- **Email Reliability**: Email delivery via Resend API is executed post-commit via `setImmediate()` with retry fallback and logging in `email_log`.

---

## 14. Testing

The suite drives the **running API over HTTP**, so start the server first (in a second
terminal), then run the tests against the same database:

```bash
cd server
npm start          # terminal 1 — must be running
npm test           # terminal 2
```

Tests use Node's built-in `node:test` runner and `node:assert` — **zero test
dependencies**. Each suite builds its own throwaway venue/event/show and removes it
afterwards, so it neither depends on nor damages the seed data. Two suites wait for a
real sweeper pass, so a full run takes roughly 60–90 seconds.

Coverage includes:
- Authentication & RBAC role enforcement (Admin mint blocking).
- Atomic seat hold locking & TTL expiry.
- 20-way concurrent seat contention (1x 201, 19x 409).
- Waitlist FIFO queuing, tokenized offers, and auto-promotion upon cancellation.

---

## 15. Deployment Notes

- **Database**: PostgreSQL hosted on Neon (pooled connection string with `?sslmode=require`).
- **Backend Service**: Deployed on Render Web Service. Sweeper automatically catches up on instance boot.
- **Frontend SPA**: Deployed on Vercel with SPA rewrite rules configured in `client/vercel.json`.

---

## 16. Known Limitations

- **Simulated Payment**: Checkout completes booking reservation directly without live credit card processing.
- **Free Tier Email**: Resend free tier sends to verified email addresses; set `MAIL_REDIRECT_TO` in `.env` to redirect all outbound demo emails to your inbox.

---

## 17. License

Distributed under the [MIT License](LICENSE).
