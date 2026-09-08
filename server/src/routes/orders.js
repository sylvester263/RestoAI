import { Router } from 'express';
import { z } from 'zod';
import { authenticate, checkTenantActive, authorize } from '../middleware/auth.js';
import { query } from '../db/pool.js';
import { notifyStatusChange, getStatusMessage } from '../services/whatsapp.js';
import { getOrderType, orderTypeSql, canEnterStatus } from '../utils/order-type.js';
import { awardPointsForOrder } from '../services/loyalty.js';
import { sendPushToCustomer } from '../services/push.js';
import { markCodPaidOnDelivery, getPaymentsForOrders } from '../services/payments.js';
import { completeReferralIfEligible } from '../services/coupons.js';
import { emit } from '../services/event-bus.js';

const router = Router();
router.use(authenticate);
router.use(checkTenantActive);

// Side effects fired whenever an order's status changes — shared by the
// kitchen-flow status PATCH below and the rider delivery-status endpoint
// (riders.js), so there is exactly one place this logic lives.
export function fireStatusChangeSideEffects(tenantId, order, status, { riderName = null } = {}) {
  notifyStatusChange(order.id, tenantId, status).catch(() => {});
  const pushBody = getStatusMessage({ status, orderType: getOrderType(order), riderName });
  if (pushBody && order.customer_id) {
    sendPushToCustomer(order.customer_id, { title: 'Order update', body: pushBody }).catch(() => {});
  }
  if (status === 'delivered') {
    awardPointsForOrder(tenantId, order.id).catch((err) => console.error('[loyalty] award failed:', err.message));
    markCodPaidOnDelivery(tenantId, order.id).catch((err) => console.error('[payments] COD mark-paid failed:', err.message));
    // impl-12 referral program: only rewards the referrer once the referred
    // order actually reaches delivered — guards against referral-then-cancel
    // abuse, same spirit as impl-21's rapid_reorder/repeat_cancel checks.
    completeReferralIfEligible(tenantId, order.id).catch((err) => console.error('[coupons] referral completion failed:', err.message));
  }
  // impl-16 dispatch agent: a delivery order just became ready for a rider.
  // Dynamic import avoids a circular dependency (dispatch-agent.js needs
  // createRiderAssignment, defined below in this same file).
  if (status === 'confirmed' && getOrderType(order) === 'delivery') {
    import('../services/dispatch-agent.js')
      .then(({ maybeAutoAssign }) => maybeAutoAssign(tenantId, order))
      .catch((err) => console.error('[dispatch-agent] auto-assign hook failed:', err.message));
  }
}

