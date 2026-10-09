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
import { requireModule } from '../services/modules.js';
import { query, withTransaction } from '../db/pool.js';
import { OrderError } from '../services/orders.js';
import {
  getTaxConfig, upsertTaxConfig,
  findOpenShift, buildZReport, buildReceiptData,
} from '../services/pos-billing.js';
import { emit } from '../services/event-bus.js';
import { scheduleFiscal, listFiscalQueue, retryPendingFiscal, resubmitFiscal, markFiscalReported } from '../services/fiscal.js';
import { openTab, addItems, settleTab, PosError } from '../services/pos-tabs.js';
import { posAudit } from '../services/pos-audit.js';

const router = Router();
router.use(authenticate);
router.use(checkTenantActive);
router.use(requireModule('pos'));

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
  // impl-33 Part 4: idempotency key + this device's bill number (both optional)
  client_request_id: z.string().uuid().optional(),
  device_id: z.string().uuid().optional(),
  bill_number: z.number().int().positive().optional(),
});

function sendPosError(res, err) {
  if (err instanceof z.ZodError) return res.status(400).json({ error: { message: err.errors[0].message } });
  if (err instanceof PosError) return res.status(err.status).json({ error: { message: err.message, code: err.code } });
  if (err instanceof OrderError) return res.status(err.status).json({ error: { message: err.message } });
  return null;
}

// ── POST /api/pos/tabs ── (logic in services/pos-tabs.js)
router.post('/tabs', async (req, res, next) => {
  try {
    const data = openTabSchema.parse(req.body);
    const { tab, replay } = await openTab({
      tenantId: req.user.tenant_id,
      user: req.user,
      data,
      clientRequestId: data.client_request_id || null,
      deviceId: data.device_id || null,
      billNumber: data.bill_number ?? null,
    });
    res.status(replay ? 200 : 201).json({ tab, replay });
  } catch (err) {
    if (!sendPosError(res, err)) next(err);
  }
});

const itemsSchema = z.object({
  items: z.array(z.object({
    menu_item_id: z.string().uuid(),
    quantity: z.number().int().min(1).max(50),
  })).min(1),
  notes: z.string().max(500).optional(),
  client_request_id: z.string().uuid().optional(),
});

