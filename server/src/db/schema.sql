-- ============ EXTENSIONS ============
CREATE EXTENSION IF NOT EXISTS citext;

-- ============ AUTH ============
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('CUSTOMER','ORGANISER','ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         CITEXT UNIQUE NOT NULL,
  phone         TEXT,
  password_hash TEXT NOT NULL,
  role          user_role NOT NULL DEFAULT 'CUSTOMER',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ VENUE (admin) ============
CREATE TABLE IF NOT EXISTS venues (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  city       TEXT NOT NULL,
  address    TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- A city cannot have two venues with the same name; also makes seeding idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS uq_venue_name_city ON venues (name, city);

CREATE TABLE IF NOT EXISTS seat_categories (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id     UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  colour_hex   TEXT NOT NULL DEFAULT '#888888',
  display_rank INT  NOT NULL DEFAULT 0,
  UNIQUE (venue_id, name)
);

CREATE TABLE IF NOT EXISTS venue_seats (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES seat_categories(id),
  row_label   TEXT NOT NULL,
  seat_number INT  NOT NULL,
  grid_row    INT  NOT NULL,
  grid_col    INT  NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (venue_id, row_label, seat_number)
);

-- ============ EVENTS & SHOWS (organiser) ============
DO $$ BEGIN
  CREATE TYPE event_type AS ENUM ('MOVIE','CONCERT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS events (
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

CREATE TABLE IF NOT EXISTS shows (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  venue_id   UUID NOT NULL REFERENCES venues(id),
  starts_at  TIMESTAMPTZ NOT NULL,
  status     TEXT NOT NULL DEFAULT 'SCHEDULED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shows_starts_at ON shows (starts_at);

CREATE TABLE IF NOT EXISTS show_category_prices (
  show_id     UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES seat_categories(id),
  price       NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  PRIMARY KEY (show_id, category_id)
);

-- ============ SEAT MAP PER SHOW (the hot table) ============
DO $$ BEGIN
  CREATE TYPE seat_status AS ENUM ('AVAILABLE','HELD','OFFERED','BOOKED','BLOCKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS show_seats (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id         UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  venue_seat_id   UUID NOT NULL REFERENCES venue_seats(id),
  category_id     UUID NOT NULL REFERENCES seat_categories(id),
  row_label       TEXT NOT NULL,
  seat_number     INT  NOT NULL,
  grid_row        INT  NOT NULL,
  grid_col        INT  NOT NULL,
  price           NUMERIC(10,2) NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_show_seats_show     ON show_seats (show_id);
CREATE INDEX IF NOT EXISTS idx_show_seats_expiry   ON show_seats (hold_expires_at)  WHERE status='HELD';
CREATE INDEX IF NOT EXISTS idx_show_seats_offerexp ON show_seats (offer_expires_at) WHERE status='OFFERED';
CREATE INDEX IF NOT EXISTS idx_show_seats_avail    ON show_seats (show_id, category_id) WHERE status='AVAILABLE';

-- ============ HOLDS (audit trail) ============
CREATE TABLE IF NOT EXISTS seat_holds (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id    UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id),
  seat_count INT  NOT NULL,
  status     TEXT NOT NULL DEFAULT 'ACTIVE',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ BOOKINGS ============
CREATE TABLE IF NOT EXISTS bookings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference     TEXT UNIQUE NOT NULL,
  show_id       UUID NOT NULL REFERENCES shows(id),
  user_id       UUID NOT NULL REFERENCES users(id),
  customer_name  TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  total_amount  NUMERIC(10,2) NOT NULL,
  status        TEXT NOT NULL DEFAULT 'CONFIRMED',
  source        TEXT NOT NULL DEFAULT 'DIRECT',
  qr_payload    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS booking_seats (
  booking_id   UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  show_seat_id UUID NOT NULL REFERENCES show_seats(id),
  price_paid   NUMERIC(10,2) NOT NULL,
  PRIMARY KEY (booking_id, show_seat_id)
);
-- HARD GUARANTEE: a seat can appear in at most one booking
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_booking_seat ON booking_seats (show_seat_id);

-- ============ WAITLIST ============
CREATE TABLE IF NOT EXISTS waitlist_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id     UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES seat_categories(id),
  user_id     UUID NOT NULL REFERENCES users(id),
  user_email  TEXT NOT NULL,
  user_name   TEXT NOT NULL,
  seats_wanted INT NOT NULL DEFAULT 1 CHECK (seats_wanted BETWEEN 1 AND 6),
  status      TEXT NOT NULL DEFAULT 'WAITING',
  position    BIGSERIAL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_waitlist_active
  ON waitlist_entries (show_id, category_id, user_id)
  WHERE status IN ('WAITING','OFFERED');
CREATE INDEX IF NOT EXISTS idx_waitlist_queue
  ON waitlist_entries (show_id, category_id, position)
  WHERE status='WAITING';

CREATE TABLE IF NOT EXISTS waitlist_offers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id    UUID NOT NULL REFERENCES waitlist_entries(id) ON DELETE CASCADE,
  show_id     UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id),
  seat_ids    UUID[] NOT NULL,
  token_hash  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'PENDING',
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_offers_pending ON waitlist_offers (expires_at) WHERE status='PENDING';

-- ============ EMAIL AUDIT ============
CREATE TABLE IF NOT EXISTS email_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email    TEXT NOT NULL,
  template    TEXT NOT NULL,
  provider_id TEXT,
  status      TEXT NOT NULL,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
