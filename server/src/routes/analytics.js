/**
 * Branch-level analytics (impl-25) — side-by-side comparison, drill-down,
 * chain benchmarking, staff performance. Gated by 'reports.view' (the same
 * permission key already used for insights/reconciliation/menu-insights),
 * so this follows impl-10's existing RBAC exactly rather than introducing a
 * new key. Branch visibility is hard-locked via req.user.branchAccess
 * (attachBranchAccess) — never trust a client-supplied branch_id alone.
 */
import { Router } from 'express';
import { authenticate, authorize, canSeeBranch, attachBranchAccess } from '../middleware/auth.js';
import { query } from '../db/pool.js';
import {
  computeBranchKpis, branchRevenueTrend, branchTopItems, branchPeakHours,
  branchStaffPerformance, percentVsBaseline, normalizePeriod,
} from '../services/branch-analytics.js';

const router = Router();
router.use(authenticate);
router.use(attachBranchAccess);
router.use(authorize('reports.view'));

async function visibleBranches(req) {
  const result = await query('SELECT id, name FROM branches WHERE tenant_id = $1 ORDER BY name', [req.user.tenant_id]);
  if (req.user.branchAccess === null) return result.rows; // owner — every branch
  return result.rows.filter((b) => req.user.branchAccess.has(b.id));
}

// ── GET /api/analytics/branches/compare?period=today|week|month ──
router.get('/branches/compare', async (req, res, next) => {
  try {
    const period = normalizePeriod(req.query.period);
    const branches = await visibleBranches(req);
    const rows = await Promise.all(
      branches.map(async (b) => ({
        branch_id: b.id,
        branch_name: b.name,
        ...(await computeBranchKpis(req.user.tenant_id, b.id, period)),
      })),
    );
    res.json({ period, branches: rows });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/analytics/branches/:id?period=... ──
router.get('/branches/:id', async (req, res, next) => {
  try {
    if (!canSeeBranch(req, req.params.id)) {
      return res.status(403).json({ error: { message: "You don't have access to this branch" } });
    }
    const branchRes = await query('SELECT id, name FROM branches WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenant_id]);
    if (branchRes.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Branch not found' } });
    }
    const period = normalizePeriod(req.query.period);
    const [kpis, revenueTrend, topItems, peakHours] = await Promise.all([
      computeBranchKpis(req.user.tenant_id, req.params.id, period),
      branchRevenueTrend(req.user.tenant_id, req.params.id),
      branchTopItems(req.user.tenant_id, req.params.id),
      branchPeakHours(req.user.tenant_id, req.params.id, period),
    ]);
    res.json({ branch: branchRes.rows[0], period, ...kpis, revenue_trend: revenueTrend, top_items: topItems, peak_hours: peakHours });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/analytics/branches/:id/benchmark?period=... ──
// This branch vs. the tenant-wide (chain) average — an aggregate figure
// only, so a branch-locked manager benchmarking against it never learns any
// other individual branch's numbers, just the pooled average.
router.get('/branches/:id/benchmark', async (req, res, next) => {
  try {
    if (!canSeeBranch(req, req.params.id)) {
      return res.status(403).json({ error: { message: "You don't have access to this branch" } });
    }
    const period = normalizePeriod(req.query.period);
    const branchesRes = await query('SELECT id FROM branches WHERE tenant_id = $1', [req.user.tenant_id]);
    if (!branchesRes.rows.some((b) => b.id === req.params.id)) {
      return res.status(404).json({ error: { message: 'Branch not found' } });
    }

    const [branchKpis, perBranchKpis] = await Promise.all([
      computeBranchKpis(req.user.tenant_id, req.params.id, period),
      Promise.all(branchesRes.rows.map((b) => computeBranchKpis(req.user.tenant_id, b.id, period))),
    ]);

    const n = perBranchKpis.length;
    const chainAverage = {
      revenue: perBranchKpis.reduce((s, k) => s + k.revenue, 0) / n,
      order_count: perBranchKpis.reduce((s, k) => s + k.order_count, 0) / n,
      avg_order_value: perBranchKpis.reduce((s, k) => s + k.avg_order_value, 0) / n,
    };

    res.json({
      period,
      branch: branchKpis,
      chain_average: {
        revenue: Math.round(chainAverage.revenue * 100) / 100,
        order_count: Math.round(chainAverage.order_count * 10) / 10,
        avg_order_value: Math.round(chainAverage.avg_order_value * 100) / 100,
      },
      vs_chain_average_pct: {
        revenue: percentVsBaseline(branchKpis.revenue, chainAverage.revenue),
        order_count: percentVsBaseline(branchKpis.order_count, chainAverage.order_count),
        avg_order_value: percentVsBaseline(branchKpis.avg_order_value, chainAverage.avg_order_value),
      },
      branch_count: n,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/analytics/branches/:id/staff-performance?period=... ──
router.get('/branches/:id/staff-performance', async (req, res, next) => {
  try {
    if (!canSeeBranch(req, req.params.id)) {
      return res.status(403).json({ error: { message: "You don't have access to this branch" } });
    }
    const branchRes = await query('SELECT id FROM branches WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenant_id]);
    if (branchRes.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Branch not found' } });
    }
    const period = normalizePeriod(req.query.period);
    const staff = await branchStaffPerformance(req.user.tenant_id, req.params.id, period);
    if (staff === null) {
      return res.json({ period, has_data: false, message: 'No POS activity for this branch in the selected period.', staff: [] });
    }
    res.json({ period, has_data: true, staff });
  } catch (err) {
    next(err);
  }
});

export default router;
