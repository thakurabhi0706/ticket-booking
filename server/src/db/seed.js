/**
 * seed.js — Creates demo users (admin, organiser, 3 customers),
 * a sample venue, categories, a movie event, and a show with seats.
 * Run: npm run seed
 * Safe to run multiple times (upserts by email).
 */
import bcrypt from 'bcryptjs';
import { pool, tx } from './pool.js';
import { config } from '../config.js';

async function seed() {
  console.log('[seed] Seeding demo data...');

  await tx(async (c) => {
    // ── Users ──────────────────────────────────────────────
    const users = [
      { name: 'Admin User',     email: config.ADMIN_EMAIL,        password: config.ADMIN_PASSWORD,  role: 'ADMIN' },
      { name: 'Organiser One',  email: 'organiser@ticketing.dev', password: 'Organiser@123',        role: 'ORGANISER' },
      { name: 'Alice Customer', email: 'alice@example.com',       password: 'Customer@123',         role: 'CUSTOMER' },
      { name: 'Bob Customer',   email: 'bob@example.com',         password: 'Customer@123',         role: 'CUSTOMER' },
      { name: 'Carol Customer', email: 'carol@example.com',       password: 'Customer@123',         role: 'CUSTOMER' },
    ];

    const userIds = {};
    for (const u of users) {
      const hash = await bcrypt.hash(u.password, config.BCRYPT_ROUNDS);
      const { rows } = await c.query(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [u.name, u.email, hash, u.role]
      );
      userIds[u.email] = rows[0].id;
    }
    console.log('[seed] ✓ Users created');

    // ── Venue ──────────────────────────────────────────────
    // uq_venue_name_city makes this a genuine no-op on a re-run.
    const { rows: [venue] } = await c.query(
      `INSERT INTO venues (name, city, address, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (name, city) DO NOTHING
       RETURNING id`,
      ['PVR Grand', 'Mumbai', 'Andheri West, Mumbai 400058', userIds[config.ADMIN_EMAIL]]
    );

    if (!venue) {
      console.log('[seed] Demo venue already exists — skipping venue/event/show seeding.');
      return;
    }

    const venueId = venue.id;

    // ── Categories ─────────────────────────────────────────
    const catRows = await c.query(
      `INSERT INTO seat_categories (venue_id, name, colour_hex, display_rank) VALUES
       ($1, 'Premium',  '#B45309', 0),
       ($1, 'Standard', '#374151', 1),
       ($1, 'Economy',  '#1E3A5F', 2)
       RETURNING id, name`,
      [venueId]
    );
    const cats = {};
    catRows.rows.forEach(r => cats[r.name] = r.id);
    console.log('[seed] ✓ Venue & categories created');

    // ── Venue seats (10 rows × 12 cols, aisles after col 4 and 8) ──
    const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    const seatsPerRow = 12;
    const aisleAfter = [4, 8]; // gap columns after these seat numbers

    const seatValues = [];
    for (let ri = 0; ri < rows.length; ri++) {
      const rowLabel = rows[ri];
      const catId = ri < 3 ? cats['Premium'] : ri < 7 ? cats['Standard'] : cats['Economy'];
      const gridRow = ri + 1;
      let gridCol = 1;
      for (let seatNum = 1; seatNum <= seatsPerRow; seatNum++) {
        seatValues.push({ venueId, catId, rowLabel, seatNum, gridRow, gridCol });
        gridCol++;
        if (aisleAfter.includes(seatNum)) gridCol++; // skip a column for the aisle
      }
    }

    // One statement instead of 120 round-trips.
    await c.query(
      `INSERT INTO venue_seats (venue_id, category_id, row_label, seat_number, grid_row, grid_col)
       SELECT * FROM UNNEST(
         $1::uuid[], $2::uuid[], $3::text[], $4::int[], $5::int[], $6::int[]
       )
       ON CONFLICT (venue_id, row_label, seat_number) DO NOTHING`,
      [
        seatValues.map(s => s.venueId),
        seatValues.map(s => s.catId),
        seatValues.map(s => s.rowLabel),
        seatValues.map(s => s.seatNum),
        seatValues.map(s => s.gridRow),
        seatValues.map(s => s.gridCol),
      ]
    );
    console.log(`[seed] ✓ Venue seats created (${seatValues.length} seats)`);

    // ── Event ──────────────────────────────────────────────
    const { rows: [event] } = await c.query(
      `INSERT INTO events (organiser_id, title, type, description, language, duration_min)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        userIds['organiser@ticketing.dev'],
        'Interstellar — IMAX Re-Release',
        'MOVIE',
        'Christopher Nolan\'s epic space odyssey returns to IMAX screens in full 70mm glory.',
        'English',
        169,
      ]
    );

    const { rows: [event2] } = await c.query(
      `INSERT INTO events (organiser_id, title, type, description, duration_min)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        userIds['organiser@ticketing.dev'],
        'Coldplay — Music of the Spheres World Tour',
        'CONCERT',
        'Experience Coldplay live with their record-breaking Music of the Spheres tour.',
        180,
      ]
    );
    console.log('[seed] ✓ Events created');

    // ── Shows ──────────────────────────────────────────────
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(19, 0, 0, 0);

    const dayAfter = new Date();
    dayAfter.setDate(dayAfter.getDate() + 2);
    dayAfter.setHours(20, 0, 0, 0);

    const { rows: [show1] } = await c.query(
      `INSERT INTO shows (event_id, venue_id, starts_at) VALUES ($1,$2,$3) RETURNING id`,
      [event.id, venueId, tomorrow.toISOString()]
    );

    const { rows: [show2] } = await c.query(
      `INSERT INTO shows (event_id, venue_id, starts_at) VALUES ($1,$2,$3) RETURNING id`,
      [event2.id, venueId, dayAfter.toISOString()]
    );

    // ── Prices ────────────────────────────────────────────
    for (const show of [show1, show2]) {
      const multiplier = show.id === show1.id ? 1 : 1.5;
      await c.query(
        `INSERT INTO show_category_prices (show_id, category_id, price) VALUES
         ($1, $2, $3), ($1, $4, $5), ($1, $6, $7)`,
        [
          show.id,
          cats['Premium'],  Math.round(450 * multiplier),
          cats['Standard'], Math.round(250 * multiplier),
          cats['Economy'],  Math.round(150 * multiplier),
        ]
      );
    }
    console.log('[seed] ✓ Shows & prices created');

    // ── Fan-out show_seats (one INSERT…SELECT per show) ────
    let fannedOut = 0;
    for (const show of [show1, show2]) {
      const { rowCount } = await c.query(
        `INSERT INTO show_seats
           (show_id, venue_seat_id, category_id, row_label, seat_number, grid_row, grid_col, price)
         SELECT $1, vs.id, vs.category_id, vs.row_label, vs.seat_number, vs.grid_row, vs.grid_col, scp.price
           FROM venue_seats vs
           JOIN show_category_prices scp
             ON scp.show_id = $1 AND scp.category_id = vs.category_id
          WHERE vs.venue_id = $2 AND vs.is_active = TRUE
         ON CONFLICT (show_id, venue_seat_id) DO NOTHING`,
        [show.id, venueId]
      );
      fannedOut += rowCount;
    }
    console.log(`[seed] ✓ Show seats fanned out (${fannedOut} rows)`);
  });

  console.log('\n[seed] ✓ Seeding complete!');
  console.log('\nDemo credentials:');
  console.log('  Admin:     ', config.ADMIN_EMAIL, '/', config.ADMIN_PASSWORD);
  console.log('  Organiser:  organiser@ticketing.dev / Organiser@123');
  console.log('  Customer 1: alice@example.com / Customer@123');
  console.log('  Customer 2: bob@example.com / Customer@123');
  console.log('  Customer 3: carol@example.com / Customer@123');

  await pool.end();
}

seed().catch(err => {
  console.error('[seed] ✗', err.message);
  process.exit(1);
});
