/**
 * Public Customer Ordering Routes — unauthenticated, tenant-scoped by slug.
 * Menu browsing, order creation, and order tracking for the customer-facing
 * web ordering flow (no OTP, no JWT session — tenant_id is always resolved
 * server-side from the slug, never trusted from client input).
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { getOrCreateCustomer, resolveOrderItems, calculatePricing, createOrder, OrderError } from '../services/orders.js';
import { sendReply } from '../services/whatsapp.js';
import { generateRecommendation } from '../services/ai-agent.js';
import { getBalance, redeemPoints, getLoyaltyConfig } from '../services/loyalty.js';
import { previewCoupon, validateAndApplyCoupon, attachRedemptionToOrder, getOrCreateReferralCode } from '../services/coupons.js';
import { estimateReadyTime } from '../services/eta-agent.js';
import config from '../config.js';

const router = Router({ mergeParams: true });

// Rate limiter for public reservations — max 10 per 15 min per IP
const reservationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.ip,
  message: { error: { message: 'Too many reservation requests, try again later' } },
});

async function resolveTenant(req, res, next) {
  try {
    const r = await query(
      'SELECT id, name, address, phone, currency FROM tenants WHERE slug = $1',
      [req.params.tenantSlug],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Restaurant not found' } });
    }
    req.tenant = r.rows[0];
    next();
  } catch (err) {
    next(err);
  }
}

router.use('/:tenantSlug', resolveTenant);

const checkoutSchema = z.object({
  customer_name: z.string().min(1).max(255),
  customer_phone: z.string().min(7).max(20),
  delivery_address: z.string().min(1).max(1000),
  payment_method: z.enum(['cash', 'jazzcash', 'easypaisa', 'card']).default('cash'),
  notes: z.string().max(500).optional(),
  redeem_points: z.number().int().min(0).optional(),
  coupon_code: z.string().min(1).max(30).optional(),
  items: z.array(z.object({
    menu_item_id: z.string().uuid(),
    quantity: z.number().int().min(1).max(50),
  })).min(1),
});

// ── GET /api/public/:tenantSlug ──
// Restaurant header info for the ordering page
router.get('/:tenantSlug', (req, res) => {
  const { name, address, phone, currency } = req.tenant;
  res.json({ restaurant: { name, address, phone, currency }, vapidPublicKey: config.vapid.publicKey || null });
});

// ── GET /api/public/:tenantSlug/menu ──
// All menu items for a tenant, publicly browsable. Unavailable items are
// still included (with is_available: false) so the frontend can show them
// grayed out/"sold out" rather than silently vanishing — actual ordering
// is independently blocked server-side in resolveOrderItems, which is the
// real enforcement point, so this list is display-only.
router.get('/:tenantSlug/menu', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT mi.id, mi.name, mi.name_urdu, mi.description, mi.price, mi.image_url, mi.tags, mi.is_available,
              mc.name as category_name, mc.sort_order
       FROM menu_items mi
       LEFT JOIN menu_categories mc ON mi.category_id = mc.id
       WHERE mi.tenant_id = $1
       ORDER BY mc.sort_order, mi.name`,
      [req.tenant.id],
    );
    res.json({ items: result.rows });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/public/:tenantSlug/orders ──
// Create a cash-on-delivery order from a cart. Prices are always resolved
// server-side from menu_items — client-supplied prices are never trusted.
router.post('/:tenantSlug/orders', async (req, res, next) => {
  try {
    const data = checkoutSchema.parse(req.body);

    const resolvedItems = await resolveOrderItems(req.tenant.id, data.items);
    const customer = await getOrCreateCustomer(req.tenant.id, data.customer_phone, {
      name: data.customer_name,
      address: data.delivery_address,
    });

    let discount = 0;
    if (data.redeem_points) {
      discount += await redeemPoints(req.tenant.id, customer.id, data.redeem_points);
    }

    let couponRedemptionId = null;
    if (data.coupon_code) {
      const subtotalForCoupon = resolvedItems.reduce((sum, i) => sum + i.total_price, 0);
      // Never trust a client-supplied discount amount — the coupon code is
      // re-validated and the discount recomputed here, server-side, at the
      // moment the order is actually created (same principle as payment
      // amounts never being trusted from the client).
      const result = await validateAndApplyCoupon(req.tenant.id, customer.id, data.coupon_code, subtotalForCoupon, {
        items: resolvedItems, deliveryFee: 100,
      });
      discount += result.discount;
      couponRedemptionId = result.redemptionId;
    }

    const pricing = calculatePricing(resolvedItems, { discount });

    const order = await createOrder({
      tenantId: req.tenant.id,
      customer,
      items: resolvedItems,
      pricing,
      deliveryAddress: data.delivery_address,
      paymentMethod: data.payment_method,
      channel: 'web',
      notes: data.notes,
    });

    if (couponRedemptionId) {
      await attachRedemptionToOrder(couponRedemptionId, order.id);
    }

    res.status(201).json({
      order: {
        id: order.id,
        order_number: order.order_number,
        status: order.status,
        subtotal: order.subtotal,
        tax: order.tax,
        delivery_fee: order.delivery_fee,
        discount_amount: order.discount_amount,
        total: order.total,
        items: order.items,
        created_at: order.created_at,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    if (err instanceof OrderError) {
      return res.status(err.status).json({ error: { message: err.message } });
    }
    next(err);
  }
});

// Preview's delivery fee always mirrors POST /orders' actual default (100)
// so a free_delivery coupon previews the real amount it will discount —
// found live: without this, preview always showed Rs. 0 off for
// free_delivery since nothing was passed and the default in coupons.js is 0.
const PREVIEW_DELIVERY_FEE = 100;

// ── GET /api/public/:tenantSlug/coupons/:code/preview ──
// Read-only — shows the discount a code would apply before final checkout.
// Final enforcement still happens atomically inside POST /orders.
router.get('/:tenantSlug/coupons/:code/preview', async (req, res, next) => {
  try {
    const phone = (req.query.phone || '').toString().trim();
    const subtotal = parseFloat(req.query.subtotal) || 0;
    let customerId = null;
    if (phone) {
      const custRes = await query('SELECT id FROM customers WHERE tenant_id = $1 AND phone = $2', [req.tenant.id, phone]);
      customerId = custRes.rows[0]?.id || null;
    }
    const result = await previewCoupon(req.tenant.id, req.params.code, customerId, subtotal, { deliveryFee: PREVIEW_DELIVERY_FEE });
    res.json(result);
  } catch (err) {
    if (err instanceof OrderError) {
      return res.status(err.status).json({ error: { message: err.message } });
    }
    next(err);
  }
});

const validateCouponSchema = z.object({
  code: z.string().min(1).max(30),
  phone: z.string().min(1).max(20).optional(),
  subtotal: z.number().min(0),
  items: z.array(z.object({
    menu_item_id: z.string().uuid(),
    quantity: z.number().int().min(1).max(50),
  })).optional(),
});

// ── POST /api/public/:tenantSlug/coupons/validate ──
// impl-12's spec-named validate endpoint — same read-only preview as the
// GET route above (kept for backward compat with the existing checkout
// UI), just POST + JSON body per the spec's own endpoint table. Accepts an
// optional cart (items) so a 'bogo' coupon can preview accurately — prices
// are always re-resolved server-side, never trusted from the client, same
// as order creation.
router.post('/:tenantSlug/coupons/validate', async (req, res, next) => {
  try {
    const data = validateCouponSchema.parse(req.body);
    let customerId = null;
    if (data.phone) {
      const custRes = await query('SELECT id FROM customers WHERE tenant_id = $1 AND phone = $2', [req.tenant.id, data.phone]);
      customerId = custRes.rows[0]?.id || null;
    }
    const resolvedItems = data.items && data.items.length > 0 ? await resolveOrderItems(req.tenant.id, data.items) : [];
    const result = await previewCoupon(req.tenant.id, data.code, customerId, data.subtotal, {
      items: resolvedItems, deliveryFee: PREVIEW_DELIVERY_FEE,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    if (err instanceof OrderError) {
      return res.status(err.status).json({ error: { message: err.message } });
    }
    next(err);
  }
});

// ── GET /api/public/:tenantSlug/referral?phone=... ──
// "Invite a friend" surface — get-or-create the customer's personal,
// reusable referral code (impl-12 Section 1.1).
router.get('/:tenantSlug/referral', async (req, res, next) => {
  try {
    const phone = (req.query.phone || '').toString().trim();
    if (!phone) return res.status(400).json({ error: { message: 'phone is required' } });
    const customer = await getOrCreateCustomer(req.tenant.id, phone);
    const code = await getOrCreateReferralCode(req.tenant.id, customer.id);
    res.json({ code });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/public/:tenantSlug/orders/:orderId ──
// Track order status. Requires the order's customer phone as a query param
// so a customer can only look up their own order — no auth session exists,
// but this prevents order-id enumeration without one.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/:tenantSlug/orders/:orderId', async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.orderId)) {
      return res.status(404).json({ error: { message: 'Order not found' } });
    }
    const phone = (req.query.phone || '').toString().trim();
    const result = await query(
      `SELECT o.id, o.branch_id, o.order_number, o.status, o.subtotal, o.tax, o.delivery_fee, o.total,
              o.delivery_address, o.payment_method, o.created_at, o.updated_at, c.phone as customer_phone
       FROM orders o
       LEFT JOIN customers c ON o.customer_id = c.id
       WHERE o.tenant_id = $1 AND o.id = $2`,
      [req.tenant.id, req.params.orderId],
    );

    const order = result.rows[0];
    if (!order || !phone || order.customer_phone !== phone) {
      return res.status(404).json({ error: { message: 'Order not found' } });
    }

    const itemsRes = await query(
      'SELECT name, quantity, unit_price, total_price FROM order_items WHERE order_id = $1',
      [order.id],
    );

    // impl-17: recomputed fresh on every poll — never cached at order-creation time
    let eta = null;
    if (['new', 'confirmed', 'preparing'].includes(order.status) && order.branch_id) {
      try {
        eta = await estimateReadyTime(order.branch_id, order.id);
      } catch (err) {
        console.error('[eta-agent] estimate failed:', err.message);
      }
    }

    const { customer_phone, branch_id, ...orderFields } = order;
    res.json({ order: { ...orderFields, items: itemsRes.rows, eta } });
  } catch (err) {
    next(err);
  }
});

const reservationSchema = z.object({
  customer_name: z.string().min(1).max(100),
  customer_phone: z.string().min(7).max(20),
  party_size: z.number().int().min(1).max(50),
  reserved_for: z.string().datetime({ offset: true }).or(z.string().datetime()),
  notes: z.string().max(500).optional(),
});

// ── POST /api/public/:tenantSlug/reservations ──
// Book a table in advance. Branch is resolved as the tenant's first branch,
// matching the same "single default branch" precedent used for orders.
router.post('/:tenantSlug/reservations', reservationLimiter, async (req, res, next) => {
  try {
    const data = reservationSchema.parse(req.body);

    const reservedFor = new Date(data.reserved_for);
    if (Number.isNaN(reservedFor.getTime()) || reservedFor <= new Date()) {
      return res.status(400).json({ error: { message: 'reserved_for must be a valid future date/time' } });
    }

    const branchRes = await query('SELECT id FROM branches WHERE tenant_id = $1 LIMIT 1', [req.tenant.id]);
    const branchId = branchRes.rows[0]?.id;
    if (!branchId) {
      return res.status(400).json({ error: { message: 'This restaurant has no branches configured' } });
    }

    const result = await query(
      `INSERT INTO reservations (tenant_id, branch_id, customer_name, customer_phone, party_size, reserved_for, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.tenant.id, branchId, data.customer_name, data.customer_phone, data.party_size, reservedFor, data.notes || null],
    );
    const reservation = result.rows[0];

    const when = reservedFor.toLocaleString('en-PK', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' });
    sendReply(
      data.customer_phone,
      `✅ Table booked at ${req.tenant.name} for ${data.party_size} on ${when}. See you then!`,
    ).catch(() => {});

    res.status(201).json({ reservation });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

// ── GET /api/public/:tenantSlug/loyalty/balance?phone=... ──
router.get('/:tenantSlug/loyalty/balance', async (req, res, next) => {
  try {
    const phone = (req.query.phone || '').toString().trim();
    if (!phone) return res.status(400).json({ error: { message: 'phone is required' } });

    const config = await getLoyaltyConfig(req.tenant.id);
    if (!config) return res.json({ enabled: false, balance: 0 });

    const custRes = await query('SELECT id FROM customers WHERE tenant_id = $1 AND phone = $2', [req.tenant.id, phone]);
    const balance = custRes.rows[0] ? await getBalance(req.tenant.id, custRes.rows[0].id) : 0;
    res.json({ enabled: true, balance, redemption_rate: parseFloat(config.redemption_rate) });
  } catch (err) {
    next(err);
  }
});

const reviewSchema = z.object({
  order_id: z.string().uuid(),
  phone: z.string().min(7).max(20),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
  menu_item_id: z.string().uuid().optional(),
});

// ── POST /api/public/:tenantSlug/reviews ──
// Only allowed once the order is delivered and the phone matches — same
// ownership check used for order tracking.
router.post('/:tenantSlug/reviews', async (req, res, next) => {
  try {
    const data = reviewSchema.parse(req.body);

    const orderRes = await query(
      `SELECT o.id, o.status, o.customer_id, c.phone FROM orders o
       LEFT JOIN customers c ON o.customer_id = c.id
       WHERE o.id = $1 AND o.tenant_id = $2`,
      [data.order_id, req.tenant.id],
    );
    const order = orderRes.rows[0];
    if (!order || order.phone !== data.phone) {
      return res.status(404).json({ error: { message: 'Order not found' } });
    }
    if (order.status !== 'delivered') {
      return res.status(400).json({ error: { message: 'You can review an order once it has been delivered' } });
    }

    const result = await query(
      `INSERT INTO reviews (tenant_id, order_id, menu_item_id, customer_id, rating, comment)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.tenant.id, order.id, data.menu_item_id || null, order.customer_id, data.rating, data.comment || null],
    );
    res.status(201).json({ review: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

// ── GET /api/public/:tenantSlug/reviews/item/:menuItemId ──
// Aggregate rating + recent comments — social proof on the menu.
router.get('/:tenantSlug/reviews/item/:menuItemId', async (req, res, next) => {
  try {
    const aggRes = await query(
      `SELECT COUNT(*) as count, COALESCE(AVG(rating), 0) as average
       FROM reviews WHERE tenant_id = $1 AND menu_item_id = $2`,
      [req.tenant.id, req.params.menuItemId],
    );
    const recentRes = await query(
      `SELECT rating, comment, created_at FROM reviews
       WHERE tenant_id = $1 AND menu_item_id = $2 AND comment IS NOT NULL
       ORDER BY created_at DESC LIMIT 5`,
      [req.tenant.id, req.params.menuItemId],
    );
    res.json({
      count: parseInt(aggRes.rows[0].count, 10),
      average: Math.round(parseFloat(aggRes.rows[0].average) * 10) / 10,
      recent: recentRes.rows,
    });
  } catch (err) {
    next(err);
  }
});

const subscribeSchema = z.object({
  phone: z.string().min(7).max(20),
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

// ── POST /api/public/:tenantSlug/notifications/subscribe ──
router.post('/:tenantSlug/notifications/subscribe', async (req, res, next) => {
  try {
    const data = subscribeSchema.parse(req.body);
    const customer = await getOrCreateCustomer(req.tenant.id, data.phone);
    await query(
      `INSERT INTO push_subscriptions (customer_id, endpoint, keys) VALUES ($1, $2, $3)
       ON CONFLICT (customer_id, endpoint) DO UPDATE SET keys = EXCLUDED.keys`,
      [customer.id, data.endpoint, data.keys],
    );
    res.status(201).json({ subscribed: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

const recommendationSchema = z.object({ message: z.string().min(1).max(500) });

// ── POST /api/public/:tenantSlug/recommendations ──
// In-app AI assistant — reuses the exact same recommendation logic already
// proven on WhatsApp. Read-only: never creates an order.
router.post('/:tenantSlug/recommendations', async (req, res, next) => {
  try {
    const data = recommendationSchema.parse(req.body);
    const menuRes = await query(
      `SELECT mi.*, mc.name as category_name FROM menu_items mi
       LEFT JOIN menu_categories mc ON mi.category_id = mc.id
       WHERE mi.tenant_id = $1 AND mi.is_available = true`,
      [req.tenant.id],
    );
    const reply = await generateRecommendation(data.message, menuRes.rows, {});
    res.json({ reply });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

export default router;
