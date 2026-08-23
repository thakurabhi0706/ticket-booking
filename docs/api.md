# CineWave API Documentation

Base URL: `/api`  
Authentication: HTTP Bearer Token (`Authorization: Bearer <jwt>`)  
Response Format: JSON (`Content-Type: application/json`)

---

## Error Handling Envelope

All errors follow a standardized structure:

```json
{
  "error": {
    "code": "SEAT_UNAVAILABLE",
    "message": "One or more seats are no longer available",
    "details": null
  }
}
```

### Common HTTP Status Codes
- `200 OK`: Request succeeded.
- `201 Created`: Resource successfully created.
- `400 Bad Request`: Validation failure or bad request parameters.
- `401 Unauthorized`: Missing or invalid Bearer token.
- `403 Forbidden`: Authenticated user lacks permission (role mismatch).
- `404 Not Found`: Target resource does not exist.
- `409 Conflict`: Business logic violation (seat already held/booked, duplicate waitlist entry, non-sold-out waitlist join attempt).
- `410 Gone`: Resource expired (seat hold or waitlist offer past TTL).
- `429 Too Many Requests`: Rate limit exceeded.

---

## 1. Authentication (`/api/auth`)

### `POST /api/auth/register`
Registers a new customer or organiser account. Cannot register as `ADMIN`.

**Request Body:**
```json
{
  "name": "Alice Smith",
  "email": "alice@example.com",
  "password": "Customer@123",
  "role": "CUSTOMER"
}
```

**Response (201 Created):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "u1111111-1111-1111-1111-111111111111",
    "name": "Alice Smith",
    "email": "alice@example.com",
    "role": "CUSTOMER"
  }
}
```

### `POST /api/auth/login`
Authenticates existing credentials and returns a JWT token.

**Request Body:**
```json
{
  "email": "alice@example.com",
  "password": "Customer@123"
}
```

**Response (200 OK):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "u1111111-1111-1111-1111-111111111111",
    "name": "Alice Smith",
    "email": "alice@example.com",
    "role": "CUSTOMER"
  }
}
```

### `GET /api/auth/me`
Returns current authenticated user details. (Requires Auth)

---

## 2. Browse & Events (`/api/events`)

### `GET /api/events`
Browse upcoming events with optional filters.

**Query Parameters:**
- `type`: `MOVIE` | `CONCERT`
- `city`: Filter by venue city
- `q`: Search title keywords
- `dateFrom`: Start date (ISO format)
- `dateTo`: End date (ISO format)
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 12)

### `GET /api/events/:id`
Retrieves event details along with all upcoming scheduled shows and category availability counts.

---

## 3. Shows & Real-time Seat Map (`/api/shows`)

### `GET /api/shows/:id`
Retrieves show information, venue metadata, per-category pricing, and per-category availability statistics.

### `GET /api/shows/:id/seats`
Retrieves the full visual seat grid array for a show.

**Response Item:**
```json
{
  "id": "s1111111-1111-1111-1111-111111111111",
  "row_label": "A",
  "seat_number": 5,
  "grid_row": 1,
  "grid_col": 5,
  "status": "AVAILABLE",
  "price": "450.00",
  "category_name": "Premium",
  "category_colour": "#B45309"
}
```

### `GET /api/shows/:id/stream` (SSE)
Establishes a Server-Sent Events stream for real-time seat status changes. Authenticated.

The browser `EventSource` API cannot set an `Authorization` header, so this endpoint
also accepts the JWT as a query parameter: `GET /api/shows/:id/stream?token=<jwt>`.
A `Bearer` header works too (e.g. from `curl`).

**Emitted Events:**
- `seat_update`: `{ "type": "seat_update", "seats": [{ "seatId": "...", "status": "HELD" }] }`
  A `seats` array that is **empty** means "re-fetch the full map" — the sweeper emits
  this after a batch release rather than enumerating every changed row.
- `waitlist_offer`: `{ "token": "...", "showId": "..." }` — targeted at the offered user.
- `: ping`: Keep-alive comments every 25 seconds.

---

## 4. Seat Holds & Checkout (`/api`)

### `POST /api/shows/:showId/holds`
Atomically holds 1 to 6 seats for the authenticated user for the configured TTL (`SEAT_HOLD_TTL_SECONDS`).

**Request Body:**
```json
{
  "seatIds": ["s1111111-1111-1111-1111-111111111111", "s2222222-2222-2222-2222-222222222222"]
}
```

**Response (201 Created):**
```json
{
  "holdGroupId": "h9999999-9999-9999-9999-999999999999",
  "expiresAt": "2026-08-23T14:40:00.000Z",
  "seats": [...],
  "total": 900
}
```

**Errors:** `409 SEAT_UNAVAILABLE` if any requested seat is held/booked by another customer.

### `GET /api/holds/:groupId`
Retrieves hold group details and remaining server-authoritative TTL.

