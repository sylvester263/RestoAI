// Redeploy trigger: pick up newly-configured CORS_ORIGINS on Vercel.
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import config from './config.js';
import { query } from './db/pool.js';
import { errorHandler } from './middleware/error-handler.js';
import authRoutes from './routes/auth.js';
import menuRoutes from './routes/menu.js';
import orderRoutes from './routes/orders.js';
import branchRoutes from './routes/branches.js';
import insightsRoutes from './routes/insights.js';
import whatsappRoutes from './routes/whatsapp.js';
import publicRoutes from './routes/public.js';
import tableSessionRoutes from './routes/table-sessions.js';
import reservationRoutes from './routes/reservations.js';
import inventoryRoutes from './routes/inventory.js';
import campaignRoutes from './routes/campaigns.js';
import landingPageRoutes from './routes/landing-page.js';
import sitesRoutes from './routes/sites.js';
import posRoutes from './routes/pos.js';
import riderRoutes from './routes/riders.js';
import customerRoutes from './routes/customers.js';
import segmentRoutes from './routes/segments.js';
import permissionRoutes from './routes/permissions.js';
import agentRoutes from './routes/agents.js';
import supplierRoutes from './routes/suppliers.js';
import purchaseOrderRoutes from './routes/purchase-orders.js';
import couponRoutes from './routes/coupons.js';
import staffInviteRoutes from './routes/staff-invites.js';
import riderAuthRoutes from './routes/rider-auth.js';
import riderAppRoutes from './routes/rider-app.js';
import contactRoutes from './routes/contact.js';
import analyticsRoutes from './routes/analytics.js';

const app = express();

// Vercel's edge sits in front of this function and sets X-Forwarded-For to the
// real client IP (not spoofable by external requests) — trust that one hop so
// express-rate-limit keys on the actual client, not Vercel's proxy.
app.set('trust proxy', 1);

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
// staff-invites includes a public token-gated accept endpoint — same ceiling
// as auth. Rider login has its own tighter, phone-keyed limiter (rider-auth.js).
app.use('/api/staff-invites', authLimiter);

// WhatsApp webhook is unauthenticated by design (Meta calls it directly), so
// it's rate-limited per-IP with a higher ceiling meant for real traffic.
const webhookLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 });
app.use('/api/whatsapp/webhook', webhookLimiter);

// Public customer ordering endpoints (menu browse + checkout + tracking) are
// unauthenticated, so they're rate-limited per-IP like the webhook.
const publicLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/public', publicLimiter);

// Dine-in table sessions are unauthenticated for the customer-facing paths too.
const tableSessionLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 150 });
app.use('/api/table-sessions', tableSessionLimiter);

// In-store display boards (impl-09) are public and poll continuously from a
// single unattended screen, so they get a higher per-IP ceiling than a normal
// public endpoint rather than the standard publicLimiter.
const displayBoardLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 600 });
app.use('/api/branches/:id/token-board', displayBoardLimiter);
app.use('/api/branches/:id/menu-board', displayBoardLimiter);

// Public landing-site pages are unauthenticated, same ceiling as other public reads.
const sitesLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/sites', sitesLimiter);

// ── Health check ──
// Verifies DB connectivity too, so a deployment issue (e.g. bad DATABASE_URL)
// is visible here rather than only surfacing on the first real request.
app.get('/health', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ status: 'ok', db: 'ok', time: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'ok', db: 'unreachable', error: err.message, time: new Date().toISOString() });
  }
});

// ── API routes ──
app.use('/api/auth', authRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/insights', insightsRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/table-sessions', tableSessionRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/riders', riderRoutes);
app.use('/api/landing-page', landingPageRoutes);
app.use('/api/sites', sitesRoutes);
app.use('/api/pos', posRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/segments', segmentRoutes);
app.use('/api/permissions', permissionRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/staff-invites', staffInviteRoutes);
app.use('/api/rider-auth', riderAuthRoutes);
app.use('/api/rider-app', riderAppRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/analytics', analyticsRoutes);

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
