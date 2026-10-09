/**
 * Fiscal retry sweep (impl-33 Part 3). Bills are also retried after every
 * settlement for that tenant (routes/pos.js); this catches tenants that stop
 * selling while bills are still queued. Not in vercel.json yet: every tenant
 * is on fiscal_provider 'none' until a real integrator exists.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireCronSecret } from '../middleware/cron-auth.js';
import { retryPendingFiscal } from '../services/fiscal.js';

const router = Router();
const retryLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30 });

async function runRetry(req, res, next) {
  try {
    res.json(await retryPendingFiscal({ limit: 100 }));
  } catch (err) {
    next(err);
  }
}
router.get('/retry', retryLimiter, requireCronSecret, runRetry);
router.post('/retry', retryLimiter, requireCronSecret, runRetry);

export default router;
