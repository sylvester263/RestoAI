import jwt from 'jsonwebtoken';
import config from '../config.js';
import { query } from '../db/pool.js';

/**
 * JWT authentication middleware.
 * Extracts token from Authorization header, verifies it, and attaches
 * the decoded user payload (including tenant_id) to req.user.
 */
export function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: { message: 'Authentication required' } });
  }

  try {
    const token = header.slice(7);
    req.user = jwt.verify(token, config.jwt.secret);
    next();
  } catch {
    return res.status(401).json({ error: { message: 'Invalid or expired token' } });
  }
}

/**
 * Rider JWT authentication middleware — structurally separate from
 * authenticate() above (different secret, no role/permissions claims).
 * Attaches { rider_id, tenant_id, branch_id } to req.rider. Only apply to
 * rider-facing routes; never mix with authenticate()/authorize() on the
 * same route.
 */
export function authenticateRider(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: { message: 'Authentication required' } });
  }
  try {
    const token = header.slice(7);
    const decoded = jwt.verify(token, config.jwt.riderSecret);
    if (decoded.type !== 'rider') {
      return res.status(401).json({ error: { message: 'Invalid or expired token' } });
    }
    req.rider = decoded;
    next();
  } catch {
    return res.status(401).json({ error: { message: 'Invalid or expired token' } });
  }
}

// Per-tenant role->permission-set cache. The set is tiny (a handful of
// roles times ~15 keys per tenant) so caching the whole thing beats a
// query per gated request; a short TTL keeps a just-changed permission
// from being stale for long, and invalidatePermissionsCache() below lets
// the permissions-management route clear it immediately on save.
const CACHE_TTL_MS = 30000;
const cache = new Map(); // tenantId -> { at, map: { role -> Set<permission_key> } }

async function getRolePermissions(tenantId) {
  const cached = cache.get(tenantId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.map;
  }
  const result = await query('SELECT role, permission_key FROM role_permissions WHERE tenant_id = $1', [tenantId]);
  const map = {};
  for (const row of result.rows) {
    (map[row.role] = map[row.role] || new Set()).add(row.permission_key);
  }
  cache.set(tenantId, { at: Date.now(), map });
  return map;
}

export function invalidatePermissionsCache(tenantId) {
  cache.delete(tenantId);
}

/**
 * Granular permission-based authorization middleware. Must follow
 * authenticate(). Pass one or more permission keys — the request proceeds
 * if the user's role has ANY of them for their tenant.
 *
 * 'owner' always passes, regardless of what's in role_permissions — this
 * is a hardcoded bypass, not a seeded default, so an owner can never
 * misconfigure their own way into being locked out of their restaurant.
 * @param {...string} permissionKeys
 */
export function authorize(...permissionKeys) {
  return async (req, res, next) => {
    if (req.user.role === 'owner') {
      return next();
    }
    try {
      const rolePerms = await getRolePermissions(req.user.tenant_id);
      const granted = rolePerms[req.user.role] || new Set();
      if (!permissionKeys.some((key) => granted.has(key))) {
        return res.status(403).json({ error: { message: 'Insufficient permissions' } });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
