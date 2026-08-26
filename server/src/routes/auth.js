import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import config from '../config.js';
import pool, { query } from '../db/pool.js';

const router = Router();

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  restaurantName: z.string().min(2),
  restaurantSlug: z.string().min(2).regex(/^[a-z0-9-]+$/),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

function signToken(user) {
  return jwt.sign(
    { id: user.id, tenant_id: user.tenant_id, role: user.role, name: user.name },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn },
  );
}

// ── POST /api/auth/register ──
// Onboards a new restaurant (tenant) + owner user in one transaction
router.post('/register', async (req, res, next) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    const data = registerSchema.parse(req.body);

    // Check slug uniqueness
    const existing = await client.query('SELECT id FROM tenants WHERE slug = $1', [data.restaurantSlug]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: { message: 'Restaurant slug already taken' } });
    }

    await client.query('BEGIN');
    transactionStarted = true;

    // Create tenant
    const tenantRes = await client.query(
      'INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING *',
      [data.restaurantName, data.restaurantSlug],
    );
    const tenant = tenantRes.rows[0];

    // Create owner user
    const passwordHash = await bcrypt.hash(data.password, 10);
    const userRes = await client.query(
      'INSERT INTO users (tenant_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role, tenant_id',
      [tenant.id, data.name, data.email, passwordHash, 'owner'],
    );
    const user = userRes.rows[0];

    // Create default branch
    await client.query(
      'INSERT INTO branches (tenant_id, name) VALUES ($1, $2)',
      [tenant.id, 'Main Branch'],
    );

    await client.query('COMMIT');

    const token = signToken(user);
    res.status(201).json({ token, user, tenant });
  } catch (err) {
    if (transactionStarted) {
      await client.query('ROLLBACK');
    }
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  } finally {
    client.release();
  }
});

// ── POST /api/auth/login ──
router.post('/login', async (req, res, next) => {
  try {
    const data = loginSchema.parse(req.body);
    const result = await query('SELECT * FROM users WHERE email = $1', [data.email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: { message: 'Invalid credentials' } });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(data.password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: { message: 'Invalid credentials' } });
    }

    const tenantRes = await query('SELECT * FROM tenants WHERE id = $1', [user.tenant_id]);
    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, tenant_id: user.tenant_id },
      tenant: tenantRes.rows[0],
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

export default router;
