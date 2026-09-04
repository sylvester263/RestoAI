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
import { authenticate, checkTenantActive, authorize } from '../middleware/auth.js';
import { query, withTransaction } from '../db/pool.js';
import { getOrCreateCustomer, resolveOrderItems, calculatePricing, createOrder, OrderError } from '../services/orders.js';
import {
  getTaxConfig, upsertTaxConfig, computeSettlement,
  findOpenShift, buildZReport, buildReceiptData,
} from '../services/pos-billing.js';
import { emit } from '../services/event-bus.js';

const router = Router();
router.use(authenticate);
router.use(checkTenantActive);

// Refunds move money back out of the business — gated on the actual role,
// same as agents.js's requireOwner, not on a role_permissions flag an owner
// could accidentally grant away. Managers are included (spec: "manager/owner").
function requireManagerOrOwner(req, res, next) {
  if (req.user.role !== 'owner' && req.user.role !== 'manager') {
    return res.status(403).json({ error: { message: 'Only a manager or owner can do this' } });
  }
  next();
}

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
        'id', oi.id, 'name', oi.name, 'quantity', oi.quantity, 'unit_price', oi.unit_price, 'total_price', oi.total_price
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
// Floor view: open AND held (parked) tabs for the tenant, optionally
// filtered by branch — the client groups them into "Active" vs "Parked"
// by tab.status, so held tabs stay visible instead of vanishing.
router.get('/tabs', async (req, res, next) => {
  try {
    const conditions = ['pt.tenant_id = $1', "pt.status IN ('open','held')"];
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

    // Best-effort — a tab opens fine with no shift on record; it just won't
    // contribute to that cashier's Z-report reconciliation later.
    const openShift = await findOpenShift(req.user.tenant_id, branchId, req.user.id);

    const result = await query(
      `INSERT INTO pos_tabs (tenant_id, branch_id, table_session_id, order_type, opened_by, customer_name, customer_phone, pos_shift_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.user.tenant_id, branchId, tableSessionId, data.order_type, req.user.id, data.customer_name || null, data.customer_phone || null, openShift?.id || null],
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
    const taxConfig = await getTaxConfig(tab.branch_id);
    const pricing = calculatePricing(resolvedItems, { deliveryFee: 0, taxRate: (parseFloat(taxConfig.tax_rate) || 0) / 100 });
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

    // Real-time: kitchen display should show this new round immediately
    emit(`kitchen:${tab.tenant_id}`, 'order:new', { orderId: order.id, tabId: tab.id });
    emit(`pos:${tab.branch_id}`, 'tab:updated', { tabId: tab.id });
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
router.post('/tabs/:id/discount', authorize('discounts.apply'), async (req, res, next) => {
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
      `UPDATE pos_tabs SET status = 'voided' WHERE id = $1 AND tenant_id = $2 AND status IN ('open','held') RETURNING *`,
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

// ── POST /api/pos/tabs/:id/hold ── park an open tab without settling
router.post('/tabs/:id/hold', async (req, res, next) => {
  try {
    const result = await query(
      `UPDATE pos_tabs SET status = 'held' WHERE id = $1 AND tenant_id = $2 AND status = 'open' RETURNING *`,
      [req.params.id, req.user.tenant_id],
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: { message: 'Tab not found or not open' } });
    }
    res.json({ tab: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/pos/tabs/:id/resume ── un-park a held tab, resumable by any staff on shift
router.post('/tabs/:id/resume', async (req, res, next) => {
  try {
    const result = await query(
      `UPDATE pos_tabs SET status = 'open' WHERE id = $1 AND tenant_id = $2 AND status = 'held' RETURNING *`,
      [req.params.id, req.user.tenant_id],
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: { message: 'Tab not found or not held' } });
    }
    res.json({ tab: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

const transferSchema = z.object({ table_id: z.string().uuid() });

// ── POST /api/pos/tabs/:id/transfer ── move a dine-in tab to a different table
router.post('/tabs/:id/transfer', async (req, res, next) => {
  try {
    const tab = await loadTab(req.user.tenant_id, req.params.id);
    if (!tab) return res.status(404).json({ error: { message: 'Tab not found' } });
    if (tab.order_type !== 'dine_in' || !tab.table_session_id) {
      return res.status(400).json({ error: { message: 'Only dine-in tabs can be transferred' } });
    }
    if (tab.status !== 'open' && tab.status !== 'held') {
      return res.status(400).json({ error: { message: `This tab is already ${tab.status}` } });
    }

    const data = transferSchema.parse(req.body);
    const tableRes = await query(
      'SELECT id FROM restaurant_tables WHERE id = $1 AND tenant_id = $2 AND branch_id = $3',
      [data.table_id, req.user.tenant_id, tab.branch_id],
    );
    if (tableRes.rows.length === 0) {
      return res.status(400).json({ error: { message: 'Table not found for this branch' } });
    }

    const occupiedRes = await query(
      `SELECT id FROM table_sessions WHERE table_id = $1 AND status != 'closed' AND id != $2`,
      [data.table_id, tab.table_session_id],
    );
    if (occupiedRes.rows.length > 0) {
      return res.status(400).json({ error: { message: 'That table is already occupied by a different session' } });
    }

    // Move the existing session itself — order history stays attached to the
    // same table_session_id, Kitchen display just shows the new table number.
    await query('UPDATE table_sessions SET table_id = $1 WHERE id = $2', [data.table_id, tab.table_session_id]);
    const updated = await loadTab(req.user.tenant_id, tab.id);
    res.json({ tab: updated });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

const voidItemSchema = z.object({
  order_item_id: z.string().uuid(),
  reason: z.string().min(1).max(255),
});

// ── POST /api/pos/tabs/:id/void-item ── void one line item before settlement
router.post('/tabs/:id/void-item', authorize('pos.void_item'), async (req, res, next) => {
  try {
    const tab = await loadTab(req.user.tenant_id, req.params.id);
    if (!tab) return res.status(404).json({ error: { message: 'Tab not found' } });
    if (tab.status !== 'open' && tab.status !== 'held') {
      return res.status(400).json({ error: { message: `This tab is already ${tab.status}` } });
    }

    const data = voidItemSchema.parse(req.body);

    const voidRow = await withTransaction(async (client) => {
      const itemRes = await client.query(
        `SELECT oi.id, oi.total_price, o.id as order_id, o.subtotal, o.tax, o.discount_amount
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE oi.id = $1 AND o.pos_tab_id = $2
         FOR UPDATE OF oi, o`,
        [data.order_item_id, tab.id],
      );
      const item = itemRes.rows[0];
      if (!item) {
        const err = new Error('Line item not found on this tab');
        err.status = 404;
        throw err;
      }

      const lineTotal = parseFloat(item.total_price);
      const oldSubtotal = parseFloat(item.subtotal);
      const oldTax = parseFloat(item.tax);
      const newSubtotal = Math.max(0, Math.round((oldSubtotal - lineTotal) * 100) / 100);
      // Shrink tax proportionally to the subtotal reduction — keeps the
      // effective rate on this round consistent rather than leaving stale tax
      // on a line that no longer exists.
      const newTax = oldSubtotal > 0 ? Math.round(oldTax * (newSubtotal / oldSubtotal) * 100) / 100 : 0;
      const newTotal = Math.max(0, Math.round((newSubtotal - parseFloat(item.discount_amount) + newTax) * 100) / 100);

      await client.query('DELETE FROM order_items WHERE id = $1', [data.order_item_id]);
      await client.query(
        'UPDATE orders SET subtotal = $2, tax = $3, total = $4, updated_at = NOW() WHERE id = $1',
        [item.order_id, newSubtotal, newTax, newTotal],
      );
      const voidRes = await client.query(
        `INSERT INTO pos_voids (tenant_id, pos_tab_id, order_id, type, amount, reason, authorized_by)
         VALUES ($1, $2, $3, 'void', $4, $5, $6) RETURNING *`,
        [req.user.tenant_id, tab.id, item.order_id, lineTotal, data.reason, req.user.id],
      );
      return voidRes.rows[0];
    });

    res.status(201).json({ void: voidRow });
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

const settleSchema = z.object({
  payment_method: z.enum(['cash', 'jazzcash', 'easypaisa', 'card']).optional(),
  payments: z.array(z.object({
    method: z.enum(['cash', 'jazzcash', 'easypaisa', 'card']),
    amount: z.number().positive(),
  })).min(1).optional(),
}).refine((d) => d.payment_method || (d.payments && d.payments.length > 0), {
  message: 'payment_method or payments is required',
});

// ── POST /api/pos/tabs/:id/settle ──
// Finalizes payment across every round already placed against this tab.
// impl-24: tax is recomputed here on the post-discount subtotal (provincial
// tax_config rate), and both discount and tax are prorated across the
// underlying order rows the same way discount alone used to be — so
// SUM(orders.total) still matches the bill total for Insights, and each
// order row stays internally consistent (subtotal - discount + tax = total).
// Accepts either a single `payment_method` (legacy — full amount) or a
// `payments` array for split-tender; a split's amounts must sum to the total.
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
      if (tab.status !== 'open' && tab.status !== 'held') {
        const err = new Error(`This tab is already ${tab.status}`);
        err.status = 400;
        throw err;
      }

      const ordersRes = await client.query(
        `SELECT id, subtotal, tax, total FROM orders WHERE pos_tab_id = $1 ORDER BY created_at FOR UPDATE`,
        [tab.id],
      );
      if (ordersRes.rows.length === 0) {
        const err = new Error('Add at least one item before settling');
        err.status = 400;
        throw err;
      }

      const taxConfig = await getTaxConfig(tab.branch_id);
      const settlement = computeSettlement(ordersRes.rows, parseFloat(tab.discount_amount) || 0, taxConfig.tax_rate);

      for (const line of settlement.perOrder) {
        await client.query(
          'UPDATE orders SET discount_amount = $2, tax = $3, total = $4, updated_at = NOW() WHERE id = $1',
          [line.id, line.discount, line.tax, line.total],
        );
      }

      const paymentLines = data.payments || [{ method: data.payment_method, amount: settlement.total }];
      const paidSum = Math.round(paymentLines.reduce((sum, p) => sum + p.amount, 0) * 100) / 100;
      if (Math.abs(paidSum - settlement.total) > 1) {
        const err = new Error(`Payment total (Rs. ${paidSum}) doesn't match the bill total (Rs. ${settlement.total})`);
        err.status = 400;
        throw err;
      }

      for (const line of paymentLines) {
        await client.query(
          `INSERT INTO pos_tab_payments (pos_tab_id, method, amount) VALUES ($1, $2, $3)`,
          [tab.id, line.method, line.amount],
        );
      }

      // Aggregate `payments` row — existing reporting reads this table across
      // every channel. Primary method is the split's first line; amount is
      // the full settled total. pos_tab_payments is the granular record.
      const primaryMethod = paymentLines[0].method === 'cash' ? 'cod' : paymentLines[0].method;
      await client.query(
        `INSERT INTO payments (tenant_id, order_id, method, status, amount)
         VALUES ($1, $2, $3, 'paid', $4)`,
        [tab.tenant_id, ordersRes.rows[0].id, primaryMethod, settlement.total],
      );

      const updatedTab = await client.query(
        `UPDATE pos_tabs SET status = 'settled', settled_at = NOW() WHERE id = $1 RETURNING *`,
        [tab.id],
      );

      return {
        tab: updatedTab.rows[0],
        total: settlement.total,
        subtotal: settlement.subtotal,
        discount: settlement.discount,
        tax: settlement.tax,
        primary_order_id: ordersRes.rows[0].id,
      };
    });

    res.json(result);

    // Real-time: notify POS and kitchen that this tab is settled
    emit(`pos:${result.tab.branch_id}`, 'tab:settled', { tabId: req.params.id });
    emit(`kitchen:${req.user.tenant_id}`, 'order:settled', { tabId: req.params.id });
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

const refundSchema = z.object({
  amount: z.number().positive(),
  reason: z.string().min(1).max(255),
  method: z.enum(['cash', 'card', 'jazzcash', 'easypaisa']).optional(),
});

// ── POST /api/pos/orders/:id/refund ── manager/owner only, hard role check
router.post('/orders/:id/refund', requireManagerOrOwner, async (req, res, next) => {
  try {
    const data = refundSchema.parse(req.body);

    const result = await withTransaction(async (client) => {
      const orderRes = await client.query(
        'SELECT * FROM orders WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
        [req.params.id, req.user.tenant_id],
      );
      const order = orderRes.rows[0];
      if (!order) {
        const err = new Error('Order not found');
        err.status = 404;
        throw err;
      }

      const priorRes = await client.query(
        `SELECT COALESCE(SUM(amount), 0) as total FROM pos_voids WHERE order_id = $1 AND type = 'refund'`,
        [order.id],
      );
      const alreadyRefunded = parseFloat(priorRes.rows[0].total);
      if (alreadyRefunded + data.amount > parseFloat(order.total) + 0.01) {
        const err = new Error(`Refund would exceed the order total (already refunded Rs. ${alreadyRefunded})`);
        err.status = 400;
        throw err;
      }

      // Default the refund method to how the order was actually paid —
      // needed so the Z-report only deducts a refund from the cash drawer
      // when it genuinely left as cash.
      let method = data.method;
      if (!method) {
        const payRes = await client.query('SELECT method FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1', [order.id]);
        method = payRes.rows[0]?.method === 'cod' ? 'cash' : (payRes.rows[0]?.method || 'cash');
      }

      const voidRes = await client.query(
        `INSERT INTO pos_voids (tenant_id, pos_tab_id, order_id, type, method, amount, reason, authorized_by, requested_by)
         VALUES ($1, $2, $3, 'refund', $4, $5, $6, $7, $8) RETURNING *`,
        [req.user.tenant_id, order.pos_tab_id, order.id, method, data.amount, data.reason, req.user.id, req.body.requested_by || req.user.id],
      );

      const fullyRefunded = alreadyRefunded + data.amount >= parseFloat(order.total) - 0.01;
      await client.query(
        `UPDATE payments SET status = $2, updated_at = NOW() WHERE order_id = $1`,
        [order.id, fullyRefunded ? 'refunded' : 'paid'],
      );

      return voidRes.rows[0];
    });

    res.status(201).json({ refund: result });
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

// ── GET /api/pos/orders/:id/voids ── void/refund audit history for one order
router.get('/orders/:id/voids', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT v.*, a.name as authorized_by_name, r.name as requested_by_name
       FROM pos_voids v
       LEFT JOIN users a ON a.id = v.authorized_by
       LEFT JOIN users r ON r.id = v.requested_by
       WHERE v.tenant_id = $1 AND (v.order_id = $2 OR v.pos_tab_id = (SELECT pos_tab_id FROM orders WHERE id = $2))
       ORDER BY v.created_at DESC`,
      [req.user.tenant_id, req.params.id],
    );
    res.json({ voids: result.rows });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/pos/receipts/:orderId ── print-ready itemized receipt data
router.get('/receipts/:orderId', async (req, res, next) => {
  try {
    const receipt = await buildReceiptData(req.user.tenant_id, req.params.orderId);
    if (!receipt) return res.status(404).json({ error: { message: 'Order not found' } });
    res.json({ receipt });
  } catch (err) {
    next(err);
  }
});

// ── Tax config ──
const taxConfigSchema = z.object({
  tax_authority: z.enum(['PRA', 'SRB', 'KPRA', 'BRA', 'NONE']),
  tax_rate: z.number().min(0).max(100),
  tax_registration_number: z.string().max(50).optional(),
});

router.get('/tax-config', async (req, res, next) => {
  try {
    if (!req.query.branch_id) return res.status(400).json({ error: { message: 'branch_id is required' } });
    const config = await getTaxConfig(req.query.branch_id);
    res.json({ tax_config: config });
  } catch (err) {
    next(err);
  }
});

router.put('/tax-config', authorize('branches.manage'), async (req, res, next) => {
  try {
    if (!req.body.branch_id) return res.status(400).json({ error: { message: 'branch_id is required' } });
    const branchRes = await query('SELECT id FROM branches WHERE id = $1 AND tenant_id = $2', [req.body.branch_id, req.user.tenant_id]);
    if (branchRes.rows.length === 0) return res.status(404).json({ error: { message: 'Branch not found' } });

    const data = taxConfigSchema.parse(req.body);
    const config = await upsertTaxConfig(req.user.tenant_id, req.body.branch_id, data);
    res.json({ tax_config: config });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

// ── Shifts ──
const openShiftSchema = z.object({
  branch_id: z.string().uuid(),
  opening_cash_float: z.number().min(0),
});

router.post('/shifts/open', async (req, res, next) => {
  try {
    const data = openShiftSchema.parse(req.body);
    const existing = await findOpenShift(req.user.tenant_id, data.branch_id, req.user.id);
    if (existing) {
      return res.status(400).json({ error: { message: 'You already have an open shift for this branch' } });
    }
    const result = await query(
      `INSERT INTO pos_shifts (tenant_id, branch_id, opened_by, opening_cash_float) VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.tenant_id, data.branch_id, req.user.id, data.opening_cash_float],
    );
    res.status(201).json({ shift: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

router.get('/shifts/current', async (req, res, next) => {
  try {
    if (!req.query.branch_id) return res.status(400).json({ error: { message: 'branch_id is required' } });
    const shift = await findOpenShift(req.user.tenant_id, req.query.branch_id, req.user.id);
    res.json({ shift });
  } catch (err) {
    next(err);
  }
});

// Owner/manager view: every open shift across a branch, not just their own.
router.get('/shifts', requireManagerOrOwner, async (req, res, next) => {
  try {
    const conditions = ['tenant_id = $1'];
    const params = [req.user.tenant_id];
    if (req.query.branch_id) {
      conditions.push(`branch_id = $${params.length + 1}`);
      params.push(req.query.branch_id);
    }
    if (req.query.status) {
      conditions.push(`status = $${params.length + 1}`);
      params.push(req.query.status);
    }
    const result = await query(
      `SELECT s.*, u.name as opened_by_name FROM pos_shifts s
       LEFT JOIN users u ON u.id = s.opened_by
       WHERE ${conditions.join(' AND ')} ORDER BY s.opened_at DESC`,
      params,
    );
    res.json({ shifts: result.rows });
  } catch (err) {
    next(err);
  }
});

const closeShiftSchema = z.object({ closing_cash_counted: z.number().min(0) });

router.post('/shifts/:id/close', async (req, res, next) => {
  try {
    const data = closeShiftSchema.parse(req.body);

    const shiftRes = await query('SELECT * FROM pos_shifts WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenant_id]);
    const shift = shiftRes.rows[0];
    if (!shift) return res.status(404).json({ error: { message: 'Shift not found' } });
    if (shift.status !== 'open') return res.status(400).json({ error: { message: 'This shift is already closed' } });
    // Any staff can close their own shift; a manager/owner can close anyone's.
    if (shift.opened_by !== req.user.id && req.user.role !== 'owner' && req.user.role !== 'manager') {
      return res.status(403).json({ error: { message: 'You can only close your own shift' } });
    }

    const report = await buildZReport(req.user.tenant_id, shift.id);
    const expected = report.closing_cash_expected;
    const variance = Math.round((data.closing_cash_counted - expected) * 100) / 100;

    const result = await query(
      `UPDATE pos_shifts SET status = 'closed', closed_by = $2, closing_cash_counted = $3,
              closing_cash_expected = $4, variance = $5, closed_at = NOW()
       WHERE id = $1 RETURNING *`,
      [shift.id, req.user.id, data.closing_cash_counted, expected, variance],
    );
    res.json({ shift: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

router.get('/shifts/:id/z-report', async (req, res, next) => {
  try {
    const shiftRes = await query('SELECT opened_by FROM pos_shifts WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenant_id]);
    if (shiftRes.rows.length === 0) return res.status(404).json({ error: { message: 'Shift not found' } });
    if (shiftRes.rows[0].opened_by !== req.user.id && req.user.role !== 'owner' && req.user.role !== 'manager') {
      return res.status(403).json({ error: { message: 'You can only view your own shift report' } });
    }
    const report = await buildZReport(req.user.tenant_id, req.params.id);
    res.json({ report });
  } catch (err) {
    next(err);
  }
});

export default router;
