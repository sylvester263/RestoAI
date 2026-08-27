/**
 * Customer Win-Back Agent (impl-15) — detects customers who've gone quiet
 * and sends a personalized WhatsApp message with a suggested incentive.
 *
 * Coupons (impl-12) now exist, so this mints a real single-use coupon per
 * customer (usage_limit_per_customer=1, 7-day expiry) and references its
 * actual code — no more plain-text "ask staff" fallback.
 */
import { query } from '../db/pool.js';
import { generateAgentText } from './ai-agent.js';
import { sendReply } from './whatsapp.js';
import { createCustomerCoupon } from './coupons.js';

const DEFAULT_THRESHOLD_DAYS = 20;

/**
 * Customers whose most recent (non-cancelled) order is older than
 * thresholdDays, excluding anyone already win-back-messaged within the
 * same cooldown window (so a lapsed customer isn't re-messaged every run).
 */
export async function findLapsedCustomers(tenantId, thresholdDays = DEFAULT_THRESHOLD_DAYS) {
  const lapsedRes = await query(
    `SELECT c.id, c.name, c.phone, MAX(o.created_at) as last_order_at,
       (SELECT oi.name FROM order_items oi
        JOIN orders o2 ON o2.id = oi.order_id
        WHERE o2.customer_id = c.id
        GROUP BY oi.name ORDER BY SUM(oi.quantity) DESC LIMIT 1) as favorite_item
     FROM customers c
     JOIN orders o ON o.customer_id = c.id AND o.status != 'cancelled'
     WHERE c.tenant_id = $1
     GROUP BY c.id
     HAVING MAX(o.created_at) < NOW() - ($2 || ' days')::interval`,
    [tenantId, thresholdDays],
  );
  if (lapsedRes.rows.length === 0) return [];

  const ids = lapsedRes.rows.map((c) => c.id);
  const recentRes = await query(
    `SELECT DISTINCT customer_id FROM agent_winback_log
     WHERE tenant_id = $1 AND customer_id = ANY($2::uuid[])
       AND triggered_at > NOW() - ($3 || ' days')::interval`,
    [tenantId, ids, thresholdDays],
  );
  const excluded = new Set(recentRes.rows.map((r) => r.customer_id));

  return lapsedRes.rows
    .filter((c) => !excluded.has(c.id))
    .map((c) => ({
      ...c,
      days_since_last_order: Math.floor((Date.now() - new Date(c.last_order_at).getTime()) / 86400000),
    }));
}

async function craftWinbackMessage(customer, tenant, coupon) {
  const fallback =
    `We miss you${customer.name ? `, ${customer.name}` : ''}! ` +
    `It's been a while since your last order${customer.favorite_item ? ` (${customer.favorite_item})` : ''} — ` +
    `come back this week and use code ${coupon.code} for ${coupon.discount_value}% off!`;

  try {
    return await generateAgentText(
      'You are a warm, brief WhatsApp message writer for a Pakistani restaurant win-back campaign. ' +
        'Write 1-3 short sentences addressed to the customer by name, mentioning their favorite item if given. ' +
        'End by telling them to use the exact coupon code given for the stated discount — do not alter the ' +
        'code or invent a different offer. Do not use markdown.',
      JSON.stringify({
        customer_name: customer.name || 'there',
        favorite_item: customer.favorite_item || null,
        days_since_last_order: customer.days_since_last_order,
        restaurant_name: tenant?.name,
        coupon_code: coupon.code,
        discount_percent: coupon.discount_value,
        expires_in_days: 7,
      }),
    );
  } catch (err) {
    console.error('[winback-agent] message generation failed, using fallback:', err.message);
    return fallback;
  }
}

export async function sendWinbackToCustomer(tenantId, customer, tenant) {
  const coupon = await createCustomerCoupon(tenantId, customer.id, { discountType: 'percent', discountValue: 10, expiryDays: 7 });
  const message = await craftWinbackMessage(customer, tenant, coupon);
  await sendReply(customer.phone, message);
  await query(
    `INSERT INTO agent_winback_log (tenant_id, customer_id, days_since_last_order, message_sent, coupon_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, customer.id, customer.days_since_last_order, message, coupon.id],
  );
}
