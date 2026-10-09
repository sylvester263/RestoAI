/**
 * Offline POS, Level 1 (impl-33 Part 4) — everything a till needs to keep
 * selling without a connection and to catch up afterwards:
 *
 *  - devices + bill-number blocks: each device leases a block of numbers per
 *    branch (atomic counter, never reused), so bills made offline on two
 *    devices can't collide. Unused numbers in a block are skipped — gaps in
 *    the bill sequence are expected and are NOT missing bills.
 *  - snapshot: menu (incl. sold-out items), prices, tables, tax rate — what the
 *    device stores so it can ring up sales offline.
 *  - enroll/refresh: after a full online sign-in, a cashier with a POS PIN
 *    gets a POS-scoped token (allowlisted till endpoints only; see
 *    middleware/auth.js). The PIN itself never leaves the server; the device
 *    keeps its own PBKDF2 hash, made from the PIN typed on the device.
 *  - sync: one queued action per request, in the device's order. Replays are
 *    idempotent (services/pos-tabs.js). Anything the server shouldn't accept
 *    on its own — removed staff, suspended tenant, POS module off, shift no
 *    longer open — goes to pos_sync_review for a manager, never applied
 *    silently and never dropped.
 *  - review: the manager's queue of those items.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import config from '../config.js';
import { query, withTransaction } from '../db/pool.js';
import { authenticate, checkTenantActive, posPinStillValid } from '../middleware/auth.js';
import { requireModule, isModuleEnabled } from '../services/modules.js';
import { getTaxConfig, findOpenShift } from '../services/pos-billing.js';
import { OrderError } from '../services/orders.js';
import { openTab, addItems, settleTab, loadTabByClientId, PosError, SyncReview } from '../services/pos-tabs.js';
import { scheduleFiscal } from '../services/fiscal.js';
import { emit } from '../services/event-bus.js';
import { posAudit } from '../services/pos-audit.js';

const router = Router();

export const BILL_BLOCK_SIZE = 500;
const POS_TOKEN_TTL = '30d';

const staffAuth = [authenticate, checkTenantActive, requireModule('pos')];

function requireFullSession(req, res, next) {
  if (req.user.scope === 'pos') {
    return res.status(403).json({ error: { message: 'Sign in fully to do this — a PIN session can only sell.', code: 'pos_session_limited' } });
  }
  next();
}
function requireManagerOrOwner(req, res, next) {
  if (req.user.role !== 'owner' && req.user.role !== 'manager') {
    return res.status(403).json({ error: { message: 'Only a manager or owner can do this' } });
  }
  next();
}

function signPosToken(user, deviceId, pinSetAt) {
  return jwt.sign(
    { id: user.id, tenant_id: user.tenant_id, role: user.role, name: user.name, scope: 'pos', device_id: deviceId, pv: new Date(pinSetAt).toISOString() },
    config.jwt.secret,
    { expiresIn: POS_TOKEN_TTL },
  );
}

async function deviceForTenant(deviceId, tenantId) {
  const res = await query('SELECT * FROM pos_devices WHERE id = $1', [deviceId]);
  const device = res.rows[0];
  if (!device || device.tenant_id !== tenantId) return null;
  return device;
}

async function branchForTenant(branchId, tenantId) {
  const res = await query('SELECT id, name FROM branches WHERE id = $1 AND tenant_id = $2', [branchId, tenantId]);
  return res.rows[0] || null;
}

// ── GET /api/pos-offline/ping ── reachability check for the till (no data)
router.get('/ping', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, time: new Date().toISOString() });
});

// ── POST /api/pos-offline/devices/register ──
const registerSchema = z.object({
  device_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  label: z.string().trim().max(100).optional(),
  // How many sales are still in this device's outbox (read by shift close).
  pending_count: z.number().int().min(0).optional(),
});
router.post('/devices/register', ...staffAuth, async (req, res, next) => {
  try {
    const data = registerSchema.parse(req.body);
    if (!(await branchForTenant(data.branch_id, req.user.tenant_id))) return res.status(400).json({ error: { message: 'Invalid branch' } });
    const result = await query(
      `INSERT INTO pos_devices (id, tenant_id, branch_id, label, registered_by, last_user_id, last_seen_at, pending_count, pending_reported_at)
       VALUES ($1, $2, $3, $4, $5, $5, NOW(), COALESCE($6, 0), CASE WHEN $6::int IS NULL THEN NULL ELSE NOW() END)
       ON CONFLICT (id) DO UPDATE SET branch_id = EXCLUDED.branch_id, label = COALESCE(EXCLUDED.label, pos_devices.label),
         last_user_id = EXCLUDED.last_user_id, last_seen_at = NOW(),
         pending_count = CASE WHEN $6::int IS NULL THEN pos_devices.pending_count ELSE $6 END,
         pending_reported_at = CASE WHEN $6::int IS NULL THEN pos_devices.pending_reported_at ELSE NOW() END
       WHERE pos_devices.tenant_id = EXCLUDED.tenant_id
       RETURNING *`,
      [data.device_id, req.user.tenant_id, data.branch_id, data.label || null, req.user.id, data.pending_count ?? null],
    );
    if (result.rows.length === 0) return res.status(409).json({ error: { message: 'This device id belongs to another restaurant' } });
    res.json({ device: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: { message: err.errors[0].message } });
    next(err);
  }
});

// ── POST /api/pos-offline/devices/lease ── a fresh block of bill numbers
const leaseLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, keyGenerator: (req) => req.body?.device_id || req.ip });
const leaseSchema = z.object({ device_id: z.string().uuid(), branch_id: z.string().uuid() });
router.post('/devices/lease', leaseLimiter, ...staffAuth, async (req, res, next) => {
  try {
    const data = leaseSchema.parse(req.body);
    const device = await deviceForTenant(data.device_id, req.user.tenant_id);
    if (!device) return res.status(404).json({ error: { message: 'Register this device first' } });
    if (!(await branchForTenant(data.branch_id, req.user.tenant_id))) return res.status(400).json({ error: { message: 'Invalid branch' } });

    // The upsert row-locks the branch counter, so concurrent leases (two
    // devices, or two tabs of one device) get consecutive, disjoint blocks.
    const block = await withTransaction(async (client) => {
      const counter = await client.query(
        `INSERT INTO pos_bill_counters (branch_id, tenant_id, next_number) VALUES ($1, $2, 1 + $3)
         ON CONFLICT (branch_id) DO UPDATE SET next_number = pos_bill_counters.next_number + $3
         RETURNING next_number - $3 AS range_start`,
        [data.branch_id, req.user.tenant_id, BILL_BLOCK_SIZE],
      );
      const start = Number(counter.rows[0].range_start);
      const inserted = await client.query(
        `INSERT INTO pos_bill_blocks (tenant_id, branch_id, device_id, range_start, range_end, leased_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [req.user.tenant_id, data.branch_id, data.device_id, start, start + BILL_BLOCK_SIZE - 1, req.user.id],
      );
      return inserted.rows[0];
    });
    res.status(201).json({ block: { ...block, range_start: Number(block.range_start), range_end: Number(block.range_end) } });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: { message: err.errors[0].message } });
    next(err);
  }
});

// ── GET /api/pos-offline/devices/:id ── device + its blocks (settings screen)
router.get('/devices/:id', ...staffAuth, async (req, res, next) => {
  try {
    if (!z.string().uuid().safeParse(req.params.id).success) return res.status(404).json({ error: { message: 'Device not found' } });
    const device = await deviceForTenant(req.params.id, req.user.tenant_id);
    if (!device) return res.status(404).json({ error: { message: 'Device not found' } });
    const blocks = await query(
      `SELECT bb.id, bb.branch_id, b.name AS branch_name, bb.range_start, bb.range_end, bb.leased_at,
              (SELECT MAX(bill_number) FROM pos_tabs pt WHERE pt.device_id = bb.device_id AND pt.branch_id = bb.branch_id
                 AND pt.bill_number BETWEEN bb.range_start AND bb.range_end) AS highest_synced
       FROM pos_bill_blocks bb JOIN branches b ON b.id = bb.branch_id
       WHERE bb.device_id = $1 ORDER BY bb.range_start`,
      [device.id],
    );
    res.json({ device, blocks: blocks.rows });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/pos-offline/snapshot?branch_id= ──
router.get('/snapshot', ...staffAuth, async (req, res, next) => {
  try {
    const branch = req.query.branch_id ? await branchForTenant(req.query.branch_id, req.user.tenant_id) : null;
    if (!branch) return res.status(400).json({ error: { message: 'branch_id is required' } });
    const [items, tables, tax, shift] = await Promise.all([
      query(
        `SELECT mi.id, mi.name, mi.name_urdu, mi.price, mi.is_available, mi.category_id,
                mc.name AS category_name, mc.sort_order
         FROM menu_items mi LEFT JOIN menu_categories mc ON mc.id = mi.category_id
         WHERE mi.tenant_id = $1 AND (mi.branch_id = $2 OR mi.branch_id IS NULL)
         ORDER BY mc.sort_order NULLS LAST, mi.name`,
        [req.user.tenant_id, branch.id],
      ),
      query('SELECT id, table_number FROM restaurant_tables WHERE tenant_id = $1 AND branch_id = $2 ORDER BY table_number', [req.user.tenant_id, branch.id]),
      getTaxConfig(branch.id),
      findOpenShift(req.user.tenant_id, branch.id, req.user.id),
    ]);
    res.json({
      snapshot_at: new Date().toISOString(),
      branch,
      items: items.rows,
      tables: tables.rows,
      tax: { authority: tax.tax_authority, rate: parseFloat(tax.tax_rate) || 0, registration_number: tax.tax_registration_number },
      shift,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/pos-offline/enroll ── PIN check → POS-scoped token
const enrollLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.headers.authorization || req.ip,
  message: { error: { message: 'Too many PIN attempts — try again in a few minutes' } },
});
const enrollSchema = z.object({ pin: z.string().regex(/^\d{4,6}$/), device_id: z.string().uuid() });
router.post('/enroll', enrollLimiter, ...staffAuth, requireFullSession, async (req, res, next) => {
  try {
    const data = enrollSchema.parse(req.body);
    const device = await deviceForTenant(data.device_id, req.user.tenant_id);
    if (!device) return res.status(404).json({ error: { message: 'Register this device first' } });
    const userRes = await query('SELECT id, tenant_id, role, name, pos_pin_hash, pos_pin_set_at FROM users WHERE id = $1 AND tenant_id = $2', [req.user.id, req.user.tenant_id]);
    const user = userRes.rows[0];
    if (!user?.pos_pin_hash) return res.status(400).json({ error: { message: 'You have no POS PIN yet. Ask a manager to set one on the Staff page.', code: 'no_pin' } });
    if (!(await bcrypt.compare(data.pin, user.pos_pin_hash))) return res.status(401).json({ error: { message: 'Wrong PIN', code: 'wrong_pin' } });
    const token = signPosToken(user, device.id, user.pos_pin_set_at);
    res.json({ pos_token: token, expires_at: new Date(jwt.decode(token).exp * 1000).toISOString(), user: { id: user.id, name: user.name, role: user.role } });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: { message: 'PIN must be 4 to 6 digits' } });
    next(err);
  }
});

// ── POST /api/pos-offline/refresh ── renew a PIN-session token while online
router.post('/refresh', ...staffAuth, async (req, res, next) => {
  try {
    const deviceId = req.user.device_id || req.body?.device_id;
    if (!deviceId || !(await deviceForTenant(deviceId, req.user.tenant_id))) return res.status(404).json({ error: { message: 'Device not found' } });
    const userRes = await query('SELECT id, tenant_id, role, name, pos_pin_hash, pos_pin_set_at FROM users WHERE id = $1 AND tenant_id = $2', [req.user.id, req.user.tenant_id]);
    const user = userRes.rows[0];
    if (!user?.pos_pin_hash) return res.status(400).json({ error: { message: 'No POS PIN set', code: 'no_pin' } });
    const token = signPosToken(user, deviceId, user.pos_pin_set_at);
    res.json({ pos_token: token, expires_at: new Date(jwt.decode(token).exp * 1000).toISOString() });
  } catch (err) {
    next(err);
  }
});

// ══ Sync ══

/**
 * Sync authenticates the token's signature and expiry but deliberately does
 * NOT reject a removed user or a suspended tenant the way authenticate()
 * does: their queued sales still happened and must reach a manager.
 * Those cases are recorded as problems and the action goes to review.
 */
