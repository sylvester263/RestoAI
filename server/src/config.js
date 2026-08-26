import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Resolve .env from project root (two levels up from server/src/)
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

const DEV_JWT_SECRET = 'dev-secret-change-me';
const nodeEnv = process.env.NODE_ENV || 'development';

if (nodeEnv === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEV_JWT_SECRET)) {
  throw new Error('JWT_SECRET must be set to a strong, non-default value when NODE_ENV=production');
}
if (!process.env.JWT_SECRET) {
  console.warn('[config] WARNING: JWT_SECRET is not set — using an insecure default. Set JWT_SECRET in .env.');
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
  },
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
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
  },
};

export default config;
