/**
 * POS — a third order-entry channel (alongside WhatsApp and the public web
 * app) for staff taking counter, phone, and dine-in orders in person. Each
 * "add items" call creates a real order round immediately via the shared
 * orders.js service — exactly like table_sessions' dine-in rounds — so the
 * kitchen sees POS orders in real time rather than waiting for the tab to
 * be settled. Settling a tab only finalizes payment across its rounds.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.js';
import { query, withTransaction } from '../db/pool.js';
import { getOrCreateCustomer, resolveOrderItems, calculatePricing, createOrder, OrderError } from '../services/orders.js';

const router = Router();
router.use(authenticate);

async function loadTab(tenantId, tabId) {
  const res = await query(
    `SELECT pt.*, rt.table_number
     FROM pos_tabs pt
     LEFT JOIN table_sessions ts ON ts.id = pt.table_session_id
     LEFT JOIN restaurant_tables rt ON rt.id = ts.table_id
     WHERE pt.id = $1 AND pt.tenant_id = $2`,
    [tabId, tenantId],
  );
  return res.rows[0] || null;
}

async function tabOrders(tabId) {
  const res = await query(
    `SELECT o.*, COALESCE(json_agg(json_build_object(
        'name', oi.name, 'quantity', oi.quantity, 'unit_price', oi.unit_price, 'total_price', oi.total_price
      )) FILTER (WHERE oi.id IS NOT NULL), '[]') as items
     FROM orders o
     LEFT JOIN order_items oi ON oi.order_id = o.id
     WHERE o.pos_tab_id = $1
     GROUP BY o.id
     ORDER BY o.created_at`,
    [tabId],
  );
  return res.rows;
}

function tabSubtotal(orders) {
  return orders.reduce((sum, o) => sum + parseFloat(o.total), 0);
}

// ── GET /api/pos/tabs ──
// Floor view: open tabs for the tenant (optionally filtered by branch).
router.get('/tabs', async (req, res, next) => {
  try {
    const conditions = ['pt.tenant_id = $1', "pt.status = 'open'"];
    const params = [req.user.tenant_id];
    if (req.query.branch_id) {
      conditions.push(`pt.branch_id = $${params.length + 1}`);
      params.push(req.query.branch_id);
    }
    const result = await query(
      `SELECT pt.*, rt.table_number,
              COALESCE((SELECT SUM(total) FROM orders WHERE pos_tab_id = pt.id), 0) as running_total,
              (SELECT COUNT(*) FROM orders WHERE pos_tab_id = pt.id) as round_count
       FROM pos_tabs pt
       LEFT JOIN table_sessions ts ON ts.id = pt.table_session_id
       LEFT JOIN restaurant_tables rt ON rt.id = ts.table_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY pt.created_at ASC`,
      params,
    );
    res.json({ tabs: result.rows });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/pos/tabs/:id ──
router.get('/tabs/:id', async (req, res, next) => {
  try {
    const tab = await loadTab(req.user.tenant_id, req.params.id);
    if (!tab) return res.status(404).json({ error: { message: 'Tab not found' } });
    const orders = await tabOrders(tab.id);
    res.json({ tab, orders, subtotal: tabSubtotal(orders) });
  } catch (err) {
    next(err);
  }
});

const openTabSchema = z.object({
  order_type: z.enum(['counter', 'dine_in', 'phone']),
  branch_id: z.string().uuid().optional(),
  table_id: z.string().uuid().optional(),
  customer_name: z.string().max(255).optional(),
  customer_phone: z.string().max(20).optional(),
});

// ── POST /api/pos/tabs ──
router.post('/tabs', async (req, res, next) => {
  try {
    const data = openTabSchema.parse(req.body);
    if (data.order_type === 'dine_in' && !data.table_id) {
      return res.status(400).json({ error: { message: 'table_id is required for a dine-in tab' } });
    }

    let branchId = data.branch_id || null;
    if (branchId) {
      const branchRes = await query('SELECT id FROM branches WHERE id = $1 AND tenant_id = $2', [branchId, req.user.tenant_id]);
      if (branchRes.rows.length === 0) {
        return res.status(400).json({ error: { message: 'Invalid branch' } });
      }
    } else {
      const branchRes = await query('SELECT id FROM branches WHERE tenant_id = $1 LIMIT 1', [req.user.tenant_id]);
      branchId = branchRes.rows[0]?.id;
    }
    if (!branchId) {
      return res.status(400).json({ error: { message: 'No branch configured for this restaurant' } });
    }

    let tableSessionId = null;
    if (data.order_type === 'dine_in') {
      const tableRes = await query(
        'SELECT id FROM restaurant_tables WHERE id = $1 AND tenant_id = $2 AND branch_id = $3',
        [data.table_id, req.user.tenant_id, branchId],
      );
      if (tableRes.rows.length === 0) {
        return res.status(400).json({ error: { message: 'Table not found for this branch' } });
      }
      const sessionRes = await query(`SELECT id FROM table_sessions WHERE table_id = $1 AND status != 'closed'`, [data.table_id]);
      if (sessionRes.rows.length > 0) {
        tableSessionId = sessionRes.rows[0].id;
      } else {
        const created = await query(
          `INSERT INTO table_sessions (tenant_id, table_id) VALUES ($1, $2) RETURNING id`,
          [req.user.tenant_id, data.table_id],
        );
        tableSessionId = created.rows[0].id;
      }
    }

    const result = await query(
      `INSERT INTO pos_tabs (tenant_id, branch_id, table_session_id, order_type, opened_by, customer_name, customer_phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.user.tenant_id, branchId, tableSessionId, data.order_type, req.user.id, data.customer_name || null, data.customer_phone || null],
    );
    res.status(201).json({ tab: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

const itemsSchema = z.object({
  items: z.array(z.object({
    menu_item_id: z.string().uuid(),
    quantity: z.number().int().min(1).max(50),
  })).min(1),
  notes: z.string().max(500).optional(),
});

// ── POST /api/pos/tabs/:id/items ──
// Adds a new order round to the tab — visible to the kitchen immediately.
router.post('/tabs/:id/items', async (req, res, next) => {
  try {
    const tab = await loadTab(req.user.tenant_id, req.params.id);
    if (!tab) return res.status(404).json({ error: { message: 'Tab not found' } });
    if (tab.status !== 'open') {
      return res.status(400).json({ error: { message: `This tab is already ${tab.status}` } });
    }

    const data = itemsSchema.parse(req.body);
    const resolvedItems = await resolveOrderItems(tab.tenant_id, data.items);
    const pricing = calculatePricing(resolvedItems, { deliveryFee: 0 });
    const customer = tab.customer_phone
      ? await getOrCreateCustomer(tab.tenant_id, tab.customer_phone, { name: tab.customer_name })
      : { id: null };

    const order = await createOrder({
      tenantId: tab.tenant_id,
      customer,
      items: resolvedItems,
      pricing,
      deliveryAddress: null,
      paymentMethod: null, // chosen once, at settlement
      channel: 'pos',
      notes: data.notes,
      branchId: tab.branch_id,
      tableSessionId: tab.table_session_id,
      posTabId: tab.id,
    });

    res.status(201).json({ order });
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

const discountSchema = z.object({
  discount_amount: z.number().min(0),
  discount_reason: z.string().max(255).optional(),
});

// ── POST /api/pos/tabs/:id/discount ──
// Manager/owner only — ties into impl-10's RBAC when it exists; gated on
// the existing roles as an interim, per the spec's own fallback note.
router.post('/tabs/:id/discount', authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const tab = await loadTab(req.user.tenant_id, req.params.id);
    if (!tab) return res.status(404).json({ error: { message: 'Tab not found' } });
    if (tab.status !== 'open') {
      return res.status(400).json({ error: { message: `This tab is already ${tab.status}` } });
    }

    const data = discountSchema.parse(req.body);
    const orders = await tabOrders(tab.id);
    const subtotal = tabSubtotal(orders);
    if (data.discount_amount > subtotal) {
      return res.status(400).json({ error: { message: 'Discount cannot exceed the tab total' } });
    }

    const result = await query(
      `UPDATE pos_tabs SET discount_amount = $2, discount_reason = $3 WHERE id = $1 RETURNING *`,
      [tab.id, data.discount_amount, data.discount_reason || null],
    );
    res.json({ tab: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

// ── POST /api/pos/tabs/:id/void ──
router.post('/tabs/:id/void', async (req, res, next) => {
  try {
    const result = await query(
      `UPDATE pos_tabs SET status = 'voided' WHERE id = $1 AND tenant_id = $2 AND status = 'open' RETURNING *`,
      [req.params.id, req.user.tenant_id],
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: { message: 'Tab not found or already closed' } });
    }
    res.json({ tab: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

const settleSchema = z.object({
  payment_method: z.enum(['cash', 'jazzcash', 'easypaisa', 'card']),
});

// ── POST /api/pos/tabs/:id/settle ──
// Finalizes payment across every round already placed against this tab.
// The discount is prorated across rounds (not dumped onto one row) so
// SUM(orders.total) — what Insights' revenue query reads — still adds up
// to exactly subtotal - discount with no per-row underflow.
router.post('/tabs/:id/settle', async (req, res, next) => {
  try {
    const data = settleSchema.parse(req.body);

    const result = await withTransaction(async (client) => {
      const tabRes = await client.query(
        `SELECT * FROM pos_tabs WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id],
      );
      const tab = tabRes.rows[0];
      if (!tab) {
        const err = new Error('Tab not found');
        err.status = 404;
        throw err;
      }
      if (tab.status !== 'open') {
        const err = new Error(`This tab is already ${tab.status}`);
        err.status = 400;
        throw err;
      }

      const ordersRes = await client.query(
        `SELECT id, total FROM orders WHERE pos_tab_id = $1 ORDER BY created_at FOR UPDATE`,
        [tab.id],
      );
      if (ordersRes.rows.length === 0) {
        const err = new Error('Add at least one item before settling');
        err.status = 400;
        throw err;
      }

      const subtotal = ordersRes.rows.reduce((sum, o) => sum + parseFloat(o.total), 0);
      const discount = Math.min(parseFloat(tab.discount_amount) || 0, subtotal);

      let remaining = discount;
      for (let i = 0; i < ordersRes.rows.length; i++) {
        const order = ordersRes.rows[i];
        const orderTotal = parseFloat(order.total);
        const isLast = i === ordersRes.rows.length - 1;
        const share = isLast ? remaining : Math.round(discount * (orderTotal / subtotal) * 100) / 100;
        const applied = Math.min(share, orderTotal, remaining);
        if (applied > 0) {
          await client.query(
            'UPDATE orders SET total = $2, discount_amount = discount_amount + $3, updated_at = NOW() WHERE id = $1',
            [order.id, Math.max(0, orderTotal - applied), applied],
          );
        }
        remaining = Math.max(0, remaining - applied);
      }

      const finalTotal = Math.max(0, subtotal - discount);
      await client.query(
        `INSERT INTO payments (tenant_id, order_id, method, status, amount)
         VALUES ($1, $2, $3, 'paid', $4)`,
        [tab.tenant_id, ordersRes.rows[0].id, data.payment_method === 'cash' ? 'cod' : data.payment_method, finalTotal],
      );

      const updatedTab = await client.query(
        `UPDATE pos_tabs SET status = 'settled', settled_at = NOW() WHERE id = $1 RETURNING *`,
        [tab.id],
      );

      return { tab: updatedTab.rows[0], total: finalTotal };
    });

    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    if (err.status) {
      return res.status(err.status).json({ error: { message: err.message } });
    }
    next(err);
  }
});

export default router;