// ── Shared rider-assignment insert — used by both the manual assign-rider
// route below and the dispatch agent's auto-assign, so the INSERT exists
// in exactly one place. ──
export async function createRiderAssignment(tenantId, orderId, riderId) {
  const result = await query(
    `INSERT INTO rider_assignments (tenant_id, order_id, rider_id) VALUES ($1, $2, $3) RETURNING *`,
    [tenantId, orderId, riderId],
  );
  return result.rows[0];
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
    // Items and the current rider ride along so the Orders page can show what
    // was ordered, the customer's note, and who is delivering without a
    // second request per row.
    const result = await query(
      `SELECT o.*, ${orderTypeSql('o')} AS order_type, c.name as customer_name, c.phone as customer_phone,
              COALESCE((SELECT json_agg(json_build_object('name', oi.name, 'quantity', oi.quantity, 'total_price', oi.total_price, 'notes', oi.notes) ORDER BY oi.name)
                        FROM order_items oi WHERE oi.order_id = o.id), '[]') AS items,
              ra.rider_name, ra.picked_up_at AS rider_picked_up_at, ra.delivered_at AS rider_delivered_at
       FROM orders o ${joinClause}
       LEFT JOIN LATERAL (
         SELECT r.name AS rider_name, x.picked_up_at, x.delivered_at
         FROM rider_assignments x JOIN riders r ON r.id = x.rider_id
         WHERE x.order_id = o.id ORDER BY x.assigned_at DESC LIMIT 1
       ) ra ON true
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
      `SELECT o.*, ${orderTypeSql('o')} AS order_type, rt.table_number,
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
      `SELECT o.*, ${orderTypeSql('o')} AS order_type, c.name as customer_name, c.phone as customer_phone
       FROM orders o
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN rider_assignments ra ON ra.order_id = o.id
       WHERE o.tenant_id = $1 AND ${orderTypeSql('o')} = 'delivery'
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
      `SELECT o.*, ${orderTypeSql('o')} AS order_type, c.name as customer_name, c.phone as customer_phone
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
    const validStatuses = ['new', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: { message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` } });
    }

    // out_for_delivery is a delivery-only state: check the order's type
    // before touching it, so a pickup or dine-in order can never be pushed
    // there by a direct API call.
    const existing = await query(
      'SELECT id, table_session_id, delivery_address, channel FROM orders WHERE tenant_id = $1 AND id = $2',
      [req.user.tenant_id, req.params.id],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Order not found' } });
    }
    if (!canEnterStatus(existing.rows[0], status)) {
      return res.status(400).json({ error: { message: `Only delivery orders can be marked out for delivery — this is a ${getOrderType(existing.rows[0]).replace('_', '-')} order.` } });
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

    // Real-time: notify kitchen display and other connected clients
    emit(`kitchen:${req.user.tenant_id}`, 'order:status', { orderId: req.params.id, status });
    if (result.rows[0].branch_id) {
      emit(`token-board:${result.rows[0].branch_id}`, 'tokens:changed', {});
    }
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
    if (getOrderType(order) !== 'delivery') {
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

    const assignment = await createRiderAssignment(req.user.tenant_id, order.id, riderId);
    res.status(201).json({ assignment });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

export const deliveryStatusSchema = z.object({
  status: z.enum(['picked_up', 'delivered']),
  cash_collected: z.number().min(0).optional(),
});

// ── Shared delivery-status transition — used by the owner/staff route below
// and by the rider self-service app (rider-app.js). When riderId is passed,
// the assignment lookup is additionally scoped to that rider, so a rider
// token can only ever move their own assignment. ──
export async function applyDeliveryStatus(tenantId, orderId, data, riderId = null) {
  const params = [orderId, tenantId];
  let riderClause = '';
  if (riderId) {
    riderClause = ' AND ra.rider_id = $3';
    params.push(riderId);
  }
  const assignRes = await query(
    `SELECT ra.*, o.payment_method, o.total, o.customer_id, o.status as order_status, o.branch_id,
            o.table_session_id, o.delivery_address, o.channel, r.name AS rider_name
     FROM rider_assignments ra
     JOIN orders o ON o.id = ra.order_id
     JOIN riders r ON r.id = ra.rider_id
     WHERE ra.order_id = $1 AND o.tenant_id = $2${riderClause}`,
    params,
  );
  const assignment = assignRes.rows[0];
  if (!assignment) {
    const err = new Error('No rider assignment found for this order');
    err.status = 404;
    throw err;
  }

  if (data.status === 'picked_up') {
    const updated = await query(
      `UPDATE rider_assignments SET picked_up_at = COALESCE(picked_up_at, NOW()) WHERE id = $1 RETURNING *`,
      [assignment.id],
    );
    // The food has physically left the restaurant: the order itself moves to
    // out_for_delivery (delivery orders only — utils/order-type.js decides),
    // which is what updates the customer's tracking page and sends the
    // "on its way, <rider> is bringing it" message. Idempotent: a repeat
    // pickup call, or one on an already-delivered order, changes nothing.
    let order = null;
    if (getOrderType(assignment) === 'delivery') {
      const moved = await query(
        `UPDATE orders SET status = 'out_for_delivery', updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND status NOT IN ('out_for_delivery', 'delivered', 'cancelled')
         RETURNING *`,
        [orderId, tenantId],
      );
      order = moved.rows[0] || null;
      if (order) {
        fireStatusChangeSideEffects(tenantId, order, 'out_for_delivery', { riderName: assignment.rider_name });
        emit(`kitchen:${tenantId}`, 'order:status', { orderId, status: 'out_for_delivery' });
        if (order.branch_id) emit(`token-board:${order.branch_id}`, 'tokens:changed', {});
      }
    }
    return { assignment: updated.rows[0], order };
  }

  // delivered — idempotent: a repeat call reports current state without re-firing notifications
  if (assignment.delivered_at) {
    return { assignment, already_delivered: true };
  }

  const isCod = assignment.payment_method === 'cash';
  const cashCollected = isCod ? (data.cash_collected ?? parseFloat(assignment.total)) : null;
  const updatedAssignment = await query(
    `UPDATE rider_assignments SET delivered_at = NOW(), cash_collected = $2 WHERE id = $1 RETURNING *`,
    [assignment.id, cashCollected],
  );

  const orderRes = await query(
    `UPDATE orders SET status = 'delivered', updated_at = NOW() WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [orderId, tenantId],
  );
  const order = orderRes.rows[0];
  fireStatusChangeSideEffects(tenantId, order, 'delivered');

  return { assignment: updatedAssignment.rows[0], order };
}

// ── POST /api/orders/:id/delivery-status ── (impl-05)
router.post('/:id/delivery-status', authorize('orders.status_update'), async (req, res, next) => {
  try {
    const data = deliveryStatusSchema.parse(req.body);
    const result = await applyDeliveryStatus(req.user.tenant_id, req.params.id, data);
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