async function authenticateForSync(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: { message: 'Authentication required' } });
  let decoded;
  try {
    decoded = jwt.verify(header.slice(7), config.jwt.secret);
  } catch {
    return res.status(401).json({ error: { message: 'Invalid or expired token', code: 'token_expired' } });
  }
  try {
    const userRes = await query('SELECT id, tenant_id, role, name, deactivated_at FROM users WHERE id = $1 AND tenant_id = $2', [decoded.id, decoded.tenant_id]);
    const tokenUser = userRes.rows[0];
    if (!tokenUser) return res.status(401).json({ error: { message: 'Invalid or expired token' } });

    // Relay: a manager/owner signed in on the device may send a cashier's
    // queued actions (the cashier has left, or was removed and their session
    // cut off). The actions stay the cashier's and every rule is applied to
    // the cashier — a removed cashier's sales still go to review.
    let user = tokenUser;
    const actorId = req.body?.actor_user_id;
    if (actorId && actorId !== tokenUser.id) {
      if (tokenUser.deactivated_at || (tokenUser.role !== 'owner' && tokenUser.role !== 'manager')) {
        return res.status(403).json({ status: 'retry', error: { message: 'Only a manager or owner can sync another cashier\'s sales', code: 'relay_not_allowed' } });
      }
      if (!z.string().uuid().safeParse(actorId).success) return res.status(400).json({ status: 'rejected', error: { message: 'Invalid actor' } });
      const actorRes = await query('SELECT id, tenant_id, role, name, deactivated_at FROM users WHERE id = $1 AND tenant_id = $2', [actorId, tokenUser.tenant_id]);
      if (!actorRes.rows[0]) return res.status(400).json({ status: 'rejected', error: { message: 'That cashier is not part of this restaurant' } });
      user = actorRes.rows[0];
      req.relayedBy = tokenUser.id;
    }
    const tenantRes = await query('SELECT subscription_status FROM tenants WHERE id = $1', [user.tenant_id]);
    const problems = [];
    if (user.deactivated_at) problems.push('user_deactivated');
    if (tenantRes.rows[0]?.subscription_status === 'suspended') problems.push('tenant_suspended');
    if (!(await isModuleEnabled(user.tenant_id, 'pos'))) problems.push('module_disabled');
    req.user = { id: user.id, tenant_id: user.tenant_id, role: user.role, name: user.name, scope: decoded.scope };
    req.syncProblems = problems;
    req.pinChanged = decoded.scope === 'pos' && !(await posPinStillValid(decoded));
    next();
  } catch (err) {
    next(err);
  }
}