// ── POST /api/pos/tabs/:id/items ──
// Adds a new order round to the tab — visible to the kitchen immediately.
router.post('/tabs/:id/items', async (req, res, next) => {
  try {
    const tab = await loadTab(req.user.tenant_id, req.params.id);
    if (!tab) return res.status(404).json({ error: { message: 'Tab not found' } });
    const data = itemsSchema.parse(req.body);
    const { order, replay } = await addItems({
      tenantId: req.user.tenant_id,
      user: req.user,
      tab,
      items: data.items,
      notes: data.notes,
      clientRequestId: data.client_request_id || null,
    });
    res.status(replay ? 200 : 201).json({ order, replay });
    if (!replay) {
      // Real-time: kitchen display should show this new round immediately
      emit(`kitchen:${tab.tenant_id}`, 'order:new', { orderId: order.id, tabId: tab.id });
      emit(`pos:${tab.branch_id}`, 'tab:updated', { tabId: tab.id });
    }
  } catch (err) {
    if (!sendPosError(res, err)) next(err);
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
  client_request_id: z.string().uuid().optional(),
}).refine((d) => d.payment_method || (d.payments && d.payments.length > 0), {
  message: 'payment_method or payments is required',
});

// ── POST /api/pos/tabs/:id/settle ── (logic in services/pos-tabs.js)
router.post('/tabs/:id/settle', async (req, res, next) => {
  try {
    const data = settleSchema.parse(req.body);
    // A PIN-unlocked (offline) session follows the offline rules even after
    // the connection is back: cash only until a full sign-in.
    const { result, replay } = await settleTab({
      tenantId: req.user.tenant_id,
      tabId: req.params.id,
      data,
      clientRequestId: data.client_request_id || null,
      offline: req.user.scope === 'pos',
    });
    res.json({ ...result, replay });
    if (replay) return;

    // Real-time: notify POS and kitchen that this tab is settled
    emit(`pos:${result.tab.branch_id}`, 'tab:settled', { tabId: req.params.id });
    emit(`kitchen:${req.user.tenant_id}`, 'order:settled', { tabId: req.params.id });
    scheduleFiscal(result.tab, req.user.tenant_id);
  } catch (err) {
    if (!sendPosError(res, err)) next(err);
  }
});

const refundSchema = z.object({
  amount: z.number().positive(),
  reason: z.string().min(1).max(255),
  method: z.enum(['cash', 'card', 'jazzcash', 'easypaisa']).optional(),
});

function refundError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Default the refund method to how the bill was actually paid — needed so
// the Z-report only deducts a refund from the cash drawer when it genuinely
// left as cash.
async function defaultRefundMethod(client, orderId) {
  const payRes = await client.query('SELECT method FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1', [orderId]);
  return payRes.rows[0]?.method === 'cod' ? 'cash' : (payRes.rows[0]?.method || 'cash');
}

// ── POST /api/pos/orders/:id/refund ── manager/owner only, hard role check
// impl-33: for a POS bill the refund is against the whole bill, not one
// round. Any round's order id may be passed; the cap is the sum of every
// round on the tab minus what the tab has already had refunded, and the bill's
// payment is marked refunded only once the whole bill has been. The refund is
// recorded once, on the order that carries the bill's payment row (so the
// Z-report's refund count is one per refund). Non-POS orders are unchanged.
router.post('/orders/:id/refund', requireManagerOrOwner, async (req, res, next) => {
  try {
    const data = refundSchema.parse(req.body);

    const result = await withTransaction(async (client) => {
      const orderRes = await client.query(
        'SELECT id, pos_tab_id, total FROM orders WHERE id = $1 AND tenant_id = $2',
        [req.params.id, req.user.tenant_id],
      );
      const order = orderRes.rows[0];
      if (!order) throw refundError(404, 'Order not found');

      if (!order.pos_tab_id) {
        await client.query('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [order.id]);
        const priorRes = await client.query(
          `SELECT COALESCE(SUM(amount), 0) as total FROM pos_voids WHERE order_id = $1 AND type = 'refund'`,
          [order.id],
        );
        const alreadyRefunded = parseFloat(priorRes.rows[0].total);
        if (alreadyRefunded + data.amount > parseFloat(order.total) + 0.01) {
          throw refundError(400, `Refund would exceed the order total (already refunded Rs. ${alreadyRefunded})`);
        }
        const method = data.method || await defaultRefundMethod(client, order.id);
        const voidRes = await client.query(
          `INSERT INTO pos_voids (tenant_id, pos_tab_id, order_id, type, method, amount, reason, authorized_by, requested_by)
           VALUES ($1, NULL, $2, 'refund', $3, $4, $5, $6, $7) RETURNING *`,
          [req.user.tenant_id, order.id, method, data.amount, data.reason, req.user.id, req.body.requested_by || req.user.id],
        );
        const fullyRefunded = alreadyRefunded + data.amount >= parseFloat(order.total) - 0.01;
        await client.query(`UPDATE payments SET status = $2, updated_at = NOW() WHERE order_id = $1`, [order.id, fullyRefunded ? 'refunded' : 'paid']);
        return { refund: voidRes.rows[0], bill_total: parseFloat(order.total), refunded_total: alreadyRefunded + data.amount };
      }

      // POS bill: lock the tab (serializes refunds on the same bill), then its rounds.
      const tabRes = await client.query('SELECT id, status FROM pos_tabs WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [order.pos_tab_id, req.user.tenant_id]);
      const tab = tabRes.rows[0];
      if (!tab) throw refundError(404, 'Order not found');
      if (tab.status !== 'settled') throw refundError(400, 'Only a settled bill can be refunded');
      const roundsRes = await client.query(
        'SELECT id, total FROM orders WHERE pos_tab_id = $1 AND tenant_id = $2 ORDER BY created_at FOR UPDATE',
        [tab.id, req.user.tenant_id],
      );
      const billTotal = Math.round(roundsRes.rows.reduce((s, o) => s + parseFloat(o.total), 0) * 100) / 100;
      const priorRes = await client.query(
        `SELECT COALESCE(SUM(amount), 0) as total FROM pos_voids WHERE pos_tab_id = $1 AND type = 'refund'`,
        [tab.id],
      );
      const alreadyRefunded = parseFloat(priorRes.rows[0].total);
      if (alreadyRefunded + data.amount > billTotal + 0.01) {
        throw refundError(400, `Refund would exceed the bill total of Rs. ${billTotal} (already refunded Rs. ${alreadyRefunded})`);
      }

      // The settle step put the bill's payment row on one round — refund against that one.
      const payOrderRes = await client.query(
        'SELECT order_id FROM payments WHERE order_id = ANY($1::uuid[]) ORDER BY created_at DESC LIMIT 1',
        [roundsRes.rows.map((o) => o.id)],
      );
      const payOrderId = payOrderRes.rows[0]?.order_id || roundsRes.rows[0].id;
      const method = data.method || await defaultRefundMethod(client, payOrderId);

      const voidRes = await client.query(
        `INSERT INTO pos_voids (tenant_id, pos_tab_id, order_id, type, method, amount, reason, authorized_by, requested_by)
         VALUES ($1, $2, $3, 'refund', $4, $5, $6, $7, $8) RETURNING *`,
        [req.user.tenant_id, tab.id, payOrderId, method, data.amount, data.reason, req.user.id, req.body.requested_by || req.user.id],
      );
      const refundedTotal = Math.round((alreadyRefunded + data.amount) * 100) / 100;
      const fullyRefunded = refundedTotal >= billTotal - 0.01;
      await client.query(`UPDATE payments SET status = $2, updated_at = NOW() WHERE order_id = $1`, [payOrderId, fullyRefunded ? 'refunded' : 'paid']);
      return { refund: voidRes.rows[0], bill_total: billTotal, refunded_total: refundedTotal };
    });

    res.status(201).json(result);
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

// ── impl-33: tax invoices still pending or failed (manager/owner) ──
// Oldest first, aged from the sale time; anything past FISCAL_WARN_AFTER_HOURS
// is flagged. Listing and retrying never touches the sales themselves.
router.get('/fiscal-invoices', requireManagerOrOwner, async (req, res, next) => {
  try {
    res.json(await listFiscalQueue(req.user.tenant_id));
  } catch (err) {
    next(err);
  }
});

router.post('/fiscal-invoices/retry', requireManagerOrOwner, async (req, res, next) => {
  try {
    const result = await retryPendingFiscal({ tenantId: req.user.tenant_id, limit: 50 });
    res.json({ ...result, ...(await listFiscalQueue(req.user.tenant_id)) });
  } catch (err) {
    next(err);
  }
});

// impl-34: one bill — resubmit (after fixing data), or settle an 'unknown'
// outcome. An unknown bill may already be recorded by the authority, so a
// resubmit needs explicit confirmation that it was checked and is not.
const resubmitSchema = z.object({ confirm_not_reported: z.boolean().optional() });
router.post('/fiscal-invoices/:tabId/resubmit', requireManagerOrOwner, async (req, res, next) => {
  try {
    if (!z.string().uuid().safeParse(req.params.tabId).success) return res.status(404).json({ error: { message: 'Bill not found' } });
    const { confirm_not_reported: confirm } = resubmitSchema.parse(req.body || {});
    const result = await resubmitFiscal(req.user.tenant_id, req.params.tabId, { confirmNotReported: !!confirm });
    if (result.error === 'not_found') return res.status(404).json({ error: { message: 'Bill not found' } });
    if (result.error === 'nothing_to_do') return res.status(400).json({ error: { message: 'This bill has nothing to report' } });
    if (result.error === 'confirm_required') {
      return res.status(409).json({ error: { message: 'The tax authority may already have this invoice. Check first, then confirm it is not recorded before resubmitting.', code: 'confirm_required' } });
    }
    await posAudit(req.user.tenant_id, req.user.id, 'fiscal_resubmitted', { tab_id: req.params.tabId, confirmed_not_reported: !!confirm, outcome: result.outcome });
    res.json({ outcome: result.outcome, ...(await listFiscalQueue(req.user.tenant_id)) });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: { message: err.errors[0].message } });
    next(err);
  }
});

const markReportedSchema = z.object({ invoice_number: z.string().trim().min(5).max(100) });
router.post('/fiscal-invoices/:tabId/mark-reported', requireManagerOrOwner, async (req, res, next) => {
  try {
    if (!z.string().uuid().safeParse(req.params.tabId).success) return res.status(404).json({ error: { message: 'Bill not found' } });
    const { invoice_number: invoiceNumber } = markReportedSchema.parse(req.body);
    if (!(await markFiscalReported(req.user.tenant_id, req.params.tabId, invoiceNumber))) {
      return res.status(400).json({ error: { message: 'Only a bill whose outcome is unknown can be marked as reported' } });
    }
    await posAudit(req.user.tenant_id, req.user.id, 'fiscal_marked_reported', { tab_id: req.params.tabId, invoice_number: invoiceNumber });
    res.json(await listFiscalQueue(req.user.tenant_id));
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: { message: err.errors[0].message } });
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

const closeShiftSchema = z.object({
  closing_cash_counted: z.number().min(0),
  // impl-33 Part 4: sales still in the closing device's offline outbox
  unsynced_count: z.number().int().min(0).default(0),
  override_reason: z.string().trim().min(1).max(500).optional(),
});

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

    // Unsynced offline sales: the closing device's own count, or what the
    // cashier's devices last reported during this shift, whichever is higher.
    const deviceRes = await query(
      `SELECT COALESCE(SUM(pending_count), 0)::int AS pending FROM pos_devices
       WHERE tenant_id = $1 AND branch_id = $2 AND last_user_id = $3 AND pending_reported_at >= $4`,
      [req.user.tenant_id, shift.branch_id, shift.opened_by, shift.opened_at],
    );
    const unsynced = Math.max(data.unsynced_count, deviceRes.rows[0].pending);
    if (unsynced > 0) {
      const isManager = req.user.role === 'owner' || req.user.role === 'manager';
      if (!isManager || !data.override_reason) {
        return res.status(409).json({
          error: {
            message: `${unsynced} offline sale${unsynced === 1 ? ' is' : 's are'} still waiting to sync. Reconnect and let them sync, or ask a manager to close with an override.`,
            code: 'unsynced_sales',
          },
          unsynced,
        });
      }
    }

    const report = await buildZReport(req.user.tenant_id, shift.id);
    const expected = report.closing_cash_expected;
    const variance = Math.round((data.closing_cash_counted - expected) * 100) / 100;

    const result = await query(
      `UPDATE pos_shifts SET status = 'closed', closed_by = $2, closing_cash_counted = $3,
              closing_cash_expected = $4, variance = $5, closed_at = NOW(),
              unsynced_at_close = $6, unsynced_override_by = $7, unsynced_override_reason = $8
       WHERE id = $1 RETURNING *`,
      [shift.id, req.user.id, data.closing_cash_counted, expected, variance,
        unsynced, unsynced > 0 ? req.user.id : null, unsynced > 0 ? data.override_reason : null],
    );
    if (unsynced > 0) {
      await posAudit(req.user.tenant_id, req.user.id, 'shift_closed_with_unsynced_sales', {
        shift_id: shift.id, unsynced, reason: data.override_reason,
      });
    }
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
