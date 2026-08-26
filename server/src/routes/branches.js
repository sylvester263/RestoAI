import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/auth.js';
import { query } from '../db/pool.js';
import { z } from 'zod';

const router = Router();
router.use(authenticate);

const branchSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  phone: z.string().optional(),
  is_active: z.boolean().default(true),
});

// ── GET /api/branches ──
router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM branches WHERE tenant_id = $1 ORDER BY created_at',
      [req.user.tenant_id],
    );
    res.json({ branches: result.rows });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/branches ──
router.post('/', authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const data = branchSchema.parse(req.body);
    const result = await query(
      'INSERT INTO branches (tenant_id, name, address, phone, is_active) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [req.user.tenant_id, data.name, data.address || null, data.phone || null, data.is_active],
    );
    res.status(201).json({ branch: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

// ── PUT /api/branches/:id ──
router.put('/:id', authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const data = branchSchema.partial().parse(req.body);
    const sets = [];
    const params = [req.user.tenant_id, req.params.id];
    let idx = 3;
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        sets.push(`${key} = $${idx}`);
        params.push(value);
        idx++;
      }
    }
    sets.push('updated_at = NOW()');

    const result = await query(
      `UPDATE branches SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      params,
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Branch not found' } });
    }
    res.json({ branch: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

export default router;
