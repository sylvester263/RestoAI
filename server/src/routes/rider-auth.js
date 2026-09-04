/**
 * Rider login — phone + PIN, not email/password. Riders aren't in the
 * `users` table at all (see riders.js), so this is a structurally separate,
 * lighter-weight auth path from owner/staff (auth.js), producing a
 * rider-scoped JWT signed with a different secret (config.jwt.riderSecret)
 * so it can never be confused with an owner/staff token.
 *
 * Riders log in via a tenant-scoped link (/rider/:tenantSlug/login on the
 * client) rather than a bare phone lookup across tenants — avoids any
 * cross-tenant phone ambiguity or leakage.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import config from '../config.js';
import { query } from '../db/pool.js';

const router = Router();

// PIN brute-forcing is a real concern with a short numeric PIN — tighter
// than the general auth limiter, and keyed per phone+tenant (not just IP)
// so an attacker can't spread guesses across IPs to dodge an IP-only limit.
const riderLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `${req.body?.tenantSlug || ''}:${req.body?.phone || ''}`,
  message: { error: { message: 'Too many login attempts — try again in a few minutes' } },
});

const loginSchema = z.object({
  tenantSlug: z.string().min(1),
  phone: z.string().min(7).max(20),
  pin: z.string().min(4).max(6),
});

// ── POST /api/rider-auth/login ──
router.post('/login', riderLoginLimiter, async (req, res, next) => {
  try {
    const data = loginSchema.parse(req.body);

    const tenantRes = await query('SELECT id, subscription_status FROM tenants WHERE slug = $1', [data.tenantSlug]);
    const tenant = tenantRes.rows[0];
    // Same generic message whether the tenant, phone, or PIN was wrong —
    // never reveal which part failed.
    if (!tenant) {
      return res.status(401).json({ error: { message: 'Invalid restaurant, phone, or PIN' } });
    }

    // ── impl-29: Block login for suspended tenants ──
    if (tenant.subscription_status === 'suspended') {
      return res.status(403).json({
        error: { message: 'This account has been suspended. Please contact support.' },
      });
    }

    const riderRes = await query(
      `SELECT * FROM riders WHERE tenant_id = $1 AND phone = $2 AND status = 'active'`,
      [tenant.id, data.phone],
    );
    const rider = riderRes.rows[0];
    if (!rider || !rider.pin_hash) {
      return res.status(401).json({ error: { message: 'Invalid restaurant, phone, or PIN' } });
    }

    const valid = await bcrypt.compare(data.pin, rider.pin_hash);
    if (!valid) {
      return res.status(401).json({ error: { message: 'Invalid restaurant, phone, or PIN' } });
    }

    await query('UPDATE riders SET last_login_at = NOW() WHERE id = $1', [rider.id]);

    // Deliberately no `role`/`permissions` claims — keeps this token type
    // structurally distinct from the owner/staff JWT.
    const token = jwt.sign(
      { rider_id: rider.id, tenant_id: rider.tenant_id, branch_id: rider.branch_id, type: 'rider' },
      config.jwt.riderSecret,
      { expiresIn: config.jwt.riderExpiresIn },
    );

    res.json({ token, rider: { id: rider.id, name: rider.name, phone: rider.phone, branch_id: rider.branch_id } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

export default router;
