import dotenv from 'dotenv';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Resolve .env from project root (two levels up from server/src/)
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

const DEV_JWT_SECRET = 'dev-secret-change-me';
const DEV_CRON_SECRET = 'dev-cron-secret-change-me';
const DEV_SUPER_ADMIN_JWT_SECRET = 'dev-super-admin-secret-change-me';
const nodeEnv = process.env.NODE_ENV || 'development';

if (nodeEnv === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEV_JWT_SECRET)) {
  throw new Error('JWT_SECRET must be set to a strong, non-default value when NODE_ENV=production');
}
if (!process.env.JWT_SECRET) {
  console.warn('[config] WARNING: JWT_SECRET is not set — using an insecure default. Set JWT_SECRET in .env.');
}

if (nodeEnv === 'production' && (!process.env.CRON_SECRET || process.env.CRON_SECRET === DEV_CRON_SECRET)) {
  throw new Error('CRON_SECRET must be set to a strong, non-default value when NODE_ENV=production');
}
if (!process.env.CRON_SECRET) {
  console.warn('[config] WARNING: CRON_SECRET is not set — using an insecure default. Set CRON_SECRET in .env.');
}

// impl-29: Super admin JWT secret — completely dedicated, never derived from
// JWT_SECRET (unlike the rider-secret pattern). This guards platform-operator
// access across all tenants, so it gets the same production boot-guard.
if (nodeEnv === 'production' && (!process.env.SUPER_ADMIN_JWT_SECRET || process.env.SUPER_ADMIN_JWT_SECRET === DEV_SUPER_ADMIN_JWT_SECRET)) {
  throw new Error('SUPER_ADMIN_JWT_SECRET must be set to a strong, non-default value when NODE_ENV=production');
}
if (!process.env.SUPER_ADMIN_JWT_SECRET) {
  console.warn('[config] WARNING: SUPER_ADMIN_JWT_SECRET is not set — using an insecure default. Set SUPER_ADMIN_JWT_SECRET in .env.');
}

const config = {
  port: process.env.PORT || 4000,
  nodeEnv,
  database: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/restaurant_ai',
  },
  jwt: {
    secret: process.env.JWT_SECRET || DEV_JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    // Rider tokens are signed with a distinct secret (derived from the main
    // one, no extra env var required) so a rider token can never verify
    // against the owner/staff secret or vice versa — structural separation
    // instead of relying on claim shape, so a rider token can never
    // accidentally pass an authorize() check meant for staff.
    riderSecret: crypto.createHash('sha256').update(`${process.env.JWT_SECRET || DEV_JWT_SECRET}:rider`).digest('hex'),
    riderExpiresIn: process.env.RIDER_JWT_EXPIRES_IN || '16h',
  },
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  // Used to build absolute links (staff invite emails/WhatsApp messages).
  // Falls back to the first configured CORS origin — that's already the
  // deployed frontend URL in every environment that has one set.
  appUrl: process.env.APP_URL || (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',')[0].trim(),
  whatsapp: {
    token: process.env.WHATSAPP_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    verifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'verify-me',
    appSecret: process.env.WHATSAPP_APP_SECRET || '',
    apiVersion: 'v21.0',
  },
  qwen: {
    apiKey: process.env.DASHSCOPE_API_KEY || '',
    model: process.env.QWEN_MODEL || 'qwen-plus',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  },
  timing: {
    estimatedPrepMin: 25,
    estimatedPrepMax: 30,
    // ETA agent (impl-17): how much longer the estimate grows per order
    // already queued ahead of this one, and per extra item in this order.
    perOrderQueueDelayMin: 3,
    perItemDelayMin: 1,
  },
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
  },
  // Shared secret for scheduler-triggered endpoints (/api/agents/*/run) —
  // these aren't user-authenticated, so a header secret stands in for a JWT.
  cronSecret: process.env.CRON_SECRET || DEV_CRON_SECRET,
  // impl-29: Super admin — dedicated JWT secret, not derived from jwt.secret.
  // Short-lived sessions (6h default) force periodic re-login for safety.
  superAdmin: {
    secret: process.env.SUPER_ADMIN_JWT_SECRET || DEV_SUPER_ADMIN_JWT_SECRET,
    sessionExpiresIn: process.env.SUPER_ADMIN_SESSION_EXPIRES_IN || '6h',
    mfaPendingExpiresIn: '5m',
  },
};

export default config;
