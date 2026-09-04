/**
 * Super Admin Routes (impl-29) — platform operator tenant management.
 *
 * All routes except /login, /verify-mfa, and /setup-mfa are gated by
 * authenticateSuperAdmin + automatic audit logging middleware.
 *
 * Key design: these are explicitly cross-tenant queries — they do NOT reuse
 * any existing tenant-scoped query function. Written fresh to avoid giving
 * single-tenant functions a cross-tenant escape hatch.
 */
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { authenticateSuperAdmin } from '../middleware/auth.js';
import { loginStep1, loginStep2, setupTotp } from '../services/super-admin-auth.js';

const router = Router();

// ── Zod schemas ──
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
const verifyMfaSchema = z.object({
  mfaToken: z.string().min(1),
  totpCode: z.string().min(4).max(8),
});
const setupMfaSchema = z.object({
  mfaToken: z.string().min(1),
  secret: z.string().optional(),
  totpCode: z.string().optional(),
});
const extendSchema = z.object({
  newEndDate: z.string().min(1),
  reason: z.string().min(1).max(500),
});
const suspendReactivateSchema = z.object({
  reason: z.string().min(1).max(500),
});
const compSchema = z.object({
  endDate: z.string().min(1),
  reason: z.string().min(1).max(500),
});

// ═══════════════════════════════════════════════════════════════════
// AUDIT LOGGING MIDDLEWARE
// Wraps every authenticated route — writes to super_admin_audit_log
// automatically. Captures action, target tenant, details, and IP.
// ═══════════════════════════════════════════════════════════════════

/**
 * Audit middleware factory. Pass the action name and an optional function
 * that extracts the target tenant_id and details from req/res.
 * Runs AFTER the handler (via res.on('finish')) so it can capture the
 * response status — only logs successful actions (2xx).
 */
