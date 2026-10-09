/**
 * Offline PIN unlock (impl-33 Part 4). The device stores a salted PBKDF2
 * (SHA-256, 310k iterations) hash of the PIN — derived here from the PIN the
 * person typed while online, after the server confirmed it. The PIN itself is
 * never stored. Wrong attempts are counted in IndexedDB, so a lockout
 * survives closing the browser.
 */
import { get, put, del, getAll } from './db';

export const PBKDF2_ITERATIONS = 310000;
export const MAX_ATTEMPTS = 5;
const BASE_LOCK_MS = 5 * 60 * 1000;
const MAX_LOCK_MS = 60 * 60 * 1000;

const enc = new TextEncoder();
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(pin, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Store this person's offline-unlock record after a successful online
 * enrolment. `posToken` is POS-scoped (till endpoints only) by construction.
 */
export async function saveEnrollment({ user, tenant, pin, posToken, tokenExpiresAt, branchId }) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt, PBKDF2_ITERATIONS);
  await put('pins', {
    user_id: user.id,
    name: user.name,
    role: user.role,
    tenant,
    branch_id: branchId,
    salt: toB64(salt),
    hash: toB64(hash),
    iterations: PBKDF2_ITERATIONS,
    failed: 0,
    locked_until: 0,
    pos_token: posToken,
    token_expires_at: tokenExpiresAt,
    enrolled_at: new Date().toISOString(),
  });
}

export const listEnrollments = () => getAll('pins');
export const getEnrollment = (userId) => get('pins', userId);
export const removeEnrollment = (userId) => del('pins', userId);

export async function updateToken(userId, posToken, tokenExpiresAt) {
  const rec = await get('pins', userId);
  if (rec) await put('pins', { ...rec, pos_token: posToken, token_expires_at: tokenExpiresAt });
}

function lockDuration(failed) {
  // 5 wrong → 5 min, 10 → 10 min, 15 → 20 min … capped at an hour
  const rounds = Math.floor(failed / MAX_ATTEMPTS);
  return Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** Math.max(0, rounds - 1));
}

/**
 * @returns {Promise<{ ok: true, record } | { ok: false, reason: 'locked'|'wrong'|'unknown', lockedUntil?, attemptsLeft? }>}
 */
export async function verifyPin(userId, pin) {
  const rec = await get('pins', userId);
  if (!rec) return { ok: false, reason: 'unknown' };
  if (rec.locked_until && Date.now() < rec.locked_until) return { ok: false, reason: 'locked', lockedUntil: rec.locked_until };

  const hash = new Uint8Array(await derive(pin, fromB64(rec.salt), rec.iterations));
  if (sameBytes(hash, fromB64(rec.hash))) {
    await put('pins', { ...rec, failed: 0, locked_until: 0 });
    return { ok: true, record: rec };
  }
  const failed = (rec.failed || 0) + 1;
  const lockedUntil = failed % MAX_ATTEMPTS === 0 ? Date.now() + lockDuration(failed) : 0;
  await put('pins', { ...rec, failed, locked_until: lockedUntil });
  if (lockedUntil) return { ok: false, reason: 'locked', lockedUntil };
  return { ok: false, reason: 'wrong', attemptsLeft: MAX_ATTEMPTS - (failed % MAX_ATTEMPTS) };
}
