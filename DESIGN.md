# System Design Write-Up — Ticket Booking System

## 1. Overview & Data Model

The ticket booking system handles high-concurrency ticket reservations for movies and concerts. To ensure data integrity under burst traffic, seat availability is materialised per show in the `show_seats` table rather than computed dynamically. Each physical seat in a venue fans out into a dedicated `show_seats` row per show runtime.

A seat follows a strict five-state lifecycle: `AVAILABLE`, `HELD`, `OFFERED`, `BOOKED`, and `BLOCKED`. Materialising seats per show enables individual rows to act as explicit transaction lock targets in PostgreSQL. Every seat state transition updates status, audit identifiers, and timestamp boundaries atomically within single database transactions.

## 2. Seat Hold & TTL Mechanism

Seat reservation relies on a dual-enforcement mechanism combining authoritative database predicates with an in-process materialisation sweeper:

1. **Database-Level Lazy Expiry (Authoritative)**: Every query checking seat availability treats `status = 'HELD'` with `hold_expires_at <= now()` as logically `AVAILABLE`. This guarantees that correctness never depends on background schedulers or external cron availability. If a hold expires, any user can claim the seat instantly.

2. **Scheduler Sweeper (Materialisation & SSE Trigger)**: An in-process worker runs every `SWEEPER_INTERVAL_MS` (default 15s) using a transaction-scoped PostgreSQL advisory lock (`pg_try_advisory_xact_lock`) to guarantee single-instance execution across scaled instances. The transaction-scoped variant is deliberate: behind a transaction-mode connection pooler (Neon, PgBouncer) a session-level `pg_advisory_lock` can unlock on a different backend than it locked, leaking the lock permanently and silently disabling the sweeper. The sweeper updates expired `HELD` seats back to `AVAILABLE` and broadcasts real-time Server-Sent Events (SSE) updates to connected clients.

Clients receive server-authoritative expiration timestamps (`expiresAt`) and enforce countdown timers. Upon user navigation or tab closure, `navigator.sendBeacon` sends an explicit release request to immediately free held seats.

## 3. Concurrency Prevention

Simultaneous attempts by multiple users to hold or book the same seat present a classic read-modify-write race condition. The system protects against double-booking using a three-layer defence:

```sql
BEGIN;
SELECT id FROM show_seats
 WHERE show_id = $1 AND id = ANY($2::uuid[])
 ORDER BY id FOR UPDATE;

UPDATE show_seats
   SET status = 'HELD', held_by = $3, hold_group_id = $4,
       hold_expires_at = now() + make_interval(secs => $5)
 WHERE show_id = $1 AND id = ANY($2::uuid[])
   AND (status = 'AVAILABLE' OR (status = 'HELD' AND hold_expires_at <= now()))
RETURNING id;
COMMIT;
```

1. **Deterministic Row Locking**: `SELECT ... ORDER BY id FOR UPDATE` locks target seat rows in primary key order, preventing cross-transaction deadlocks when concurrent users request overlapping seat sets.

2. **Atomic Conditional UPDATE**: The write operation includes availability predicates directly in its `WHERE` clause. The application verifies `RETURNING` row count against requested seat count; any mismatch triggers an immediate transaction rollback returning `409 SEAT_UNAVAILABLE`.

3. **Database Invariant Guarantee**: A partial unique index `uq_active_booking_seat` on `booking_seats(show_seat_id)` provides an unbypassable database constraint ensuring a seat can never belong to more than one active booking.

*Alternatives Rejected*: Optimistic locking requires complex application retry loops under contention. In-memory locks fail across multi-instance deployments. Distributed Redis locks introduce unnecessary infrastructure overhead.

## 4. Waitlist Auto-Assignment Flow

When a seat category is fully booked (`AVAILABLE` count = 0), customers can join a category waitlist queue. Entries are assigned a monotonically increasing position via PostgreSQL `BIGSERIAL` to enforce strict First-In-First-Out (FIFO) fairness.

When a customer cancels a booking, seat promotion executes inside the cancellation transaction:

1. The booking status updates to `CANCELLED` and its seats are freed.
2. The queue head is selected using `SELECT ... FOR UPDATE SKIP LOCKED` to prevent concurrent cancellation workers from processing the same waitlist entry.
3. If available seats satisfy `seats_wanted`, seats transition directly to `OFFERED` status, reserving them exclusively for that user (`offered_to`, `offer_expires_at`).
4. If available seats are insufficient for the head entry, FIFO fairness is preserved by keeping seats available for general sale while retaining the entry at the head of the queue.

## 5. Time-Limited Offer Handling

Waitlist offers generate a cryptographically secure random 256-bit token sent to the customer's email. Only the SHA-256 hash (`token_hash`) is stored in `waitlist_offers`, ensuring database leaks cannot compromise active offers.

Seats remain in `OFFERED` status for `WAITLIST_OFFER_TTL_SECONDS` (default 15m), preventing general users from sniping reserved seats. Claiming an offer executes an atomic conditional UPDATE (`status = 'OFFERED' AND offer_expires_at > now()`), creating a booking with `source = 'WAITLIST'`.

If an offer expires unclaimed, the sweeper marks the offer `EXPIRED`, frees seats back to `AVAILABLE`, and immediately invokes `promoteWaitlist` inside the same transaction, automatically passing the offer to the next waitlisted customer.

## 6. Trade-Offs & Limitations

- **Free-Tier Hosting**: Background sweepers pause if instances spin down on free hosting tiers; lazy SQL predicates maintain correctness.
- **Payment Processing**: Payment collection is simulated at checkout without third-party gateway integrations.
