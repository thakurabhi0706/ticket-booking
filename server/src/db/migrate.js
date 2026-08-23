/**
 * migrate.js — Applies schema.sql to the connected database.
 * Run: npm run migrate
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

async function migrate() {
  console.log('[migrate] Running schema migrations...');
  try {
    await pool.query(sql);
    console.log('[migrate] ✓ Done');
  } catch (err) {
    console.error('[migrate] ✗ Failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
