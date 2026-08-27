/**
 * Fraud/Abuse Detection Agent (impl-21) — flags suspicious patterns for
 * human review. Never blocks, cancels, or revokes anything itself: false
 * positives here are reputationally costly, so this always stops at a
 * human-judgment step.
 *
 * Coupons (impl-12) now exist, so checkCouponAbuse is included alongside
 * the order/review-pattern checks.
 */
import { query } from '../db/pool.js';
import { generateAgentText } from './ai-agent.js';

/** Customers with an unusually high cancellation ratio in the lookback window. */
export async function checkRepeatCancellation(tenantId, lookbackDays = 30, minCancellations = 3) {
  const res = await query(
    `SELECT c.id as customer_id, c.phone, c.name,
       COUNT(*) FILTER (WHERE o.status = 'cancelled') as cancelled_count,
       COUNT(*) as total_count,
       array_agg(o.id) FILTER (WHERE o.status = 'cancelled') as cancelled_order_ids
     FROM customers c
     JOIN orders o ON o.customer_id = c.id
     WHERE c.tenant_id = $1 AND o.created_at >= NOW() - ($2 || ' days')::interval
     GROUP BY c.id
     HAVING COUNT(*) FILTER (WHERE o.status = 'cancelled') >= $3`,
    [tenantId, lookbackDays, minCancellations],
  );
  return res.rows.map((r) => ({
    customer_id: r.customer_id,
    flag_type: 'repeat_cancel',
    evidence: {
      cancelled_count: parseInt(r.cancelled_count, 10),
      total_orders: parseInt(r.total_count, 10),
      order_ids: r.cancelled_order_ids,
    },
    severity: parseInt(r.cancelled_count, 10) >= 5 ? 'high' : 'medium',
  }));
}

/** Customers placing implausibly many orders in a short trailing window. */
export async function checkRapidReorderAbuse(tenantId, windowMinutes = 60, minOrders = 4) {
  const res = await query(
    `SELECT customer_id, COUNT(*) as order_count, array_agg(id) as order_ids,
       COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_count
     FROM orders
     WHERE tenant_id = $1 AND customer_id IS NOT NULL
       AND created_at >= NOW() - ($2 || ' minutes')::interval
     GROUP BY customer_id
     HAVING COUNT(*) >= $3`,
    [tenantId, windowMinutes, minOrders],
  );
  return res.rows.map((r) => ({
    customer_id: r.customer_id,
    flag_type: 'rapid_reorder',
    evidence: {
      order_count: parseInt(r.order_count, 10),
      cancelled_count: parseInt(r.cancelled_count, 10),
      order_ids: r.order_ids,
      window_minutes: windowMinutes,
    },
    severity: parseInt(r.cancelled_count, 10) >= 2 ? 'high' : 'medium',
  }));
}

/** Unusual clustering of low-rated reviews in a short window — tenant-wide, not customer-specific. */
export async function checkReviewPatterns(tenantId, windowHours = 24, minCount = 3) {
  const res = await query(
    `SELECT COUNT(*) as count, array_agg(id) as review_ids, AVG(rating) as avg_rating
     FROM reviews
     WHERE tenant_id = $1 AND created_at >= NOW() - ($2 || ' hours')::interval AND rating <= 2`,
    [tenantId, windowHours],
  );
  const row = res.rows[0];
  const count = parseInt(row.count, 10);
  if (count < minCount) return [];
  return [
    {
      customer_id: null,
      flag_type: 'review_pattern',
      evidence: { count, review_ids: row.review_ids, avg_rating: parseFloat(row.avg_rating), window_hours: windowHours },
      severity: 'medium',
    },
  ];
}

/**
 * Unusually high redemption velocity on a single coupon — can't do
 * device/IP fingerprinting without infrastructure that doesn't exist here,
 * so this stays simple per the spec: flag a coupon whose redemption rate
 * looks abnormal for staff to look into, not a definitive fraud claim.
 */
