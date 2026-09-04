import { Router } from 'express';
import { z } from 'zod';
import { authenticate, checkTenantActive, authorize } from '../middleware/auth.js';
import { query } from '../db/pool.js';
import { createCoupon } from '../services/coupons.js';

const router = Router();
router.use(authenticate);
router.use(checkTenantActive);

// ── GET /api/coupons ──
router.get('/', authorize('coupons.manage'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT c.*, cust.name as customer_name, cust.phone as customer_phone,
         (SELECT COUNT(*) FROM coupon_redemptions WHERE coupon_id = c.id) as redemption_count
       FROM coupons c
       LEFT JOIN customers cust ON cust.id = c.customer_id
       WHERE c.tenant_id = $1
       ORDER BY c.created_at DESC`,
      [req.user.tenant_id],
    );
    res.json({ coupons: result.rows });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  code: z.string().min(3).max(30).optional(),
  discount_type: z.enum(['percent', 'fixed', 'free_delivery', 'bogo']),
  discount_value: z.number().positive().optional(),
  usage_limit_per_customer: z.number().int().positive().default(1),
  max_redemptions: z.number().int().positive().optional(),
  expires_at: z.string().datetime({ offset: true }).or(z.string().datetime()).optional(),
  starts_at: z.string().datetime({ offset: true }).or(z.string().datetime()).optional(),
  min_order_amount: z.number().min(0).optional(),
  max_discount_amount: z.number().positive().optional(),
  first_order_only: z.boolean().optional(),
}).refine(
  (d) => (d.discount_type === 'percent' || d.discount_type === 'fixed') ? d.discount_value != null : true,
  { message: 'discount_value is required for percent/fixed coupons', path: ['discount_value'] },
);

// ── POST /api/coupons ──
router.post('/', authorize('coupons.manage'), async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    if (data.discount_type === 'percent' && data.discount_value > 100) {
      return res.status(400).json({ error: { message: 'Percent discount cannot exceed 100' } });
    }
    const coupon = await createCoupon(req.user.tenant_id, data, req.user.id);
    res.status(201).json({ coupon });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    if (err.code === '23505') {
      return res.status(400).json({ error: { message: 'A coupon with that code already exists' } });
    }
    next(err);
  }
});

const updateSchema = z.object({ active: z.boolean() });

// ── PUT /api/coupons/:id ── — currently just the active on/off toggle
router.put('/:id', authorize('coupons.manage'), async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    const result = await query(
      `UPDATE coupons SET active = $3 WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [req.user.tenant_id, req.params.id, data.active],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Coupon not found' } });
    }
    res.json({ coupon: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

export default router;
