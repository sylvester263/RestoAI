import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { query } from '../db/pool.js';
import { filterRulesSchema, buildSegmentQuery, computeRFM, RFM_LABELS } from '../services/segments.js';

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

// ── GET /api/segments/rfm ──
// Built-in RFM segment set, available immediately alongside custom
// filter_rules segments — every scored customer (has >=1 order) grouped
// by the 7 standard labels, with per-label counts for a quick overview.
// Registered before /:id/customers — 'rfm' would otherwise be swallowed by
// that route as a (nonexistent) segment id.
router.get('/rfm', async (req, res, next) => {
  try {
    const scored = await computeRFM(req.user.tenant_id, query);
    const byLabel = Object.fromEntries(RFM_LABELS.map((l) => [l, []]));
    for (const row of scored) byLabel[row.segment].push(row);
    const summary = RFM_LABELS.map((label) => ({ label, count: byLabel[label].length }));
    res.json({ summary, customers: scored });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/segments/rfm/customers?label=... ──
// Also registered before /:id/customers for the same reason — 'rfm/customers'
// would otherwise match :id='rfm' first.
router.get('/rfm/customers', async (req, res, next) => {
  try {
    const label = req.query.label;
    if (!RFM_LABELS.includes(label)) {
      return res.status(400).json({ error: { message: `label must be one of: ${RFM_LABELS.join(', ')}` } });
    }
    const scored = await computeRFM(req.user.tenant_id, query);
    const customers = scored.filter((c) => c.segment === label);
    res.json({ label, customers, count: customers.length });
  } catch (err) {
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
