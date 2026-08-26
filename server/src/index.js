import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import config from './config.js';
import { errorHandler } from './middleware/error-handler.js';
import authRoutes from './routes/auth.js';
import menuRoutes from './routes/menu.js';
import orderRoutes from './routes/orders.js';
import branchRoutes from './routes/branches.js';
import insightsRoutes from './routes/insights.js';
import whatsappRoutes from './routes/whatsapp.js';
import publicRoutes from './routes/public.js';

const app = express();

// ── Global middleware ──
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests (no Origin header, e.g. curl/server-to-server)
    if (!origin || config.corsOrigins.includes(origin)) {
      return callback(null, true);
    }
    const err = new Error('Not allowed by CORS');
    err.status = 403;
    return callback(err);
  },
}));
// Retain the raw request body so the WhatsApp webhook can verify Meta's
// X-Hub-Signature-256 HMAC, which must be computed over the exact bytes sent.
app.use(express.json({ limit: '10mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

// Rate limiting on webhook endpoint is lenient; tighten for auth endpoints
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
app.use('/api/auth', authLimiter);

// WhatsApp webhook is unauthenticated by design (Meta calls it directly), so
// it's rate-limited per-IP with a higher ceiling meant for real traffic.
const webhookLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 });
app.use('/api/whatsapp/webhook', webhookLimiter);

// Public customer ordering endpoints (menu browse + checkout + tracking) are
// unauthenticated, so they're rate-limited per-IP like the webhook.
const publicLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/public', publicLimiter);

// ── Health check ──
app.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ── API routes ──
app.use('/api/auth', authRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/insights', insightsRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/public', publicRoutes);

// ── Global error handler ──
app.use(errorHandler);

// Vercel imports this module as a serverless function handler and never needs
// a bound port — only listen when running as a standalone Node process.
if (!process.env.VERCEL) {
  app.listen(config.port, () => {
    console.log(`[server] running on http://localhost:${config.port} (${config.nodeEnv})`);
  });
}

export default app;
