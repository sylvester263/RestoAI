import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, authorize } from '../middleware/auth.js';
import { query } from '../db/pool.js';

const router = Router();
router.use(authenticate);

// generateInsights() calls Qwen twice (SQL + summary) per request — limit per-user
const insightsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.user?.id || req.ip,
});

// ── POST /api/insights/query ──
// Natural-language query over the restaurant's order data, powered by Qwen
router.post('/query', authorize('reports.view'), insightsLimiter, async (req, res, next) => {
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
    const answer = await generateInsights(req.user.tenant_id, question, validHistory);
    res.json({ answer });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/insights/dashboard ──
// Pre-computed KPIs for the admin dashboard
router.get('/dashboard', authorize('reports.view'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;

    const [todayOrders, weekRevenue, topItems, statusBreakdown, recentCustomers, reviewStats, lowStockCount, foodCostMargins] = await Promise.all([
      // Today's order count and revenue
      query(`
        SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as revenue
        FROM orders
        WHERE tenant_id = $1 AND created_at >= CURRENT_DATE
      `, [tenantId]),

      // Last 7 days revenue trend
      query(`
        SELECT DATE(created_at) as date, COUNT(*) as orders, COALESCE(SUM(total), 0) as revenue
        FROM orders
        WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '7 days'
        GROUP BY DATE(created_at)
        ORDER BY date
      `, [tenantId]),

      // Top 5 selling items
      query(`
        SELECT oi.name, SUM(oi.quantity) as total_qty, SUM(oi.total_price) as total_revenue
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE o.tenant_id = $1 AND o.created_at >= NOW() - INTERVAL '30 days'
        GROUP BY oi.name
        ORDER BY total_qty DESC
        LIMIT 5
      `, [tenantId]),

      // Order status breakdown
      query(`
        SELECT status, COUNT(*) as count
        FROM orders
        WHERE tenant_id = $1 AND created_at >= CURRENT_DATE
        GROUP BY status
      `, [tenantId]),

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
      query(`
        SELECT COUNT(*) as count
        FROM ingredients
        WHERE tenant_id = $1 AND current_stock <= low_stock_threshold
      `, [tenantId]),

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
