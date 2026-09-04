/**
 * WhatsApp Embedded Signup (impl-30) — lets an owner connect their own
 * WhatsApp Business number via Meta's hosted Facebook Login for Business
 * flow, instead of the platform operator configuring one number per tenant
 * by hand. Requires an approved, Live Meta Tech Provider app — see the spec
 * file's dependency note; /session below returns a clear 503 if that
 * platform-level configuration isn't present yet, rather than a confusing
 * failure deeper in the flow.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, checkTenantActive } from '../middleware/auth.js';
import { query } from '../db/pool.js';
import config from '../config.js';
import { encrypt } from '../services/encryption.js';
import {
  generateWhatsAppPin, exchangeSignupCode, registerPhoneNumber, subscribeToWabaWebhooks,
  WhatsAppConnectError,
} from '../services/whatsapp-connect.js';

const router = Router();
router.use(authenticate);
router.use(checkTenantActive);

function requireOwner(req, res, next) {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: { message: 'Only the owner can manage the WhatsApp connection' } });
  }
  next();
}

// Masks all but the last 4 digits of a phone_number_id-adjacent display
// number is not meaningful (phone_number_id is an opaque Meta ID, not the
// actual phone number) — what we actually want masked for display is never
// stored here at all, so this masks the ID itself just to avoid printing a
// full internal identifier verbatim in the UI.
function maskId(id) {
  if (!id) return null;
  return id.length <= 4 ? id : `${'•'.repeat(id.length - 4)}${id.slice(-4)}`;
}

// ── GET /api/whatsapp-connect/status ──
// Owner or manager — read-only, no side effects.
router.get('/status', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT whatsapp_connection_status, whatsapp_phone_number_id, whatsapp_connected_at
       FROM tenants WHERE id = $1`,
      [req.user.tenant_id],
    );
    const row = result.rows[0];
    res.json({
      status: row.whatsapp_connection_status,
      // Only meaningful once actually connected via this flow — a tenant
      // can have a legacy, manually-configured whatsapp_phone_number_id
      // (set outside Embedded Signup, e.g. before impl-30 existed) that
      // shouldn't be shown as "connected" here just because the column is non-null.
      phone_number_id_masked: row.whatsapp_connection_status === 'connected'
        ? maskId(row.whatsapp_phone_number_id)
        : null,
      connected_at: row.whatsapp_connected_at,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/whatsapp-connect/session ──
// Owner-only. Returns the launch config the frontend SDK needs — appId and
// configId are sent to the browser by design (FB.login() requires them
// client-side); appSecret never leaves this server.
router.post('/session', requireOwner, async (req, res, next) => {
  try {
    if (!config.meta.appId || !config.meta.configId) {
      return res.status(503).json({
        error: { message: 'WhatsApp connection is not configured on this platform yet.' },
      });
    }
    res.json({ appId: config.meta.appId, configId: config.meta.configId });
  } catch (err) {
    next(err);
  }
});

const callbackSchema = z.object({
  code: z.string().min(1),
  waba_id: z.string().min(1),
  phone_number_id: z.string().min(1),
});

// ── POST /api/whatsapp-connect/callback ──
// Owner-only. tenant_id is always req.user.tenant_id — never trusted from
// the request body — so one tenant's signup session can never write to
// another tenant's whatsapp_* fields (impl-30 verification step 6).
router.post('/callback', requireOwner, async (req, res, next) => {
  const tenantId = req.user.tenant_id;
  try {
    const data = callbackSchema.parse(req.body);

    // Step 1: complete/confirm the authorization on Meta's side. Time-boxed
    // to ~30s per Meta's docs — this must run before anything else, not
    // queued or retried later.
    await exchangeSignupCode(data.code);

    // Step 2: register the number for Cloud API messaging with a
    // programmatically-generated PIN — the owner never has to invent or
    // manage this themselves.
    const pin = generateWhatsAppPin();
    await registerPhoneNumber(data.phone_number_id, pin);

    // Step 3: confirm (don't assume) the WABA is subscribed to this app's webhook.
    await subscribeToWabaWebhooks(data.waba_id);

    // Step 4: persist. Only reached if every step above succeeded.
    await query(
      `UPDATE tenants
       SET whatsapp_waba_id = $2,
           whatsapp_phone_number_id = $3,
           whatsapp_connection_status = 'connected',
           whatsapp_connected_at = NOW(),
           whatsapp_pin_encrypted = $4,
           whatsapp_connection_error = NULL
       WHERE id = $1`,
      [tenantId, data.waba_id, data.phone_number_id, encrypt(pin)],
    );

    res.json({ status: 'connected', phone_number_id_masked: maskId(data.phone_number_id) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }

    // Partial failure after the frontend signup step already succeeded —
    // per the spec, never leave the tenant looking "connected" when
    // messages won't actually flow. Detail is logged server-side only.
    const detail = err instanceof WhatsAppConnectError ? err.detail : err.message;
    console.error(`[whatsapp-connect] callback failed for tenant ${tenantId}:`, detail);
    await query(
      `UPDATE tenants SET whatsapp_connection_status = 'error', whatsapp_connection_error = $2 WHERE id = $1`,
      [tenantId, String(detail).slice(0, 2000)],
    ).catch((updateErr) => console.error('[whatsapp-connect] failed to record error status:', updateErr.message));

    next(err);
  }
});

// ── POST /api/whatsapp-connect/disconnect ──
// Owner-only. Clears local connection state only — deliberately does not
// call Meta to deregister the number (that's a separate, explicit action,
// not built here per the spec's explicit scope boundary).
router.post('/disconnect', requireOwner, async (req, res, next) => {
  try {
    await query(
      `UPDATE tenants
       SET whatsapp_waba_id = NULL,
           whatsapp_phone_number_id = NULL,
           whatsapp_connection_status = 'not_connected',
           whatsapp_connected_at = NULL,
           whatsapp_pin_encrypted = NULL,
           whatsapp_connection_error = NULL
       WHERE id = $1`,
      [req.user.tenant_id],
    );
    res.json({ status: 'not_connected' });
  } catch (err) {
    next(err);
  }
});

export default router;
