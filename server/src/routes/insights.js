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
router.post('/query', authorize('owner', 'manager'), insightsLimiter, async (req, res, next) => {
  try {
    const { question } = req.body;
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: { message: 'question is required' } });
    }

    const { generateInsights } = await import('../services/ai-agent.js');
    const answer = await generateInsights(req.user.tenant_id, question);
    res.json({ answer });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/insights/dashboard ──
// Pre-computed KPIs for the admin dashboard
router.get('/dashboard', async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;

    const [todayOrders, weekRevenue, topItems, statusBreakdown, recentCustomers] = await Promise.all([
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
    });
  } catch (err) {
    next(err);
  }
});

export default router;