### `DELETE /api/holds/:groupId`
Explicitly releases a seat hold group (the checkout page's **Cancel** button).

### `POST /api/holds/:groupId/release?token=<jwt>`
Identical behaviour, exposed as a `POST` for `navigator.sendBeacon()` on `beforeunload`.
Beacons are always `POST` and cannot set headers, hence the query-parameter token.
This is belt-and-braces on top of the TTL — the hold expires on its own regardless.

---

## 5. Bookings & Verification (`/api/bookings`)

### `POST /api/bookings`
Converts an active hold into a confirmed booking. Generates unique reference & HMAC QR code payload and dispatches confirmation email.

**Request Body:**
```json
{
  "holdGroupId": "h9999999-9999-9999-9999-999999999999",
  "customer": {
    "name": "Alice Smith",
    "email": "alice@example.com",
    "phone": "+919876543210"
  }
}
```

**Response (201 Created):**
```json
{
  "reference": "BKG-7F3A9C21",
  "seats": [...]
}
```

### `GET /api/bookings/me`
Lists booking history for the logged-in customer.

### `GET /api/bookings/:id`
Retrieves single booking details including generated QR Data URL.

### `POST /api/bookings/:id/cancel`
Cancels a confirmed booking (if prior to cancellation cutoff time). Frees seats and triggers waitlist auto-promotion.

### `GET /api/bookings/verify/:reference?s=<signature>`
Public gate-verification endpoint used by venue scanners to validate HMAC-signed QR ticket codes.

---

## 6. Waitlist & Time-Limited Offers (`/api`)

### `POST /api/shows/:showId/waitlist`
Joins the waitlist queue for a specific category when sold out.

**Request Body:**
```json
{
  "categoryId": "c1111111-1111-1111-1111-111111111111",
  "seatsWanted": 2
}
```

**Response (201 Created):**
```json
{
  "entryId": "w1111111-1111-1111-1111-111111111111",
  "position": 1
}
```

### `GET /api/waitlist/me`  ·  `GET /api/me/waitlist`
Lists active/historical waitlist entries with queue positions. Both paths are the
same handler.

### `DELETE /api/waitlist/:entryId`
Leaves a waitlist queue.

### `GET /api/waitlist/offers/:token`
Validates a time-limited offer token sent via email and returns remaining countdown seconds.

### `POST /api/waitlist/offers/:token/claim`
Claims an active waitlist offer and creates a confirmed booking.

### `POST /api/waitlist/offers/:token/decline`
Declines an offer, immediately freeing seats for promotion to the next waitlisted customer.

---

## 6b. Venue directory (`/api/venues`)

*(Requires `ORGANISER` or `ADMIN` role — read-only; mutations live under `/api/admin`)*

- `GET /api/venues`: All venues with `seat_count` and their seat categories. Used by
  the organiser's "schedule a show" form to price every category.
- `GET /api/venues/:id`: One venue with its categories.

---

## 7. Organiser API (`/api/organiser`)

*(Requires `ORGANISER` or `ADMIN` role)*

- `POST /api/organiser/events`: Create movie or concert listing.
- `GET /api/organiser/events`: List owned events.
- `POST /api/organiser/events/:id/shows`: Schedule show date/time & category prices, fanning out `show_seats`.
- `GET /api/organiser/events/:id/summary`: Comprehensive revenue dashboard (tickets sold, gross revenue, cancellations, refunded value, occupancy %, waitlist depth).
- `GET /api/organiser/shows/:showId/bookings`: List all bookings for a show.

---

## 8. Admin API (`/api/admin`)

*(Requires `ADMIN` role)*

- `POST /api/admin/venues`: Create new venue.
- `GET /api/admin/venues`: List all venues.
- `GET /api/admin/venues/:id`: One venue with its seat categories.
- `PATCH /api/admin/venues/:id`: Update name / city / address.
- `DELETE /api/admin/venues/:id`: Delete a venue. Refused with `409 VENUE_IN_USE`
  while any show is scheduled there.
- `POST /api/admin/venues/:id/categories`: Add seat category (e.g. Premium, Standard).
- `POST /api/admin/venues/:id/seats/bulk`: Bulk-generate visual seat grid layout with row mappings and aisle gaps.
- `GET /api/admin/venues/:id/layout`: Fetch complete layout grid.

---

## Sample `curl` Commands

### 1. Register & Login
```bash
# Register
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@example.com","password":"Customer@123","role":"CUSTOMER"}'

# Login
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"Customer@123"}'
```

### 2. Hold & Book Seats
```bash
# Hold seats
curl -X POST http://localhost:4000/api/shows/<SHOW_ID>/holds \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"seatIds":["<SEAT_ID_1>","<SEAT_ID_2>"]}'

# Confirm booking
curl -X POST http://localhost:4000/api/bookings \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"holdGroupId":"<HOLD_GROUP_ID>","customer":{"name":"Alice","email":"alice@example.com"}}'
```
