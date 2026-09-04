import { Router } from 'express';
import { z } from 'zod';
import { authenticate, checkTenantActive, authorize } from '../middleware/auth.js';
import { query } from '../db/pool.js';
import { createDraftPurchaseOrder, receivePurchaseOrder } from '../services/purchase-orders.js';

const router = Router();
router.use(authenticate);
router.use(checkTenantActive);

// ── GET /api/purchase-orders ──
router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT po.*, s.name as supplier_name,
         (SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = po.id) as item_count,
         (SELECT COALESCE(SUM(quantity * unit_cost), 0) FROM purchase_order_items WHERE purchase_order_id = po.id) as total_cost
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.tenant_id = $1
       ORDER BY po.created_at DESC`,
      [req.user.tenant_id],
    );
    res.json({ purchase_orders: result.rows });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/purchase-orders/:id ──
router.get('/:id', async (req, res, next) => {
  try {
    const poRes = await query(
      `SELECT po.*, s.name as supplier_name FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.id = $1 AND po.tenant_id = $2`,
      [req.params.id, req.user.tenant_id],
    );
    if (poRes.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Purchase order not found' } });
    }
    const itemsRes = await query(
      `SELECT poi.*, i.name as ingredient_name, i.unit FROM purchase_order_items poi
       JOIN ingredients i ON i.id = poi.ingredient_id
       WHERE poi.purchase_order_id = $1`,
      [req.params.id],
    );
    res.json({ purchase_order: poRes.rows[0], items: itemsRes.rows });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  supplier_id: z.string().uuid(),
  branch_id: z.string().uuid().optional(),
  items: z.array(z.object({
    ingredient_id: z.string().uuid(),
    quantity: z.number().positive(),
    unit_cost: z.number().min(0),
  })).min(1),
});

// ── POST /api/purchase-orders ──
router.post('/', authorize('inventory.manage'), async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);

    const supplierRes = await query('SELECT id FROM suppliers WHERE id = $1 AND tenant_id = $2', [data.supplier_id, req.user.tenant_id]);
    if (supplierRes.rows.length === 0) {
      return res.status(400).json({ error: { message: 'Invalid supplier' } });
    }

    let branchId = data.branch_id || null;
    if (branchId) {
      const branchRes = await query('SELECT id FROM branches WHERE id = $1 AND tenant_id = $2', [branchId, req.user.tenant_id]);
      if (branchRes.rows.length === 0) {
        return res.status(400).json({ error: { message: 'Invalid branch' } });
      }
    } else {
      const branchRes = await query('SELECT id FROM branches WHERE tenant_id = $1 LIMIT 1', [req.user.tenant_id]);
      branchId = branchRes.rows[0]?.id;
    }
    if (!branchId) {
      return res.status(400).json({ error: { message: 'No branch configured for this restaurant' } });
    }

    const ingredientIds = data.items.map((i) => i.ingredient_id);
    const ownedRes = await query(
      'SELECT id FROM ingredients WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
      [req.user.tenant_id, ingredientIds],
    );
    if (ownedRes.rows.length !== new Set(ingredientIds).size) {
      return res.status(400).json({ error: { message: 'One or more ingredients are invalid for this tenant' } });
    }

    const po = await createDraftPurchaseOrder(req.user.tenant_id, branchId, data.supplier_id, data.items);
    res.status(201).json({ purchase_order: po });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

// ── POST /api/purchase-orders/:id/receive ──
// Increments ingredient stock, updates cost_per_unit, and re-enables any
// menu item that was auto-86'd purely for lack of these ingredients.
router.post('/:id/receive', authorize('inventory.restock'), async (req, res, next) => {
  try {
    const result = await receivePurchaseOrder(req.user.tenant_id, req.params.id);
    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: { message: err.message } });
    }
    next(err);
  }
});

export default router;
