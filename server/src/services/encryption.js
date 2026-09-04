/**
 * Encryption-at-rest for sensitive values that must be recoverable (unlike a
 * password, which only ever needs a one-way hash). First use: the WhatsApp
 * Embedded Signup two-step verification PIN (impl-30) — no other encrypted
 * value existed in this codebase before, so this establishes the pattern
 * rather than following one.
 *
 * AES-256-GCM: authenticated encryption, so tampering with the stored value
 * is detected (decrypt throws) rather than silently returning garbage.
 * Stored format is "iv:authTag:ciphertext", all hex — a single TEXT column
 * value, easy to store/compare without a custom SQL type.
 */
import crypto from 'crypto';
import config from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV is the recommended/standard size for GCM

function getKey() {
  const key = Buffer.from(config.encryptionKey, 'hex');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes (64 hex characters)');
  }
  return key;
}

export function encrypt(plaintext) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decrypt(stored) {
  const parts = stored.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted value');
  }
  const [ivHex, authTagHex, ciphertextHex] = parts;
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
