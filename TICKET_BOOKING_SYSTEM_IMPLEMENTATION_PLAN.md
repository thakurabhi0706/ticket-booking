# Ticket Booking System — Implementation Plan

**Assignment:** Ticket Booking System (movies & concerts)
**Deliverable type:** Graded project — source code + README + hosted URL + system design write-up
**Plan version:** 1.0

---

## 0. How to use this document

This plan is written so that you can execute it top-to-bottom without re-reading the assignment PDF. Sections 1–2 are the compliance backbone (every requirement mapped to an artefact). Sections 3–12 are the build. Sections 13–18 are packaging, deployment and submission.

**Two rules that will decide your grade:**

1. Four features carry disproportionate marks — **seat hold TTL/auto-release, concurrency protection, waitlist auto-assignment with time-limited offers, and real-time seat map**. These must be *demonstrably* working, not just present in code. Build them first, polish UI last.
2. The submission guidelines document is itself graded. A perfect app in a repo containing `node_modules/` and a committed `.env` loses easy marks. Section 17 is non-negotiable.

---

## 1. Requirement traceability matrix

Every bullet from the assignment brief, mapped to where it is satisfied. Tick these off before submitting.

### 1.1 Scope of Work

| # | Requirement (verbatim intent) | Implemented in | Verify by |
|---|---|---|---|
| S1 | Input: event selection, seat selection, customer details | Frontend booking flow (§10.2) + `POST /api/shows/:id/holds` | Manual walkthrough |
| S2 | Output: confirmed booking, QR ticket via email, waitlist management on cancellation | §9 (QR+email), §8 (waitlist) | Receive real email |
| S3 | Admin creates and manages venues with seat layout and seat categories | `venues`, `seat_categories`, `venue_seats` (§6); Admin UI (§10.5) | Create a 10×12 venue with 3 categories |
| S4 | Organiser registers, logs in, creates movie/event listings with venue, date, time, per-category pricing | `events`, `shows`, `show_category_prices` (§6); Organiser UI (§10.4) | Create a show; prices differ per category |
| S5 | Customer registers, logs in, browses and filters events | `GET /api/events?type=&city=&date=&q=` (§7.3) | Filter by movie vs concert, by date |
| S6 | Visual seat map with real-time status (available / held / booked) | `show_seats` grid (§6) + SSE (§5.4) + `SeatMap` component (§10.2) | Two browsers side-by-side |
| S7 | Seat hold with configurable TTL (e.g. 10 min); held seats unavailable to others | `SEAT_HOLD_TTL_SECONDS` env; §5.1 hold algorithm | Set TTL=60s in demo, watch it expire |
| S8 | Abandoned checkout → seats auto-released; map updates in real time | Sweeper job §5.3 + SSE broadcast | Hold seats, close tab, watch other browser |
| S9 | Two customers must not hold/book the same seat simultaneously | Atomic conditional UPDATE + row locks §5.2 | Concurrency test script §14.3 |
| S10 | On booking, email with QR code; QR encodes booking reference | §9.1–9.3 | Scan the QR with a phone |
| S11 | Sold-out event → customer joins waitlist for a specific seat category | `waitlist_entries` (§6) + `POST /api/shows/:id/waitlist` | Book out a category, join waitlist |
| S12 | Cancellation → seat offered to next waitlisted customer, email with time-limited link | §8.2 offer flow | Cancel, check next user's inbox |
| S13 | Offer not completed in time → seat offered to next in line | Sweeper job §8.3 | Let an offer expire |
| S14 | Customer views booking history and cancels a booking | `GET /api/me/bookings`, `POST /api/bookings/:id/cancel` | My Bookings page |
| S15 | Organiser views booking summary and revenue per event | `GET /api/organiser/events/:id/summary` (§7.6) | Dashboard with totals |

### 1.2 Technical Expectations

| # | Requirement | Implemented in | Verify by |
|---|---|---|---|
| T1 | Backend API, Frontend, Database, role-based auth (customer/organiser/admin) | §3 stack, §4 architecture, §11 RBAC | Try an organiser route as a customer → 403 |
| T2 | Seat map stored per show with per-seat status; rendered as visual grid | `show_seats` table with `row_label`, `seat_number`, `status` | Grid renders with correct gaps/aisles |
| T3 | Hold TTL enforced via scheduler **or** DB-level expiry; status updated on release | Both: lazy DB expiry (§5.2) + sweeper (§5.3) | Sweeper log lines |
| T4 | Concurrency protection — simultaneous attempts must not both succeed | §5.2 | §14.3 test output: 1 × 201, N−1 × 409 |
| T5 | Waitlist queue per seat category; auto-assignment + time-limited offer on cancellation | §8 | End-to-end waitlist demo |
| T6 | QR code generation; email delivery (any free-tier service) | §9 | Real inbox |

### 1.3 Deliverables

| # | Deliverable | Where produced |
|---|---|---|
| D1 | Zip file with complete source code | §17.2 |
| D2 | README with setup guide, `.env.example`, API docs, DB schema, seat-hold & waitlist logic explanation | §16 |
| D3 | Hosted application URL | §15 |
| D4 | System design write-up, 800 words max, covering hold+TTL, concurrency, waitlist auto-assignment, time-limited offers | §18 |

### 1.4 Evaluation Focus (weight your effort here)

| Focus area | Plan section | Effort priority |
|---|---|---|
| Seat hold TTL and auto-release | §5.1, §5.3 | **P0** |
| Concurrency protection | §5.2, §14.3 | **P0** |
| Waitlist auto-assignment + time-limited offer | §8 | **P0** |
| Seat map data model + real-time updates | §6, §5.4 | **P0** |
| QR generation + email delivery | §9 | P1 |
| API design, code structure, documentation | §7, §12, §16 | P1 |

---

## 2. Submission guidelines compliance (second PDF)

| Guideline | Action in this plan |
|---|---|
| GitHub repo, branch **must be `main`** | §17.1 — initialise with `git init -b main` |
| Repo **public / open-source** | §17.1 — set visibility Public, verify in incognito |
| Repo within GitHub limits, fully downloadable | Repo will be < 5 MB with a correct `.gitignore` |
| Submit only basic application + required code files | §12 repo structure — no scratch folders, no screenshots dir bloat |
| ❌ No `node_modules` or dependency folders | `.gitignore` (§17.3) |
| ❌ No `.env` or sensitive config | `.gitignore` + commit `.env.example` only |
| ❌ No build artefacts (`dist/`, `.next/`, `out/`) | `.gitignore` |
| ❌ No editor files (`.vscode/`, `.idea/`) | `.gitignore` |
| ❌ No extra modules / package files | §3.3 — dependency budget with written justification for each |
| ✅ Minimal, native dependencies wherever possible | §3.3 — SSE instead of socket.io, `fetch` instead of an SDK, `node:crypto` instead of uuid |
| App runs without errors | §14 test plan + fresh-clone smoke test (§17.4) |
| Code properly structured and named | §12 |
| Proper documentation / comments | §16 + JSDoc on the three hard algorithms |
| Link publicly accessible | §17.4 incognito check |

> **Conflict to be aware of:** the brief demands QR codes, email, real-time updates and RBAC, while the guidelines demand minimal dependencies. Resolve this by keeping a **short, justified dependency list** and stating the justification in the README. That turns a potential deduction into evidence of judgement. See §3.3.

---

## 3. Technology stack

### 3.1 Recommended stack

| Layer | Choice | Why |
|---|---|---|
| Backend | **Node.js 20 + Express** | Ubiquitous, trivial to host, reviewer-friendly |
| Database | **PostgreSQL 15+** | The concurrency story (row locks, `FOR UPDATE`, conditional UPDATE, partial unique indexes) is the core of this assignment. MongoDB makes it harder to demonstrate. **Do not use SQLite** — hosted free tiers have ephemeral disks. |
| DB access | **`pg` driver + raw SQL** | Lets you show the exact locking SQL in the write-up. An ORM hides the very thing being graded. (Prisma is acceptable if you prefer, but you must drop to `$queryRaw` for the hold/booking transactions.) |
| Frontend | **React 18 + Vite** | Fast, standard, easy Vercel deploy |
| Real-time | **Server-Sent Events (native)** | Zero dependencies, one-way server→client is exactly what a seat map needs, survives free-tier hosting better than WebSockets |
| Auth | **JWT (`jsonwebtoken`) + `bcryptjs`** | Stateless, easy for a reviewer to test with a curl token |
| QR | **`qrcode`** | Generates PNG buffer server-side for email attachment |
| Email | **Resend** (free tier, 3 000/mo) via `fetch` — *or* **Brevo SMTP** via `nodemailer` | Resend adds **zero** dependencies |
| Scheduler | **`setInterval` worker in-process** + Postgres advisory lock | No cron dependency; safe if scaled |
| Hosting | Backend **Render**, DB **Neon**, Frontend **Vercel** | All free tier, all in the assignment's allowed list |

