/**
 * Staff invites (impl-23) — the owner/manager self-service path for adding
 * a manager or staff account. Owner and staff share the existing
 * users/JWT/authorize() system (see middleware/auth.js) — this router only
 * bridges "invited by email" to "activated users row"; the invitee logs in
 * afterwards through the same /api/auth/login everyone else uses.
 */
import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { authenticate, authorize } from '../middleware/auth.js';
import { query } from '../db/pool.js';
import { sendReply } from '../services/whatsapp.js';
import config from '../config.js';

const router = Router();

const INVITE_EXPIRY_DAYS = 7;

// ── GET /api/staff-invites ──
// Pending/expired invites for this tenant, so the owner can see who hasn't
// accepted yet. (Public accept below deliberately doesn't require auth.)
router.get('/', authenticate, authorize('staff.manage'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT si.id, si.email, si.phone, si.role, si.branch_id, si.status, si.expires_at, si.created_at,
              b.name as branch_name
       FROM staff_invites si
       LEFT JOIN branches b ON b.id = si.branch_id
       WHERE si.tenant_id = $1
       ORDER BY si.created_at DESC`,
      [req.user.tenant_id],
    );
    res.json({ invites: result.rows });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  email: z.string().email(),
  phone: z.string().min(7).max(20).optional(),
  role: z.enum(['manager', 'staff']),
  branch_id: z.string().uuid().optional(),
});

// ── POST /api/staff-invites ──
// Owner/manager invites a staff member by email. Sends the invite link via
// WhatsApp if a phone is given (already built, demo-mode-safe); either way
// the link is always returned in the response so the owner can share it
// directly — this environment has no email sending configured.
router.post('/', authenticate, authorize('staff.manage'), async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);

    if (data.branch_id) {
      const branchRes = await query('SELECT id FROM branches WHERE id = $1 AND tenant_id = $2', [data.branch_id, req.user.tenant_id]);
      if (branchRes.rows.length === 0) {
        return res.status(400).json({ error: { message: 'Invalid branch' } });
      }
    }

    const existingUser = await query('SELECT id FROM users WHERE email = $1', [data.email]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: { message: 'A user with this email already exists' } });
    }
    const existingInvite = await query(
      `SELECT id FROM staff_invites WHERE tenant_id = $1 AND email = $2 AND status = 'pending'`,
      [req.user.tenant_id, data.email],
    );
    if (existingInvite.rows.length > 0) {
      return res.status(409).json({ error: { message: 'An invite is already pending for this email' } });
    }

    const inviteToken = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const result = await query(
      `INSERT INTO staff_invites (tenant_id, email, phone, role, branch_id, invite_token, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.user.tenant_id, data.email, data.phone || null, data.role, data.branch_id || null, inviteToken, expiresAt, req.user.id],
    );
    const invite = result.rows[0];

    const inviteLink = `${config.appUrl}/invite/${inviteToken}`;

    if (data.phone) {
      const tenantRes = await query('SELECT name FROM tenants WHERE id = $1', [req.user.tenant_id]);
      const tenantName = tenantRes.rows[0]?.name || 'your team';
      sendReply(data.phone, `You've been invited to join ${tenantName} on RestoAI as ${data.role}. Set up your account: ${inviteLink}`)
        .catch((err) => console.error('[staff-invites] whatsapp send failed:', err.message));
    }

    res.status(201).json({ invite: { ...invite, invite_link: inviteLink } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

const acceptSchema = z.object({
  name: z.string().min(2),
  password: z.string().min(6),
});

// ── POST /api/staff-invites/:token/accept ──
// Public, token-gated. The invitee sets their name/password and their
// `users` row is created — from then on they log in via /api/auth/login
// exactly like the owner.
router.post('/:token/accept', async (req, res, next) => {
  try {
    const data = acceptSchema.parse(req.body);

    const inviteRes = await query('SELECT * FROM staff_invites WHERE invite_token = $1', [req.params.token]);
    const invite = inviteRes.rows[0];
    if (!invite) {
      return res.status(404).json({ error: { message: 'Invite not found' } });
    }
    if (invite.status !== 'pending') {
      return res.status(400).json({ error: { message: `This invite has already been ${invite.status}` } });
    }
    if (new Date(invite.expires_at) < new Date()) {
      await query(`UPDATE staff_invites SET status = 'expired' WHERE id = $1`, [invite.id]);
      return res.status(400).json({ error: { message: 'This invite has expired — ask the owner to send a new one' } });
    }

    const existingUser = await query('SELECT id FROM users WHERE email = $1', [invite.email]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: { message: 'A user with this email already exists' } });
    }

    const passwordHash = await bcrypt.hash(data.password, 10);
    const userRes = await query(
      `INSERT INTO users (tenant_id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role, tenant_id`,
      [invite.tenant_id, data.name, invite.email, passwordHash, invite.role],
    );
    // impl-25: a manager/staff invited to a specific branch starts with
    // access to exactly that branch (hard-locked by default otherwise —
    // see migrate.js's user_branch_access seeding note).
    if (invite.branch_id) {
      await query(
        `INSERT INTO user_branch_access (user_id, branch_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userRes.rows[0].id, invite.branch_id],
      );
    }
    await query(`UPDATE staff_invites SET status = 'accepted' WHERE id = $1`, [invite.id]);

    res.status(201).json({ user: userRes.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

export default router;
