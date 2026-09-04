/**
 * Customer CRM — list, rich profile, and tag management. Segment
 * definitions/resolution live in routes/segments.js (separate mount, same
 * underlying query builder) to keep each resource on its own clean prefix.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, checkTenantActive } from '../middleware/auth.js';
import { query } from '../db/pool.js';
import { getLoyaltyConfig, getBalance } from '../services/loyalty.js';

const router = Router();
router.use(authenticate);
router.use(checkTenantActive);

// ── GET /api/customers ──
router.get('/', async (req, res, next) => {
  try {
    const { search } = req.query;
    const conditions = ['c.tenant_id = $1'];
    const params = [req.user.tenant_id];
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(c.name ILIKE $${params.length} OR c.phone ILIKE $${params.length})`);
    }
    const result = await query(
      `SELECT c.*, COALESCE(array_agg(ct.tag) FILTER (WHERE ct.tag IS NOT NULL), '{}') as tags
       FROM customers c
       LEFT JOIN customer_tags ct ON ct.customer_id = c.id
       WHERE ${conditions.join(' AND ')}
       GROUP BY c.id
       ORDER BY c.total_spent DESC
       LIMIT 200`,
      params,
    );
    res.json({ customers: result.rows });
  } catch (err) {
    next(err);
  }
});

async function assertCustomerOwnedByTenant(tenantId, customerId) {
  const res = await query('SELECT id FROM customers WHERE id = $1 AND tenant_id = $2', [customerId, tenantId]);
  return res.rows.length > 0;
}

// ── GET /api/customers/:id/profile ──
// Rich profile: order history, spend, tags, reviews, loyalty balance.
router.get('/:id/profile', async (req, res, next) => {
  try {
    const custRes = await query('SELECT * FROM customers WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenant_id]);
    if (custRes.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Customer not found' } });
    }
    const customer = custRes.rows[0];

    const [tagsRes, ordersRes, reviewsRes, loyaltyConfig] = await Promise.all([
      query('SELECT tag FROM customer_tags WHERE customer_id = $1 ORDER BY tag', [req.params.id]),
      query(
        `SELECT id, order_number, channel, status, total, payment_method, created_at
         FROM orders WHERE customer_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 20`,
        [req.params.id, req.user.tenant_id],
      ),
      query(
        `SELECT rating, comment, menu_item_id, created_at FROM reviews
         WHERE customer_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 20`,
        [req.params.id, req.user.tenant_id],
      ),
      getLoyaltyConfig(req.user.tenant_id),
    ]);

    const loyaltyBalance = loyaltyConfig ? await getBalance(req.user.tenant_id, req.params.id) : null;

    res.json({
      customer,
      tags: tagsRes.rows.map((r) => r.tag),
      orders: ordersRes.rows,
      reviews: reviewsRes.rows,
      loyalty_balance: loyaltyBalance,
    });
  } catch (err) {
    next(err);
  }
});

const tagSchema = z.object({ tag: z.string().min(1).max(50) });

// ── GET /api/customers/:id/tags ──
router.get('/:id/tags', async (req, res, next) => {
  try {
    if (!(await assertCustomerOwnedByTenant(req.user.tenant_id, req.params.id))) {
      return res.status(404).json({ error: { message: 'Customer not found' } });
    }
    const result = await query('SELECT tag FROM customer_tags WHERE customer_id = $1 ORDER BY tag', [req.params.id]);
    res.json({ tags: result.rows.map((r) => r.tag) });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/customers/:id/tags ── body: { tag }
router.post('/:id/tags', async (req, res, next) => {
  try {
    if (!(await assertCustomerOwnedByTenant(req.user.tenant_id, req.params.id))) {
      return res.status(404).json({ error: { message: 'Customer not found' } });
    }
    const data = tagSchema.parse(req.body);
    await query(
      `INSERT INTO customer_tags (tenant_id, customer_id, tag) VALUES ($1, $2, $3)
       ON CONFLICT (customer_id, tag) DO NOTHING`,
      [req.user.tenant_id, req.params.id, data.tag.toLowerCase()],
    );
    const result = await query('SELECT tag FROM customer_tags WHERE customer_id = $1 ORDER BY tag', [req.params.id]);
    res.status(201).json({ tags: result.rows.map((r) => r.tag) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

// ── DELETE /api/customers/:id/tags/:tag ──
router.delete('/:id/tags/:tag', async (req, res, next) => {
  try {
    if (!(await assertCustomerOwnedByTenant(req.user.tenant_id, req.params.id))) {
      return res.status(404).json({ error: { message: 'Customer not found' } });
    }
    await query('DELETE FROM customer_tags WHERE customer_id = $1 AND tag = $2', [req.params.id, req.params.tag.toLowerCase()]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
