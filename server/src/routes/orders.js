import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.js';
import { query } from '../db/pool.js';
import { notifyStatusChange, STATUS_MESSAGES } from '../services/whatsapp.js';
import { awardPointsForOrder } from '../services/loyalty.js';
import { sendPushToCustomer } from '../services/push.js';
import { markCodPaidOnDelivery, getPaymentsForOrders } from '../services/payments.js';

const router = Router();
router.use(authenticate);

// Side effects fired whenever an order's status changes — shared by the
// kitchen-flow status PATCH below and the rider delivery-status endpoint
// (riders.js), so there is exactly one place this logic lives.
export function fireStatusChangeSideEffects(tenantId, order, status) {
  notifyStatusChange(order.id, tenantId, status).catch(() => {});
  if (STATUS_MESSAGES[status] && order.customer_id) {
    sendPushToCustomer(order.customer_id, { title: 'Order update', body: STATUS_MESSAGES[status] }).catch(() => {});
  }
  if (status === 'delivered') {
    awardPointsForOrder(tenantId, order.id).catch((err) => console.error('[loyalty] award failed:', err.message));
    markCodPaidOnDelivery(tenantId, order.id).catch((err) => console.error('[payments] COD mark-paid failed:', err.message));
  }
}

// ── GET /api/orders ──
// List orders for the current tenant with filtering & pagination
router.get('/', authorize('orders.view'), async (req, res, next) => {
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
router.get('/kitchen', authorize('orders.view'), async (req, res, next) => {
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

// ── GET /api/orders/deliveries/unassigned ── (impl-05)
// Delivery orders (has an address, no table session) with no rider yet,
// filtered to statuses staff would actually act on. Declared before the
// generic GET /:id below — a literal 2-segment path never collides with
// it (different segment count), but keeping specific-before-generic
// matches this file's existing /kitchen convention.
router.get('/deliveries/unassigned', authorize('orders.view'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT o.*, c.name as customer_name, c.phone as customer_phone
       FROM orders o
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN rider_assignments ra ON ra.order_id = o.id
       WHERE o.tenant_id = $1 AND o.delivery_address IS NOT NULL AND o.table_session_id IS NULL
         AND ra.id IS NULL AND o.status IN ('confirmed', 'preparing', 'ready')
       ORDER BY o.created_at ASC`,
      [req.user.tenant_id],
    );
    res.json({ orders: result.rows });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/orders/:id ──
router.get('/:id', authorize('orders.view'), async (req, res, next) => {
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
router.patch('/:id/status', authorize('orders.status_update'), async (req, res, next) => {
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

    // Fire-and-forget: WhatsApp/push notification, loyalty, COD payment mark-paid
    fireStatusChangeSideEffects(req.user.tenant_id, result.rows[0], status);
  } catch (err) {
    next(err);
  }
});

const assignRiderSchema = z.object({ rider_id: z.string().uuid().optional() });

// ── POST /api/orders/:id/assign-rider ── (impl-05)
router.post('/:id/assign-rider', authorize('orders.status_update'), async (req, res, next) => {
  try {
    const orderRes = await query('SELECT * FROM orders WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenant_id]);
    const order = orderRes.rows[0];
    if (!order) {
      return res.status(404).json({ error: { message: 'Order not found' } });
    }
    if (!order.delivery_address || order.table_session_id) {
      return res.status(400).json({ error: { message: 'Only delivery orders can be assigned to a rider' } });
    }
    const existing = await query('SELECT id FROM rider_assignments WHERE order_id = $1', [order.id]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: { message: 'This order is already assigned to a rider' } });
    }

    const data = assignRiderSchema.parse(req.body);
    let riderId = data.rider_id;
    if (riderId) {
      const riderRes = await query(
        `SELECT id FROM riders WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND status = 'active'`,
        [riderId, req.user.tenant_id, order.branch_id],
      );
      if (riderRes.rows.length === 0) {
        return res.status(400).json({ error: { message: 'Invalid or inactive rider for this branch' } });
      }
    } else {
      // No GPS/location tracking exists — approximate "nearest rider" with
      // the active rider carrying the fewest currently-undelivered assignments.
      const pick = await query(
        `SELECT r.id
         FROM riders r
         LEFT JOIN rider_assignments ra ON ra.rider_id = r.id AND ra.delivered_at IS NULL
         WHERE r.tenant_id = $1 AND r.branch_id = $2 AND r.status = 'active'
         GROUP BY r.id
         ORDER BY COUNT(ra.id) ASC, r.created_at ASC
         LIMIT 1`,
        [req.user.tenant_id, order.branch_id],
      );
      if (pick.rows.length === 0) {
        return res.status(400).json({ error: { message: 'No active riders available for this branch' } });
      }
      riderId = pick.rows[0].id;
    }

    const assignRes = await query(
      `INSERT INTO rider_assignments (tenant_id, order_id, rider_id) VALUES ($1, $2, $3) RETURNING *`,
      [req.user.tenant_id, order.id, riderId],
    );
    res.status(201).json({ assignment: assignRes.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

const deliveryStatusSchema = z.object({
  status: z.enum(['picked_up', 'delivered']),
  cash_collected: z.number().min(0).optional(),
});

// ── POST /api/orders/:id/delivery-status ── (impl-05)
router.post('/:id/delivery-status', authorize('orders.status_update'), async (req, res, next) => {
  try {
    const data = deliveryStatusSchema.parse(req.body);
    const assignRes = await query(
      `SELECT ra.*, o.payment_method, o.total, o.customer_id, o.status as order_status
       FROM rider_assignments ra
       JOIN orders o ON o.id = ra.order_id
       WHERE ra.order_id = $1 AND o.tenant_id = $2`,
      [req.params.id, req.user.tenant_id],
    );
    const assignment = assignRes.rows[0];
    if (!assignment) {
      return res.status(404).json({ error: { message: 'No rider assignment found for this order' } });
    }

    if (data.status === 'picked_up') {
      const updated = await query(
        `UPDATE rider_assignments SET picked_up_at = COALESCE(picked_up_at, NOW()) WHERE id = $1 RETURNING *`,
        [assignment.id],
      );
      return res.json({ assignment: updated.rows[0] });
    }

    // delivered — idempotent: a repeat call reports current state without re-firing notifications
    if (assignment.delivered_at) {
      return res.json({ assignment, already_delivered: true });
    }

    const isCod = assignment.payment_method === 'cash';
    const cashCollected = isCod ? (data.cash_collected ?? parseFloat(assignment.total)) : null;
    const updatedAssignment = await query(
      `UPDATE rider_assignments SET delivered_at = NOW(), cash_collected = $2 WHERE id = $1 RETURNING *`,
      [assignment.id, cashCollected],
    );

    const orderRes = await query(
      `UPDATE orders SET status = 'delivered', updated_at = NOW() WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, req.user.tenant_id],
    );
    const order = orderRes.rows[0];
    fireStatusChangeSideEffects(req.user.tenant_id, order, 'delivered');

    res.json({ assignment: updatedAssignment.rows[0], order });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

export default router;