### 3.2 Alternative stacks (if you're more fluent elsewhere)

- **Spring Boot + PostgreSQL + React** — use `@Lock(PESSIMISTIC_WRITE)` / `@Query` with `FOR UPDATE`, `@Scheduled` for the sweeper, ZXing for QR.
- **Django + DRF + PostgreSQL + React** — `select_for_update()`, Celery-beat *or* a management command on a cron, `qrcode` lib, `django.core.mail`.
- **NestJS** — same as Node above with more structure.

The algorithms in §5 and §8 are stack-agnostic; only the syntax changes. Pick what you can ship confidently — a working Express app beats a half-finished Spring app.

### 3.3 Dependency budget (justify each in README)

**Backend (7):**

| Package | Justification |
|---|---|
| `express` | HTTP framework |
| `pg` | PostgreSQL driver |
| `jsonwebtoken` | Role-based auth tokens |
| `bcryptjs` | Password hashing |
| `qrcode` | Required by the brief |
| `dotenv` | Local env loading |
| `cors` | Frontend on a different origin |

*Deliberately avoided:* `socket.io` (native SSE), `uuid` (`node:crypto.randomUUID`), `node-cron` (`setInterval`), `nodemailer` (Resend via `fetch`), `helmet`/`morgan` (not required), any ORM.

**Frontend (3):** `react`, `react-dom`, `react-router-dom`. Dev-only: `vite`, `@vitejs/plugin-react`. Plain CSS — no Tailwind, no UI kit.

Total production dependencies: **10**. Put this table in the README under "Dependency policy."

---

## 4. System architecture

```
┌────────────────────┐         ┌──────────────────────────────────┐
│  React SPA (Vite)  │         │      Express API (Render)        │
│  Vercel            │         │                                  │
│                    │ REST    │  routes/  → controllers/         │
│  - Auth pages      │◄───────►│           → services/            │
│  - Event browse    │         │           → db (pg Pool)         │
│  - Seat map  ──────┼─────────┤  GET /api/shows/:id/stream (SSE) │
│  - Checkout        │  SSE    │                                  │
│  - My bookings     │◄────────┤  worker/sweeper.js (setInterval) │
│  - Organiser dash  │         │    ├─ expireHolds()              │
│  - Admin venues    │         │    ├─ expireOffers()             │
│  - Offer claim page│         │    └─ promoteWaitlist()          │
└────────────────────┘         └──────────┬───────────────────────┘
                                          │
                          ┌───────────────┴───────────────┐
                          │  PostgreSQL (Neon)            │
                          │  row-level locks + partial    │
                          │  unique indexes + timestamps  │
                          └───────────────────────────────┘
                                          │
                                   ┌──────┴──────┐
                                   │ Resend API  │  QR PNG attachment
                                   │ (email)     │
                                   └─────────────┘
```

**Layering rule:** routes do validation only; controllers orchestrate; services own transactions; nothing outside `services/` opens a DB transaction. State transitions on `show_seats` happen **only** in `services/seatService.js` — one file the examiner can read to understand the whole concurrency story.

---

## 5. Seat hold, TTL, concurrency and real-time (the core)

### 5.1 Seat lifecycle state machine

```
                 hold (TTL)                confirm
   AVAILABLE ─────────────────► HELD ───────────────► BOOKED
       ▲                         │                      │
       │   TTL expiry / release  │                      │ cancel
       └─────────────────────────┘                      │
       ▲                                                ▼
       │           offer expires / no waitlist    ┌────────────┐
       └────────────────────────────────────────  │ (released) │
       ▲                                          └─────┬──────┘
       │                                                │ waitlist exists
       │          offer expires                         ▼
       └──────────────────────────────────────────  OFFERED ──► HELD ──► BOOKED
                                                    (time-limited,
                                                     bound to one user)
```

Five statuses only: `AVAILABLE`, `HELD`, `OFFERED`, `BOOKED`, `BLOCKED` (admin-disabled seat, e.g. broken chair — optional but cheap and looks thorough).

**Key modelling decision:** a seat is never "half-held". `HELD` always carries `(held_by, hold_expires_at, hold_group_id)`. `OFFERED` always carries `(offered_to, offer_expires_at, offer_id)`. Never leave those columns dangling — clear them on every transition.

### 5.2 Concurrency protection (P0 — highest-value section)

**Threat:** two customers tap the same seat within milliseconds. Both `SELECT status='AVAILABLE'`, both `UPDATE`, both succeed. Classic read-modify-write race.

**Defence — three layers:**

**Layer 1 — Single atomic conditional UPDATE.** Never `SELECT` then `UPDATE`. Make the condition part of the write and count the rows returned:

```sql
BEGIN;

-- Lock the target rows in a deterministic order to avoid deadlocks
SELECT id
  FROM show_seats
 WHERE show_id = $1 AND id = ANY($2::uuid[])
 ORDER BY id            --  << deterministic order = no deadlock
   FOR UPDATE;

-- Atomically claim only seats that are genuinely claimable
UPDATE show_seats
   SET status          = 'HELD',
       held_by         = $3,
       hold_group_id   = $4,
       hold_expires_at = now() + make_interval(secs => $5),
       updated_at      = now()
 WHERE show_id = $1
   AND id = ANY($2::uuid[])
   AND ( status = 'AVAILABLE'
      OR (status = 'HELD'    AND hold_expires_at  <= now())   -- lazy expiry
      OR (status = 'OFFERED' AND offer_expires_at <= now()) )
RETURNING id;

-- Application check:
--   if (rows.length !== requestedSeatIds.length) → ROLLBACK → 409 SEAT_UNAVAILABLE
COMMIT;
```

The `ORDER BY id ... FOR UPDATE` matters: without it, customer A locking seats `[5,6]` and customer B locking `[6,5]` can deadlock. Mention this in the write-up — it reads as real engineering.

**Layer 2 — Lazy expiry in the predicate.** Note the `OR (status='HELD' AND hold_expires_at <= now())` clause. This means a seat is *logically available the instant its TTL passes*, even if the sweeper hasn't run yet. The sweeper becomes a UI-consistency mechanism rather than a correctness dependency. This is the single most defensible design point in the whole assignment — call it out explicitly.

**Layer 3 — Database-level invariant.** Belt and braces, so a bug cannot double-book:

```sql
-- A seat row is unique per show by construction:
ALTER TABLE show_seats
  ADD CONSTRAINT uq_show_seat UNIQUE (show_id, venue_seat_id);

-- A booked seat must belong to exactly one booking:
CREATE UNIQUE INDEX uq_booking_seat ON booking_seats (show_seat_id);

-- A seat can only be booked if it carries a booking_id, and vice versa:
ALTER TABLE show_seats ADD CONSTRAINT ck_booked_consistency
  CHECK ( (status = 'BOOKED') = (booking_id IS NOT NULL) );
```

`uq_booking_seat` is the hard guarantee: even under a catastrophic logic error, Postgres refuses the second booking of the same seat.

**Booking confirmation** uses the same pattern, keyed on the hold group:

```sql
UPDATE show_seats
   SET status = 'BOOKED', booking_id = $1,
       held_by = NULL, hold_expires_at = NULL, hold_group_id = NULL
 WHERE hold_group_id = $2
   AND held_by       = $3
   AND status        = 'HELD'
   AND hold_expires_at > now()
RETURNING id, price_paid;
-- count mismatch → ROLLBACK → 410 HOLD_EXPIRED
```

**Explicitly rejected alternatives** (say why in the write-up — showing you considered them earns marks):
- *Optimistic version column only* — works, but needs retry loops and doesn't handle multi-seat atomicity as cleanly.
- *Application-level mutex / in-memory lock* — breaks the moment the app runs on more than one instance.
- `SERIALIZABLE` isolation — correct but forces client-side retry on serialization failures; heavier than needed for row-scoped contention.
- Redis distributed lock — adds infrastructure the assignment doesn't need and violates the minimal-dependency rule.

