/**
 * Public Customer Ordering Routes — unauthenticated, tenant-scoped by slug.
 * Menu browsing, order creation, and order tracking for the customer-facing
 * web ordering flow (no OTP, no JWT session — tenant_id is always resolved
 * server-side from the slug, never trusted from client input).
 */
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { getOrCreateCustomer, resolveOrderItems, calculatePricing, createOrder, OrderError } from '../services/orders.js';
import { sendReply } from '../services/whatsapp.js';

const router = Router({ mergeParams: true });

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
  items: z.array(z.object({
    menu_item_id: z.string().uuid(),
    quantity: z.number().int().min(1).max(50),
  })).min(1),
});

// ── GET /api/public/:tenantSlug ──
// Restaurant header info for the ordering page
router.get('/:tenantSlug', (req, res) => {
  const { name, address, phone, currency } = req.tenant;
  res.json({ restaurant: { name, address, phone, currency } });
});

// ── GET /api/public/:tenantSlug/menu ──
// Available menu items for a tenant, publicly browsable
router.get('/:tenantSlug/menu', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT mi.id, mi.name, mi.name_urdu, mi.description, mi.price, mi.image_url, mi.tags,
              mc.name as category_name, mc.sort_order
       FROM menu_items mi
       LEFT JOIN menu_categories mc ON mi.category_id = mc.id
       WHERE mi.tenant_id = $1 AND mi.is_available = true
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
    const pricing = calculatePricing(resolvedItems);
    const customer = await getOrCreateCustomer(req.tenant.id, data.customer_phone, {
      name: data.customer_name,
      address: data.delivery_address,
    });
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

    res.status(201).json({
      order: {
        id: order.id,
        order_number: order.order_number,
        status: order.status,
        subtotal: order.subtotal,
        tax: order.tax,
        delivery_fee: order.delivery_fee,
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
      `SELECT o.id, o.order_number, o.status, o.subtotal, o.tax, o.delivery_fee, o.total,
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

    const { customer_phone, ...orderFields } = order;
    res.json({ order: { ...orderFields, items: itemsRes.rows } });
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
router.post('/:tenantSlug/reservations', async (req, res, next) => {
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

export default router;
