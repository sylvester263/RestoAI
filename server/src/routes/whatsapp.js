import { Router } from 'express';
import crypto from 'crypto';
import config from '../config.js';
import { query } from '../db/pool.js';
import { processWhatsAppMessage } from '../services/whatsapp.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Verifies Meta's X-Hub-Signature-256 HMAC over the raw request body.
// Fails closed: if the app secret isn't configured, or the header is missing
// or doesn't match, the request is rejected rather than processed unverified.
function verifyMetaSignature(req, res, next) {
  const signature = req.headers['x-hub-signature-256'];
  const secret = config.whatsapp.appSecret;

  if (!secret || typeof signature !== 'string' || !signature.startsWith('sha256=')) {
    return res.status(403).json({ error: { message: 'Signature verification failed' } });
  }

  const expected = crypto.createHmac('sha256', secret).update(req.rawBody || Buffer.alloc(0)).digest('hex');
  const provided = signature.slice('sha256='.length);
  const expectedBuf = Buffer.from(expected, 'hex');
  const providedBuf = Buffer.from(provided, 'hex');

  if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    return res.status(403).json({ error: { message: 'Signature verification failed' } });
  }
  next();
}

// ── GET /api/whatsapp/webhook ──
// Webhook verification (Meta sends a GET request to verify your endpoint)
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    console.log('[whatsapp] webhook verified');
    return res.status(200).send(challenge);
  }
  return res.status(403).json({ error: 'Verification failed' });
});

// ── POST /api/whatsapp/webhook ──
// Receives incoming WhatsApp messages and dispatches to the order agent
router.post('/webhook', verifyMetaSignature, async (req, res, next) => {
  try {
    const body = req.body;

    // Only process messages (ignore other webhook events)
    if (body.object !== 'whatsapp_business_account') {
      return res.status(200).send('OK');
    }

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;

        const phoneNumberId = change.value?.metadata?.phone_number_id;
        const messages = change.value?.messages || [];
        if (messages.length === 0) continue;

        if (!phoneNumberId) {
          console.error('[whatsapp] webhook payload missing phone_number_id — cannot route, dropping messages');
          continue;
        }

        // Resolve tenant strictly by which WhatsApp number received the message —
        // never fall back to "first tenant in table".
        const tenantRes = await query(
          'SELECT id FROM tenants WHERE whatsapp_phone_number_id = $1',
          [phoneNumberId],
        );
        if (tenantRes.rows.length === 0) {
          console.error(`[whatsapp] no tenant mapped to phone_number_id=${phoneNumberId} — dropping message`);
          continue;
        }
        const tenantId = tenantRes.rows[0].id;

        for (const msg of messages) {
          await processWhatsAppMessage(tenantId, msg);
        }
      }
    }

    // Meta requires 200 response within 20 seconds
    res.status(200).send('OK');
  } catch (err) {
    console.error('[whatsapp] webhook error:', err);
    // Still return 200 to Meta to avoid retries
    res.status(200).send('OK');
  }
});

// ── POST /api/whatsapp/simulate ──
// Dev-only endpoint to simulate a WhatsApp message without needing the real API.
// Requires auth; always uses the caller's own tenant regardless of what the
// request body claims, and is disabled entirely in production.
router.post('/simulate', authenticate, (req, res, next) => {
  if (config.nodeEnv === 'production') {
    return res.status(404).end();
  }
  return next();
}, async (req, res, next) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ error: { message: 'phone and message are required' } });
    }

    // Tenant is always derived from the authenticated caller's JWT — any
    // tenant_id passed in the request body is ignored.
    const tenantId = req.user.tenant_id;

    const simulatedMsg = {
      from: phone,
      type: 'text',
      text: { body: message },
      timestamp: Math.floor(Date.now() / 1000).toString(),
    };

    const reply = await processWhatsAppMessage(tenantId, simulatedMsg);
    res.json({ reply });
  } catch (err) {
    next(err);
  }
});

export default router;
