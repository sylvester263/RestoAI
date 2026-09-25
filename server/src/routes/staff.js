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
import { query } from '../db/pool.js';

const router = Router();
router.use(authenticate);
router.use(checkTenantActive);

// ── GET /api/staff ──
router.get('/', authorize('staff.manage'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT u.id, u.name, u.email, u.role, u.phone, u.created_at, u.deactivated_at,
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

export default router;
