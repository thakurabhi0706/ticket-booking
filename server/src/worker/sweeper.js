/**
 * sweeper.js ★
 *
 * TTL enforcement — dual mechanism (per spec §5.3):
 *  (a) DB-level: hold_expires_at / offer_expires_at are the source of truth.
 *      Correctness never depends on this job running.
 *  (b) This sweeper: materialises expired rows back to AVAILABLE and pushes SSE updates.
 *
 * Uses a TRANSACTION-scoped advisory lock (pg_try_advisory_xact_lock) so only one
 * instance sweeps at a time, even if the host scales horizontally.
 *
 * It must be the xact variant, not the session variant: hosted Postgres (Neon,
 * Supabase, PgBouncer) is usually fronted by a TRANSACTION-mode pooler, where
 * consecutive statements can land on different backends. A session-level
 * pg_advisory_lock() then unlocks on the wrong backend and leaks forever, after
 * which every later pg_try_advisory_lock() returns false and the sweeper silently
 * stops running. A transaction-scoped lock is released by COMMIT/ROLLBACK itself,
 * so it cannot leak and needs no explicit unlock.
 */
import { pool, tx } from '../db/pool.js';
import { config } from '../config.js';
import { broadcastSeatUpdate } from '../realtime/sse.js';
import { expireOffers, dispatchNotifications } from '../services/waitlistService.js';

/**
 * Release every seat whose hold TTL has passed, and mark the matching audit rows
 * EXPIRED. The CTE captures hold_group_id before the UPDATE nulls it out, so the
 * audit trail follows the seats that were actually released rather than being
 * expired on a separate clock (the two can drift, leaving ACTIVE holds with no seats).
 */
async function expireHolds(client) {
  const { rows } = await client.query(
    `WITH lapsed AS (
        SELECT id, hold_group_id
          FROM show_seats
         WHERE status = 'HELD' AND hold_expires_at <= now()
         ORDER BY id
         FOR UPDATE
     )
     UPDATE show_seats ss
        SET status='AVAILABLE', held_by=NULL, hold_expires_at=NULL,
            hold_group_id=NULL, updated_at=now()
       FROM lapsed l
      WHERE ss.id = l.id
     RETURNING ss.id, ss.show_id, l.hold_group_id`
  );

  const groupIds = [...new Set(rows.map(r => r.hold_group_id).filter(Boolean))];
  if (groupIds.length > 0) {
    await client.query(
      `UPDATE seat_holds SET status='EXPIRED'
        WHERE id = ANY($1::uuid[]) AND status='ACTIVE'`,
      [groupIds]
    );
  }

  // Safety net: an ACTIVE row past its deadline that no longer owns seats, because
  // lazy expiry let someone else re-hold them.
  await client.query(
    `UPDATE seat_holds sh SET status='EXPIRED'
      WHERE sh.status='ACTIVE' AND sh.expires_at <= now()
        AND NOT EXISTS (SELECT 1 FROM show_seats ss WHERE ss.hold_group_id = sh.id)`
  );

  return rows;
}

async function sweep() {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    try {
      // Skip if another instance is sweeping; the lock releases on COMMIT/ROLLBACK.
      const { rows: [{ got }] } = await client.query(
        `SELECT pg_try_advisory_xact_lock($1) AS got`, [config.SWEEP_LOCK_KEY]
      );
      if (!got) {
        await client.query('ROLLBACK');
        return;
      }

      const releasedHolds = await expireHolds(client);
      const { shows: offerShows, notifications } = await expireOffers(client);

      await client.query('COMMIT');

      // Only after COMMIT: the next person in line now has a claimable offer row.
      dispatchNotifications(notifications);

      const affectedShows = new Set([
        ...releasedHolds.map(r => r.show_id),
        ...offerShows,
      ]);

      for (const showId of affectedShows) {
        broadcastSeatUpdate(showId, []);  // empty delta = tell clients to re-fetch
      }

      if (releasedHolds.length > 0 || offerShows.length > 0) {
        console.log(`[sweeper] Released ${releasedHolds.length} hold(s); expired offers in ${offerShows.length} show(s)`);
      }
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
      console.error('[sweeper] Error during sweep:', err.message);
    }
  } catch (err) {
    console.error('[sweeper] Connection error:', err.message);
  } finally {
    client?.release();
  }
}

let sweeperInterval;

export function startSweeper() {
  // Run on boot to catch up after a cold start.
  sweep().catch(err => console.error('[sweeper] Boot sweep failed:', err.message));

  sweeperInterval = setInterval(sweep, config.SWEEPER_INTERVAL_MS);
  console.log(`[sweeper] Started — interval ${config.SWEEPER_INTERVAL_MS}ms`);
}

export function stopSweeper() {
  if (sweeperInterval) clearInterval(sweeperInterval);
}
