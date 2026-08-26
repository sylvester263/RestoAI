/**
 * Inventory CRUD — basic stock management for the admin panel.
 * The inventory_items table already exists from migrate.js; this route
 * provides list/create/update/delete plus a low-stock alert endpoint.
 */
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { query } from '../db/pool.js';
import { z } from 'zod';

const router = Router();
router.use(authenticate);

const itemSchema = z.object({
  name: z.string().min(1).max(255),
  unit: z.string().min(1).max(50).default('kg'),
  current_qty: z.number().min(0).default(0),
  min_qty: z.number().min(0).default(0),
  branch_id: z.string().uuid().optional(),
});

// ── GET /api/inventory ──
router.get('/', async (req, res, next) => {
  try {
    const { branch_id, low_stock } = req.query;
    const conditions = ['i.tenant_id = $1'];
    const params = [req.user.tenant_id];
    let idx = 2;

    if (branch_id) {
      conditions.push(`i.branch_id = $${idx}`);
      params.push(branch_id);
      idx++;
    }
    if (low_stock === 'true') {
      conditions.push(`i.current_qty <= i.min_qty`);
    }

    const where = conditions.join(' AND ');
    const result = await query(
      `SELECT i.*, b.name as branch_name
       FROM inventory_items i
       LEFT JOIN branches b ON i.branch_id = b.id
       WHERE ${where}
       ORDER BY i.name`,
      params,
    );
    res.json({ items: result.rows });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/inventory ──
router.post('/', authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const data = itemSchema.parse(req.body);

    // Resolve branch: use provided, or tenant's first branch
    let branchId = data.branch_id || null;
    if (!branchId) {
      const branchRes = await query('SELECT id FROM branches WHERE tenant_id = $1 LIMIT 1', [req.user.tenant_id]);
      branchId = branchRes.rows[0]?.id;
    }

    const result = await query(
      `INSERT INTO inventory_items (tenant_id, branch_id, name, unit, current_qty, min_qty)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.tenant_id, branchId, data.name, data.unit, data.current_qty, data.min_qty],
    );
    res.status(201).json({ item: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

// ── PUT /api/inventory/:id ──
router.put('/:id', authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const data = itemSchema.partial().parse(req.body);
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
      `UPDATE inventory_items SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      params,
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Item not found' } });
    }
    res.json({ item: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

// ── DELETE /api/inventory/:id ──
router.delete('/:id', authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM inventory_items WHERE tenant_id = $1 AND id = $2 RETURNING id',
      [req.user.tenant_id, req.params.id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Item not found' } });
    }
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/inventory/:id/restock ──
// Quick restock action — adds quantity and updates last_restocked
router.post('/:id/restock', authorize('owner', 'manager', 'staff'), async (req, res, next) => {
  try {
    const { quantity } = req.body;
    if (!quantity || quantity <= 0) {
      return res.status(400).json({ error: { message: 'quantity must be a positive number' } });
    }
    const result = await query(
      `UPDATE inventory_items
       SET current_qty = current_qty + $3, last_restocked = NOW(), updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [req.user.tenant_id, req.params.id, quantity],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Item not found' } });
    }
    res.json({ item: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

export default router;
