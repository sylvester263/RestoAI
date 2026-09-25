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
import { query, withTransaction } from '../db/pool.js';
import { sendReply } from '../services/whatsapp.js';
import { PLANS, BILLING_PERIOD_MONTHS, invalidateAgentPack } from '../services/billing.js';
import { periodStartSql } from '../utils/business-time.js';
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
               t.subscription_status, t.subscription_plan, t.ai_agent_pack_enabled,
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
               t.subscription_status, t.subscription_plan, t.ai_agent_pack_enabled,
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

      const paymentsRes = await query(
        `SELECT ps.id, ps.claimed_plan, ps.claimed_branch_count, ps.claimed_agent_pack, ps.claimed_amount,
                ps.bank_reference_number, ps.receipt_image_url, ps.status, ps.rejection_reason,
                ps.submitted_at, ps.reviewed_at, sa.email AS reviewed_by_email
         FROM payment_submissions ps LEFT JOIN super_admins sa ON sa.id = ps.reviewed_by
         WHERE ps.tenant_id = $1 ORDER BY ps.submitted_at DESC LIMIT 20`,
        [req.params.id],
      );

      res.json({
        tenant: tenantRes.rows[0],
        branches: branchesRes.rows,
        users: usersRes.rows,
        payments: paymentsRes.rows,
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

// ═══════════════════════════════════════════════════════════════════
// impl-32 — PAYMENT VERIFICATION, REVENUE, AI AGENT PACK
// ═══════════════════════════════════════════════════════════════════

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rejectSchema = z.object({ reason: z.string().trim().min(1).max(500) });
const agentPackSchema = z.object({ enabled: z.boolean(), reason: z.string().trim().min(1).max(500) });

// Owner's WhatsApp number: the owner user's verified phone, else the
// restaurant's phone (the same fallback the daily briefing uses).
async function ownerPhone(tenantId) {
  const res = await query(
    `SELECT COALESCE(
       (SELECT phone FROM users WHERE tenant_id = $1 AND role = 'owner' AND phone IS NOT NULL AND deactivated_at IS NULL ORDER BY created_at LIMIT 1),
       (SELECT phone FROM tenants WHERE id = $1)
     ) AS phone`,
    [tenantId],
  );
  return res.rows[0]?.phone || null;
}

// Fire-and-forget after the DB change has committed — a WhatsApp failure
// must never undo or block an approval/rejection.
function notifyOwner(tenantId, text) {
  ownerPhone(tenantId)
    .then((phone) => {
      if (!phone) {
        console.warn(`[super-admin] no owner phone for tenant ${tenantId} — payment notice not sent`);
        return null;
      }
      return sendReply(phone, text, tenantId);
    })
    .catch((err) => console.error('[super-admin] payment notice failed:', err.message));
}

// ── GET /needs-action — counts for the home "Needs Action" strip ──
router.get('/needs-action', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT
        (SELECT COUNT(*) FROM payment_submissions WHERE status = 'pending')::int AS pending_payments,
        (SELECT COUNT(*) FROM tenants
          WHERE subscription_period_end IS NOT NULL
            AND subscription_period_end <= NOW() + INTERVAL '30 days'
            AND subscription_status IN ('trial', 'active'))::int AS expiring_30d
    `);
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// ── GET /payments?status=pending|approved|rejected|all ──
router.get(
  '/payments',
  auditLog('view_payment_queue', (req) => ({ details: { status: req.query.status || 'pending' } })),
  async (req, res, next) => {
    try {
      const status = ['pending', 'approved', 'rejected', 'all'].includes(req.query.status) ? req.query.status : 'pending';
      const result = await query(
        `SELECT ps.*, t.name AS tenant_name, t.slug AS tenant_slug, t.subscription_status, t.subscription_plan,
                t.subscription_period_end, sa.email AS reviewed_by_email
         FROM payment_submissions ps
         JOIN tenants t ON t.id = ps.tenant_id
         LEFT JOIN super_admins sa ON sa.id = ps.reviewed_by
         WHERE ($1 = 'all' OR ps.status = $1)
         ORDER BY CASE WHEN ps.status = 'pending' THEN ps.submitted_at END ASC,
                  ps.submitted_at DESC
         LIMIT 200`,
        [status],
      );
      res.json({ payments: result.rows, status });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /payments/:id/approve — verify a transfer and activate the plan ──
// One transaction: the submission is locked, marked approved, and the
// tenant's status, plan, Agent Pack and period all change together.
router.post(
  '/payments/:id/approve',
  auditLog('approve_payment', (req, res) => ({
    targetTenantId: res.locals.auditTenantId,
    details: { payment_id: req.params.id, ...res.locals.auditDetails },
  })),
  async (req, res, next) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: { message: 'Payment not found' } });
    try {
      let outcome;
      await withTransaction(async (client) => {
        const subRes = await client.query('SELECT * FROM payment_submissions WHERE id = $1 FOR UPDATE', [req.params.id]);
        const sub = subRes.rows[0];
        if (!sub) { outcome = { status: 404, message: 'Payment not found' }; return; }
        if (sub.status !== 'pending') { outcome = { status: 409, message: `This payment was already ${sub.status}` }; return; }

        await client.query(
          `UPDATE payment_submissions SET status = 'approved', reviewed_by = $2, reviewed_at = NOW() WHERE id = $1`,
          [sub.id, req.superAdmin.id],
        );
        // Renewing early (still active, period not over) extends from the
        // current end; otherwise the new period starts now.
        const tenantRes = await client.query(
          `UPDATE tenants SET
             subscription_period_start = CASE WHEN subscription_status = 'active' AND subscription_period_end > NOW()
                                              THEN subscription_period_start ELSE NOW() END,
             subscription_period_end = CASE WHEN subscription_status = 'active' AND subscription_period_end > NOW()
                                            THEN subscription_period_end ELSE NOW() END + make_interval(months => $2::int),
             subscription_status = 'active',
             subscription_plan = $3::varchar,
             ai_agent_pack_enabled = $4::boolean,
             subscription_notes = COALESCE(subscription_notes, '') || E'\\n[' || NOW()::date || '] Payment approved: '
               || $3::varchar || ', Rs. ' || $5::text || ', ref ' || $6::text,
             updated_at = NOW()
           WHERE id = $1
           RETURNING id, name, subscription_status, subscription_plan, ai_agent_pack_enabled, subscription_period_end`,
          [sub.tenant_id, BILLING_PERIOD_MONTHS, sub.claimed_plan, sub.claimed_agent_pack, sub.claimed_amount, sub.bank_reference_number],
        );
        outcome = { status: 200, sub, tenant: tenantRes.rows[0] };
      });

      if (outcome.status !== 200) return res.status(outcome.status).json({ error: { message: outcome.message } });

      const { sub, tenant } = outcome;
      invalidateAgentPack(sub.tenant_id);
      res.locals.auditTenantId = sub.tenant_id;
      res.locals.auditDetails = { plan: sub.claimed_plan, agent_pack: sub.claimed_agent_pack, amount: sub.claimed_amount, reference: sub.bank_reference_number };

      const until = new Date(tenant.subscription_period_end).toLocaleDateString('en-PK', { timeZone: 'Asia/Karachi', dateStyle: 'medium' });
      notifyOwner(sub.tenant_id,
        `✅ Payment received — thank you!\n\nYour RestoAI ${PLANS[sub.claimed_plan].name} plan${sub.claimed_agent_pack ? ' with the AI Agent Pack' : ''} is now active until ${until}.\n\nReference: ${sub.bank_reference_number}\nAmount: Rs. ${Number(sub.claimed_amount).toLocaleString()}`);

      res.json({ payment: { ...sub, status: 'approved' }, tenant });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /payments/:id/reject — reason required; subscription untouched ──
router.post(
  '/payments/:id/reject',
  auditLog('reject_payment', (req, res) => ({
    targetTenantId: res.locals.auditTenantId,
    details: { payment_id: req.params.id, reason: req.body?.reason },
  })),
  async (req, res, next) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: { message: 'Payment not found' } });
    try {
      const parsed = rejectSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: { message: 'A reason is required to reject a payment' } });

      const result = await query(
        `UPDATE payment_submissions
         SET status = 'rejected', reviewed_by = $2, reviewed_at = NOW(), rejection_reason = $3
         WHERE id = $1 AND status = 'pending'
         RETURNING *`,
        [req.params.id, req.superAdmin.id, parsed.data.reason],
      );
      if (result.rows.length === 0) {
        const exists = await query('SELECT status FROM payment_submissions WHERE id = $1', [req.params.id]);
        return exists.rows[0]
          ? res.status(409).json({ error: { message: `This payment was already ${exists.rows[0].status}` } })
          : res.status(404).json({ error: { message: 'Payment not found' } });
      }
      const sub = result.rows[0];
      res.locals.auditTenantId = sub.tenant_id;

      notifyOwner(sub.tenant_id,
        `We couldn't verify your RestoAI payment (reference ${sub.bank_reference_number}).\n\nReason: ${parsed.data.reason}\n\nYou can fix this and resubmit from Plan & Billing in your RestoAI dashboard. Your account hasn't been changed.`);

      res.json({ payment: sub });
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /revenue — intentionally small: plan counts + verified money in ──
router.get(
  '/revenue',
  auditLog('view_revenue'),
  async (req, res, next) => {
    try {
      const monthStart = periodStartSql('month');
      const [byPlan, pack, month, pending] = await Promise.all([
        query(`SELECT COALESCE(subscription_plan, 'none') AS plan, COUNT(*)::int AS count
               FROM tenants WHERE subscription_status = 'active' GROUP BY 1 ORDER BY 1`),
        query(`SELECT COUNT(*) FILTER (WHERE ai_agent_pack_enabled)::int AS enabled,
                      COUNT(*) FILTER (WHERE ai_agent_pack_enabled AND subscription_status = 'active')::int AS enabled_active,
                      COUNT(*)::int AS tenants
               FROM tenants`),
        query(`SELECT COALESCE(SUM(claimed_amount), 0) AS total, COUNT(*)::int AS count
               FROM payment_submissions WHERE status = 'approved' AND reviewed_at >= ${monthStart}`),
        query(`SELECT COALESCE(SUM(claimed_amount), 0) AS total, COUNT(*)::int AS count
               FROM payment_submissions WHERE status = 'pending'`),
      ]);
      res.json({
        active_by_plan: byPlan.rows,
        agent_pack: pack.rows[0],
        approved_this_month: { total: parseFloat(month.rows[0].total), count: month.rows[0].count },
        pending: { total: parseFloat(pending.rows[0].total), count: pending.rows[0].count },
        month_start_tz: 'Asia/Karachi',
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /tenants/:id/agent-pack — manual toggle (support/comp cases) ──
router.post(
  '/tenants/:id/agent-pack',
  auditLog('toggle_agent_pack', (req) => ({
    targetTenantId: req.params.id,
    details: req.body,
  })),
  async (req, res, next) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: { message: 'Tenant not found' } });
    try {
      const parsed = agentPackSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: { message: 'enabled (true/false) and a reason are required' } });
      const { enabled, reason } = parsed.data;
      const result = await query(
        `UPDATE tenants
         SET ai_agent_pack_enabled = $1::boolean,
             subscription_notes = COALESCE(subscription_notes, '') || E'\\n[' || NOW()::date || '] AI Agent Pack '
               || CASE WHEN $1::boolean THEN 'enabled' ELSE 'disabled' END || ': ' || $2::text,
             updated_at = NOW()
         WHERE id = $3
         RETURNING id, name, ai_agent_pack_enabled, subscription_notes`,
        [enabled, reason, req.params.id],
      );
      if (result.rows.length === 0) return res.status(404).json({ error: { message: 'Tenant not found' } });
      invalidateAgentPack(req.params.id);
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