export async function checkCouponAbuse(tenantId, windowMinutes = 60, minRedemptions = 3) {
  const res = await query(
    `SELECT cr.coupon_id, c.code, COUNT(*) as redemption_count,
       COUNT(DISTINCT cr.customer_id) as distinct_customers,
       array_agg(cr.id) as redemption_ids
     FROM coupon_redemptions cr
     JOIN coupons c ON c.id = cr.coupon_id
     WHERE c.tenant_id = $1 AND cr.redeemed_at >= NOW() - ($2 || ' minutes')::interval
     GROUP BY cr.coupon_id, c.code
     HAVING COUNT(*) >= $3`,
    [tenantId, windowMinutes, minRedemptions],
  );
  return res.rows.map((r) => ({
    customer_id: null,
    related_entity_id: r.coupon_id,
    flag_type: 'coupon_abuse',
    evidence: {
      coupon_id: r.coupon_id,
      coupon_code: r.code,
      redemption_count: parseInt(r.redemption_count, 10),
      distinct_customers: parseInt(r.distinct_customers, 10),
      redemption_ids: r.redemption_ids,
      window_minutes: windowMinutes,
    },
    severity: parseInt(r.distinct_customers, 10) >= parseInt(r.redemption_count, 10) ? 'high' : 'medium',
  }));
}

function fallbackDescription(r) {
  switch (r.flag_type) {
    case 'repeat_cancel':
      return `This customer has cancelled ${r.evidence.cancelled_count} of ${r.evidence.total_orders} recent orders — worth a closer look.`;
    case 'rapid_reorder':
      return `This customer placed ${r.evidence.order_count} orders within ${r.evidence.window_minutes} minutes — worth verifying these are genuine.`;
    case 'review_pattern':
      return `${r.evidence.count} low-rated reviews (avg ${r.evidence.avg_rating?.toFixed(1)}) came in within ${r.evidence.window_hours}h — may indicate a coordinated issue or a real service problem worth investigating.`;
    case 'coupon_abuse':
      return `Coupon ${r.evidence.coupon_code} was redeemed ${r.evidence.redemption_count} times by ${r.evidence.distinct_customers} different customers within ${r.evidence.window_minutes} minutes — worth checking the redemption pattern.`;
    default:
      return 'Unusual pattern detected — review the evidence for details.';
  }
}

export async function runAbuseScan(tenantId) {
  const results = [
    ...(await checkRepeatCancellation(tenantId)),
    ...(await checkRapidReorderAbuse(tenantId)),
    ...(await checkReviewPatterns(tenantId)),
    ...(await checkCouponAbuse(tenantId)),
  ];

  let created = 0;
  for (const r of results) {
    const existing = await query(
      `SELECT id FROM agent_abuse_flags
       WHERE tenant_id = $1 AND flag_type = $2 AND status = 'open'
         AND ((customer_id IS NULL AND $3::uuid IS NULL) OR customer_id = $3)
         AND ((related_entity_id IS NULL AND $4::uuid IS NULL) OR related_entity_id = $4)`,
      [tenantId, r.flag_type, r.customer_id || null, r.related_entity_id || null],
    );
    if (existing.rows.length > 0) continue;

    let description;
    try {
      description = await generateAgentText(
        'You are a trust-and-safety assistant for a restaurant. Describe this suspicious pattern in one clear, ' +
          'factual sentence for staff to review. Reference only the numbers given. This is a pattern worth ' +
          'checking, not a fraud accusation — do not use accusatory language.',
        JSON.stringify(r),
      );
    } catch (err) {
      console.error('[abuse-detection-agent] description generation failed, using fallback:', err.message);
      description = fallbackDescription(r);
    }

    try {
      await query(
        `INSERT INTO agent_abuse_flags (tenant_id, flag_type, customer_id, related_entity_id, description, evidence, severity)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [tenantId, r.flag_type, r.customer_id || null, r.related_entity_id || null, description, JSON.stringify(r.evidence), r.severity],
      );
      created++;
    } catch (err) {
      // 23505 = unique_violation on idx_abuse_flags_dedup — a concurrent run
      // already flagged this; the SELECT above is only a fast path, the DB
      // constraint is the real guarantee.
      if (err.code !== '23505') throw err;
    }
  }
  return created;
}
