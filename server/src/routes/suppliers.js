import { Router } from 'express';
import { z } from 'zod';
import { authenticate, checkTenantActive, authorize } from '../middleware/auth.js';
import { query } from '../db/pool.js';

const router = Router();
router.use(authenticate);
router.use(checkTenantActive);

const supplierSchema = z.object({
  name: z.string().min(1).max(150),
  contact_phone: z.string().max(20).optional().nullable(),
  contact_email: z.string().email().max(150).optional().nullable(),
});

// ── GET /api/suppliers ──
router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM suppliers WHERE tenant_id = $1 ORDER BY name',
      [req.user.tenant_id],
    );
    res.json({ suppliers: result.rows });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/suppliers ──
router.post('/', authorize('inventory.manage'), async (req, res, next) => {
  try {
    const data = supplierSchema.parse(req.body);
    const result = await query(
      `INSERT INTO suppliers (tenant_id, name, contact_phone, contact_email) VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.tenant_id, data.name, data.contact_phone || null, data.contact_email || null],
    );
    res.status(201).json({ supplier: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

// ── PUT /api/suppliers/:id ──
router.put('/:id', authorize('inventory.manage'), async (req, res, next) => {
  try {
    const data = supplierSchema.partial().parse(req.body);
    const sets = [];
    const params = [req.user.tenant_id, req.params.id];
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        sets.push(`${key} = $${params.length + 1}`);
        params.push(value);
      }
    }
    if (sets.length === 0) {
      return res.status(400).json({ error: { message: 'No fields to update' } });
    }
    const result = await query(
      `UPDATE suppliers SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      params,
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Supplier not found' } });
    }
    res.json({ supplier: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

export default router;
