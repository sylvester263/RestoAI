/**
 * Customer segment evaluation — filter_rules is JSON, but it never drives
 * raw SQL construction. Each supported key maps to one fixed, hardcoded,
 * parameterized query fragment; only the VALUES (bound as $N params) come
 * from the JSON, never table/column names or SQL syntax. This is the same
 * class of risk the earlier security audit flagged for LLM-generated SQL —
 * a flexible-looking rule engine still has to be built from fixed pieces.
 */
import { z } from 'zod';

export const filterRulesSchema = z.object({
  min_orders: z.number().int().min(0).optional(),
  min_spend: z.number().min(0).optional(),
  last_order_days_ago_lt: z.number().int().min(1).optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
}).strict();

/**
 * Builds a parameterized SQL query resolving a segment's filter_rules to
 * matching customers for one tenant. Returns { sql, params }.
 */
export function buildSegmentQuery(tenantId, filterRules) {
  const conditions = ['c.tenant_id = $1'];
  const params = [tenantId];
  let joins = '';

  if (filterRules.min_orders !== undefined) {
    params.push(filterRules.min_orders);
    conditions.push(`c.order_count >= $${params.length}`);
  }
  if (filterRules.min_spend !== undefined) {
    params.push(filterRules.min_spend);
    conditions.push(`c.total_spent >= $${params.length}`);
  }
  if (filterRules.last_order_days_ago_lt !== undefined) {
    joins += ` LEFT JOIN (SELECT customer_id, MAX(created_at) as last_order_at FROM orders GROUP BY customer_id) lo ON lo.customer_id = c.id`;
    params.push(filterRules.last_order_days_ago_lt);
    conditions.push(`lo.last_order_at >= NOW() - ($${params.length} || ' days')::interval`);
  }
  if (filterRules.tags && filterRules.tags.length > 0) {
    // ANY-of-tags match (a customer needs at least one, not all) — the
    // more useful default for reach-broadening marketing segments.
    params.push(filterRules.tags);
    joins += ` JOIN customer_tags ct ON ct.customer_id = c.id AND ct.tag = ANY($${params.length}::text[])`;
  }

  const sql = `SELECT DISTINCT c.* FROM customers c ${joins} WHERE ${conditions.join(' AND ')} ORDER BY c.total_spent DESC`;
  return { sql, params };
}

// ── RFM segmentation (2026-08-28 addition) ──
// Recency/Frequency/Monetary, scored 1-5 by tenant-relative quintile
// (NTILE(5) — Postgres handles uneven bucket sizes fine on small N).
// Only customers with at least one non-cancelled order are scored; a
// customer who's never ordered hasn't "lapsed," they never started, so
// they don't fit any RFM label.
export const RFM_LABELS = [
  'Champions', 'Loyal customers', 'Recent/promising', 'Needs attention',
  'About to sleep', 'Cannot lose them', 'Lost',
];

// Deterministic, priority-ordered classifier — checked most-specific/most-
// actionable first so every one of the 125 possible (R,F,M) score
// combinations lands in exactly one label, with 'Needs attention' as the
// mid-mid-mid catch-all the spec describes.
function classifyRFM(r, f, m) {
  if (r <= 2 && f >= 4 && m >= 4) return 'Cannot lose them';
  if (r >= 4 && f >= 4 && m >= 4) return 'Champions';
  if (r >= 3 && f >= 4 && m >= 3) return 'Loyal customers';
  if (r >= 4 && f <= 2) return 'Recent/promising';
  if (r <= 3 && f <= 2 && m >= 3) return 'About to sleep';
  if (r <= 2 && f <= 2 && m < 3) return 'Lost';
  return 'Needs attention';
}

/**
 * Scores every tenant customer with >=1 non-cancelled order on R/F/M and
 * assigns the standard labeled segment. Returns one row per customer.
 */
export async function computeRFM(tenantId, queryFn) {
  const res = await queryFn(
    `WITH stats AS (
       SELECT c.id, c.name, c.phone,
              EXTRACT(DAY FROM NOW() - MAX(o.created_at))::int as days_since_last_order,
              COUNT(o.id) as order_count,
              COALESCE(SUM(o.total), 0) as total_spent
       FROM customers c
       JOIN orders o ON o.customer_id = c.id AND o.status != 'cancelled'
       WHERE c.tenant_id = $1
       GROUP BY c.id
     )
     SELECT *,
       NTILE(5) OVER (ORDER BY days_since_last_order DESC, id) as r_score,
       NTILE(5) OVER (ORDER BY order_count ASC, id) as f_score,
       NTILE(5) OVER (ORDER BY total_spent ASC, id) as m_score
     FROM stats`,
    [tenantId],
  );
  return res.rows.map((row) => ({
    ...row,
    segment: classifyRFM(row.r_score, row.f_score, row.m_score),
  }));
}
