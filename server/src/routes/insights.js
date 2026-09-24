import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, checkTenantActive, authorize, attachBranchAccess, hasPermission } from '../middleware/auth.js';
import { query } from '../db/pool.js';
import { periodStartSql, localDateSql, isSaleSql } from '../utils/business-time.js';

const router = Router();
router.use(authenticate);
router.use(checkTenantActive);

// generateInsights() calls Qwen twice (SQL + summary) per request — limit per-user
const insightsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.user?.id || req.ip,
});

// ── POST /api/insights/query ──
// Natural-language query over the restaurant's order data, powered by Qwen
router.post('/query', authorize('reports.view'), insightsLimiter, attachBranchAccess, async (req, res, next) => {
  try {
    const { question, history } = req.body;
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: { message: 'question is required' } });
    }

    // Optional conversation history for multi-turn context — each entry is
    // { role: 'user'|'assistant', content: string }. Validated lightly here;
    // the AI service slices the last 6 turns for context window efficiency.
    const validHistory = Array.isArray(history)
      ? history.filter((h) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string').slice(0, 10)
      : [];

    const { generateInsights } = await import('../services/ai-agent.js');
    // Branch-locked users only see their branches' orders — same rule as the
    // branch analytics routes (null = owner, every branch).
    const branchIds = req.user.branchAccess === null ? null : Array.from(req.user.branchAccess);
    const answer = await generateInsights(req.user.tenant_id, question, { history: validHistory, branchIds });
    res.json({ answer });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/insights/dashboard ──
// Pre-computed KPIs for the admin dashboard. Two scopes:
//  - 'full' (reports.view): sales, revenue, customers, margins.
//  - 'operations' (orders.view only, e.g. staff): today's order count and
//    status, low stock — the parts of the page their job needs, no financials.
// Order-based figures are limited to the user's branches for non-owners, the
// same rule the branch analytics routes apply.
router.get('/dashboard', authorize('reports.view', 'orders.view'), attachBranchAccess, async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const branchIds = req.user.branchAccess === null ? null : Array.from(req.user.branchAccess);
    const orderParams = branchIds ? [tenantId, branchIds] : [tenantId];
    const branchSql = (alias = '') => (branchIds ? ` AND ${alias ? `${alias}.` : ''}branch_id = ANY($2::uuid[])` : '');

    const lowStockQuery = () => query(`
        SELECT COUNT(*) as count
        FROM ingredients
        WHERE tenant_id = $1 AND current_stock <= low_stock_threshold
      `, [tenantId]);
    const statusQuery = () => query(`
        SELECT status, COUNT(*) as count
        FROM orders
        WHERE tenant_id = $1 AND created_at >= ${periodStartSql('today')}${branchSql()}
        GROUP BY status
      `, orderParams);

    if (!(await hasPermission(req.user, 'reports.view'))) {
      const [statusBreakdown, lowStockCount] = await Promise.all([statusQuery(), lowStockQuery()]);
      const todayCount = statusBreakdown.rows
        .filter((r) => r.status !== 'cancelled')
        .reduce((sum, r) => sum + parseInt(r.count, 10), 0);
      return res.json({
        scope: 'operations',
        today: { orders: todayCount },
        status_breakdown: statusBreakdown.rows,
        low_stock_count: parseInt(lowStockCount.rows[0].count, 10),
      });
    }

    const [todayOrders, weekRevenue, topItems, statusBreakdown, recentCustomers, reviewStats, lowStockCount, foodCostMargins] = await Promise.all([
      // Today's order count and revenue (Pakistan day, cancelled excluded —
      // same definition AI Insights is given, see utils/business-time.js)
      query(`
        SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as revenue
        FROM orders
        WHERE tenant_id = $1 AND created_at >= ${periodStartSql('today')} AND ${isSaleSql()}${branchSql()}
      `, orderParams),

      // Last 7 local days revenue trend (today + 6 previous days)
      query(`
        SELECT ${localDateSql('created_at')} as date, COUNT(*) as orders, COALESCE(SUM(total), 0) as revenue
        FROM orders
        WHERE tenant_id = $1 AND created_at >= ${periodStartSql('today')} - INTERVAL '6 days' AND ${isSaleSql()}${branchSql()}
        GROUP BY 1
        ORDER BY date
      `, orderParams),

      // Top 5 selling items (last 30 days)
      query(`
        SELECT oi.name, SUM(oi.quantity) as total_qty, SUM(oi.total_price) as total_revenue
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE o.tenant_id = $1 AND o.created_at >= NOW() - INTERVAL '30 days' AND ${isSaleSql('o')}${branchSql('o')}
        GROUP BY oi.name
        ORDER BY total_qty DESC
        LIMIT 5
      `, orderParams),

      // Order status breakdown
      statusQuery(),

      // Recent customers
      query(`
        SELECT c.*, (SELECT COUNT(*) FROM orders WHERE customer_id = c.id) as total_orders
        FROM customers c
        WHERE c.tenant_id = $1
        ORDER BY c.updated_at DESC
        LIMIT 10
      `, [tenantId]),

      // Review ratings summary (last 30 days)
      query(`
        SELECT COUNT(*) as count, COALESCE(AVG(rating), 0) as average
        FROM reviews
        WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
      `, [tenantId]),

      // Low-stock ingredients count (impl-08)
      lowStockQuery(),

      // Food-cost margin per menu item (impl-08) — only items with a recipe
      // defined have real cost data; items without one are omitted rather
      // than shown with a misleading 0-cost/100%-margin figure.
      query(`
        SELECT mi.id, mi.name, mi.price,
               SUM(r.quantity_required * i.cost_per_unit) as unit_cost
        FROM menu_items mi
        JOIN recipes r ON r.menu_item_id = mi.id
        JOIN ingredients i ON i.id = r.ingredient_id
        WHERE mi.tenant_id = $1
        GROUP BY mi.id, mi.name, mi.price
        ORDER BY mi.name
      `, [tenantId]),
    ]);

    res.json({
      scope: 'full',
      today: {
        orders: parseInt(todayOrders.rows[0].count, 10),
        revenue: parseFloat(todayOrders.rows[0].revenue),
      },
      weekly_trend: weekRevenue.rows,
      top_items: topItems.rows,
      status_breakdown: statusBreakdown.rows,
      recent_customers: recentCustomers.rows,
      reviews: {
        count: parseInt(reviewStats.rows[0].count, 10),
        average: Math.round(parseFloat(reviewStats.rows[0].average) * 10) / 10,
      },
      low_stock_count: parseInt(lowStockCount.rows[0].count, 10),
      food_cost_margins: foodCostMargins.rows.map((row) => {
        const price = parseFloat(row.price);
        const unitCost = parseFloat(row.unit_cost);
        const margin = price - unitCost;
        return {
          menu_item_id: row.id,
          name: row.name,
          price,
          unit_cost: unitCost,
          margin,
          margin_pct: price > 0 ? Math.round((margin / price) * 1000) / 10 : null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
