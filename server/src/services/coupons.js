/**
 * Coupons, discounts & referrals (impl-12, extended 2026-08-28 with
 * first_order_only, the referral program, and the free_delivery/bogo types).
 * The `coupons`/`coupon_redemptions` tables predate a written spec (built
 * for impl-15/impl-21) — column names (discount_type/discount_value,
 * max_redemptions) were kept as-is rather than renamed to the newer spec's
 * vocabulary (type/value, usage_limit_total), to avoid touching the
 * already-verified race-safe redemption path. New columns were added
 * instead; see migrate.js's impl-12 block for the exact deviation notes.
 *
 * validateAndApplyCoupon is the single shared entry point required by the
 * spec — callable from both the public checkout flow (routes/public.js)
 * and the WhatsApp order flow (services/whatsapp.js). There is exactly one
 * implementation of the discount math and the concurrency-safe redemption
 * logic; nothing else duplicates it.
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
    `INSERT INTO coupons (
       tenant_id, code, discount_type, discount_value, usage_limit_per_customer, max_redemptions,
       expires_at, customer_id, created_by, min_order_amount, max_discount_amount, first_order_only,
       referral_customer_id, starts_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
    [
      tenantId, code, data.discount_type, data.discount_value ?? null,
      data.usage_limit_per_customer ?? 1, data.max_redemptions ?? null,
      data.expires_at ?? null, data.customer_id ?? null, createdBy ?? null,
      data.min_order_amount ?? 0, data.max_discount_amount ?? null,
      data.first_order_only ?? false, data.referral_customer_id ?? null,
      data.starts_at ?? null,
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

// ── Discount math — shared by the preview path and the real redemption path ──
// items is optional (only needed for 'bogo'); deliveryFee is optional (only
// needed for 'free_delivery', 0 for dine-in/POS where there's no delivery fee).
function computeDiscount(coupon, subtotal, items = [], deliveryFee = 0) {
  switch (coupon.discount_type) {
    case 'percent': {
      const raw = subtotal * (parseFloat(coupon.discount_value) / 100);
      const capped = coupon.max_discount_amount != null ? Math.min(raw, parseFloat(coupon.max_discount_amount)) : raw;
      return Math.round(capped * 100) / 100;
    }
    case 'fixed':
      return Math.min(parseFloat(coupon.discount_value), subtotal);
    case 'free_delivery':
      return Math.min(deliveryFee, subtotal + deliveryFee);
    case 'bogo': {
      // No specced "target item" concept — the cheapest single unit in the
      // cart becomes free. Documented interpretation, not a spec literal.
      const unitPrices = items.flatMap((i) => Array(i.quantity || 1).fill(parseFloat(i.unit_price)));
      return unitPrices.length > 0 ? Math.min(...unitPrices) : 0;
    }
    default:
      return 0;
  }
}

async function assertOrderEligible(client, tenantId, code) {
  if (!code) throw new OrderError(400, 'Coupon code is required');
}

// Shared checks that don't depend on locking — used by both preview and the
// real (locked) path so the two can never silently diverge.
function runCouponChecks(coupon, customerId, subtotal) {
  if (!coupon || !coupon.active) throw new OrderError(400, 'Invalid coupon code');
  if (coupon.starts_at && new Date(coupon.starts_at) > new Date()) throw new OrderError(400, 'This coupon is not active yet');
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) throw new OrderError(400, 'This coupon has expired');
  if (coupon.customer_id && coupon.customer_id !== customerId) throw new OrderError(400, 'This coupon is not valid for this account');
  if (coupon.referral_customer_id && coupon.referral_customer_id === customerId) throw new OrderError(400, "You can't use your own referral code");
  if (parseFloat(coupon.min_order_amount) > 0 && subtotal < parseFloat(coupon.min_order_amount)) {
    throw new OrderError(400, `This coupon requires a minimum order of Rs. ${coupon.min_order_amount}`);
  }
}

async function assertFirstOrderOnly(queryFn, tenantId, customerId, coupon) {
  if (!coupon.first_order_only) return;
  const res = await queryFn(
    `SELECT 1 FROM orders WHERE tenant_id = $1 AND customer_id = $2 AND status = 'delivered' LIMIT 1`,
    [tenantId, customerId],
  );
  if (res.rows.length > 0) throw new OrderError(400, 'This coupon is only valid on your first order');
}

/**
 * Read-only preview for checkout UI — same validity checks as
 * validateAndApplyCoupon but no lock, no insert. Purely informational: the
 * real enforcement still happens atomically at actual submit time, so a
 * coupon that previews fine can still be rejected there (e.g. someone else
 * used up the last redemption in between).
 */
export async function previewCoupon(tenantId, code, customerId, subtotal, { items = [], deliveryFee = 0 } = {}) {
  const couponRes = await query('SELECT * FROM coupons WHERE tenant_id = $1 AND code = $2', [tenantId, code.toUpperCase()]);
  const coupon = couponRes.rows[0];
  runCouponChecks(coupon, customerId, subtotal);
  if (customerId) await assertFirstOrderOnly(query, tenantId, customerId, coupon);

  const perCustomerRes = customerId
    ? await query('SELECT COUNT(*) FROM coupon_redemptions WHERE coupon_id = $1 AND customer_id = $2', [coupon.id, customerId])
    : { rows: [{ count: 0 }] };
  if (parseInt(perCustomerRes.rows[0].count, 10) >= coupon.usage_limit_per_customer) {
    throw new OrderError(400, 'You have already used this coupon');
  }
  if (coupon.max_redemptions !== null) {
    const totalRes = await query('SELECT COUNT(*) FROM coupon_redemptions WHERE coupon_id = $1', [coupon.id]);
    if (parseInt(totalRes.rows[0].count, 10) >= coupon.max_redemptions) {
      throw new OrderError(400, 'This coupon has reached its redemption limit');
    }
  }

  const discount = computeDiscount(coupon, subtotal, items, deliveryFee);
  return { discount, discount_type: coupon.discount_type, discount_value: coupon.discount_value != null ? parseFloat(coupon.discount_value) : null };
}

