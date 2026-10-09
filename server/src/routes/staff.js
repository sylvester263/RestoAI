/**
 * Staff roster — the people who can sign in to this restaurant, separate
 * from /api/staff-invites (which only lists invitations).
 *
 * Removing someone is a soft deactivation (users.deactivated_at), not a
 * delete: their name stays on the POS tabs, tickets and orders they
 * handled, login refuses them, and authenticate() rejects their existing
 * session tokens (see middleware/auth.js). Reactivating restores access.
 * Owners can't be deactivated, and nobody can deactivate themselves.
 */
import { Router } from 'express';
import { authenticate, checkTenantActive, authorize, invalidateUserStatus } from '../middleware/auth.js';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { posAudit } from '../services/pos-audit.js';

const router = Router();
router.use(authenticate);
router.use(checkTenantActive);

// ── GET /api/staff ──
router.get('/', authorize('staff.manage'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT u.id, u.name, u.email, u.role, u.phone, u.created_at, u.deactivated_at,
              (u.pos_pin_hash IS NOT NULL) AS has_pin, u.pos_pin_set_at,
              COALESCE(
                (SELECT array_agg(b.name ORDER BY b.name) FROM user_branch_access uba
                 JOIN branches b ON b.id = uba.branch_id
                 WHERE uba.user_id = u.id AND b.tenant_id = u.tenant_id),
                '{}'
              ) AS branches
       FROM users u
       WHERE u.tenant_id = $1
       ORDER BY (u.deactivated_at IS NOT NULL), CASE u.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, u.name`,
      [req.user.tenant_id],
    );
    res.json({ staff: result.rows.map((u) => ({ ...u, is_you: u.id === req.user.id })) });
  } catch (err) {
    next(err);
  }
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function setActive(req, res, next, active) {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(404).json({ error: { message: 'Staff member not found' } });
    }
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: { message: "You can't remove your own account." } });
    }
    const target = await query(
      'SELECT id, role FROM users WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.user.tenant_id],
    );
    if (target.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Staff member not found' } });
    }
    if (target.rows[0].role === 'owner') {
      return res.status(400).json({ error: { message: "The owner's account can't be removed." } });
    }
    const result = await query(
      `UPDATE users SET deactivated_at = ${active ? 'NULL' : 'NOW()'}, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, name, email, role, deactivated_at`,
      [req.params.id, req.user.tenant_id],
    );
    invalidateUserStatus(req.params.id);
    res.json({ user: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/staff/:id/deactivate ──
router.post('/:id/deactivate', authorize('staff.manage'), (req, res, next) => setActive(req, res, next, false));

// ── POST /api/staff/:id/reactivate ──
router.post('/:id/reactivate', authorize('staff.manage'), (req, res, next) => setActive(req, res, next, true));

// ── impl-33 Part 4: POS PIN for offline unlock ──
// Owner/manager only, on the actual role (like refunds), not a grantable
// permission. A manager can't set or clear the owner's PIN. Changing or
// clearing a PIN invalidates every device's offline unlock for that person:
// their PIN-session tokens carry pos_pin_set_at and are refused once it moves.
const pinSchema = z.object({ pin: z.string().regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits') });

async function loadPinTarget(req, res) {
  if (req.user.role !== 'owner' && req.user.role !== 'manager') {
    res.status(403).json({ error: { message: 'Only a manager or owner can set POS PINs' } });
    return null;
  }
  if (!UUID_RE.test(req.params.id)) {
    res.status(404).json({ error: { message: 'Staff member not found' } });
    return null;
  }
  const target = await query('SELECT id, name, role, deactivated_at FROM users WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenant_id]);
  const user = target.rows[0];
  if (!user) {
    res.status(404).json({ error: { message: 'Staff member not found' } });
    return null;
  }
  if (user.role === 'owner' && req.user.role !== 'owner') {
    res.status(403).json({ error: { message: "Only the owner can set the owner's PIN" } });
    return null;
  }
  if (user.deactivated_at) {
    res.status(400).json({ error: { message: 'Restore this person before giving them a PIN' } });
    return null;
  }
  return user;
}

// ── PUT /api/staff/:id/pin ── set or reset
router.put('/:id/pin', async (req, res, next) => {
  try {
    const target = await loadPinTarget(req, res);
    if (!target) return;
    const { pin } = pinSchema.parse(req.body);
    const hash = await bcrypt.hash(pin, 10);
    await query('UPDATE users SET pos_pin_hash = $2, pos_pin_set_at = NOW(), updated_at = NOW() WHERE id = $1', [target.id, hash]);
    await posAudit(req.user.tenant_id, req.user.id, 'pos_pin_set', { user_id: target.id, name: target.name });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: { message: err.errors[0].message } });
    next(err);
  }
});

// ── DELETE /api/staff/:id/pin ── clear (turns off offline unlock for them)
router.delete('/:id/pin', async (req, res, next) => {
  try {
    const target = await loadPinTarget(req, res);
    if (!target) return;
    await query('UPDATE users SET pos_pin_hash = NULL, pos_pin_set_at = NOW(), updated_at = NOW() WHERE id = $1', [target.id]);
    await posAudit(req.user.tenant_id, req.user.id, 'pos_pin_cleared', { user_id: target.id, name: target.name });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
