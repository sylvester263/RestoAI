/**
 * Coupons & discounts (impl-12). No written spec exists for this file
 * anywhere in the repo — it's only referenced by name as a dependency in
 * impl-15 (winback) and impl-21 (abuse detection). Scope here is sized to
 * exactly what those two specs already assume, not a general promotions
 * engine: a code with a discount, an optional single-customer target, an
 * expiry, and a redemption log.
 */
import { query, withTransaction } from '../db/pool.js';
import { OrderError } from './orders.js';

function generateCode(prefix = 'SAVE') {
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${suffix}`;
}

/** Admin-facing coupon creation (owner/manager, via routes/coupons.js). */
export async function createCoupon(tenantId, data, createdBy) {
  const code = (data.code || generateCode()).toUpperCase();
  const result = await query(
    `INSERT INTO coupons (tenant_id, code, discount_type, discount_value, usage_limit_per_customer, max_redemptions, expires_at, customer_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [
      tenantId, code, data.discount_type, data.discount_value,
      data.usage_limit_per_customer ?? 1, data.max_redemptions ?? null,
      data.expires_at ?? null, data.customer_id ?? null, createdBy ?? null,
    ],
  );
  return result.rows[0];
}

/**
 * Mints a real, single-use coupon for one customer — used by the win-back
 * agent (impl-15) instead of its plain-text fallback offer, once coupons
 * exist. usage_limit_per_customer=1 and a short expiry, per that spec.
 */
export async function createCustomerCoupon(tenantId, customerId, { discountType = 'percent', discountValue = 10, expiryDays = 7 } = {}) {
  const expiresAt = new Date(Date.now() + expiryDays * 86400000);
  return createCoupon(tenantId, {
    discount_type: discountType,
    discount_value: discountValue,
    usage_limit_per_customer: 1,
    expires_at: expiresAt,
    customer_id: customerId,
  });
}

/**
 * Read-only preview for checkout UI — same validity checks as redeemCoupon
 * but no lock, no insert. Purely informational: the real enforcement still
 * happens atomically inside redeemCoupon at actual submit time, so a coupon
 * that previews fine can still be rejected there (e.g. someone else used
 * up the last redemption in between).
 */
export async function previewCoupon(tenantId, code, customerId, subtotal) {
  const couponRes = await query('SELECT * FROM coupons WHERE tenant_id = $1 AND code = $2', [tenantId, code.toUpperCase()]);
  const coupon = couponRes.rows[0];
  if (!coupon || !coupon.active) throw new OrderError(400, 'Invalid coupon code');
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) throw new OrderError(400, 'This coupon has expired');
  if (coupon.customer_id && coupon.customer_id !== customerId) throw new OrderError(400, 'This coupon is not valid for this account');

  const perCustomerRes = await query('SELECT COUNT(*) FROM coupon_redemptions WHERE coupon_id = $1 AND customer_id = $2', [coupon.id, customerId]);
  if (parseInt(perCustomerRes.rows[0].count, 10) >= coupon.usage_limit_per_customer) {
    throw new OrderError(400, 'You have already used this coupon');
  }
  if (coupon.max_redemptions !== null) {
    const totalRes = await query('SELECT COUNT(*) FROM coupon_redemptions WHERE coupon_id = $1', [coupon.id]);
    if (parseInt(totalRes.rows[0].count, 10) >= coupon.max_redemptions) {
      throw new OrderError(400, 'This coupon has reached its redemption limit');
    }
  }

  const discount =
    coupon.discount_type === 'percent'
      ? Math.round(subtotal * (parseFloat(coupon.discount_value) / 100) * 100) / 100
      : Math.min(parseFloat(coupon.discount_value), subtotal);
  return { discount, discount_type: coupon.discount_type, discount_value: parseFloat(coupon.discount_value) };
}

/**
 * Validates a coupon code for a checkout and redeems it atomically —
 * locks the coupon row for the duration of the check so two concurrent
 * checkouts (double-submit, two tabs) can't both pass the per-customer
 * limit check against the same pre-redemption count, same class of race
 * already guarded against in loyalty.js's redeemPoints.
 *
 * order_id isn't known yet at this point (pricing — and therefore the
 * discount — must be resolved before the order row can be created), so the
 * redemption is recorded with a null order_id and patched by
 * attachRedemptionToOrder once the order exists. Matches the same
 * looseness loyalty.js's redeemPoints already accepts (its redemption rows
 * don't link back to an order_id either).
 */
export async function redeemCoupon(tenantId, code, customerId, subtotal) {
  return withTransaction(async (client) => {
    const couponRes = await client.query(
      `SELECT * FROM coupons WHERE tenant_id = $1 AND code = $2 FOR UPDATE`,
      [tenantId, code.toUpperCase()],
    );
    const coupon = couponRes.rows[0];
    if (!coupon || !coupon.active) {
      throw new OrderError(400, 'Invalid coupon code');
    }
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      throw new OrderError(400, 'This coupon has expired');
    }
    if (coupon.customer_id && coupon.customer_id !== customerId) {
      throw new OrderError(400, 'This coupon is not valid for this account');
    }

    const perCustomerRes = await client.query(
      `SELECT COUNT(*) FROM coupon_redemptions WHERE coupon_id = $1 AND customer_id = $2`,
      [coupon.id, customerId],
    );
    if (parseInt(perCustomerRes.rows[0].count, 10) >= coupon.usage_limit_per_customer) {
      throw new OrderError(400, 'You have already used this coupon');
    }

    if (coupon.max_redemptions !== null) {
      const totalRes = await client.query(`SELECT COUNT(*) FROM coupon_redemptions WHERE coupon_id = $1`, [coupon.id]);
      if (parseInt(totalRes.rows[0].count, 10) >= coupon.max_redemptions) {
        throw new OrderError(400, 'This coupon has reached its redemption limit');
      }
    }

    const discount =
      coupon.discount_type === 'percent'
        ? Math.round(subtotal * (parseFloat(coupon.discount_value) / 100) * 100) / 100
        : Math.min(parseFloat(coupon.discount_value), subtotal);

    const redemptionRes = await client.query(
      `INSERT INTO coupon_redemptions (coupon_id, customer_id, discount_amount) VALUES ($1, $2, $3) RETURNING id`,
      [coupon.id, customerId, discount],
    );

    return { discount, redemptionId: redemptionRes.rows[0].id };
  });
}

/** Links a redemption to the order it ended up being used on, once that order exists. */
export async function attachRedemptionToOrder(redemptionId, orderId) {
  await query('UPDATE coupon_redemptions SET order_id = $1 WHERE id = $2', [orderId, redemptionId]);
}
