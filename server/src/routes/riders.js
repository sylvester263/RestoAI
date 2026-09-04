/**
 * Riders & cash reconciliation. The order-lifecycle endpoints that touch
 * riders (assign-rider, delivery-status) live in orders.js instead — they
 * need fireStatusChangeSideEffects, which is defined there, and mounting
 * this router at a shared prefix with orders.js would put its
 * router.use(authenticate) in front of every other /api/* route (it very
 * nearly did: see the commit that fixed this).
 */
import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { authenticate, checkTenantActive, authorize } from '../middleware/auth.js';
import { query, withTransaction } from '../db/pool.js';

const router = Router();
router.use(authenticate);
router.use(checkTenantActive);

// A random 6-digit PIN, zero-padded — generated when the owner doesn't set
// one explicitly at rider creation/reset.
function generatePin() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

async function assertBranchOwnedByTenant(tenantId, branchId) {
  const res = await query('SELECT id FROM branches WHERE id = $1 AND tenant_id = $2', [branchId, tenantId]);
  return res.rows.length > 0;
}

// ── GET /api/riders ──
router.get('/', async (req, res, next) => {
  try {
    const { branch_id, status } = req.query;
    const conditions = ['r.tenant_id = $1'];
    const params = [req.user.tenant_id];
    if (branch_id) {
      conditions.push(`r.branch_id = $${params.length + 1}`);
      params.push(branch_id);
    }
    if (status) {
      conditions.push(`r.status = $${params.length + 1}`);
      params.push(status);
    }
    const result = await query(
      `SELECT r.id, r.tenant_id, r.branch_id, r.name, r.phone, r.status, r.last_login_at, r.created_at,
              b.name as branch_name,
              (SELECT COUNT(*) FROM rider_assignments WHERE rider_id = r.id AND delivered_at IS NULL) as active_deliveries
       FROM riders r
       LEFT JOIN branches b ON b.id = r.branch_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY r.name`,
      params,
    );
    res.json({ riders: result.rows });
  } catch (err) {
    next(err);
  }
});

const riderCreateSchema = z.object({
  name: z.string().min(1).max(100),
  phone: z.string().min(7).max(20),
  branch_id: z.string().uuid().optional(),
  pin: z.string().regex(/^\d{4,6}$/, 'PIN must be 4-6 digits').optional(),
});

