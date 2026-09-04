/**
 * Super Admin Authentication Service (impl-29)
 *
 * Handles the two-step login flow:
 *   1. Email + password → short-lived mfa_pending token
 *   2. TOTP code → real session JWT (6h default)
 *
 * First login (totp_enabled=false) routes to TOTP enrollment instead.
 *
 * Key design: completely separate from tenant-side auth.
 * - Dedicated JWT secret (SUPER_ADMIN_JWT_SECRET), never derived from JWT_SECRET
 * - Separate table (super_admins), never joined with users
 * - type: 'super_admin' claim ensures non-interchangeability with tenant JWTs
 *
 * TOTP implementation uses Node's built-in crypto (no external OTP library needed):
 * - 30-second time step, 6-digit codes, SHA1 (standard RFC 6238)
 * - 1-step window tolerance (accepts previous/current/next code)
 */
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query } from '../db/pool.js';
import config from '../config.js';

// ── TOTP helpers (RFC 6238 / RFC 4226 using Node crypto) ──

const TOTP_PERIOD = 30; // seconds
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1;  // accept ±1 time step

function generateTotpSecret() {
  // 20 bytes (160 bits) base32-encoded — standard for SHA1-based TOTP
  const bytes = crypto.randomBytes(20);
  return base32Encode(bytes);
}

function base32Encode(buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(str) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const output = [];
  for (const char of str.toUpperCase()) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function generateTotpCode(secret, timeStep) {
  const secretBytes = base32Decode(secret);
  const timeBuffer = Buffer.alloc(8);
  timeBuffer.writeBigUInt64BE(BigInt(timeStep));
  const hmac = crypto.createHmac('sha1', secretBytes).update(timeBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, '0');
}

function verifyTotp(token, secret) {
  const now = Math.floor(Date.now() / 1000);
  const currentStep = Math.floor(now / TOTP_PERIOD);
  // Check current step ± window
  for (let i = -TOTP_WINDOW; i <= TOTP_WINDOW; i++) {
    const expected = generateTotpCode(secret, currentStep + i);
    if (token === expected) return true;
  }
  return false;
}

function totpUri(secret, email, issuer) {
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedEmail = encodeURIComponent(email);
  return `otpauth://totp/${encodedIssuer}:${encodedEmail}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;
}

// ── Auth service functions ──

/**
 * Step 1: Verify email + password.
 * Returns { admin, mfaPendingToken } on success.
 * Throws with a clear message on failure.
 */
export async function loginStep1(email, password) {
  const res = await query(
    'SELECT * FROM super_admins WHERE email = $1',
    [email.toLowerCase().trim()],
  );
  if (res.rows.length === 0) {
    throw new Error('Invalid email or password');
  }

  const admin = res.rows[0];
  const valid = await bcrypt.compare(password, admin.password_hash);
  if (!valid) {
    throw new Error('Invalid email or password');
  }

  // Issue a short-lived mfa_pending token — NOT a usable session yet.
  // This token only proves step 1 passed; step 2 (TOTP) is still required.
  const mfaPendingToken = jwt.sign(
    {
      type: 'mfa_pending',
      admin_id: admin.id,
      email: admin.email,
      totp_enabled: admin.totp_enabled,
    },
    config.superAdmin.secret,
    { expiresIn: config.superAdmin.mfaPendingExpiresIn },
  );

  // Update last_login_at (best-effort, don't block on it)
  query('UPDATE super_admins SET last_login_at = NOW() WHERE id = $1', [admin.id]).catch(() => {});

  return { admin, mfaPendingToken };
}

/**
 * Step 2: Verify TOTP code and issue real session JWT.
 * @param {string} mfaPendingToken — from step 1
 * @param {string} totpCode — 6-digit TOTP code
 * @returns {{ token: string, admin: object }}
 */
export async function loginStep2(mfaPendingToken, totpCode) {
  // Verify the mfa_pending token first
  let pending;
  try {
    pending = jwt.verify(mfaPendingToken, config.superAdmin.secret);
  } catch {
    throw new Error('MFA session expired — please log in again');
  }

  if (pending.type !== 'mfa_pending') {
    throw new Error('Invalid MFA session token');
  }

  // Load the admin to get their TOTP secret
  const adminRes = await query('SELECT * FROM super_admins WHERE id = $1', [pending.admin_id]);
  if (adminRes.rows.length === 0) {
    throw new Error('Admin account not found');
  }
  const admin = adminRes.rows[0];

  if (!admin.totp_enabled || !admin.totp_secret) {
    throw new Error('TOTP is not set up for this account — call /setup-mfa first');
  }

  // Verify the TOTP code
  if (!verifyTotp(totpCode, admin.totp_secret)) {
    throw new Error('Invalid TOTP code');
  }

  // Issue the real session JWT
  const token = jwt.sign(
    {
      type: 'super_admin',
      admin_id: admin.id,
      email: admin.email,
    },
    config.superAdmin.secret,
    { expiresIn: config.superAdmin.sessionExpiresIn },
  );

  return { token, admin: { id: admin.id, email: admin.email } };
}

/**
 * TOTP setup (first login or re-enrollment).
 * If no secret exists, generates one and returns it as a URI + QR-compatible data.
 * If a code is provided along with the secret, verifies and enables TOTP.
 *
 * @param {string} mfaPendingToken — from step 1
 * @param {object} opts — { secret?, totpCode? }
 * @returns {{ secret?, uri?, enabled? }}
 */
export async function setupTotp(mfaPendingToken, opts = {}) {
  let pending;
  try {
    pending = jwt.verify(mfaPendingToken, config.superAdmin.secret);
  } catch {
    throw new Error('MFA session expired — please log in again');
  }

  if (pending.type !== 'mfa_pending') {
    throw new Error('Invalid MFA session token');
  }

  const adminRes = await query('SELECT * FROM super_admins WHERE id = $1', [pending.admin_id]);
  if (adminRes.rows.length === 0) {
    throw new Error('Admin account not found');
  }
  const admin = adminRes.rows[0];

  // Phase 1: Generate a new secret (if none provided or admin has no secret yet)
  if (!opts.secret) {
    const secret = generateTotpSecret();
    // Store the secret but don't enable TOTP yet — needs code verification first
    await query('UPDATE super_admins SET totp_secret = $1 WHERE id = $2', [secret, admin.id]);

    const uri = totpUri(secret, admin.email, 'RestoAI Super Admin');

    return { secret, uri };
  }

  // Phase 2: Verify the code against the provided secret and enable TOTP
  if (!verifyTotp(opts.totpCode, opts.secret)) {
    throw new Error('Invalid TOTP code — please try again');
  }

  // Enable TOTP
  await query(
    'UPDATE super_admins SET totp_secret = $1, totp_enabled = true WHERE id = $2',
    [opts.secret, admin.id],
  );

  return { enabled: true };
}

/**
 * Generate a QR code data URL from an otpauth:// URI.
 * The frontend renders this as a QR code using qrcode.react.
 */
export function generateQrDataUri(uri) {
  return { otpauthUri: uri };
}
