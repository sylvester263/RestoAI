/**
 * Payments Service — payment-record lifecycle for every order channel.
 * COD orders get a pending record at creation; marked paid on delivery.
 * Future: JazzCash/EasyPaisa/Card gateway hooks land here too.
 */
import { query } from '../db/pool.js';

// Map the order-level payment_method value to a payments.method value.
// The orders table uses 'cash' while payments uses 'cod' — normalize here.
function normalizeMethod(orderPaymentMethod) {
  if (orderPaymentMethod === 'cash') return 'cod';
  return orderPaymentMethod || 'cod';
}

/**
 * Create a payment record when an order is placed.
 * For COD, the record starts as 'pending' and flips to 'paid' on delivery.
 * For online methods, it would start as 'pending' and flip via webhook.
 */
export async function createPaymentForOrder(tenantId, orderId, amount, paymentMethod) {
  const method = normalizeMethod(paymentMethod);
  const res = await query(
    `INSERT INTO payments (tenant_id, order_id, method, status, amount)
     VALUES ($1, $2, $3, 'pending', $4)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [tenantId, orderId, method, amount],
  );
  return res.rows[0] || null;
}

/**
 * Mark a COD payment as paid when the order is delivered.
 * Idempotent — safe to call multiple times.
 */
export async function markCodPaidOnDelivery(tenantId, orderId) {
  const res = await query(
    `UPDATE payments SET status = 'paid', updated_at = NOW()
     WHERE tenant_id = $1 AND order_id = $2 AND method = 'cod' AND status = 'pending'
     RETURNING *`,
    [tenantId, orderId],
  );
  return res.rows[0] || null;
}

/**
 * Get payment status for an order (used in admin views and public tracking).
 */
export async function getPaymentForOrder(orderId) {
  const res = await query(
    `SELECT id, method, status, amount, created_at, updated_at FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [orderId],
  );
  return res.rows[0] || null;
}

/**
 * Get payment statuses for multiple orders (batch lookup for list views).
 */
export async function getPaymentsForOrders(orderIds) {
  if (!orderIds || orderIds.length === 0) return {};
  const res = await query(
    `SELECT DISTINCT ON (order_id) order_id, method, status, amount
     FROM payments WHERE order_id = ANY($1::uuid[])
     ORDER BY order_id, created_at DESC`,
    [orderIds],
  );
  const map = {};
  for (const row of res.rows) {
    map[row.order_id] = { method: row.method, status: row.status, amount: parseFloat(row.amount) };
  }
  return map;
}
