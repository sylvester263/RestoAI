/**
 * Seed the first super admin account (impl-29).
 *
 * Usage:
 *   node src/scripts/seed-super-admin.js
 *
 * Reads SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD from .env (or environment).
 * Refuses to run if a super admin with that email already exists.
 *
 * This is a one-off script, not an API endpoint — super admins are never
 * created through the regular tenant user flow.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pool, { query } from '../db/pool.js';

const email = process.env.SUPER_ADMIN_EMAIL;
const password = process.env.SUPER_ADMIN_PASSWORD;

if (!email || !password) {
  console.error('ERROR: Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD in your .env file');
  process.exit(1);
}

if (password.length < 12) {
  console.error('ERROR: Super admin password must be at least 12 characters');
  process.exit(1);
}

async function seed() {
  try {
    // Check if this email already exists
    const existing = await query('SELECT id, email FROM super_admins WHERE email = $1', [email.toLowerCase().trim()]);
    if (existing.rows.length > 0) {
      console.log(`Super admin already exists: ${existing.rows[0].email} (id: ${existing.rows[0].id})`);
      console.log('Skipping — delete the row first if you need to recreate.');
      process.exit(0);
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await query(
      `INSERT INTO super_admins (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email`,
      [email.toLowerCase().trim(), passwordHash],
    );

    const admin = result.rows[0];
    console.log(`\n✓ Super admin created successfully`);
    console.log(`  Email: ${admin.email}`);
    console.log(`  ID:    ${admin.id}`);
    console.log(`\nNext step: Log in at /super-admin/login and complete TOTP setup.`);
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
