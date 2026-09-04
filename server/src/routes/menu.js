import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { put, del } from '@vercel/blob';
import { authenticate, checkTenantActive, authorize } from '../middleware/auth.js';
import { query } from '../db/pool.js';
import { z } from 'zod';

const router = Router();
router.use(authenticate);
router.use(checkTenantActive);

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
    // A staff member setting availability by hand is a manual decision —
    // clear the auto-86 flag so a later stock replenishment (impl-08) never
    // silently overrides it. If they're re-enabling something the kitchen
    // still can't make, that's on them; the flag only protects the reverse.
    if (data.is_available !== undefined) {
      sets.push('auto_unavailable = false');
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

// ── GET /api/menu/:id/recipe ── (impl-08)
router.get('/:id/recipe', authorize('menu.edit'), async (req, res, next) => {
  try {
    const itemRes = await query('SELECT id FROM menu_items WHERE tenant_id = $1 AND id = $2', [req.user.tenant_id, req.params.id]);
    if (itemRes.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Menu item not found' } });
    }
    const { getRecipe } = await import('../services/inventory.js');
    const recipe = await getRecipe(req.user.tenant_id, req.params.id);
    res.json({ recipe });
  } catch (err) {
    next(err);
  }
});

const recipeSchema = z.object({
  ingredients: z.array(z.object({
    ingredient_id: z.string().uuid(),
    quantity_required: z.number().positive(),
  })),
});

// ── PUT /api/menu/:id/recipe ── (impl-08)
// Replaces the full recipe for a menu item with the given ingredient list.
router.put('/:id/recipe', authorize('menu.edit'), async (req, res, next) => {
  try {
    const itemRes = await query('SELECT id FROM menu_items WHERE tenant_id = $1 AND id = $2', [req.user.tenant_id, req.params.id]);
    if (itemRes.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Menu item not found' } });
    }
    const data = recipeSchema.parse(req.body);
    const { setRecipe } = await import('../services/inventory.js');
    const recipe = await setRecipe(req.user.tenant_id, req.params.id, data.ingredients);
    res.json({ recipe });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    if (err.status) {
      return res.status(err.status).json({ error: { message: err.message } });
    }
    next(err);
  }
});

// ── POST /api/menu/:id/image ──
// Upload or replace the photo for a menu item.
// Accepts multipart/form-data with a `photo` field (JPEG/PNG/WebP, max 5 MB).
// Stores to Vercel Blob, writes the CDN URL into menu_items.image_url.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG, and WebP images are accepted'));
    }
    cb(null, true);
  },
});

router.post('/:id/image', authorize('menu.edit'), upload.single('photo'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: { message: 'photo file is required' } });
    }

    // Confirm item belongs to this tenant before touching storage
    const existing = await query(
      'SELECT id, image_url FROM menu_items WHERE tenant_id = $1 AND id = $2',
      [req.user.tenant_id, req.params.id],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Menu item not found' } });
    }

    // Delete the old blob if one exists to avoid orphaned storage
    const oldUrl = existing.rows[0].image_url;
    if (oldUrl && oldUrl.includes('vercel-storage.com')) {
      try { await del(oldUrl); } catch { /* ignore stale blob errors */ }
    }

    const ext = req.file.mimetype === 'image/png' ? 'png'
      : req.file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const pathname = `menu-images/${req.user.tenant_id}/${req.params.id}.${ext}`;

    const blob = await put(pathname, req.file.buffer, {
      access: 'public',
      contentType: req.file.mimetype,
      addRandomSuffix: false, // deterministic URL so re-upload replaces the same path
    });

    const result = await query(
      'UPDATE menu_items SET image_url = $1, updated_at = NOW() WHERE tenant_id = $2 AND id = $3 RETURNING *',
      [blob.url, req.user.tenant_id, req.params.id],
    );
    res.json({ item: result.rows[0] });
  } catch (err) {
    if (err.message && err.message.includes('Only JPEG')) {
      return res.status(400).json({ error: { message: err.message } });
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: { message: 'Image must be under 5 MB' } });
    }
    next(err);
  }
});

// ── DELETE /api/menu/:id/image ──
// Removes the stored photo and clears image_url on the item.
router.delete('/:id/image', authorize('menu.edit'), async (req, res, next) => {
  try {
    const existing = await query(
      'SELECT id, image_url FROM menu_items WHERE tenant_id = $1 AND id = $2',
      [req.user.tenant_id, req.params.id],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Menu item not found' } });
    }
    const oldUrl = existing.rows[0].image_url;
    if (oldUrl && oldUrl.includes('vercel-storage.com')) {
      try { await del(oldUrl); } catch { /* ignore stale blob errors */ }
    }
    await query(
      'UPDATE menu_items SET image_url = NULL, updated_at = NOW() WHERE tenant_id = $1 AND id = $2',
      [req.user.tenant_id, req.params.id],
    );
    res.status(204).end();
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
