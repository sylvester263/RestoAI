/**
 * Permissions management — owner-only. Deliberately NOT gated through the
 * same authorize(permission_key) system it configures: if it were, a
 * manager somehow granted 'staff.manage' could hand themselves every other
 * permission, defeating the point. requireOwner is a hardcoded role check
 * that bypasses role_permissions entirely, same as authorize()'s own
 * owner fast-path.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, checkTenantActive, invalidatePermissionsCache } from '../middleware/auth.js';
import { query } from '../db/pool.js';
import { PERMISSIONS, PERMISSION_KEYS, EDITABLE_ROLES } from '../services/permissions.js';

const router = Router();
router.use(authenticate);
router.use(checkTenantActive);

function requireOwner(req, res, next) {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: { message: 'Only the owner can manage permissions' } });
  }
  next();
}
router.use(requireOwner);

// ── GET /api/permissions ──
// The full catalog plus this tenant's current grants for manager/staff.
// 'owner' isn't included — it always has everything via the hardcoded
// bypass in authorize(), so there's nothing to configure for it.
router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT role, permission_key FROM role_permissions WHERE tenant_id = $1 AND role = ANY($2::text[])`,
      [req.user.tenant_id, EDITABLE_ROLES],
    );
    const grants = Object.fromEntries(EDITABLE_ROLES.map((r) => [r, []]));
    for (const row of result.rows) {
      grants[row.role].push(row.permission_key);
    }
    res.json({ permissions: PERMISSIONS, roles: EDITABLE_ROLES, grants });
  } catch (err) {
    next(err);
  }
});

const updateSchema = z.object({
  permission_keys: z.array(z.enum(PERMISSION_KEYS)),
});

// ── PUT /api/permissions/:role ──
// Replaces the full permission set for one role (manager or staff) with
// the given list.
router.put('/:role', async (req, res, next) => {
  try {
    if (!EDITABLE_ROLES.includes(req.params.role)) {
      return res.status(400).json({ error: { message: "role must be 'manager' or 'staff' — 'owner' always has every permission" } });
    }
    const data = updateSchema.parse(req.body);

    await query('DELETE FROM role_permissions WHERE tenant_id = $1 AND role = $2', [req.user.tenant_id, req.params.role]);
    for (const key of data.permission_keys) {
      await query(
        'INSERT INTO role_permissions (tenant_id, role, permission_key) VALUES ($1, $2, $3)',
        [req.user.tenant_id, req.params.role, key],
      );
    }
    invalidatePermissionsCache(req.user.tenant_id);

    res.json({ role: req.params.role, permission_keys: data.permission_keys });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

export default router;
