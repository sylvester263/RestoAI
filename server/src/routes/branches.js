import { Router } from 'express';
import crypto from 'crypto';
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
router.post('/:id/tables', authorize('owner', 'manager'), async (req, res, next) => {
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