// ── POST /api/riders ──
// Also sets the rider's login PIN — either the one the owner supplied or a
// freshly generated one. The plaintext PIN is only ever returned in this
// response (never stored, never logged) for the owner to hand to the rider.
router.post('/', authorize('riders.manage'), async (req, res, next) => {
  try {
    const data = riderCreateSchema.parse(req.body);
    let branchId = data.branch_id || null;
    if (branchId) {
      if (!(await assertBranchOwnedByTenant(req.user.tenant_id, branchId))) {
        return res.status(400).json({ error: { message: 'Invalid branch' } });
      }
    } else {
      const branchRes = await query('SELECT id FROM branches WHERE tenant_id = $1 LIMIT 1', [req.user.tenant_id]);
      branchId = branchRes.rows[0]?.id;
    }
    if (!branchId) {
      return res.status(400).json({ error: { message: 'No branch configured for this restaurant' } });
    }
    const pin = data.pin || generatePin();
    const pinHash = await bcrypt.hash(pin, 10);
    const result = await query(
      `INSERT INTO riders (tenant_id, branch_id, name, phone, pin_hash) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.tenant_id, branchId, data.name, data.phone, pinHash],
    );
    const rider = result.rows[0];
    delete rider.pin_hash;
    res.status(201).json({ rider, pin });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

// ── POST /api/riders/:id/reset-pin ──
// Issues a fresh PIN for a rider (e.g. they forgot it, or a phone was lost).
// Returns the plaintext PIN once, same as creation.
router.post('/:id/reset-pin', authorize('riders.manage'), async (req, res, next) => {
  try {
    const riderRes = await query('SELECT id FROM riders WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenant_id]);
    if (riderRes.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Rider not found' } });
    }
    const pin = generatePin();
    const pinHash = await bcrypt.hash(pin, 10);
    await query('UPDATE riders SET pin_hash = $1 WHERE id = $2', [pinHash, req.params.id]);
    res.json({ pin });
  } catch (err) {
    next(err);
  }
});

// PIN changes go through POST /:id/reset-pin (which hashes it) — 'pin' is
// omitted here since the generic UPDATE loop below writes column names
// directly from the parsed keys, and 'pin' isn't a real column.
const riderUpdateSchema = riderCreateSchema.omit({ pin: true }).partial().extend({
  status: z.enum(['active', 'inactive']).optional(),
});

// ── PUT /api/riders/:id ──
router.put('/:id', authorize('riders.manage'), async (req, res, next) => {
  try {
    const data = riderUpdateSchema.parse(req.body);
    if (data.branch_id && !(await assertBranchOwnedByTenant(req.user.tenant_id, data.branch_id))) {
      return res.status(400).json({ error: { message: 'Invalid branch' } });
    }
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
      `UPDATE riders SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2
       RETURNING id, tenant_id, branch_id, name, phone, status, last_login_at, created_at`,
      params,
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Rider not found' } });
    }
    res.json({ rider: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

// ── GET /api/riders/reconciliations ──
// Recent reconciliation history across all riders, for the admin view.
// (Declared before /:id/assignments — a literal path, no collision either way.)
router.get('/reconciliations', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT cr.*, r.name as rider_name, u.name as reconciled_by_name
       FROM cash_reconciliations cr
       JOIN riders r ON r.id = cr.rider_id
       LEFT JOIN users u ON u.id = cr.reconciled_by
       WHERE cr.tenant_id = $1
       ORDER BY cr.created_at DESC LIMIT 50`,
      [req.user.tenant_id],
    );
    res.json({ reconciliations: result.rows });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/riders/:id/assignments ──
router.get('/:id/assignments', async (req, res, next) => {
  try {
    const riderRes = await query('SELECT id FROM riders WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenant_id]);
    if (riderRes.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Rider not found' } });
    }
    const result = await query(
      `SELECT ra.*, o.order_number, o.total, o.payment_method, o.delivery_address, o.status as order_status,
              c.name as customer_name, c.phone as customer_phone
       FROM rider_assignments ra
       JOIN orders o ON o.id = ra.order_id
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE ra.rider_id = $1
       ORDER BY ra.assigned_at DESC`,
      [req.params.id],
    );
    res.json({ assignments: result.rows });
  } catch (err) {
    next(err);
  }
});

const reconcileSchema = z.object({
  period_start: z.string().datetime({ offset: true }).or(z.string().datetime()),
  period_end: z.string().datetime({ offset: true }).or(z.string().datetime()),
});

// ── POST /api/riders/:id/reconcile ──
// Sums unreconciled cash-collected assignments delivered within the period,
// compares against the expected COD total for the same set, records the
// variance, and marks those assignments reconciled — locked in a
// transaction so a second run for the same period can't double-count.
router.post('/:id/reconcile', authorize('riders.reconcile'), async (req, res, next) => {
  try {
    const data = reconcileSchema.parse(req.body);
    const riderRes = await query('SELECT id FROM riders WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenant_id]);
    if (riderRes.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Rider not found' } });
    }

    const result = await withTransaction(async (client) => {
      const assignmentsRes = await client.query(
        `SELECT ra.id, ra.cash_collected, o.total, o.payment_method
         FROM rider_assignments ra
         JOIN orders o ON o.id = ra.order_id
         WHERE ra.rider_id = $1 AND ra.cash_reconciled = false
           AND ra.delivered_at IS NOT NULL
           AND ra.delivered_at >= $2 AND ra.delivered_at <= $3
         FOR UPDATE OF ra`,
        [req.params.id, data.period_start, data.period_end],
      );

      if (assignmentsRes.rows.length === 0) {
        const err = new Error('No unreconciled deliveries found for this rider in that period');
        err.status = 400;
        throw err;
      }

      const totalCollected = assignmentsRes.rows.reduce((sum, a) => sum + (parseFloat(a.cash_collected) || 0), 0);
      const totalExpected = assignmentsRes.rows
        .filter((a) => a.payment_method === 'cash')
        .reduce((sum, a) => sum + parseFloat(a.total), 0);
      const variance = Math.round((totalCollected - totalExpected) * 100) / 100;

      const ids = assignmentsRes.rows.map((a) => a.id);
      await client.query(`UPDATE rider_assignments SET cash_reconciled = true WHERE id = ANY($1::uuid[])`, [ids]);

      const reconRes = await client.query(
        `INSERT INTO cash_reconciliations (tenant_id, rider_id, period_start, period_end, total_expected, total_collected, variance, reconciled_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [req.user.tenant_id, req.params.id, data.period_start, data.period_end, totalExpected, totalCollected, variance, req.user.id],
      );
      return { reconciliation: reconRes.rows[0], assignments_reconciled: ids.length };
    });

    res.status(201).json(result);
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

export default router;
