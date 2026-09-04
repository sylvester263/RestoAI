/**
 * Table Sessions — dine-in QR ordering. A customer scans a table's QR code,
 * joins (or opens) that table's active session, and can place multiple order
 * rounds against it before requesting and settling the bill. Public and
 * unauthenticated by design — tenant/branch are always resolved from the
 * scanned qr_code_token or the session row itself, never from client input.
 */
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { authenticate, checkTenantActive, authorize } from '../middleware/auth.js';
import { getOrCreateCustomer, resolveOrderItems, calculatePricing, createOrder, OrderError } from '../services/orders.js';

const router = Router();

async function loadSession(sessionId) {
  const res = await query(
    `SELECT s.*, t.tenant_id, t.branch_id, t.table_number
     FROM table_sessions s
     JOIN restaurant_tables t ON t.id = s.table_id
     WHERE s.id = $1`,
    [sessionId],
  );
  return res.rows[0] || null;
}

// ── GET /api/table-sessions/:qrToken ──
// Resolve a scanned QR token to the table's current session (opening one if none is active).
router.get('/:qrToken', async (req, res, next) => {
  try {
    const tableRes = await query(
      `SELECT rt.*, t.name as restaurant_name, t.address as restaurant_address
       FROM restaurant_tables rt
       JOIN tenants t ON t.id = rt.tenant_id
       WHERE rt.qr_code_token = $1`,
      [req.params.qrToken],
    );
    const table = tableRes.rows[0];
    if (!table) {
      return res.status(404).json({ error: { message: 'Table not found' } });
    }

    let sessionRes = await query(
      `SELECT * FROM table_sessions WHERE table_id = $1 AND status != 'closed'`,
      [table.id],
    );
    let session = sessionRes.rows[0];
    if (!session) {
      const created = await query(
        `INSERT INTO table_sessions (tenant_id, table_id) VALUES ($1, $2) RETURNING *`,
        [table.tenant_id, table.id],
      );
      session = created.rows[0];
    }

    const menuRes = await query(
      `SELECT mi.id, mi.name, mi.name_urdu, mi.description, mi.price, mi.image_url, mi.tags,
              mc.name as category_name, mc.sort_order
       FROM menu_items mi
       LEFT JOIN menu_categories mc ON mi.category_id = mc.id
       WHERE mi.tenant_id = $1 AND mi.is_available = true
       ORDER BY mc.sort_order, mi.name`,
      [table.tenant_id],
    );

    res.json({
      session: { id: session.id, status: session.status, table_number: table.table_number },
      restaurant: { name: table.restaurant_name, address: table.restaurant_address },
      menu: menuRes.rows,
    });
  } catch (err) {
    next(err);
  }
});

const orderRoundSchema = z.object({
  customer_name: z.string().min(1).max(255).optional(),
  customer_phone: z.string().min(7).max(20).optional(),
  notes: z.string().max(500).optional(),
  items: z.array(z.object({
    menu_item_id: z.string().uuid(),
    quantity: z.number().int().min(1).max(50),
  })).min(1),
});

// ── POST /api/table-sessions/:id/orders ──
// Place an order round against an open session — repeatable as the meal continues.
router.post('/:id/orders', async (req, res, next) => {
  try {
    const session = await loadSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: { message: 'Session not found' } });
    }
    if (session.status !== 'open') {
      return res.status(400).json({ error: { message: 'This table has already requested the bill — ask staff for a new round' } });
    }

    const data = orderRoundSchema.parse(req.body);
    const resolvedItems = await resolveOrderItems(session.tenant_id, data.items);
    const pricing = calculatePricing(resolvedItems, { deliveryFee: 0 });

    const customer = data.customer_phone
      ? await getOrCreateCustomer(session.tenant_id, data.customer_phone, { name: data.customer_name })
      : { id: null };

    const order = await createOrder({
      tenantId: session.tenant_id,
      customer,
      items: resolvedItems,
      pricing,
      deliveryAddress: null,
      paymentMethod: 'cash',
      channel: 'web',
      notes: data.notes,
      branchId: session.branch_id,
      tableSessionId: session.id,
    });

    res.status(201).json({ order: { id: order.id, order_number: order.order_number, status: order.status, total: order.total, items: order.items } });
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

// ── POST /api/table-sessions/:id/request-bill ──
router.post('/:id/request-bill', async (req, res, next) => {
  try {
    const session = await loadSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: { message: 'Session not found' } });
    }
    const updated = await query(
      `UPDATE table_sessions SET status = 'bill_requested' WHERE id = $1 AND status = 'open' RETURNING *`,
      [session.id],
    );
    if (updated.rows.length === 0) {
      return res.status(400).json({ error: { message: 'Bill already requested or session closed' } });
    }
    res.json({ session: updated.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/table-sessions/:id/bill ──
// Itemized bill across every order round placed in this session.
router.get('/:id/bill', async (req, res, next) => {
  try {
    const session = await loadSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: { message: 'Session not found' } });
    }

    const ordersRes = await query(
      `SELECT id, order_number, subtotal, tax, total, created_at FROM orders WHERE table_session_id = $1 ORDER BY created_at`,
      [session.id],
    );
    const itemsRes = await query(
      `SELECT oi.order_id, oi.name, oi.quantity, oi.unit_price, oi.total_price
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.table_session_id = $1
       ORDER BY oi.created_at`,
      [session.id],
    );

    const rounds = ordersRes.rows.map((order) => ({
      ...order,
      items: itemsRes.rows.filter((i) => i.order_id === order.id),
    }));
    const grandTotal = rounds.reduce((sum, r) => sum + parseFloat(r.total), 0);

    res.json({
      session: { id: session.id, status: session.status, table_number: session.table_number },
      rounds,
      grand_total: grandTotal,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/table-sessions/:id/close ──
// Staff closes the session once payment is settled.
router.post('/:id/close', authenticate, checkTenantActive, authorize('tables.close'), async (req, res, next) => {
  try {
    const session = await loadSession(req.params.id);
    if (!session || session.tenant_id !== req.user.tenant_id) {
      return res.status(404).json({ error: { message: 'Session not found' } });
    }
    const updated = await query(
      `UPDATE table_sessions SET status = 'closed', closed_at = NOW() WHERE id = $1 RETURNING *`,
      [session.id],
    );
    res.json({ session: updated.rows[0] });
  } catch (err) {
    next(err);
  }
});

export default router;