const lineSchema = z.object({
  menu_item_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(50),
  charged_unit_price: z.number().nonnegative().optional(),
});
const syncSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('open_tab'),
    payload: z.object({
      order_type: z.enum(['counter', 'dine_in', 'phone']),
      branch_id: z.string().uuid(),
      table_id: z.string().uuid().optional(),
      customer_name: z.string().max(255).optional(),
      customer_phone: z.string().max(20).optional(),
      bill_number: z.number().int().positive(),
    }),
  }),
  z.object({
    type: z.literal('add_items'),
    payload: z.object({ items: z.array(lineSchema).min(1), notes: z.string().max(500).optional() }),
  }),
  z.object({
    type: z.literal('settle'),
    payload: z.object({ payment_method: z.literal('cash'), client_total: z.number().optional() }),
  }),
]);
const envelopeSchema = z.object({
  client_request_id: z.string().uuid(),
  device_id: z.string().uuid(),
  tab_client_id: z.string().uuid(),
  created_at: z.string().max(40),
  snapshot_at: z.string().max(40).optional(),
  pending_count: z.number().int().min(0).optional(),
  actor_user_id: z.string().uuid().optional(),
});

async function flagForReview(req, env, action, reason) {
  await query(
    `INSERT INTO pos_sync_review (tenant_id, device_id, user_id, client_request_id, action_type, tab_client_id, payload, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (tenant_id, client_request_id) DO NOTHING`,
    [req.user.tenant_id, env.device_id, req.user.id, env.client_request_id, action.type, env.tab_client_id,
      { ...action.payload, created_at: env.created_at, snapshot_at: env.snapshot_at || null, ...(req.relayedBy && { relayed_by: req.relayedBy }) }, reason],
  );
  const tab = await loadTabByClientId(req.user.tenant_id, env.tab_client_id);
  if (tab) {
    await query(`UPDATE pos_tabs SET sync_flags = ARRAY(SELECT DISTINCT unnest(sync_flags || ARRAY['needs_review'])) WHERE id = $1`, [tab.id]);
  }
}