### 5.3 TTL enforcement — dual mechanism

The brief says "scheduler **or** database-level expiry". Implement **both** and say so — it's a differentiator.

**(a) Database-level (authoritative):** `hold_expires_at TIMESTAMPTZ`. Every query that decides availability treats `hold_expires_at <= now()` as available. Correctness never depends on a job running.

**(b) Scheduler (materialising + notification):** `worker/sweeper.js`, `setInterval` every `SWEEPER_INTERVAL_MS` (default 15 000):

```js
// Pseudocode — runs inside ONE transaction per pass
async function sweep() {
  // Only one instance sweeps at a time, even if the host scales
  const got = await db.query('SELECT pg_try_advisory_lock($1)', [SWEEP_LOCK_KEY]);
  if (!got.rows[0].pg_try_advisory_lock) return;
  try {
    const releasedShows = await expireHolds();   // HELD  + past TTL → AVAILABLE
    const offerShows    = await expireOffers();  // OFFERED + past TTL → next in waitlist
    for (const showId of new Set([...releasedShows, ...offerShows])) {
      broadcastSeatUpdate(showId);               // SSE push
    }
  } finally {
    await db.query('SELECT pg_advisory_unlock($1)', [SWEEP_LOCK_KEY]);
  }
}
```

`expireHolds`:

```sql
UPDATE show_seats
   SET status='AVAILABLE', held_by=NULL, hold_expires_at=NULL, hold_group_id=NULL, updated_at=now()
 WHERE status='HELD' AND hold_expires_at <= now()
RETURNING show_id, id;
```

Also mark the abandoned `seat_holds` row `EXPIRED` for the audit trail.

**Configurable TTL:** `SEAT_HOLD_TTL_SECONDS=600` in `.env`. **For your demo video/screenshots, set it to 60** so the reviewer sees expiry happen without waiting ten minutes. Document both values in the README.

**Client-side:** the checkout page renders a countdown from `hold_expires_at` returned by the API (never from a client-started timer — clocks drift). At zero it calls `DELETE /api/holds/:groupId` and redirects with an explanatory message.

**Explicit release on abandonment:** wire `navigator.sendBeacon('/api/holds/:id/release')` to `beforeunload` and a "Back"/"Cancel" button handler. Belt and braces on top of TTL — reviewers notice this.

### 5.4 Real-time seat map (SSE)

**Endpoint:** `GET /api/shows/:showId/stream` — `Content-Type: text/event-stream`.

```js
// server: registry of open connections per show
const clients = new Map(); // showId -> Set<res>

app.get('/api/shows/:showId/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',            // stops proxy buffering on Render
  });
  res.write('retry: 3000\n\n');
  addClient(req.params.showId, res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000); // keep-alive
  req.on('close', () => { clearInterval(ping); removeClient(req.params.showId, res); });
});
```

**Events emitted:** `seat_update` (array of `{seatId, status}`), `show_soldout`, `waitlist_offer` (targeted at a user).

**Emit points:** after a successful hold, release, booking, cancellation, offer creation, and every sweeper pass that changed rows.

**Client:** `EventSource` in a `useShowStream(showId)` hook; merge deltas into seat state; `EventSource` auto-reconnects, and on `onerror`→reconnect the hook re-fetches the full map to resync. Also poll `GET /api/shows/:id/seats` every 20 s as a fallback so the demo never looks broken if SSE is blocked by a proxy.

**Never trust the client's view:** the seat map is a hint. The atomic UPDATE (§5.2) is the truth. Say this in the write-up.

---

## 6. Database schema

Full DDL, ready for `db/schema.sql`.

```sql
-- ============ AUTH ============
CREATE TYPE user_role AS ENUM ('CUSTOMER','ORGANISER','ADMIN');

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         CITEXT UNIQUE NOT NULL,      -- or TEXT + lower() unique index
  phone         TEXT,
  password_hash TEXT NOT NULL,
  role          user_role NOT NULL DEFAULT 'CUSTOMER',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ VENUE (admin) ============
CREATE TABLE venues (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  city       TEXT NOT NULL,
  address    TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE seat_categories (              -- e.g. Premium / Standard
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id     UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  colour_hex   TEXT NOT NULL DEFAULT '#888888',
  display_rank INT  NOT NULL DEFAULT 0,
  UNIQUE (venue_id, name)
);

CREATE TABLE venue_seats (                  -- the physical layout
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES seat_categories(id),
  row_label   TEXT NOT NULL,                -- 'A','B','C'
  seat_number INT  NOT NULL,                -- 1..n
  grid_row    INT  NOT NULL,                -- render coords (aisles = gaps)
  grid_col    INT  NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (venue_id, row_label, seat_number)
);

-- ============ EVENTS & SHOWS (organiser) ============
CREATE TYPE event_type AS ENUM ('MOVIE','CONCERT');

CREATE TABLE events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organiser_id UUID NOT NULL REFERENCES users(id),
  title        TEXT NOT NULL,
  type         event_type NOT NULL,
  description  TEXT,
  poster_url   TEXT,
  language     TEXT,
  duration_min INT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE shows (                         -- one screening / one concert night
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  venue_id   UUID NOT NULL REFERENCES venues(id),
  starts_at  TIMESTAMPTZ NOT NULL,
  status     TEXT NOT NULL DEFAULT 'SCHEDULED',   -- SCHEDULED | CANCELLED
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_shows_starts_at ON shows (starts_at);

CREATE TABLE show_category_prices (          -- per-category pricing
  show_id     UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES seat_categories(id),
  price       NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  PRIMARY KEY (show_id, category_id)
);

-- ============ SEAT MAP PER SHOW (the hot table) ============
CREATE TYPE seat_status AS ENUM ('AVAILABLE','HELD','OFFERED','BOOKED','BLOCKED');

CREATE TABLE show_seats (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id         UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  venue_seat_id   UUID NOT NULL REFERENCES venue_seats(id),
  category_id     UUID NOT NULL REFERENCES seat_categories(id),
  row_label       TEXT NOT NULL,             -- denormalised for fast map reads
  seat_number     INT  NOT NULL,
  grid_row        INT  NOT NULL,
  grid_col        INT  NOT NULL,
  price           NUMERIC(10,2) NOT NULL,    -- snapshot at show creation
  status          seat_status NOT NULL DEFAULT 'AVAILABLE',
  -- hold fields
  held_by         UUID REFERENCES users(id),
  hold_group_id   UUID,
  hold_expires_at TIMESTAMPTZ,
  -- offer fields
  offered_to      UUID REFERENCES users(id),
  offer_id        UUID,
  offer_expires_at TIMESTAMPTZ,
  -- booking field
  booking_id      UUID,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_show_seat UNIQUE (show_id, venue_seat_id),
  CONSTRAINT ck_booked_consistency CHECK ((status='BOOKED') = (booking_id IS NOT NULL)),
  CONSTRAINT ck_held_consistency   CHECK ((status='HELD')   = (hold_expires_at IS NOT NULL))
);
CREATE INDEX idx_show_seats_show     ON show_seats (show_id);
CREATE INDEX idx_show_seats_expiry   ON show_seats (hold_expires_at)  WHERE status='HELD';
CREATE INDEX idx_show_seats_offerexp ON show_seats (offer_expires_at) WHERE status='OFFERED';
CREATE INDEX idx_show_seats_avail    ON show_seats (show_id, category_id) WHERE status='AVAILABLE';

-- ============ HOLDS (audit trail) ============
CREATE TABLE seat_holds (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),   -- == hold_group_id
  show_id    UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id),
  seat_count INT  NOT NULL,
  status     TEXT NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE|CONVERTED|RELEASED|EXPIRED
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ BOOKINGS ============
CREATE TABLE bookings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference     TEXT UNIQUE NOT NULL,         -- 'BKG-7F3A9C21'  → encoded in QR
  show_id       UUID NOT NULL REFERENCES shows(id),
  user_id       UUID NOT NULL REFERENCES users(id),
  customer_name  TEXT NOT NULL,               -- captured at checkout
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  total_amount  NUMERIC(10,2) NOT NULL,
  status        TEXT NOT NULL DEFAULT 'CONFIRMED',  -- CONFIRMED|CANCELLED
  source        TEXT NOT NULL DEFAULT 'DIRECT',     -- DIRECT|WAITLIST
  qr_payload    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at  TIMESTAMPTZ
);
CREATE INDEX idx_bookings_user ON bookings (user_id, created_at DESC);

CREATE TABLE booking_seats (
  booking_id   UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  show_seat_id UUID NOT NULL REFERENCES show_seats(id),
  price_paid   NUMERIC(10,2) NOT NULL,
  PRIMARY KEY (booking_id, show_seat_id)
);
-- HARD GUARANTEE: a seat can appear in at most one *active* booking
CREATE UNIQUE INDEX uq_active_booking_seat ON booking_seats (show_seat_id);

-- ============ WAITLIST ============
CREATE TABLE waitlist_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id     UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES seat_categories(id),
  user_id     UUID NOT NULL REFERENCES users(id),
  seats_wanted INT NOT NULL DEFAULT 1 CHECK (seats_wanted BETWEEN 1 AND 6),
  status      TEXT NOT NULL DEFAULT 'WAITING',   -- WAITING|OFFERED|FULFILLED|EXPIRED|CANCELLED
  position    BIGSERIAL,                          -- FIFO ordering
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- one active entry per user per show+category
CREATE UNIQUE INDEX uq_waitlist_active
  ON waitlist_entries (show_id, category_id, user_id)
  WHERE status IN ('WAITING','OFFERED');
CREATE INDEX idx_waitlist_queue
  ON waitlist_entries (show_id, category_id, position)
  WHERE status='WAITING';

CREATE TABLE waitlist_offers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id    UUID NOT NULL REFERENCES waitlist_entries(id) ON DELETE CASCADE,
  show_id     UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id),
  seat_ids    UUID[] NOT NULL,
  token_hash  TEXT NOT NULL,                 -- sha256 of the emailed token
  status      TEXT NOT NULL DEFAULT 'PENDING', -- PENDING|CLAIMED|EXPIRED|SUPERSEDED
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at  TIMESTAMPTZ
);
CREATE INDEX idx_offers_pending ON waitlist_offers (expires_at) WHERE status='PENDING';

-- ============ EMAIL AUDIT (nice-to-have, cheap) ============
CREATE TABLE email_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email    TEXT NOT NULL,
  template    TEXT NOT NULL,          -- BOOKING_CONFIRMED|WAITLIST_OFFER|CANCELLED
  provider_id TEXT,
  status      TEXT NOT NULL,          -- SENT|FAILED
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Why `show_seats` is materialised per show rather than computed on the fly:** the brief explicitly requires "seat map stored per show with per-seat status". Materialising also lets a *single row* be the lock target for concurrency, which is what makes §5.2 correct. Generate the rows in the same transaction that creates the show (fan-out from `venue_seats`, join `show_category_prices` for `price`).

---

## 7. API design

Base: `/api`. JSON everywhere. Auth via `Authorization: Bearer <jwt>`.

### 7.1 Auth
| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/auth/register` | public | `{name,email,password,role}` — role limited to CUSTOMER/ORGANISER; ADMIN seeded only |
| POST | `/auth/login` | public | returns `{token, user}` |
| GET  | `/auth/me` | any | current user |

