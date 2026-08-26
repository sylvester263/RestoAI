/**
 * Loyalty Service — shared points balance/earn/redeem logic, callable from
 * the public checkout flow, the order-status-update hook, and the WhatsApp
 * agent, so there is exactly one implementation of the points math.
 */
import { query, withTransaction } from '../db/pool.js';
import { OrderError } from './orders.js';

// ── Get a tenant's loyalty config, or null if not opted in ──
export async function getLoyaltyConfig(tenantId) {
  const res = await query('SELECT * FROM loyalty_config WHERE tenant_id = $1 AND enabled = true', [tenantId]);
  return res.rows[0] || null;
}

// ── Current points balance for a customer ──
export async function getBalance(tenantId, customerId) {
  const res = await query(
    `SELECT COALESCE(SUM(points_change), 0) as balance FROM loyalty_points WHERE tenant_id = $1 AND customer_id = $2`,
    [tenantId, customerId],
  );
  return parseInt(res.rows[0].balance, 10);
}

// ── Award points for a completed order (idempotent per order) ──
export async function awardPointsForOrder(tenantId, orderId) {
  const config = await getLoyaltyConfig(tenantId);
  if (!config) return;

  const existing = await query(`SELECT id FROM loyalty_points WHERE order_id = $1 AND reason = 'earned'`, [orderId]);
  if (existing.rows.length > 0) return; // already awarded — avoid double-earning on repeat status updates

  const orderRes = await query('SELECT customer_id, total FROM orders WHERE id = $1 AND tenant_id = $2', [orderId, tenantId]);
  const order = orderRes.rows[0];
  if (!order || !order.customer_id) return;

  const points = Math.floor(parseFloat(order.total) * parseFloat(config.points_per_currency_unit));
  if (points <= 0) return;

  await query(
    `INSERT INTO loyalty_points (tenant_id, customer_id, points_change, reason, order_id) VALUES ($1, $2, $3, 'earned', $4)`,
    [tenantId, order.customer_id, points, orderId],
  );
}

// ── Redeem points for a discount amount, validated against the current balance ──
// Locks the customer row for the duration of the check+insert so two
// concurrent redemptions (double-click, multiple tabs) can't both pass the
// balance check against the same pre-redemption balance and over-redeem.
export async function redeemPoints(tenantId, customerId, pointsToRedeem) {
  const config = await getLoyaltyConfig(tenantId);
  if (!config) throw new OrderError(400, 'Loyalty is not enabled for this restaurant');

  if (pointsToRedeem <= 0) {
    throw new OrderError(400, 'Not enough points for that redemption');
  }

  return withTransaction(async (client) => {
    await client.query('SELECT id FROM customers WHERE id = $1 FOR UPDATE', [customerId]);

    const balanceRes = await client.query(
      `SELECT COALESCE(SUM(points_change), 0) as balance FROM loyalty_points WHERE tenant_id = $1 AND customer_id = $2`,
      [tenantId, customerId],
    );
    const balance = parseInt(balanceRes.rows[0].balance, 10);
    if (pointsToRedeem > balance) {
      throw new OrderError(400, 'Not enough points for that redemption');
    }

    const discount = Math.round(pointsToRedeem * parseFloat(config.redemption_rate) * 100) / 100;
    await client.query(
      `INSERT INTO loyalty_points (tenant_id, customer_id, points_change, reason) VALUES ($1, $2, $3, 'redeemed')`,
      [tenantId, customerId, -pointsToRedeem],
    );
    return discount;
  });
}
