/**
 * setRole.js — Change a user's role from the command line.
 *
 * Roles are assigned at registration and there is deliberately no API route that lets an
 * account promote itself, so this is the supported way to grant the first admin.
 *
 * Usage: npm run set-role -- <email> <CUSTOMER|ORGANISER|ADMIN>
 */
import { pool } from './pool.js';

const ROLES = ['CUSTOMER', 'ORGANISER', 'ADMIN'];

async function main() {
  const [email, roleArg] = process.argv.slice(2);
  const role = (roleArg || '').toUpperCase();

  if (!email || !role) {
    console.error('Usage: npm run set-role -- <email> <CUSTOMER|ORGANISER|ADMIN>');
    process.exit(1);
  }
  if (!ROLES.includes(role)) {
    console.error(`Role must be one of: ${ROLES.join(', ')} (got "${roleArg}")`);
    process.exit(1);
  }

  const { rows: [user] } = await pool.query(
    `UPDATE users SET role = $2::user_role
      WHERE lower(email) = lower($1)
      RETURNING id, name, email, role`,
    [email, role]
  );

  if (!user) {
    console.error(`No user found with email "${email}".`);
    process.exit(1);
  }

  console.log(`✓ ${user.name} <${user.email}> is now ${user.role}`);
  console.log('  Sign out and back in — the role is baked into the JWT at login.');
}

main()
  .catch((err) => { console.error('Failed:', err.message); process.exitCode = 1; })
  .finally(() => pool.end());