### 7.2 Admin — venues & categories
| Method | Path | Role |
|---|---|---|
| POST | `/admin/venues` | ADMIN |
| GET | `/admin/venues` · `/admin/venues/:id` | ADMIN |
| PATCH / DELETE | `/admin/venues/:id` | ADMIN |
| POST | `/admin/venues/:id/categories` | ADMIN |
| POST | `/admin/venues/:id/seats/bulk` | ADMIN — generate a grid: `{rows:['A'..'J'], seatsPerRow:12, categoryMap:{A-C:Premium, D-J:Standard}, aisleAfterCols:[4,8]}` |
| GET | `/admin/venues/:id/layout` | ADMIN — full layout for the editor |

### 7.3 Public / customer — browse
| Method | Path | Notes |
|---|---|---|
| GET | `/events` | filters: `type`, `city`, `q`, `dateFrom`, `dateTo`, `page`, `limit` |
| GET | `/events/:id` | with upcoming shows |
| GET | `/shows/:id` | show + venue + per-category price + availability counts + `soldOut` flags |
| GET | `/shows/:id/seats` | full seat map array |
| GET | `/shows/:id/stream` | **SSE** live updates |

### 7.4 Holds & bookings (customer)
| Method | Path | Body / Notes |
|---|---|---|
| POST | `/shows/:id/holds` | `{seatIds:[...]}` → `201 {holdGroupId, expiresAt, seats, total}` · `409 SEAT_UNAVAILABLE` |
| GET | `/holds/:groupId` | remaining TTL (server-authoritative) |
| DELETE | `/holds/:groupId` | explicit release (also `sendBeacon` target) |
| POST | `/bookings` | `{holdGroupId, customer:{name,email,phone}}` → `201 {reference,...}` · `410 HOLD_EXPIRED` |
| GET | `/me/bookings` | history, newest first |
| GET | `/bookings/:id` | detail + QR data URL |
| POST | `/bookings/:id/cancel` | releases seats → triggers waitlist promotion |
| GET | `/bookings/verify/:reference` | public-ish gate-scan endpoint (proves the QR does something) |

### 7.5 Waitlist
| Method | Path | Notes |
|---|---|---|
| POST | `/shows/:id/waitlist` | `{categoryId, seatsWanted}` → `201` · `400 NOT_SOLD_OUT` · `409 ALREADY_ON_WAITLIST` |
| GET | `/me/waitlist` | entries + queue position |
| DELETE | `/waitlist/:entryId` | leave the queue |
| GET | `/waitlist/offers/:token` | validate a time-limited link → returns seats + seconds remaining |
| POST | `/waitlist/offers/:token/claim` | converts offer → booking (sends QR email) |
| POST | `/waitlist/offers/:token/decline` | immediately passes to next in line (nice touch) |

### 7.6 Organiser
| Method | Path | Notes |
|---|---|---|
| POST | `/organiser/events` | create movie/concert |
| POST | `/organiser/events/:id/shows` | `{venueId, startsAt, prices:[{categoryId, price}]}` — fans out `show_seats` |
| GET | `/organiser/events` | own events only |
| GET | `/organiser/events/:id/summary` | **revenue per event**: tickets sold, gross revenue, cancellations, refunded value, occupancy %, per-category breakdown, per-show breakdown, waitlist depth |
| GET | `/organiser/shows/:id/bookings` | booking list for a show |

### 7.7 Conventions
- Errors: `{ "error": { "code": "SEAT_UNAVAILABLE", "message": "...", "details": {...} } }`
- Status codes: 400 validation · 401 no/bad token · 403 wrong role · 404 · 409 conflict (seat taken, duplicate waitlist) · 410 gone (expired hold/offer) · 429 rate limit
- Every mutating endpoint validates ownership, not just role.
- Timestamps ISO-8601 UTC; the client formats to local time.

---

## 8. Waitlist & time-limited offer flow

### 8.1 Joining the waitlist

Guard: only allow joining when the *category* is sold out — `COUNT(*) FILTER (WHERE status='AVAILABLE') = 0` for that `show_id + category_id`. Return `400 NOT_SOLD_OUT` otherwise, so the reviewer sees the rule enforced. Position is `BIGSERIAL` → strict FIFO. `uq_waitlist_active` prevents duplicate entries.

### 8.2 Cancellation → automatic assignment

