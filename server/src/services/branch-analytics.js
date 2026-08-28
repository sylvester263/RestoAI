/**
 * Branch-level analytics (impl-25) — side-by-side comparison, single-branch
 * drill-down, chain-average benchmarking, and staff performance. Live
 * queries against orders/order_items/pos_tabs directly, no pre-aggregation
 * (per the spec's own guidance not to prematurely optimize). Every function
 * here is reused by more than one route handler rather than duplicated —
 * /compare calls computeBranchKpis once per visible branch, /branches/:id
 * calls it once for the drill-down header, /benchmark calls it twice
 * (branch + tenant-wide) — same query shape, one implementation.
 */
import { query } from '../db/pool.js';

const PERIODS = ['today', 'week', 'month'];

function periodClause(period) {
  if (period === 'week') return "created_at >= NOW() - INTERVAL '7 days'";
  if (period === 'month') return "created_at >= NOW() - INTERVAL '30 days'";
  return 'created_at >= CURRENT_DATE';
}

export function normalizePeriod(raw) {
  return PERIODS.includes(raw) ? raw : 'today';
}

/**
 * Core KPI set for one branch, or the whole tenant if branchId is null
 * (used for the chain-wide benchmark average — an aggregate only, never a
 * per-branch breakdown, so it can't be used to infer another branch's
 * individual numbers even when called on behalf of a branch-locked manager).
 */
export async function computeBranchKpis(tenantId, branchId, period) {
  const clause = periodClause(period);
  const params = [tenantId];
  let branchFilter = '';
  if (branchId) {
    params.push(branchId);
    branchFilter = ` AND branch_id = $${params.length}`;
  }

  const [totalsRes, channelRes, fulfillmentRes] = await Promise.all([
    query(
      `SELECT COUNT(*) as order_count, COALESCE(SUM(total), 0) as revenue, COALESCE(AVG(total), 0) as avg_order_value
       FROM orders WHERE tenant_id = $1 AND ${clause}${branchFilter}`,
      params,
    ),
    query(
      `SELECT channel, COUNT(*) as count FROM orders WHERE tenant_id = $1 AND ${clause}${branchFilter} GROUP BY channel`,
      params,
    ),
    query(
      `SELECT
         CASE WHEN table_session_id IS NOT NULL THEN 'dine_in'
              WHEN delivery_address IS NOT NULL THEN 'delivery'
              ELSE 'pickup' END as fulfillment,
         COUNT(*) as count
       FROM orders WHERE tenant_id = $1 AND ${clause}${branchFilter}
       GROUP BY fulfillment`,
      params,
    ),
  ]);

  return {
    order_count: parseInt(totalsRes.rows[0].order_count, 10),
    revenue: parseFloat(totalsRes.rows[0].revenue),
    avg_order_value: Math.round(parseFloat(totalsRes.rows[0].avg_order_value) * 100) / 100,
    channel_breakdown: Object.fromEntries(channelRes.rows.map((r) => [r.channel, parseInt(r.count, 10)])),
    fulfillment_breakdown: Object.fromEntries(fulfillmentRes.rows.map((r) => [r.fulfillment, parseInt(r.count, 10)])),
  };
}

/** Daily revenue trend for one branch — same shape as insights.js's tenant-wide weekly_trend, just branch-filtered. */
export async function branchRevenueTrend(tenantId, branchId, days = 7) {
  const res = await query(
    `SELECT DATE(created_at) as date, COUNT(*) as orders, COALESCE(SUM(total), 0) as revenue
     FROM orders
     WHERE tenant_id = $1 AND branch_id = $2 AND created_at >= NOW() - ($3 || ' days')::interval
     GROUP BY DATE(created_at)
     ORDER BY date`,
    [tenantId, branchId, days],
  );
  return res.rows.map((r) => ({ date: r.date, orders: parseInt(r.orders, 10), revenue: parseFloat(r.revenue) }));
}

/** Top-selling items for one branch — same join shape as insights.js's tenant-wide top_items. */
export async function branchTopItems(tenantId, branchId, days = 30, limit = 5) {
  const res = await query(
    `SELECT oi.name, SUM(oi.quantity) as total_qty, SUM(oi.total_price) as total_revenue
     FROM order_items oi
     JOIN orders o ON oi.order_id = o.id
     WHERE o.tenant_id = $1 AND o.branch_id = $2 AND o.created_at >= NOW() - ($3 || ' days')::interval
     GROUP BY oi.name
     ORDER BY total_qty DESC
     LIMIT $4`,
    [tenantId, branchId, days, limit],
  );
  return res.rows.map((r) => ({ name: r.name, total_qty: parseInt(r.total_qty, 10), total_revenue: parseFloat(r.total_revenue) }));
}

/** Order count by hour-of-day (0-23, Asia/Karachi) for one branch. */
export async function branchPeakHours(tenantId, branchId, period) {
  const clause = periodClause(period);
  const res = await query(
    `SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Karachi')::int as hour, COUNT(*) as count
     FROM orders
     WHERE tenant_id = $1 AND branch_id = $2 AND ${clause}
     GROUP BY hour
     ORDER BY hour`,
    [tenantId, branchId],
  );
  return res.rows.map((r) => ({ hour: r.hour, count: parseInt(r.count, 10) }));
}

/**
 * Per-cashier sales for one branch/period, attributed via pos_tabs.opened_by
 * on settled tabs (impl-24). Returns null (not an empty array) when the
 * branch has zero settled POS activity in the period, so the route can
 * surface a clear "no data" state instead of a confusing empty table.
 */
export async function branchStaffPerformance(tenantId, branchId, period) {
  const clause = periodClause(period).replace(/created_at/g, 'pt.settled_at');
  const res = await query(
    `SELECT u.id as user_id, u.name,
            COUNT(*) as tab_count,
            COALESCE(SUM(o.total), 0) as total_sales,
            COALESCE(AVG(o.total), 0) as avg_ticket
     FROM pos_tabs pt
     JOIN users u ON u.id = pt.opened_by
     JOIN orders o ON o.pos_tab_id = pt.id
     WHERE pt.tenant_id = $1 AND pt.branch_id = $2 AND pt.status = 'settled' AND ${clause}
     GROUP BY u.id, u.name
     ORDER BY total_sales DESC`,
    [tenantId, branchId],
  );
  if (res.rows.length === 0) return null;
  return res.rows.map((r) => ({
    user_id: r.user_id,
    name: r.name,
    tab_count: parseInt(r.tab_count, 10),
    total_sales: parseFloat(r.total_sales),
    avg_ticket: Math.round(parseFloat(r.avg_ticket) * 100) / 100,
  }));
}

/** +N% / -N% vs. a baseline, null-safe for a zero baseline. */
export function percentVsBaseline(value, baseline) {
  if (!baseline) return null;
  return Math.round(((value - baseline) / baseline) * 1000) / 10;
}