// ── POST /api/pos-offline/sync ── one queued offline action
const syncLimiter = rateLimit({ windowMs: 60 * 1000, max: 300, keyGenerator: (req) => req.body?.device_id || req.ip });
router.post('/sync', syncLimiter, authenticateForSync, async (req, res, next) => {
  let env;
  let action;
  try {
    env = envelopeSchema.parse(req.body);
    action = syncSchema.parse(req.body);
  } catch (err) {
    return res.status(400).json({ status: 'rejected', error: { message: err.errors?.[0]?.message || 'Invalid sync action' } });
  }
  try {
    const tenantId = req.user.tenant_id;
    const device = await deviceForTenant(env.device_id, tenantId);
    if (!device) return res.status(400).json({ status: 'rejected', error: { message: 'Unknown device — register it while online first', code: 'unknown_device' } });
    await query(
      `UPDATE pos_devices SET last_seen_at = NOW(), last_user_id = $2,
              pending_count = COALESCE($3, pending_count), pending_reported_at = CASE WHEN $3::int IS NULL THEN pending_reported_at ELSE NOW() END
       WHERE id = $1`,
      [device.id, req.user.id, env.pending_count ?? null],
    );
    const meta = { pin_changed: req.pinChanged };

    // Already held for review (a replay of a flagged action) — same answer.
    const held = await query('SELECT reason FROM pos_sync_review WHERE tenant_id = $1 AND client_request_id = $2', [tenantId, env.client_request_id]);
    if (held.rows[0]) return res.json({ status: 'flagged', reason: held.rows[0].reason, ...meta });

    if (req.syncProblems.length > 0) {
      await flagForReview(req, env, action, req.syncProblems[0]);
      return res.json({ status: 'flagged', reason: req.syncProblems[0], ...meta });
    }
    // Later actions on a bill whose opening is under review follow it there.
    if (action.type !== 'open_tab') {
      const tabHeld = await query(
        `SELECT 1 FROM pos_sync_review WHERE tenant_id = $1 AND tab_client_id = $2 AND status = 'pending_review' LIMIT 1`,
        [tenantId, env.tab_client_id],
      );
      if (tabHeld.rows.length > 0) {
        await flagForReview(req, env, action, 'bill_under_review');
        return res.json({ status: 'flagged', reason: 'bill_under_review', ...meta });
      }
    }

    const user = req.user;
    if (req.relayedBy) {
      await posAudit(tenantId, req.relayedBy, 'offline_action_relayed', { actor_user_id: user.id, type: action.type, client_request_id: env.client_request_id });
    }
    if (action.type === 'open_tab') {
      if (env.client_request_id !== env.tab_client_id) {
        return res.status(400).json({ status: 'rejected', error: { message: 'open_tab must use the bill id as its request id' } });
      }
      const { tab, replay } = await openTab({
        tenantId, user, data: action.payload, clientRequestId: env.tab_client_id, deviceId: device.id,
        billNumber: action.payload.bill_number, offline: true, actionTime: env.created_at,
      });
      if (!replay) emit(`pos:${tab.branch_id}`, 'tab:updated', { tabId: tab.id });
      return res.json({ status: replay ? 'duplicate' : 'applied', tab_id: tab.id, bill_number: Number(tab.bill_number), ...meta });
    }

    const tab = await loadTabByClientId(tenantId, env.tab_client_id);
    if (!tab) {
      // Out of order: the bill's opening hasn't synced yet. The device retries.
      return res.status(409).json({ status: 'retry', error: { message: 'This bill has not been opened on the server yet', code: 'tab_not_synced' } });
    }

    if (action.type === 'add_items') {
      const { order, replay, flags } = await addItems({
        tenantId, user, tab, items: action.payload.items, notes: action.payload.notes,
        clientRequestId: env.client_request_id, offline: true, snapshotAt: env.snapshot_at, actionTime: env.created_at,
      });
      if (!replay) {
        emit(`kitchen:${tenantId}`, 'order:new', { orderId: order.id, tabId: tab.id });
        emit(`pos:${tab.branch_id}`, 'tab:updated', { tabId: tab.id });
      }
      return res.json({ status: replay ? 'duplicate' : 'applied', tab_id: tab.id, order_id: order.id, order_total: parseFloat(order.total), flags, ...meta });
    }

    // settle — cash only, total recomputed by the server
    const { result, replay } = await settleTab({
      tenantId, tabId: tab.id, data: action.payload, clientRequestId: env.client_request_id, offline: true, issuedOffline: true, actionTime: env.created_at,
    });
    if (!replay) {
      emit(`pos:${result.tab.branch_id}`, 'tab:settled', { tabId: tab.id });
      emit(`kitchen:${tenantId}`, 'order:settled', { tabId: tab.id });
    }
    // impl-33: report the invoice right after the sync — also on a replay, in
    // case the first attempt's response (or the server) was lost before it ran.
    // Never blocks or undoes the sale; a failure is left for the retry sweep.
    scheduleFiscal(result.tab, tenantId);
    return res.json({
      status: replay ? 'duplicate' : 'applied',
      tab_id: tab.id,
      primary_order_id: result.primary_order_id,
      total: result.total,
      sync_flags: result.tab.sync_flags,
      ...meta,
    });
  } catch (err) {
    if (err instanceof SyncReview) {
      await flagForReview(req, env, action, err.reason);
      return res.json({ status: 'flagged', reason: err.reason, message: err.message });
    }
    if (err instanceof PosError || err instanceof OrderError) {
      return res.status(err.status).json({ status: 'rejected', error: { message: err.message, code: err.code } });
    }
    next(err);
  }
});