```js
async function cancelBooking(bookingId, userId) {
  await tx(async (c) => {
    // 1. Validate ownership + not already cancelled + show not started
    //    (enforce a cancellation cutoff, e.g. CANCELLATION_CUTOFF_MINUTES before start)
    // 2. Mark booking CANCELLED
    // 3. Free the seats
    const freed = await c.query(`
      UPDATE show_seats SET status='AVAILABLE', booking_id=NULL, updated_at=now()
       WHERE booking_id=$1 RETURNING id, show_id, category_id`, [bookingId]);
    await c.query(`DELETE FROM booking_seats WHERE booking_id=$1`, [bookingId]);
    // 4. Attempt promotion per affected category
    for (const [categoryId, seats] of groupByCategory(freed.rows)) {
      await promoteWaitlist(c, showId, categoryId, seats);
    }
  });
  broadcastSeatUpdate(showId);
}

async function promoteWaitlist(client, showId, categoryId, freedSeats) {
  let pool = [...freedSeats];
  while (pool.length > 0) {
    // FIFO head, skip rows another worker is already processing
    const { rows:[entry] } = await client.query(`
      SELECT * FROM waitlist_entries
       WHERE show_id=$1 AND category_id=$2 AND status='WAITING'
       ORDER BY position ASC
       LIMIT 1 FOR UPDATE SKIP LOCKED`, [showId, categoryId]);

    if (!entry) break;                       // nobody waiting → seats stay AVAILABLE
    if (entry.seats_wanted > pool.length) {
      // Not enough seats for this entry. Policy (document it!):
      // keep FIFO fairness — do NOT skip ahead. Leave seats AVAILABLE
      // for general sale and leave the entry at the head of the queue.
      break;
    }

    const seats = pool.splice(0, entry.seats_wanted);
    const token   = crypto.randomBytes(32).toString('hex');   // sent by email
    const tokenHash = sha256(token);                          // stored
    const expiresAt = new Date(Date.now() + WAITLIST_OFFER_TTL_SECONDS * 1000);

    const offer = await client.query(`
      INSERT INTO waitlist_offers (entry_id, show_id, user_id, seat_ids, token_hash, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [entry.id, showId, entry.user_id, seats.map(s=>s.id), tokenHash, expiresAt]);

    // Reserve the seats exclusively for this user
    await client.query(`
      UPDATE show_seats
         SET status='OFFERED', offered_to=$2, offer_id=$3, offer_expires_at=$4, updated_at=now()
       WHERE id = ANY($1::uuid[]) AND status='AVAILABLE'`,
      [seats.map(s=>s.id), entry.user_id, offer.rows[0].id, expiresAt]);

    await client.query(`UPDATE waitlist_entries SET status='OFFERED' WHERE id=$1`, [entry.id]);

    enqueueEmail('WAITLIST_OFFER', {
      to: entry.user_email,
      link: `${APP_URL}/waitlist/offer/${token}`,
      expiresAt, seats, showTitle,
    });
  }
}
```

**Design points worth stating in the write-up:**
- Seats move to `OFFERED`, **not** `AVAILABLE`, so the promotion is a real reservation and general customers can't snipe them.
- The emailed value is a random token; only its SHA-256 is stored. A leaked DB dump can't claim offers.
- `FOR UPDATE SKIP LOCKED` makes promotion safe if two cancellations land at once.
- The "not enough seats" policy is a deliberate fairness choice — document it either way, but *have* a policy.

### 8.3 Offer expiry → next in line

Sweeper pass, every `SWEEPER_INTERVAL_MS`:

```sql
UPDATE waitlist_offers SET status='EXPIRED'
 WHERE status='PENDING' AND expires_at <= now()
RETURNING id, entry_id, show_id, seat_ids;
```

Then, per expired offer:
1. `UPDATE waitlist_entries SET status='EXPIRED' WHERE id=$entryId` — they had their turn (alternative policy: requeue at the tail; pick one and document it).
2. `UPDATE show_seats SET status='AVAILABLE', offered_to=NULL, offer_id=NULL, offer_expires_at=NULL WHERE id=ANY(seat_ids) AND status='OFFERED'`
3. Call `promoteWaitlist(...)` again with those seats → **next in line gets the offer automatically**.
4. Broadcast SSE.

This closes the loop the brief asks for: *"If the waitlisted customer does not complete booking within the time limit, seat is offered to the next in line."*

### 8.4 Claiming an offer

`GET /waitlist/offers/:token` → hash the token, look up `status='PENDING' AND expires_at > now()`, return seats + `secondsRemaining`. Expired/claimed → `410 OFFER_EXPIRED` with a friendly page.

`POST /waitlist/offers/:token/claim` in one transaction:
```sql
UPDATE show_seats SET status='BOOKED', booking_id=$booking, offered_to=NULL, offer_id=NULL, offer_expires_at=NULL
 WHERE offer_id=$offerId AND status='OFFERED' AND offer_expires_at > now()
RETURNING id;
-- count mismatch → ROLLBACK → 410
```
Then insert `bookings` (`source='WAITLIST'`) + `booking_seats`, mark offer `CLAIMED`, entry `FULFILLED`, send QR email, broadcast.

**Timings for the demo:** `WAITLIST_OFFER_TTL_SECONDS=900` (15 min) in production config; **set 120 s for the demo** so the reviewer can watch it pass to the next person.

---

## 9. QR code & email

### 9.1 Booking reference & QR payload

```js
const reference = 'BKG-' + crypto.randomBytes(4).toString('hex').toUpperCase(); // BKG-7F3A9C21
const sig = crypto.createHmac('sha256', TICKET_SIGNING_SECRET).update(reference).digest('hex').slice(0,16);
const qrPayload = `${APP_URL}/verify/${reference}?s=${sig}`;
```

The brief requires the QR to encode the booking reference — this does, and the HMAC + verify URL makes it *scannable and meaningful*, which demos far better than a bare string. Store `qr_payload` on the booking so it's reproducible.

`GET /bookings/verify/:reference` returns `{valid, status, event, show, seats, customerName}` and rejects a bad signature. Screenshot this in the README — it proves the QR isn't decorative.

### 9.2 Generation

```js
import QRCode from 'qrcode';
const png = await QRCode.toBuffer(qrPayload, { width: 320, margin: 1, errorCorrectionLevel: 'M' });
```
Attach to the email as `cid:ticket-qr` (inline) **and** as a downloadable attachment — some clients block inline images.

### 9.3 Email delivery (free tier)

**Option A — Resend (recommended, zero deps):**
```js
await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    from: MAIL_FROM,                 // 'Tickets <onboarding@resend.dev>' works without a domain
    to: [customerEmail],
    subject: `Your ticket — ${eventTitle} (${reference})`,
    html,
    attachments: [{ filename: `${reference}.png`, content: png.toString('base64') }],
  }),
});
```
*Caveat:* the shared `onboarding@resend.dev` sender can only send to your own verified address on the free tier. **Mitigation for grading:** add `MAIL_REDIRECT_TO` — when set, all mail goes to your address with the intended recipient in the subject line, and the README explains this. Reviewers respect an honest, documented constraint far more than a silently broken feature.

**Option B — Brevo SMTP** (300 emails/day, sends to any address) via `nodemailer` (+1 dependency). If you want emails to reach a reviewer's own address during grading, take this option and note the extra dependency in the dependency table.

### 9.4 Templates (3)
1. **BOOKING_CONFIRMED** — event, venue, date/time, seats, total, reference, QR (inline + attached).
2. **WAITLIST_OFFER** — "A seat has opened up", seats offered, **big countdown deadline in words** ("expires at 7:42 PM IST — 15 minutes"), single CTA button to the tokenised link.
3. **BOOKING_CANCELLED** — confirmation + refund note.

### 9.5 Reliability
Never send inside a DB transaction. `COMMIT` first, then `setImmediate(() => sendEmail(...))` with try/catch and a row in `email_log`. **An email provider outage must never roll back a confirmed booking.** State this in the write-up. Add one retry with a 2 s backoff.

---

## 10. Frontend plan

### 10.1 Routes

| Route | Role | Purpose |
|---|---|---|
| `/` | public | Hero + event grid + filters (type / city / date / search) |
| `/events/:id` | public | Detail + list of shows, each with availability badge |
| `/shows/:id` | customer | **Seat map** + legend + selection tray |
| `/checkout/:holdGroupId` | customer | Countdown, customer details form, confirm |
| `/booking/:reference` | customer | Success page: QR, seats, "email sent" |
| `/my/bookings` | customer | History, cancel button, QR re-view |
| `/my/waitlist` | customer | Entries + queue position |
| `/waitlist/offer/:token` | customer | **Time-limited claim page** with live countdown |
| `/organiser` | organiser | Events list, create event/show, revenue summary |
| `/admin` | admin | Venues, categories, bulk seat-grid generator |
| `/login`, `/register` | public | Auth |
| `/verify/:reference` | public | QR landing / gate check |

### 10.2 SeatMap component (the showpiece)

```jsx
// Render from grid_row / grid_col so aisles appear as real gaps
<div className="seat-map" style={{ gridTemplateColumns: `repeat(${maxCol}, 28px)` }}>
  {seats.map(s => (
    <button key={s.id}
      className={`seat seat--${s.status.toLowerCase()} ${selected.has(s.id) ? 'is-selected' : ''}`}
      style={{ gridRow: s.grid_row, gridColumn: s.grid_col,
               '--cat-colour': s.categoryColour }}
      disabled={s.status !== 'AVAILABLE' || (selected.size >= MAX && !selected.has(s.id))}
      onClick={() => toggle(s.id)}
      title={`${s.row_label}${s.seat_number} · ${s.categoryName} · ₹${s.price}`}
      aria-label={`Seat ${s.row_label}${s.seat_number}, ${s.status.toLowerCase()}`}
    >{s.seat_number}</button>
  ))}
