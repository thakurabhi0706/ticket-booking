import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: config.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  // Headroom matters: a burst of concurrent seat holds each occupies a client for
  // the length of its transaction. At max=20 a 20-way burst starved the sweeper and
  // surfaced as "Connection terminated due to connection timeout" 500s.
  max: config.DB_POOL_MAX,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: config.DB_CONNECT_TIMEOUT_MS,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

/**
 * Run a function inside a single transaction.
 * The client is automatically committed or rolled back.
 * @param {(client: pg.PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    // A failing ROLLBACK (broken connection) must not mask the real error.
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[DB] ROLLBACK failed:', rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}
