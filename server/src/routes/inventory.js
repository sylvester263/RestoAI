/**
 * Ingredient inventory (impl-08) — the ingredients table replaces the old
 * flat inventory_items tracker with recipe-linked, cost-aware stock. Recipe
 * editing lives under menu.js (GET/PUT /api/menu/:id/recipe) since it's
 * conceptually part of a menu item's own definition.
 */
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { query } from '../db/pool.js';
import { z } from 'zod';

const router = Router();
router.use(authenticate);

const ingredientSchema = z.object({
  name: z.string().min(1).max(150),
  unit: z.string().min(1).max(20).default('kg'),
  current_stock: z.number().min(0).default(0),
  low_stock_threshold: z.number().min(0).default(0),
  cost_per_unit: z.number().min(0).default(0),
  branch_id: z.string().uuid().optional(),
  preferred_supplier_id: z.string().uuid().optional().nullable(),
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
      conditions.push(`i.current_stock <= i.low_stock_threshold`);
    }

    const where = conditions.join(' AND ');
    const result = await query(
      `SELECT i.*, b.name as branch_name, s.name as preferred_supplier_name
       FROM ingredients i
       LEFT JOIN branches b ON i.branch_id = b.id
       LEFT JOIN suppliers s ON i.preferred_supplier_id = s.id
       WHERE ${where}
       ORDER BY i.name`,
      params,
    );
    res.json({ ingredients: result.rows });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/inventory ──
router.post('/', authorize('inventory.manage'), async (req, res, next) => {
  try {
    const data = ingredientSchema.parse(req.body);

    let branchId = data.branch_id || null;
    if (!branchId) {
      const branchRes = await query('SELECT id FROM branches WHERE tenant_id = $1 LIMIT 1', [req.user.tenant_id]);
      branchId = branchRes.rows[0]?.id;
    }
    if (!branchId) {
      return res.status(400).json({ error: { message: 'No branch configured for this restaurant' } });
    }

    const result = await query(
      `INSERT INTO ingredients (tenant_id, branch_id, name, unit, current_stock, low_stock_threshold, cost_per_unit, preferred_supplier_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.user.tenant_id, branchId, data.name, data.unit, data.current_stock, data.low_stock_threshold, data.cost_per_unit, data.preferred_supplier_id || null],
    );
    res.status(201).json({ ingredient: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

// ── PUT /api/inventory/:id ──
router.put('/:id', authorize('inventory.manage'), async (req, res, next) => {
  try {
    const data = ingredientSchema.partial().parse(req.body);
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
    if (sets.length === 0) {
      return res.status(400).json({ error: { message: 'No fields to update' } });
    }

    const result = await query(
      `UPDATE ingredients SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      params,
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Ingredient not found' } });
    }
    res.json({ ingredient: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

// ── DELETE /api/inventory/:id ──
router.delete('/:id', authorize('inventory.manage'), async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM ingredients WHERE tenant_id = $1 AND id = $2 RETURNING id',
      [req.user.tenant_id, req.params.id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Ingredient not found' } });
    }
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

export default router;