</div>
```

**Visual language:** curved "SCREEN / STAGE" bar at the top; category colour as the seat border; fill colour by status — grey `AVAILABLE`, **amber pulsing** `HELD`, purple `OFFERED`, dark `BOOKED`, blue `is-selected`. A legend below. The amber pulse animation is what makes real-time updates *visible* in a demo — worth the 6 lines of CSS.

**Max seats per booking:** `MAX_SEATS_PER_BOOKING=6` (env, enforced server-side too).

### 10.3 Checkout countdown
`useCountdown(expiresAt)` from the server value. Under 60 s → turn red. At zero → release + redirect with a toast. Show the countdown in the tab title (`(2:41) Checkout`) — a small touch that reads as polish.

### 10.4 Organiser dashboard
Summary cards (tickets sold, gross revenue, cancellations, occupancy %), a per-category revenue table, a per-show table, and waitlist depth per category. No charting library — a CSS bar built from `width: %` is enough and keeps dependencies at zero.

### 10.5 Admin venue builder
Form → rows × seats-per-row → live preview grid → assign row ranges to categories → save via `/admin/venues/:id/seats/bulk`. Support an "aisle after column N" input so the map looks like a real cinema.

### 10.6 Cross-cutting
- `AuthContext` (token in `localStorage`), `ProtectedRoute` by role.
- One `api.js` wrapper: injects the bearer token, normalises the error envelope, 401 → logout.
- Loading skeletons and an error boundary — an app that never shows a raw stack trace reads as finished.
- Responsive: seat map horizontally scrollable on mobile with a pinch-zoom wrapper.

---

## 11. Auth & RBAC

- **Hashing:** bcrypt, cost 10.
- **JWT:** `{sub, role, email}`, `JWT_EXPIRES_IN=7d`, `HS256`.
- **Middleware chain:** `requireAuth` → `requireRole('ORGANISER')` → `requireOwnership(resource)`.
- **Admin bootstrap:** seeded from `ADMIN_EMAIL` / `ADMIN_PASSWORD` env by `npm run seed`. Registration must **never** be able to mint an ADMIN — assert this in tests; it's a classic mark-loser.
- **Rate limit:** a small in-memory limiter (~20 lines, no dependency) on `/auth/*` and `/shows/:id/holds`. Prevents a seat-hoarding script and shows security awareness.
- **Validation:** a tiny hand-rolled `validate(schema, body)` helper rather than a validation library — keeps the dependency count honest.

---

## 12. Repository structure

```
ticket-booking-system/
├── README.md                       # the graded one — see §16
├── DESIGN.md                       # 800-word write-up — see §18
├── .gitignore
├── LICENSE                         # MIT — "open-source" per guidelines
├── docs/
│   ├── api.md                      # full endpoint reference
│   ├── schema.md                   # ER diagram (mermaid) + table notes
│   └── screenshots/                # 6–8 compressed PNGs, < 200 KB each
├── server/
│   ├── package.json
│   ├── .env.example
│   ├── src/
│   │   ├── index.js                # express bootstrap + SSE + sweeper start
│   │   ├── config.js               # env parsing with defaults & validation
│   │   ├── db/
│   │   │   ├── pool.js
│   │   │   ├── schema.sql
│   │   │   ├── migrate.js
│   │   │   └── seed.js
│   │   ├── middleware/  auth.js  requireRole.js  errorHandler.js  rateLimit.js
│   │   ├── routes/      auth.js  events.js  shows.js  holds.js  bookings.js
│   │   │                waitlist.js  organiser.js  admin.js
│   │   ├── controllers/ …
│   │   ├── services/
│   │   │   ├── seatService.js      # ★ hold / release / confirm — ALL locking SQL
│   │   │   ├── waitlistService.js  # ★ promote / offer / claim / expire
│   │   │   ├── bookingService.js
│   │   │   ├── qrService.js
│   │   │   └── emailService.js
│   │   ├── realtime/ sse.js
│   │   ├── worker/   sweeper.js    # ★ TTL + offer expiry
│   │   └── utils/    errors.js  validate.js  reference.js
│   └── tests/
│       ├── concurrency.test.js     # ★ the money test
│       ├── ttl.test.js
│       └── waitlist.test.js
└── client/
    ├── package.json
    ├── index.html
    ├── vite.config.js
    └── src/
        ├── main.jsx  App.jsx  api.js
        ├── context/AuthContext.jsx
        ├── hooks/ useShowStream.js  useCountdown.js
        ├── components/ SeatMap.jsx  SeatLegend.jsx  EventCard.jsx
        │               CountdownBar.jsx  ProtectedRoute.jsx  Nav.jsx
        ├── pages/ Home  EventDetail  ShowSeats  Checkout  BookingSuccess
        │          MyBookings  MyWaitlist  OfferClaim  Login  Register
        │          OrganiserDashboard  AdminVenues  VerifyTicket
        └── styles/ global.css  seatmap.css
```

The ★ files are what the examiner will actually read. Put a clear header comment at the top of each explaining the algorithm in 6–10 lines.

---

## 13. Build phases

Sized for roughly 7 focused days. Compress by cutting Phase 7 polish, never Phases 3–5.

| Phase | Deliverable | Est. | Definition of done |
|---|---|---|---|
| **0. Setup** | Repo (`main`), `.gitignore`, server+client skeletons, `/api/health`, Neon DB connected | 3 h | `git log` clean, health check 200 |
| **1. Auth & RBAC** | users table, register/login/me, JWT, role middleware, seeded admin | 4 h | Customer hits `/admin/venues` → 403 |
| **2. Venues & shows** | Admin venue + category + bulk seat grid; organiser events + shows; `show_seats` fan-out; browse & filter API | 8 h | A 120-seat show exists with per-category prices |
| **3. Seat map + hold + concurrency** ★ | `GET /shows/:id/seats`, `POST /holds`, atomic UPDATE, `DELETE /holds/:id`, SeatMap UI | 10 h | **Concurrency test passes: 1×201, 19×409** |
| **4. TTL + real-time** ★ | Sweeper, lazy expiry, SSE endpoint + hook, countdown UI, `sendBeacon` release | 7 h | Two browsers: hold in A → B greys out in <1 s; expiry frees it |
| **5. Booking + QR + email** | `POST /bookings`, reference, QR, Resend, success page, history, cancel | 8 h | Real email lands with a scannable QR |
| **6. Waitlist + offers** ★ | Join, FIFO queue, cancellation promotion, tokenised offer email, claim page, expiry → next in line | 10 h | Full demo: A cancels → B emailed → B ignores → C emailed |
| **7. Organiser dashboard + polish** | Revenue summary, occupancy, loading/error states, responsive, empty states | 6 h | Dashboard totals reconcile with the DB |
| **8. Deploy** | Neon + Render + Vercel, CORS, migrations, seed on prod | 4 h | Public URL works in incognito on mobile |
| **9. Docs & submission** | README, DESIGN.md, api.md, schema.md, screenshots, zip, final checks | 5 h | §17 checklist all ticked |

**Daily discipline:** commit at the end of every phase with a meaningful message. A repo with 40 sensible commits reads as real work; one commit named "final" does not.

---

## 14. Testing plan

### 14.1 Approach
Node's built-in `node:test` runner + `node:assert` — **zero test dependencies**, satisfying the minimal-dependency guideline while still having tests. Run against a disposable test schema.

### 14.2 Coverage targets
- **Auth:** duplicate email rejected; wrong password 401; registration can't set role=ADMIN; expired token 401.
- **Seat hold:** hold succeeds → status HELD; holding a BOOKED seat → 409; holding an expired hold's seat succeeds (lazy expiry); releasing frees the seat; over `MAX_SEATS_PER_BOOKING` → 400.
- **TTL:** with `SEAT_HOLD_TTL_SECONDS=2`, seat is claimable by another user after 2 s *without* the sweeper; sweeper sets it back to `AVAILABLE`.
- **Booking:** confirming an expired hold → 410; total equals sum of seat prices; reference is unique; `uq_active_booking_seat` blocks a duplicate.
- **Cancellation:** seats freed; booking CANCELLED; cancelling twice → 409.
- **Waitlist:** joining a non-sold-out category → 400; duplicate join → 409; FIFO order respected; cancellation creates an offer for position 1; offer expiry passes to position 2; claiming an expired token → 410; claim creates a booking with `source='WAITLIST'`.
- **RBAC:** organiser cannot read another organiser's summary.

### 14.3 The concurrency test (write this first, it's the highest-value artefact)

```js
// tests/concurrency.test.js
test('20 concurrent holds on the same seat → exactly one succeeds', async () => {
  const seatId = await freshAvailableSeat(showId);
  const tokens = await Promise.all(Array.from({length:20}, (_,i)=>loginAs(`u${i}@t.com`)));

  const results = await Promise.all(tokens.map(t =>
    fetch(`${API}/shows/${showId}/holds`, {
      method:'POST',
      headers:{ Authorization:`Bearer ${t}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ seatIds:[seatId] })
    }).then(r => r.status)
  ));

  assert.equal(results.filter(s => s === 201).length, 1);
  assert.equal(results.filter(s => s === 409).length, 19);

  const { rows } = await db.query('SELECT status, held_by FROM show_seats WHERE id=$1',[seatId]);
  assert.equal(rows[0].status, 'HELD');
  assert.ok(rows[0].held_by);
});
```

Also test **multi-seat partial overlap**: user A requests `[1,2,3]`, user B requests `[3,4,5]` simultaneously — exactly one succeeds fully, the other gets 409 and **holds nothing** (verify seats 4,5 are still `AVAILABLE`, i.e. the transaction rolled back cleanly). This all-or-nothing property is a great write-up detail.

**Paste the test output into the README.** It's the cheapest possible proof of the highest-weighted requirement.

### 14.4 Manual demo script (rehearse before recording/screenshotting)
1. Admin creates "PVR Grand, Chennai", 10 rows × 12, rows A–C Premium, D–J Standard.
2. Organiser creates *Interstellar*, show tomorrow 7 PM, Premium ₹450 / Standard ₹250.
3. Customer 1 opens the seat map; Customer 2 opens it in another browser.
4. C1 selects A5, A6 → C2's map turns them amber **live**.
5. C1 abandons → after TTL, seats go grey on both screens.
6. C1 books A5, A6 → confirmation email with QR arrives; scan it → verify page.
7. Book out all Premium seats. C2 sees "Sold out — join waitlist" → joins. C3 joins too.
8. C1 cancels → C2 receives the offer email within seconds. C2 ignores it.
9. Offer TTL passes → C3 receives the offer. C3 claims → booking + QR email.
10. Organiser dashboard shows tickets sold, revenue, 1 cancellation, occupancy %.

If any step needs an excuse, fix it before submitting.

---

## 15. Deployment

### 15.1 Database — Neon (free Postgres)
Create project → copy the pooled connection string → `DATABASE_URL` with `?sslmode=require`. Use the **pooled** endpoint. Run `npm run migrate && npm run seed` against prod once.

### 15.2 Backend — Render (Web Service)
- Root directory `server`, build `npm ci`, start `npm start`, Node 20.
- Env vars: everything from `.env.example`.
- **Free-tier spin-down warning:** the instance sleeps after ~15 min idle, which stops the sweeper and drops SSE connections. Mitigations: (a) the lazy-expiry design means *correctness survives sleep* — say so in the README; (b) on boot, run one immediate `sweep()` to catch up; (c) optionally use a free uptime pinger every 10 min. **Do not claim the app is always-on if it isn't.** If you can use Railway's free trial instead, it sleeps less aggressively.
- Health check path `/api/health`.

### 15.3 Frontend — Vercel
- Root `client`, framework Vite, build `npm run build`, output `dist`.
- Env `VITE_API_URL=https://<render-app>.onrender.com/api`.
- SPA rewrite so deep links like `/waitlist/offer/:token` work:
  ```json
  { "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
  ```
  **This one line is what makes the emailed offer link work.** Forgetting it breaks the flagship feature in production while it works locally.

### 15.4 Cross-cutting deploy checks
- CORS `origin: [APP_URL]`, `credentials: false` (bearer tokens, not cookies).
- `APP_URL` on the server must be the **Vercel** URL — it's baked into email links.
- SSE through Render: send `X-Accel-Buffering: no` and a `: ping` comment every 25 s or the proxy will close idle streams.
- Seed demo data on prod and **put the demo credentials in the README** (admin / organiser / 3 customers). A reviewer who can't log in gives up.

---

## 16. README outline (deliverable D2)

Ordered so a reviewer can succeed in 90 seconds.

1. **Title + one-line description + live URL badge**
2. **Demo credentials table** — admin / organiser / customer1 / customer2 / customer3 (email + password). *First thing after the intro.*
3. **Screenshots** (6–8): event browse, seat map with mixed statuses, checkout countdown, confirmation email with QR, waitlist join, offer claim page with countdown, organiser revenue dashboard.
4. **Features** — mapped to the assignment bullets (reuse §1.1; it doubles as your own compliance proof).
5. **Tech stack + dependency policy** — the §3.3 table with justifications, plus what you deliberately avoided.
6. **Architecture diagram** (the ASCII block from §4, or mermaid).
7. **Setup guide** — prerequisites, clone, `cd server && npm i`, `cp .env.example .env`, fill values, `npm run migrate`, `npm run seed`, `npm run dev`; then `cd client && npm i && npm run dev`. Include expected output and total time (~5 min).
8. **`.env.example`** reproduced inline (see §16.1).
9. **API documentation** — every endpoint: method, path, auth/role, request body, success response, error codes. Include 3–4 curl examples (login → hold → book → cancel).
10. **Database schema** — mermaid ER diagram + a table-by-table note on why each exists. Link `docs/schema.md`.
11. **★ Seat hold & TTL explained** — state machine diagram, the actual SQL, why lazy expiry + sweeper, how TTL is configured.
12. **★ Concurrency prevention explained** — the race described, the atomic UPDATE, the row-lock ordering, the `uq_active_booking_seat` backstop, alternatives rejected. **Paste the concurrency test output.**
13. **★ Waitlist logic explained** — FIFO model, sold-out gate, promotion on cancellation, tokenised time-limited offer, expiry → next in line, the seats-wanted fairness policy.
14. **Real-time updates** — SSE choice, events, reconnect + polling fallback.
15. **QR & email** — payload format, verify endpoint, provider, and the honest note about free-tier sender restrictions / `MAIL_REDIRECT_TO`.
16. **Testing** — how to run, what's covered, sample output.
17. **Deployment notes** — including the Render spin-down caveat.
18. **Known limitations & future work** — no payment gateway (bookings are simulated), single-region, no refunds integration, no seat-selection accessibility audit. **Listing limitations honestly reads as maturity, not weakness.**
19. **License (MIT)**

### 16.1 `.env.example` (commit this; never commit `.env`)

```dotenv
# ---- Server ----
NODE_ENV=development
PORT=4000
APP_URL=http://localhost:5173          # public frontend URL — used in email links

# ---- Database ----
DATABASE_URL=postgresql://user:password@host:5432/ticketing?sslmode=require

# ---- Auth ----
JWT_SECRET=replace-with-a-long-random-string
JWT_EXPIRES_IN=7d
BCRYPT_ROUNDS=10

# ---- Seat hold ----
SEAT_HOLD_TTL_SECONDS=600              # 600 in prod; 60 for demos
MAX_SEATS_PER_BOOKING=6

# ---- Waitlist ----
WAITLIST_OFFER_TTL_SECONDS=900         # 900 in prod; 120 for demos
WAITLIST_MAX_SEATS=6

# ---- Scheduler ----
SWEEPER_INTERVAL_MS=15000
SWEEP_LOCK_KEY=845213                  # postgres advisory lock key

# ---- Booking policy ----
CANCELLATION_CUTOFF_MINUTES=60         # no cancellations within 60 min of showtime

# ---- Email (Resend free tier) ----
RESEND_API_KEY=re_xxxxxxxxxxxxxxxx
MAIL_FROM="CineWave Tickets <onboarding@resend.dev>"
MAIL_REDIRECT_TO=                      # if set, ALL mail is redirected here (free-tier workaround)

# ---- Tickets ----
TICKET_SIGNING_SECRET=another-long-random-string

# ---- Seed admin ----
ADMIN_EMAIL=admin@ticketing.dev
ADMIN_PASSWORD=Admin@12345

# ---- Client (client/.env) ----
# VITE_API_URL=http://localhost:4000/api
```

---

## 17. Submission packaging

### 17.1 GitHub
```bash
git init -b main                       # branch MUST be main
git add .
git commit -m "feat: ticket booking system with seat holds, concurrency control and waitlist"
git remote add origin https://github.com/<you>/ticket-booking-system.git
git push -u origin main
```
Set repository visibility to **Public**. Add a description and topics. Verify `git branch --show-current` prints `main`.

### 17.2 Zip file (deliverable D1)
Build the zip **from a fresh clone**, not your working directory — that guarantees no ignored junk sneaks in:
```bash
git clone --depth 1 https://github.com/<you>/ticket-booking-system.git /tmp/tbs
cd /tmp && rm -rf tbs/.git && zip -r ticket-booking-system.zip tbs -x "*.DS_Store"
unzip -l ticket-booking-system.zip | head -50     # eyeball it
```
Target size: **< 5 MB**. If it isn't, you've committed something you shouldn't have.

### 17.3 `.gitignore` (root)
```gitignore
# dependencies
node_modules/
.pnp/
.yarn/

# env & secrets
.env
.env.*
!.env.example

# build artifacts
dist/
build/
out/
.next/
.vercel/
*.tsbuildinfo

# editors / OS
.vscode/
.idea/
.DS_Store
Thumbs.db
*.swp

# logs & runtime
logs/
*.log
npm-debug.log*
coverage/
.nyc_output/
tmp/
```

### 17.4 Final pre-submission checklist

**Repository**
- [ ] Branch is `main`
- [ ] Repository is Public — **opened in an incognito window to confirm**
- [ ] No `node_modules/` anywhere: `git ls-files | grep -c node_modules` → `0`
- [ ] No `.env` committed: `git ls-files | grep -E '^\.env$|/\.env$'` → empty
- [ ] No `dist/`, `build/`, `.next/`, `out/`
- [ ] No `.vscode/`, `.idea/`, `.DS_Store`
- [ ] Repo size < 5 MB; zip downloads and extracts cleanly
- [ ] `LICENSE` present (MIT)

**Runs without errors**
- [ ] Fresh clone → `npm i` → `.env` from example → `migrate` → `seed` → `dev` works on both server and client, following **only** the README
- [ ] Zero console errors in the browser on every page
- [ ] Zero unhandled promise rejections in server logs during the §14.4 demo script
- [ ] Tests pass: `npm test`

**Feature proof (do the §14.4 script one final time on the hosted URL)**
- [ ] Seat hold TTL visibly expires and releases
- [ ] Concurrency test output pasted in the README
- [ ] Waitlist offer email received; expiry passes to the next person
- [ ] QR email received and the QR scans to a working verify page
- [ ] Organiser revenue numbers reconcile
- [ ] Admin/organiser/customer roles are each enforced (try a forbidden call)

**Deliverables**
- [ ] D1 Zip file built from a fresh clone
- [ ] D2 README complete — setup, `.env.example`, API docs, DB schema, hold logic, waitlist logic
- [ ] D3 Hosted URL live, tested in incognito **and on a phone**
- [ ] D4 `DESIGN.md` — **word count verified ≤ 800** (`wc -w DESIGN.md`)
- [ ] Demo credentials in the README and confirmed working on the hosted app

---

## 18. System design write-up (deliverable D4 — 800 words max)

Hard cap. The four required topics are named in the brief, so give each its own heading — a marker scanning for them must find them instantly. Budget:

| Section | Words | Must contain |
|---|---|---|
| **1. Overview & data model** | ~110 | Why `show_seats` is materialised per show; the five-state machine; the one-row-per-seat lock target |
| **2. Seat hold & TTL mechanism** | ~180 | `hold_expires_at` as the source of truth; **lazy expiry in the query predicate** so correctness never depends on a job; sweeper as materialisation + SSE trigger; configurable TTL; server-authoritative countdown; `sendBeacon` explicit release |
| **3. Concurrency prevention** | ~200 | The read-modify-write race; single atomic conditional UPDATE with `RETURNING` + row-count check; `ORDER BY id ... FOR UPDATE` to avoid deadlocks; all-or-nothing multi-seat semantics; `uq_active_booking_seat` as the database-level backstop; alternatives rejected (app mutex fails on multi-instance, SERIALIZABLE needs retries, Redis adds infra); the 20-way test result |
| **4. Waitlist auto-assignment flow** | ~170 | Per-category FIFO via `BIGSERIAL`; sold-out gate; cancellation frees seats then promotes inside the same transaction; `FOR UPDATE SKIP LOCKED` for concurrent cancellations; seats move to `OFFERED` (reserved), not `AVAILABLE`, so they can't be sniped; the seats-wanted fairness policy |
| **5. Time-limited offer handling** | ~120 | Random token emailed, SHA-256 stored; `offer_expires_at` on both offer and seats; claim is another atomic conditional UPDATE; expiry sweep → mark expired → free seats → immediately re-promote to the next entry, so the queue drains without manual intervention |
| **6. Trade-offs & limitations** | ~20 | Free-tier spin-down; no payment gateway; single-region |

**Writing rules:** present tense, active voice, no marketing adjectives. Include **one** small SQL snippet (the atomic hold UPDATE) and **one** small diagram (the state machine) — both count toward the impression, not much toward the word count. Run `wc -w DESIGN.md` and cut until it's under 800. Going over is an unforced error.

---

## 19. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Email free tier only sends to your own address | Flagship waitlist demo looks broken | `MAIL_REDIRECT_TO` + documented in README, **or** use Brevo SMTP which sends anywhere |
| Render free tier sleeps → sweeper stops | Holds/offers appear not to expire | Lazy expiry makes it correct regardless; run `sweep()` on boot; document it; optional uptime pinger |
| SSE dropped by proxy | Map doesn't update live | 20 s polling fallback + `X-Accel-Buffering: no` + keep-alive pings |
| Deep-link `/waitlist/offer/:token` 404s on Vercel | Offer claim fails in prod only | SPA rewrite rule (§15.3) — test the link in prod, not just locally |
| Scope creep (payments, admin analytics, dark mode) | P0 features unfinished | Phases 3–6 before anything in Phase 7 |
| Timezone confusion on show times | Wrong times shown to reviewer | Store `TIMESTAMPTZ` UTC; format client-side; label the timezone in the UI |
| Deadlock on multi-seat holds | Intermittent 500s under load | `ORDER BY id` before `FOR UPDATE` (§5.2) |
| Committing `.env` with a live API key | Guideline breach **and** a leaked secret | `.gitignore` first commit; if it ever happens, rotate the key and rewrite history |
| Reviewer can't log in | Everything else is invisible | Demo credentials at the top of the README, verified on the hosted app |

---

## 20. Scoring self-audit (do this the day before you submit)

Score yourself 0–3 on each. Anything under 3 on a P0 row gets fixed before you touch anything else.

| Evaluation focus | Evidence a grader can see in 60 seconds | Score |
|---|---|---|
| Seat hold TTL & auto-release | Countdown UI, seat visibly freed, `hold_expires_at` in schema, README §11 | ⬜ |
| Concurrency protection | Test output in README, locking SQL in `seatService.js`, DESIGN §3 | ⬜ |
| Waitlist auto-assignment & offers | Offer email screenshot, `waitlist_offers` table, DESIGN §4–5 | ⬜ |
| Seat map model & real-time | Live two-browser screenshot/GIF, `show_seats` schema, SSE code | ⬜ |
| QR & email | Received email screenshot, working verify page | ⬜ |
| API design, structure, docs | `docs/api.md`, clean folder tree, error envelope, comments on ★ files | ⬜ |
| Submission hygiene | Public `main` branch, no junk files, tiny repo, working links | ⬜ |
