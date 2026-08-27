/**
 * Rider-facing self-service routes (impl-23 step 9-10) — what a rider sees
 * after logging in via rider-auth.js. Gated by authenticateRider, never
 * authenticate()/authorize() (see middleware/auth.js) — a rider token must
 * never be able to reach an owner/staff-only route, and this router must
 * never accept an owner/staff token.
 */
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { authenticateRider } from '../middleware/auth.js';
import { applyDeliveryStatus, deliveryStatusSchema } from './orders.js';

const router = Router();
router.use(authenticateRider);

// ── GET /api/rider-app/me ──
router.get('/me', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT r.id, r.name, r.phone, r.branch_id, b.name as branch_name, t.name as tenant_name
       FROM riders r
       LEFT JOIN branches b ON b.id = r.branch_id
       LEFT JOIN tenants t ON t.id = r.tenant_id
       WHERE r.id = $1 AND r.tenant_id = $2`,
      [req.rider.rider_id, req.rider.tenant_id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Rider not found' } });
    }
    res.json({ rider: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/rider-app/assignments ──
// Active (undelivered) deliveries plus today's completed ones, for the
// logged-in rider only.
router.get('/assignments', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT ra.*, o.order_number, o.total, o.payment_method, o.delivery_address, o.status as order_status,
              c.name as customer_name, c.phone as customer_phone
       FROM rider_assignments ra
       JOIN orders o ON o.id = ra.order_id
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE ra.rider_id = $1 AND ra.tenant_id = $2
         AND (ra.delivered_at IS NULL OR ra.delivered_at >= CURRENT_DATE)
       ORDER BY ra.assigned_at DESC`,
      [req.rider.rider_id, req.rider.tenant_id],
    );
    res.json({ assignments: result.rows });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/rider-app/summary ──
// Running total of cash collected today, for the rider's own end-of-shift check.
router.get('/summary', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT COALESCE(SUM(cash_collected), 0) as cash_collected_today,
              COUNT(*) FILTER (WHERE delivered_at IS NOT NULL) as delivered_today
       FROM rider_assignments
       WHERE rider_id = $1 AND tenant_id = $2 AND delivered_at >= CURRENT_DATE`,
      [req.rider.rider_id, req.rider.tenant_id],
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/rider-app/assignments/:orderId/status ──
// Body: { status: 'picked_up' | 'delivered', cash_collected? }. Reuses the
// same transition logic as the owner/staff delivery-status endpoint
// (orders.js), scoped to this rider's own assignment only.
router.post('/assignments/:orderId/status', async (req, res, next) => {
  try {
    const data = deliveryStatusSchema.parse(req.body);
    const result = await applyDeliveryStatus(req.rider.tenant_id, req.params.orderId, data, req.rider.rider_id);
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
