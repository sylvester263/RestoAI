/**
 * Per-user context the client needs to render itself (impl-33). Only the
 * module map for now — the nav reads it to hide areas outside the plan.
 * Hiding is cosmetic; every gated route enforces the same map server-side.
 */
import { Router } from 'express';
import { authenticate, checkTenantActive } from '../middleware/auth.js';
import { getTenantModules, MODULE_LABELS } from '../services/modules.js';
import { query } from '../db/pool.js';

const router = Router();
router.use(authenticate);
router.use(checkTenantActive);

// ── GET /api/me/modules ──
router.get('/modules', async (req, res, next) => {
  try {
    const [modules, planRes] = await Promise.all([
      getTenantModules(req.user.tenant_id),
      query('SELECT subscription_plan FROM tenants WHERE id = $1', [req.user.tenant_id]),
    ]);
    res.json({ modules, labels: MODULE_LABELS, plan: planRes.rows[0]?.subscription_plan || null });
  } catch (err) {
    next(err);
  }
});

export default router;
