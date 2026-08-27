import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { query } from '../db/pool.js';
import { filterRulesSchema, buildSegmentQuery } from '../services/segments.js';

const router = Router();
router.use(authenticate);

// ── GET /api/segments ──
router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM customer_segments WHERE tenant_id = $1 ORDER BY created_at DESC',
      [req.user.tenant_id],
    );
    res.json({ segments: result.rows });
  } catch (err) {
    next(err);
  }
});

const segmentSchema = z.object({
  name: z.string().min(1).max(100),
  filter_rules: filterRulesSchema,
});

// ── POST /api/segments ──
router.post('/', async (req, res, next) => {
  try {
    const data = segmentSchema.parse(req.body);
    const result = await query(
      `INSERT INTO customer_segments (tenant_id, name, filter_rules) VALUES ($1, $2, $3) RETURNING *`,
      [req.user.tenant_id, data.name, JSON.stringify(data.filter_rules)],
    );
    res.status(201).json({ segment: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

// ── GET /api/segments/:id/customers ──
// Evaluated live against current order/tag data — never a stale materialized list.
router.get('/:id/customers', async (req, res, next) => {
  try {
    const segRes = await query('SELECT * FROM customer_segments WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenant_id]);
    if (segRes.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Segment not found' } });
    }
    const { sql, params } = buildSegmentQuery(req.user.tenant_id, segRes.rows[0].filter_rules);
    const result = await query(sql, params);
    res.json({ segment: segRes.rows[0], customers: result.rows, count: result.rows.length });
  } catch (err) {
    next(err);
  }
});

export default router;
