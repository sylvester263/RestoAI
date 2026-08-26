import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { query } from '../db/pool.js';
import { notifyStatusChange, STATUS_MESSAGES } from '../services/whatsapp.js';
import { awardPointsForOrder } from '../services/loyalty.js';
import { sendPushToCustomer } from '../services/push.js';
import { markCodPaidOnDelivery, getPaymentsForOrders } from '../services/payments.js';

const router = Router();
router.use(authenticate);

// ── GET /api/orders ──
// List orders for the current tenant with filtering & pagination
router.get('/', async (req, res, next) => {
  try {
    const { status, branch_id, from, to, limit = 50, offset = 0 } = req.query;

    // Build shared WHERE clause and params once
    const conditions = ['o.tenant_id = $1'];
    const params = [req.user.tenant_id];
    let idx = 2;

    if (status) {
      conditions.push(`o.status = $${idx}`);
      params.push(status);
      idx++;
    }
    if (branch_id) {
      conditions.push(`o.branch_id = $${idx}`);
      params.push(branch_id);
      idx++;
    }
    if (from) {
      conditions.push(`o.created_at >= $${idx}`);
      params.push(from);
      idx++;
    }
    if (to) {
      conditions.push(`o.created_at <= $${idx}`);
      params.push(to);
      idx++;
    }

    const whereClause = conditions.join(' AND ');
    const joinClause = 'LEFT JOIN customers c ON o.customer_id = c.id';

    // Count query — dedicated, no regex
    const countResult = await query(
      `SELECT COUNT(*) FROM orders o ${joinClause} WHERE ${whereClause}`,
      params,
    );

    // List query
    const listParams = [...params, Number(limit), Number(offset)];
    const result = await query(
      `SELECT o.*, c.name as customer_name, c.phone as customer_phone
       FROM orders o ${joinClause}
       WHERE ${whereClause}
       ORDER BY o.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      listParams,
    );

    // Attach payment status to each order (batch lookup, no N+1)
    const orderIds = result.rows.map((o) => o.id);
    const paymentMap = await getPaymentsForOrders(orderIds);
    const ordersWithPayment = result.rows.map((o) => ({
      ...o,
      payment: paymentMap[o.id] || null,
    }));

    res.json({
      orders: ordersWithPayment,
      total: parseInt(countResult.rows[0].count, 10),
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/orders/kitchen ──
// Active orders for kitchen display (new, confirmed, preparing)
router.get('/kitchen', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT o.*, rt.table_number,
        COALESCE(json_agg(json_build_object(
          'name', oi.name, 'quantity', oi.quantity, 'notes', oi.notes
        )) FILTER (WHERE oi.id IS NOT NULL), '[]') as items
       FROM orders o
       LEFT JOIN order_items oi ON o.id = oi.order_id
       LEFT JOIN table_sessions ts ON o.table_session_id = ts.id
       LEFT JOIN restaurant_tables rt ON ts.table_id = rt.id
       WHERE o.tenant_id = $1 AND o.status IN ('new', 'confirmed', 'preparing')
       GROUP BY o.id, rt.table_number
       ORDER BY o.created_at ASC`,
      [req.user.tenant_id],
    );
    res.json({ orders: result.rows });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/orders/:id ──
router.get('/:id', async (req, res, next) => {
  try {
    const orderRes = await query(
      `SELECT o.*, c.name as customer_name, c.phone as customer_phone
       FROM orders o
       LEFT JOIN customers c ON o.customer_id = c.id
       WHERE o.tenant_id = $1 AND o.id = $2`,
      [req.user.tenant_id, req.params.id],
    );
    if (orderRes.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Order not found' } });
    }

    const itemsRes = await query(
      'SELECT * FROM order_items WHERE order_id = $1',
      [req.params.id],
    );
    const paymentMap = await getPaymentsForOrders([req.params.id]);

    res.json({ order: { ...orderRes.rows[0], items: itemsRes.rows, payment: paymentMap[req.params.id] || null } });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/orders/:id/status ──
// Update order status (for kitchen flow)
router.patch('/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    const validStatuses = ['new', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: { message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` } });
    }

    const result = await query(
      'UPDATE orders SET status = $3, updated_at = NOW() WHERE tenant_id = $1 AND id = $2 RETURNING *',
      [req.user.tenant_id, req.params.id, status],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Order not found' } });
    }
    res.json({ order: result.rows[0] });

    // Fire-and-forget: WhatsApp + push notification (parallel channels, both best-effort)
    notifyStatusChange(req.params.id, req.user.tenant_id, status).catch(() => {});
    if (STATUS_MESSAGES[status] && result.rows[0].customer_id) {
      sendPushToCustomer(result.rows[0].customer_id, { title: 'Order update', body: STATUS_MESSAGES[status] }).catch(() => {});
    }

    // Award loyalty points once an order is delivered (idempotent, opt-in per tenant)
    if (status === 'delivered') {
      awardPointsForOrder(req.user.tenant_id, req.params.id).catch((err) => console.error('[loyalty] award failed:', err.message));
      // Mark COD payment as paid on delivery (idempotent)
      markCodPaidOnDelivery(req.user.tenant_id, req.params.id).catch((err) => console.error('[payments] COD mark-paid failed:', err.message));
    }
  } catch (err) {
    next(err);
  }
});

export default router;