/**
 * Validates a coupon code for a checkout and redeems it atomically — locks
 * the coupon row for the duration of the check so two concurrent checkouts
 * (double-submit, two tabs, or a burst of concurrent requests) can't both
 * pass the per-customer/total limit check against the same pre-redemption
 * count. Same class of race already guarded against in loyalty.js's
 * redeemPoints and the POS coupon path this replaced.
 *
 * order_id isn't known yet at this point (pricing — and therefore the
 * discount — must be resolved before the order row can be created), so the
 * redemption is recorded with a null order_id and patched by
 * attachRedemptionToOrder once the order exists.
 *
 * If the coupon was issued by the referral program (referral_customer_id
 * set) and this is a different customer's first successful redemption of
 * it, a new referral_rewards row is created here, inside the same lock —
 * the referrer's actual reward coupon is minted later, only once the
 * referred order reaches 'delivered' (completeReferralIfEligible).
 */
export async function validateAndApplyCoupon(tenantId, customerId, code, subtotal, { items = [], deliveryFee = 0 } = {}) {
  await assertOrderEligible(null, tenantId, code);
  return withTransaction(async (client) => {
    const couponRes = await client.query(
      `SELECT * FROM coupons WHERE tenant_id = $1 AND code = $2 FOR UPDATE`,
      [tenantId, code.toUpperCase()],
    );
    const coupon = couponRes.rows[0];
    runCouponChecks(coupon, customerId, subtotal);
    await assertFirstOrderOnly((...args) => client.query(...args), tenantId, customerId, coupon);

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

    const discount = computeDiscount(coupon, subtotal, items, deliveryFee);

    const redemptionRes = await client.query(
      `INSERT INTO coupon_redemptions (coupon_id, customer_id, discount_amount) VALUES ($1, $2, $3) RETURNING id`,
      [coupon.id, customerId, discount],
    );

    if (coupon.referral_customer_id) {
      await client.query(
        `INSERT INTO referral_rewards (tenant_id, referrer_customer_id, referred_customer_id, referred_coupon_id)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, coupon.referral_customer_id, customerId, coupon.id],
      );
    }

    return { discount, redemptionId: redemptionRes.rows[0].id };
  });
}

/** Links a redemption to the order it ended up being used on, once that order exists. */
export async function attachRedemptionToOrder(redemptionId, orderId) {
  await query('UPDATE coupon_redemptions SET order_id = $1 WHERE id = $2', [orderId, redemptionId]);
}

// ── Referral program ──

/**
 * Returns the customer's personal, reusable referral code — a first-order
 * coupon tagged with referral_customer_id — minting one on first request.
 * One code can be shared with (and redeemed by) many different friends;
 * each successful redemption gets its own referral_rewards row via
 * validateAndApplyCoupon above, not this function.
 */
export async function getOrCreateReferralCode(tenantId, customerId) {
  const existing = await query(
    `SELECT code FROM coupons WHERE tenant_id = $1 AND referral_customer_id = $2 AND active = true LIMIT 1`,
    [tenantId, customerId],
  );
  if (existing.rows[0]) return existing.rows[0].code;

  const coupon = await createCoupon(tenantId, {
    code: generateCode('REFER'),
    discount_type: 'percent',
    discount_value: 15,
    usage_limit_per_customer: 1,
    first_order_only: true,
    referral_customer_id: customerId,
  });
  return coupon.code;
}

/**
 * Called when an order reaches 'delivered' (routes/orders.js's
 * fireStatusChangeSideEffects, same trigger point as the loyalty-points
 * award) — if this order's customer was successfully referred and hasn't
 * already triggered a reward, mints the referrer's reward coupon and marks
 * the referral complete. Guards against referral-then-cancel abuse by
 * firing only on 'delivered', never on order creation.
 */
export async function completeReferralIfEligible(tenantId, orderId) {
  return withTransaction(async (client) => {
    const orderRes = await client.query('SELECT customer_id FROM orders WHERE id = $1 AND tenant_id = $2', [orderId, tenantId]);
    const referredCustomerId = orderRes.rows[0]?.customer_id;
    if (!referredCustomerId) return null;

    const rewardRes = await client.query(
      `SELECT * FROM referral_rewards
       WHERE tenant_id = $1 AND referred_customer_id = $2 AND status = 'pending'
       ORDER BY created_at ASC LIMIT 1 FOR UPDATE`,
      [tenantId, referredCustomerId],
    );
    const reward = rewardRes.rows[0];
    if (!reward) return null;

    const code = generateCode('THANKS');
    const couponRes = await client.query(
      `INSERT INTO coupons (tenant_id, code, discount_type, discount_value, usage_limit_per_customer, customer_id, expires_at)
       VALUES ($1, $2, 'fixed', 200, 1, $3, $4) RETURNING *`,
      [tenantId, code, reward.referrer_customer_id, new Date(Date.now() + 30 * 86400000)],
    );
    const referrerCoupon = couponRes.rows[0];

    await client.query(
      `UPDATE referral_rewards SET referrer_coupon_id = $2, status = 'completed' WHERE id = $1`,
      [reward.id, referrerCoupon.id],
    );

    return { referrerCoupon, referrerCustomerId: reward.referrer_customer_id };
  });
}