// ══ Manager review ══

router.get('/review', ...staffAuth, requireFullSession, requireManagerOrOwner, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT r.*, u.name AS user_name, d.label AS device_label
       FROM pos_sync_review r
       LEFT JOIN users u ON u.id = r.user_id
       LEFT JOIN pos_devices d ON d.id = r.device_id
       WHERE r.tenant_id = $1 AND r.status = $2
       ORDER BY r.created_at`,
      [req.user.tenant_id, req.query.status === 'resolved' ? 'resolved' : 'pending_review'],
    );
    res.json({ items: result.rows });
  } catch (err) {
    next(err);
  }
});

const resolveSchema = z.object({ note: z.string().trim().min(1).max(500) });
router.post('/review/:id/resolve', ...staffAuth, requireFullSession, requireManagerOrOwner, async (req, res, next) => {
  try {
    if (!z.string().uuid().safeParse(req.params.id).success) return res.status(404).json({ error: { message: 'Not found' } });
    const { note } = resolveSchema.parse(req.body);
    const result = await query(
      `UPDATE pos_sync_review SET status = 'resolved', resolution_note = $3, reviewed_by = $4, reviewed_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND status = 'pending_review' RETURNING *`,
      [req.params.id, req.user.tenant_id, note, req.user.id],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: { message: 'Not found or already resolved' } });
    await posAudit(req.user.tenant_id, req.user.id, 'offline_review_resolved', { review_id: req.params.id, reason: result.rows[0].reason, note });
    res.json({ item: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: { message: 'A note is required' } });
    next(err);
  }
});

export default router;
