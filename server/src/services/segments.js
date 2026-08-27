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