function auditLog(action, extractMeta) {
  return async (req, res, next) => {
    // Hook into response finish — only log on success
    const originalEnd = res.end;
    res.end = function (...args) {
      res.end = originalEnd;
      res.end(...args);

      if (res.statusCode >= 200 && res.statusCode < 300) {
        const meta = extractMeta ? extractMeta(req, res) : {};
        const targetTenantId = meta.targetTenantId || null;
        const details = meta.details || {};

        // Fire-and-forget — don't block the response on audit logging
        query(
          `INSERT INTO super_admin_audit_log (super_admin_id, action, target_tenant_id, details, ip_address)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            req.superAdmin.id,
            action,
            targetTenantId,
            details,
            req.ip || req.headers['x-forwarded-for'] || null,
          ],
        ).catch((err) => console.error('[super-admin-audit] log failed:', err.message));
      }
    };
    next();
  };
}

// ═══════════════════════════════════════════════════════════════════
// PUBLIC ROUTES — login + MFA (no authentication required)
// ═══════════════════════════════════════════════════════════════════

// Step 1: Email + password → mfa_pending token
router.post('/login', async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: 'email and password are required' } });
    }

    const { admin, mfaPendingToken } = await loginStep1(parsed.data.email, parsed.data.password);

    res.json({
      mfaToken: mfaPendingToken,
      totpEnabled: admin.totp_enabled,
      // If TOTP is not set up, the frontend routes to the setup flow
    });
  } catch (err) {
    if (err.message === 'Invalid email or password') {
      return res.status(401).json({ error: { message: err.message } });
    }
    next(err);
  }
});

// Step 2: TOTP code → real session JWT
router.post('/verify-mfa', async (req, res, next) => {
  try {
    const parsed = verifyMfaSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: 'mfaToken and totpCode are required' } });
    }

    const { token, admin } = await loginStep2(parsed.data.mfaToken, parsed.data.totpCode);
    res.json({ token, admin });
  } catch (err) {
    if (err.message.includes('Invalid TOTP') || err.message.includes('expired') || err.message.includes('not set up')) {
      return res.status(401).json({ error: { message: err.message } });
    }
    next(err);
  }
});

// TOTP enrollment (first login)
router.post('/setup-mfa', async (req, res, next) => {
  try {
    const parsed = setupMfaSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: 'mfaToken is required' } });
    }

    const result = await setupTotp(parsed.data.mfaToken, {
      secret: parsed.data.secret,
      totpCode: parsed.data.totpCode,
    });

    res.json(result);
  } catch (err) {
    if (err.message.includes('Invalid TOTP') || err.message.includes('expired')) {
      return res.status(400).json({ error: { message: err.message } });
    }
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════
// AUTHENTICATED ROUTES — all gated by authenticateSuperAdmin + audit
// ═══════════════════════════════════════════════════════════════════

// All routes below require super admin authentication
router.use(authenticateSuperAdmin);

// ── GET /tenants — list all tenants ──
router.get(
  '/tenants',
  auditLog('view_tenant_list'),
  async (req, res, next) => {
    try {
      const result = await query(`
        SELECT t.id, t.name, t.slug, t.phone, t.currency, t.created_at,
               t.subscription_status, t.subscription_plan,
               t.subscription_period_start, t.subscription_period_end,
               COUNT(DISTINCT b.id) AS branch_count,
               MAX(o.created_at) AS last_activity
        FROM tenants t
        LEFT JOIN branches b ON b.tenant_id = t.id
        LEFT JOIN orders o ON o.tenant_id = t.id
        GROUP BY t.id
        ORDER BY t.created_at DESC
      `);
      res.json({ tenants: result.rows });
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /tenants/expiring — tenants expiring within N days ──
router.get(
  '/tenants/expiring',
  auditLog('view_tenant_list', (req) => ({
    details: { filter: 'expiring', days: req.query.days || 30 },
  })),
  async (req, res, next) => {
    try {
      const days = parseInt(req.query.days, 10) || 30;
      const result = await query(`
        SELECT t.id, t.name, t.slug, t.phone, t.currency, t.created_at,
               t.subscription_status, t.subscription_plan,
               t.subscription_period_start, t.subscription_period_end,
               COUNT(DISTINCT b.id) AS branch_count,
               MAX(o.created_at) AS last_activity,
               EXTRACT(DAY FROM (t.subscription_period_end - NOW())) AS days_until_expiry
        FROM tenants t
        LEFT JOIN branches b ON b.tenant_id = t.id
        LEFT JOIN orders o ON o.tenant_id = t.id
        WHERE t.subscription_period_end IS NOT NULL
          AND t.subscription_period_end <= NOW() + ($1 || ' days')::INTERVAL
          AND t.subscription_status IN ('trial', 'active')
        GROUP BY t.id
        ORDER BY t.subscription_period_end ASC
      `, [days]);
      res.json({ tenants: result.rows, days });
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /tenants/:id — full tenant detail ──
router.get(
  '/tenants/:id',
  auditLog('view_tenant_detail', (req) => ({
    targetTenantId: req.params.id,
  })),
  async (req, res, next) => {
    try {
      const tenantRes = await query(`
        SELECT t.*, COUNT(DISTINCT b.id) AS branch_count,
               COUNT(DISTINCT u.id) AS user_count,
               MAX(o.created_at) AS last_activity
        FROM tenants t
        LEFT JOIN branches b ON b.tenant_id = t.id
        LEFT JOIN users u ON u.tenant_id = t.id
        LEFT JOIN orders o ON o.tenant_id = t.id
        WHERE t.id = $1
        GROUP BY t.id
      `, [req.params.id]);

      if (tenantRes.rows.length === 0) {
        return res.status(404).json({ error: { message: 'Tenant not found' } });
      }

      const branchesRes = await query(
        'SELECT id, name, address, phone FROM branches WHERE tenant_id = $1 ORDER BY name',
        [req.params.id],
      );

      const usersRes = await query(
        "SELECT id, name, email, role, created_at FROM users WHERE tenant_id = $1 ORDER BY created_at DESC",
        [req.params.id],
      );

      res.json({
        tenant: tenantRes.rows[0],
        branches: branchesRes.rows,
        users: usersRes.rows,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /tenants/:id/extend — extend subscription period ──
router.post(
  '/tenants/:id/extend',
  auditLog('extend_subscription', (req) => ({
    targetTenantId: req.params.id,
    details: req.body,
  })),
  async (req, res, next) => {
    try {
      const parsed = extendSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: { message: 'newEndDate (ISO) and reason are required' } });
      }

      const result = await query(`
        UPDATE tenants
        SET subscription_period_end = $1,
            subscription_notes = COALESCE(subscription_notes, '') || E'\\n[' || NOW()::date || '] Extended to ' || $1::date || ': ' || $2,
            updated_at = NOW()
        WHERE id = $3
        RETURNING id, name, subscription_status, subscription_period_end, subscription_notes
      `, [parsed.data.newEndDate, parsed.data.reason, req.params.id]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: { message: 'Tenant not found' } });
      }

      res.json({ tenant: result.rows[0] });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /tenants/:id/suspend — suspend a tenant ──
router.post(
  '/tenants/:id/suspend',
  auditLog('suspend_tenant', (req) => ({
    targetTenantId: req.params.id,
    details: req.body,
  })),
  async (req, res, next) => {
    try {
      const parsed = suspendReactivateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: { message: 'reason is required' } });
      }

      const result = await query(`
        UPDATE tenants
        SET subscription_status = 'suspended',
            subscription_notes = COALESCE(subscription_notes, '') || E'\\n[' || NOW()::date || '] Suspended: ' || $1,
            updated_at = NOW()
        WHERE id = $2
        RETURNING id, name, subscription_status, subscription_notes
      `, [parsed.data.reason, req.params.id]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: { message: 'Tenant not found' } });
      }

      res.json({ tenant: result.rows[0] });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /tenants/:id/reactivate — reactivate a suspended tenant ──
router.post(
  '/tenants/:id/reactivate',
  auditLog('reactivate_tenant', (req) => ({
    targetTenantId: req.params.id,
    details: req.body,
  })),
  async (req, res, next) => {
    try {
      const parsed = suspendReactivateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: { message: 'reason is required' } });
      }

      const result = await query(`
        UPDATE tenants
        SET subscription_status = 'active',
            subscription_notes = COALESCE(subscription_notes, '') || E'\\n[' || NOW()::date || '] Reactivated: ' || $1,
            updated_at = NOW()
        WHERE id = $2
        RETURNING id, name, subscription_status, subscription_notes
      `, [parsed.data.reason, req.params.id]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: { message: 'Tenant not found' } });
      }

      res.json({ tenant: result.rows[0] });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /tenants/:id/comp — apply a complimentary period ──
router.post(
  '/tenants/:id/comp',
  auditLog('comp_period', (req) => ({
    targetTenantId: req.params.id,
    details: req.body,
  })),
  async (req, res, next) => {
    try {
      const parsed = compSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: { message: 'endDate (ISO) and reason are required' } });
      }

      const result = await query(`
        UPDATE tenants
        SET subscription_period_end = $1,
            subscription_status = CASE WHEN subscription_status = 'suspended' THEN 'active' ELSE subscription_status END,
            subscription_notes = COALESCE(subscription_notes, '') || E'\\n[' || NOW()::date || '] Comp period to ' || $1::date || ': ' || $2,
            updated_at = NOW()
        WHERE id = $3
        RETURNING id, name, subscription_status, subscription_period_end, subscription_notes
      `, [parsed.data.endDate, parsed.data.reason, req.params.id]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: { message: 'Tenant not found' } });
      }

      res.json({ tenant: result.rows[0] });
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /audit-log — filterable audit log ──
router.get('/audit-log', async (req, res, next) => {
  try {
    const { tenant_id, admin_id, days, limit } = req.query;
    let sql = `
      SELECT al.*, sa.email AS admin_email, t.name AS tenant_name
      FROM super_admin_audit_log al
      LEFT JOIN super_admins sa ON sa.id = al.super_admin_id
      LEFT JOIN tenants t ON t.id = al.target_tenant_id
      WHERE 1=1
    `;
    const params = [];
    let paramIdx = 1;

    if (tenant_id) {
      sql += ` AND al.target_tenant_id = $${paramIdx}`;
      params.push(tenant_id);
      paramIdx++;
    }
    if (admin_id) {
      sql += ` AND al.super_admin_id = $${paramIdx}`;
      params.push(admin_id);
      paramIdx++;
    }
    if (days) {
      sql += ` AND al.created_at >= NOW() - ($${paramIdx} || ' days')::INTERVAL`;
      params.push(days);
      paramIdx++;
    }

    sql += ` ORDER BY al.created_at DESC`;

    const lim = parseInt(limit, 10) || 50;
    sql += ` LIMIT $${paramIdx}`;
    params.push(Math.min(lim, 200));

    const result = await query(sql, params);
    res.json({ entries: result.rows });
  } catch (err) {
    next(err);
  }
});

export default router;
