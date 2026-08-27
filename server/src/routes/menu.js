import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, authorize } from '../middleware/auth.js';
import { query } from '../db/pool.js';
import { z } from 'zod';

const router = Router();
router.use(authenticate);

// digitize() calls a paid Qwen vision API per request — limit per-user, not just per-IP
const digitizeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  keyGenerator: (req) => req.user?.id || req.ip,
});

const menuItemSchema = z.object({
  name: z.string().min(1),
  name_urdu: z.string().optional(),
  description: z.string().optional(),
  price: z.number().positive(),
  category_id: z.string().uuid().optional(),
  branch_id: z.string().uuid().optional(),
  image_url: z.string().url().optional().nullable(),
  is_available: z.boolean().default(true),
  tags: z.array(z.string()).default([]),
});

// ── GET /api/menu ──
// Returns all menu items for the current tenant, optionally filtered by branch
router.get('/', async (req, res, next) => {
  try {
    const { branch_id, category, available_only } = req.query;
    let sql = `
      SELECT mi.*, mc.name as category_name
      FROM menu_items mi
      LEFT JOIN menu_categories mc ON mi.category_id = mc.id
      WHERE mi.tenant_id = $1
    `;
    const params = [req.user.tenant_id];
    let idx = 2;

    if (branch_id) {
      sql += ` AND mi.branch_id = $${idx}`;
      params.push(branch_id);
      idx++;
    }
    if (category) {
      sql += ` AND mc.name ILIKE $${idx}`;
      params.push(`%${category}%`);
      idx++;
    }
    if (available_only === 'true') {
      sql += ` AND mi.is_available = true`;
    }
    sql += ' ORDER BY mc.sort_order, mi.name';

    const result = await query(sql, params);
    res.json({ items: result.rows });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/menu/categories ──
router.get('/categories', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM menu_categories WHERE tenant_id = $1 ORDER BY sort_order',
      [req.user.tenant_id],
    );
    res.json({ categories: result.rows });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/menu ──
// Create a new menu item
router.post('/', authorize('menu.edit'), async (req, res, next) => {
  try {
    const data = menuItemSchema.parse(req.body);
    const result = await query(
      `INSERT INTO menu_items (tenant_id, branch_id, category_id, name, name_urdu, description, price, image_url, is_available, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [req.user.tenant_id, data.branch_id, data.category_id, data.name, data.name_urdu || null, data.description || null, data.price, data.image_url || null, data.is_available, data.tags],
    );
    res.status(201).json({ item: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

// ── PUT /api/menu/:id ──
// Update a menu item
router.put('/:id', authorize('menu.edit'), async (req, res, next) => {
  try {
    const data = menuItemSchema.partial().parse(req.body);
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
      `UPDATE menu_items SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      params,
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Menu item not found' } });
    }
    res.json({ item: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/menu/:id ──
router.delete('/:id', authorize('menu.edit'), async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM menu_items WHERE tenant_id = $1 AND id = $2 RETURNING id',
      [req.user.tenant_id, req.params.id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Menu item not found' } });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ── POST /api/menu/digitize ──
// Accepts a base64 image of a physical menu and uses Qwen vision to extract items
router.post('/digitize', authorize('menu.edit'), digitizeLimiter, async (req, res, next) => {
  try {
    const { image_base64 } = req.body;
    if (!image_base64) {
      return res.status(400).json({ error: { message: 'image_base64 is required' } });
    }

    const { digitizeMenuFromImage } = await import('../services/ai-agent.js');
    const items = await digitizeMenuFromImage(image_base64);
    res.json({ extracted_items: items });
  } catch (err) {
    next(err);
  }
});

export default router;
