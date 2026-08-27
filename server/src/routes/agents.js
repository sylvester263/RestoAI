/**
 * Agentic AI systems (impl-14..21). Every "run" endpoint here is
 * scheduler-triggered (Vercel Cron), never user-authenticated — protected
 * by requireCronSecret instead of a JWT. Everything else (previews, flag
 * review, settings) is a normal authenticated admin endpoint. There is no
 * router-level router.use(authenticate) here on purpose — mixing the two
 * auth models on one router previously caused a real bug (see riders.js's
 * comment on the same class of mistake).
 */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.js';
import { requireCronSecret } from '../middleware/cron-auth.js';
import { query } from '../db/pool.js';

import { sendBriefingForTenant } from '../services/daily-briefing-agent.js';
import { findLapsedCustomers, sendWinbackToCustomer } from '../services/winback-agent.js';
import { previewSuggestion, autoAssign, DispatchError } from '../services/dispatch-agent.js';
import { runReconciliation } from '../services/reconciliation-agent.js';
import { runAbuseScan } from '../services/abuse-detection-agent.js';

const router = Router();

function requireOwner(req, res, next) {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: { message: 'Only the owner can manage agent settings' } });
  }
  next();
}

// ── Agent settings (owner-only, per-tenant automation toggles) ──
router.get('/settings', authenticate, requireOwner, async (req, res, next) => {
  try {
    const result = await query(
      'SELECT agent_winback_enabled, agent_dispatch_mode FROM tenants WHERE id = $1',
      [req.user.tenant_id],
    );
    res.json({
      winback_enabled: result.rows[0].agent_winback_enabled,
      dispatch_mode: result.rows[0].agent_dispatch_mode,
    });
  } catch (err) {
    next(err);
  }
});

const settingsSchema = z.object({
  winback_enabled: z.boolean().optional(),
  dispatch_mode: z.enum(['suggest_only', 'auto']).optional(),
});

