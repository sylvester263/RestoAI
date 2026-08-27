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
import { runReplenishmentScan } from '../services/replenishment-agent.js';
import { createDraftPurchaseOrder } from '../services/purchase-orders.js';
import { runMenuInsightScan } from '../services/menu-insight-agent.js';

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

// ═══ impl-21 — Abuse Detection (order, review, and coupon-redemption pattern checks) ═══

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

// ═══ impl-19 — Replenishment (suggest-only, never auto-orders) ═══

async function runReplenishment(req, res, next) {
  try {
    const tenantsRes = await query('SELECT id FROM tenants');
    let suggestionsCreated = 0;
    let failed = 0;
    for (const tenant of tenantsRes.rows) {
      try {
        suggestionsCreated += await runReplenishmentScan(tenant.id);
      } catch (err) {
        failed++;
        console.error(`[agents:replenishment] tenant ${tenant.id} failed:`, err.message);
      }
    }
    res.json({ suggestions_created: suggestionsCreated, failed });
  } catch (err) {
    next(err);
  }
}
router.get('/replenishment/run', requireCronSecret, runReplenishment);
router.post('/replenishment/run', requireCronSecret, runReplenishment);

router.get('/replenishment/suggestions', authenticate, authorize('inventory.manage'), async (req, res, next) => {
  try {
    const status = req.query.status || 'pending';
    const result = await query(
      `SELECT rs.*, i.name as ingredient_name, i.unit FROM agent_replenishment_suggestions rs
       JOIN ingredients i ON i.id = rs.ingredient_id
       WHERE rs.tenant_id = $1 AND ($2 = 'all' OR rs.status = $2)
       ORDER BY rs.created_at DESC`,
      [req.user.tenant_id, status],
    );
    res.json({ suggestions: result.rows });
  } catch (err) {
    next(err);
  }
});

router.post('/replenishment/suggestions/:id/approve', authenticate, authorize('inventory.manage'), async (req, res, next) => {
  try {
    const suggRes = await query(
      `SELECT * FROM agent_replenishment_suggestions WHERE id = $1 AND tenant_id = $2 AND status = 'pending'`,
      [req.params.id, req.user.tenant_id],
    );
    const suggestion = suggRes.rows[0];
    if (!suggestion) {
      return res.status(404).json({ error: { message: 'Suggestion not found or already actioned' } });
    }

    const ingredientRes = await query('SELECT * FROM ingredients WHERE id = $1', [suggestion.ingredient_id]);
    const ingredient = ingredientRes.rows[0];
    const supplierId = req.body.supplier_id || ingredient.preferred_supplier_id;
    if (!supplierId) {
      return res.status(400).json({ error: { message: 'No supplier specified — pass supplier_id or set a preferred supplier on this ingredient' } });
    }

    const po = await createDraftPurchaseOrder(req.user.tenant_id, ingredient.branch_id, supplierId, [
      { ingredient_id: ingredient.id, quantity: suggestion.suggested_quantity, unit_cost: ingredient.cost_per_unit },
    ]);

    await query(
      `UPDATE agent_replenishment_suggestions SET status = 'approved', purchase_order_id = $3 WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.user.tenant_id, po.id],
    );

    res.status(201).json({ purchase_order: po });
  } catch (err) {
    next(err);
  }
});

const suggestionStatusSchema = z.object({ status: z.enum(['dismissed']) });

router.put('/replenishment/suggestions/:id/status', authenticate, authorize('inventory.manage'), async (req, res, next) => {
  try {
    const data = suggestionStatusSchema.parse(req.body);
    const result = await query(
      `UPDATE agent_replenishment_suggestions SET status = $3 WHERE tenant_id = $1 AND id = $2 AND status = 'pending' RETURNING *`,
      [req.user.tenant_id, req.params.id, data.status],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Suggestion not found or already actioned' } });
    }
    res.json({ suggestion: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

// ═══ impl-20 — Menu/Pricing Insights ═══

async function runMenuInsights(req, res, next) {
  try {
    const tenantsRes = await query('SELECT id FROM tenants');
    let insightsCreated = 0;
    let failed = 0;
    for (const tenant of tenantsRes.rows) {
      try {
        insightsCreated += await runMenuInsightScan(tenant.id);
      } catch (err) {
        failed++;
        console.error(`[agents:menu-insights] tenant ${tenant.id} failed:`, err.message);
      }
    }
    res.json({ insights_created: insightsCreated, failed });
  } catch (err) {
    next(err);
  }
}
router.get('/menu-insights/run', requireCronSecret, runMenuInsights);
router.post('/menu-insights/run', requireCronSecret, runMenuInsights);

router.get('/menu-insights', authenticate, authorize('reports.view'), async (req, res, next) => {
  try {
    const status = req.query.status || 'new';
    const result = await query(
      `SELECT mi.*, m.name as menu_item_name FROM agent_menu_insights mi
       JOIN menu_items m ON m.id = mi.menu_item_id
       WHERE mi.tenant_id = $1 AND ($2 = 'all' OR mi.status = $2)
       ORDER BY mi.generated_at DESC`,
      [req.user.tenant_id, status],
    );
    res.json({ insights: result.rows });
  } catch (err) {
    next(err);
  }
});

const menuInsightStatusSchema = z.object({ status: z.enum(['new', 'acknowledged', 'acted_on', 'dismissed']) });

router.put('/menu-insights/:id/status', authenticate, authorize('reports.view'), async (req, res, next) => {
  try {
    const data = menuInsightStatusSchema.parse(req.body);
    const result = await query(
      `UPDATE agent_menu_insights SET status = $3 WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [req.user.tenant_id, req.params.id, data.status],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Insight not found' } });
    }
    res.json({ insight: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

export default router;
