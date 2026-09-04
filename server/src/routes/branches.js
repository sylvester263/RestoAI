import { Router } from 'express';
import crypto from 'crypto';
import { authenticate, checkTenantActive } from '../middleware/auth.js';
import { authorize } from '../middleware/auth.js';
import { query } from '../db/pool.js';
import { z } from 'zod';

const router = Router();

// ── Public display boards (impl-09) — must be registered BEFORE the
// authenticate middleware below, since these run unattended on an in-store
// screen with no login. Token board exposes only order numbers + wait time.
router.get('/:id/token-board', async (req, res, next) => {
  try {
    const branchRes = await query('SELECT tenant_id FROM branches WHERE id = $1', [req.params.id]);
    if (branchRes.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Branch not found' } });
    }
    const tenantId = branchRes.rows[0].tenant_id;

    const result = await query(
      `SELECT o.order_number, o.created_at FROM orders o
       JOIN branches b ON b.id = o.branch_id
       WHERE o.branch_id = $1 AND b.tenant_id = $2 AND o.status = 'ready'
       ORDER BY o.created_at`,
      [req.params.id, tenantId],
    );
    res.json({
      tokens: result.rows.map((o) => ({
        token_number: o.order_number,
        waiting_minutes: Math.max(0, Math.round((Date.now() - new Date(o.created_at).getTime()) / 60000)),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/menu-board', async (req, res, next) => {
  try {
    const branchRes = await query('SELECT tenant_id FROM branches WHERE id = $1', [req.params.id]);
    if (branchRes.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Branch not found' } });
    }
    const tenantId = branchRes.rows[0].tenant_id;

    const result = await query(
      `SELECT mi.id, mi.name, mi.name_urdu, mi.price, mi.is_available,
              mc.name as category_name, mc.sort_order
       FROM menu_items mi
       LEFT JOIN menu_categories mc ON mi.category_id = mc.id
       WHERE mi.tenant_id = $1 AND (mi.branch_id = $2 OR mi.branch_id IS NULL)
       ORDER BY mc.sort_order, mi.name`,
      [tenantId, req.params.id],
    );
    res.json({ items: result.rows });
  } catch (err) {
    next(err);
  }
});

router.use(authenticate);
router.use(checkTenantActive);

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
router.post('/', authorize('branches.manage'), async (req, res, next) => {
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
router.put('/:id', authorize('branches.manage'), async (req, res, next) => {
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

// ── Dine-in tables (impl-02) ──
const tableSchema = z.object({ table_number: z.string().min(1).max(20) });

async function assertBranchOwnedByTenant(tenantId, branchId) {
  const res = await query('SELECT id FROM branches WHERE id = $1 AND tenant_id = $2', [branchId, tenantId]);
  return res.rows.length > 0;
}

// ── GET /api/branches/:id/tables ──
router.get('/:id/tables', async (req, res, next) => {
  try {
    if (!(await assertBranchOwnedByTenant(req.user.tenant_id, req.params.id))) {
      return res.status(404).json({ error: { message: 'Branch not found' } });
    }
    const result = await query(
      `SELECT t.*, s.id as open_session_id, s.status as session_status
       FROM restaurant_tables t
       LEFT JOIN table_sessions s ON s.table_id = t.id AND s.status != 'closed'
       WHERE t.branch_id = $1
       ORDER BY t.table_number`,
      [req.params.id],
    );
    res.json({ tables: result.rows });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/branches/:id/reservations?date=YYYY-MM-DD ──
// Day view of reservations for staff (impl-06)
router.get('/:id/reservations', async (req, res, next) => {
  try {
    if (!(await assertBranchOwnedByTenant(req.user.tenant_id, req.params.id))) {
      return res.status(404).json({ error: { message: 'Branch not found' } });
    }
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const result = await query(
      `SELECT * FROM reservations
       WHERE branch_id = $1 AND reserved_for >= $2::date AND reserved_for < $2::date + INTERVAL '1 day'
       ORDER BY reserved_for`,
      [req.params.id, date],
    );
    res.json({ reservations: result.rows });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/branches/:id/tables ──
router.post('/:id/tables', authorize('branches.manage'), async (req, res, next) => {
  try {
    if (!(await assertBranchOwnedByTenant(req.user.tenant_id, req.params.id))) {
      return res.status(404).json({ error: { message: 'Branch not found' } });
    }
    const data = tableSchema.parse(req.body);
    const qrToken = crypto.randomBytes(24).toString('hex');
    const result = await query(
      `INSERT INTO restaurant_tables (tenant_id, branch_id, table_number, qr_code_token)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.tenant_id, req.params.id, data.table_number, qrToken],
    );
    res.status(201).json({ table: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: { message: 'That table number already exists for this branch' } });
    }
    next(err);
  }
});

export default router;