router.put('/settings', authenticate, requireOwner, async (req, res, next) => {
  try {
    const data = settingsSchema.parse(req.body);
    const sets = [];
    const params = [req.user.tenant_id];
    if (data.winback_enabled !== undefined) {
      params.push(data.winback_enabled);
      sets.push(`agent_winback_enabled = $${params.length}`);
    }
    if (data.dispatch_mode !== undefined) {
      params.push(data.dispatch_mode);
      sets.push(`agent_dispatch_mode = $${params.length}`);
    }
    if (sets.length === 0) {
      return res.status(400).json({ error: { message: 'No fields to update' } });
    }
    const result = await query(
      `UPDATE tenants SET ${sets.join(', ')} WHERE id = $1 RETURNING agent_winback_enabled, agent_dispatch_mode`,
      params,
    );
    res.json({
      winback_enabled: result.rows[0].agent_winback_enabled,
      dispatch_mode: result.rows[0].agent_dispatch_mode,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

// ═══ impl-14 — Daily Briefing ═══

async function runDailyBriefing(req, res, next) {
  try {
    const tenantsRes = await query('SELECT id FROM tenants');
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const tenant of tenantsRes.rows) {
      try {
        const result = await sendBriefingForTenant(tenant.id);
        if (result.status === 'sent') sent++;
        else skipped++;
      } catch (err) {
        failed++;
        console.error(`[agents:daily-briefing] tenant ${tenant.id} failed:`, err.message);
      }
    }
    res.json({ sent, skipped, failed });
  } catch (err) {
    next(err);
  }
}
// GET: Vercel Cron invokes scheduled paths with GET + Authorization: Bearer.
// POST: manual/demo trigger with an X-Cron-Secret header (see impl-14 spec).
router.get('/daily-briefing/run', requireCronSecret, runDailyBriefing);
router.post('/daily-briefing/run', requireCronSecret, runDailyBriefing);

// ═══ impl-15 — Win-Back ═══

async function runWinback(req, res, next) {
  try {
    const tenantsRes = await query('SELECT id FROM tenants WHERE agent_winback_enabled = true');
    let sent = 0;
    let failed = 0;
    for (const tenant of tenantsRes.rows) {
      try {
        const lapsed = await findLapsedCustomers(tenant.id);
        for (const customer of lapsed) {
          try {
            await sendWinbackToCustomer(tenant.id, customer);
            sent++;
          } catch (err) {
            failed++;
            console.error(`[agents:winback] tenant ${tenant.id} customer ${customer.id} failed:`, err.message);
          }
        }
      } catch (err) {
        console.error(`[agents:winback] tenant ${tenant.id} failed:`, err.message);
      }
    }
    res.json({ sent, failed });
  } catch (err) {
    next(err);
  }
}
router.get('/winback/run', requireCronSecret, runWinback);
router.post('/winback/run', requireCronSecret, runWinback);

router.get('/winback/preview', authenticate, authorize('reports.view'), async (req, res, next) => {
  try {
    const lapsed = await findLapsedCustomers(req.user.tenant_id);
    res.json({ customers: lapsed });
  } catch (err) {
    next(err);
  }
});

// ═══ impl-16 — Dispatch ═══

router.get('/dispatch/suggest/:orderId', authenticate, authorize('orders.status_update'), async (req, res, next) => {
  try {
    const suggestion = await previewSuggestion(req.params.orderId, req.user.tenant_id);
    if (!suggestion) {
      return res.status(400).json({ error: { message: "No available riders for this order's branch" } });
    }
    res.json(suggestion);
  } catch (err) {
    if (err instanceof DispatchError) {
      return res.status(err.status).json({ error: { message: err.message } });
    }
    next(err);
  }
});

router.post('/dispatch/auto-assign', authenticate, authorize('orders.status_update'), async (req, res, next) => {
  try {
    const { order_id } = req.body;
    if (!order_id) {
      return res.status(400).json({ error: { message: 'order_id is required' } });
    }
    const existing = await query('SELECT id FROM rider_assignments WHERE order_id = $1', [order_id]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: { message: 'This order is already assigned to a rider' } });
    }
    const result = await autoAssign(order_id, req.user.tenant_id);
    if (!result) {
      return res.status(400).json({ error: { message: "No available riders for this order's branch" } });
    }
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof DispatchError) {
      return res.status(err.status).json({ error: { message: err.message } });
    }
    next(err);
  }
});

// ═══ impl-18 — Reconciliation ═══

async function runReconciliationScan(req, res, next) {
  try {
    const tenantsRes = await query('SELECT id FROM tenants');
    const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    let flagsCreated = 0;
    let failed = 0;
    for (const tenant of tenantsRes.rows) {
      try {
        flagsCreated += await runReconciliation(tenant.id, since);
      } catch (err) {
        failed++;
        console.error(`[agents:reconciliation] tenant ${tenant.id} failed:`, err.message);
      }
    }
    res.json({ flags_created: flagsCreated, failed });
  } catch (err) {
    next(err);
  }
}
router.get('/reconciliation/run', requireCronSecret, runReconciliationScan);
router.post('/reconciliation/run', requireCronSecret, runReconciliationScan);

router.get('/reconciliation/flags', authenticate, authorize('reports.view'), async (req, res, next) => {
  try {
    const status = req.query.status || 'open';
    const result = await query(
      `SELECT f.*, o.order_number FROM agent_reconciliation_flags f
       LEFT JOIN orders o ON o.id = f.order_id
       WHERE f.tenant_id = $1 AND ($2 = 'all' OR f.status = $2)
       ORDER BY CASE f.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, f.detected_at DESC`,
      [req.user.tenant_id, status],
    );
    res.json({ flags: result.rows });
  } catch (err) {
    next(err);
  }
});

const flagStatusSchema = z.object({ status: z.enum(['open', 'reviewed', 'resolved', 'dismissed']) });

router.put('/reconciliation/flags/:id/status', authenticate, authorize('reports.view'), async (req, res, next) => {
  try {
    const data = flagStatusSchema.parse(req.body);
    const result = await query(
      `UPDATE agent_reconciliation_flags SET status = $3, reviewed_by = $4, reviewed_at = NOW()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [req.user.tenant_id, req.params.id, data.status, req.user.id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Flag not found' } });
    }
    res.json({ flag: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

// ═══ impl-21 — Abuse Detection (order/review checks only — coupon-abuse pending impl-12) ═══

async function runAbuseDetection(req, res, next) {
  try {
    const tenantsRes = await query('SELECT id FROM tenants');
    let flagsCreated = 0;
    let failed = 0;
    for (const tenant of tenantsRes.rows) {
      try {
        flagsCreated += await runAbuseScan(tenant.id);
      } catch (err) {
        failed++;
        console.error(`[agents:abuse-detection] tenant ${tenant.id} failed:`, err.message);
      }
    }
    res.json({ flags_created: flagsCreated, failed });
  } catch (err) {
    next(err);
  }
}
router.get('/abuse-detection/run', requireCronSecret, runAbuseDetection);
router.post('/abuse-detection/run', requireCronSecret, runAbuseDetection);

router.get('/abuse-detection/flags', authenticate, authorize('reports.view'), async (req, res, next) => {
  try {
    const status = req.query.status || 'open';
    const result = await query(
      `SELECT * FROM agent_abuse_flags
       WHERE tenant_id = $1 AND ($2 = 'all' OR status = $2)
       ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, detected_at DESC`,
      [req.user.tenant_id, status],
    );
    res.json({ flags: result.rows });
  } catch (err) {
    next(err);
  }
});

const abuseStatusSchema = z.object({ status: z.enum(['open', 'reviewed', 'confirmed', 'false_positive']) });

router.put('/abuse-detection/flags/:id/status', authenticate, authorize('reports.view'), async (req, res, next) => {
  try {
    const data = abuseStatusSchema.parse(req.body);
    const result = await query(
      `UPDATE agent_abuse_flags SET status = $3 WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [req.user.tenant_id, req.params.id, data.status],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Flag not found' } });
    }
    res.json({ flag: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

export default router;
