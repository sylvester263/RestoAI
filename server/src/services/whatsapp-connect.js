/**
 * WhatsApp Embedded Signup (impl-30) — the Graph API calls needed to turn a
 * completed frontend Facebook Login for Business flow into a working,
 * message-capable connection for one tenant.
 *
 * Token model (corrected 2026-09-21 — the original design used a shared
 * platform System User token here, which contradicts Meta's docs): a Tech
 * Provider uses per-customer *business tokens* (Business Integration System
 * User access tokens) exclusively. Meta's Embedded Signup overview: "If you
 * are a Tech Provider, you will use business tokens exclusively." The code
 * exchange below returns that token; the callback route stores it encrypted
 * per tenant (tenants.whatsapp_business_token_encrypted) and it is used for
 * register, subscribed_apps, and every outbound send (services/whatsapp.js
 * sendReply()). WHATSAPP_TOKEN (config.whatsapp.token) is now only the
 * legacy fallback for tenants that have not connected their own number.
 * Sources: developers.facebook.com/documentation/business-messaging/whatsapp/
 * embedded-signup/overview and .../embedded-signup/onboarding-customers-as-a-tech-provider
 * (Steps 2-4 there all show `Authorization: Bearer <BUSINESS_TOKEN>`).
 *
 * Meta API surface note: the code-exchange endpoint (GET /oauth/access_token
 * with client_id, client_secret, code — no redirect_uri) matches Meta's
 * current Tech Provider docs. The docs page does not document GET
 * subscribed_apps, so the read-back below is still verified only by the
 * live end-to-end test.
 */
import crypto from 'crypto';
import config from '../config.js';

const GRAPH_API_VERSION = config.whatsapp.apiVersion;
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export class WhatsAppConnectError extends Error {
  constructor(message, { status = 500, detail = null } = {}) {
    super(message);
    this.status = status;
    this.expose = true;
    this.detail = detail; // server-side-only context, never sent to the client
  }
}

/** Random 6-digit PIN, zero-padded — same shape as riders.js's generatePin(). */
export function generateWhatsAppPin() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

/**
 * Step 1 of the callback: exchange the Embedded Signup authorization code
 * for a token. Per Meta's docs the code expires ~30 seconds after the
 * frontend receives it, so this must run immediately in the callback
 * handler, not queued/retried later.
 *
 * Returns the customer's business token. The caller must use it for the
 * register and subscribed_apps calls and persist it (encrypted) for ongoing
 * sends — it is the only credential that works for this customer's WABA.
 */
export async function exchangeSignupCode(code) {
  if (!config.meta.appId || !config.meta.appSecret) {
    throw new WhatsAppConnectError('WhatsApp connection is not configured on this platform yet.', { status: 503 });
  }

  const url = new URL(`${GRAPH_BASE}/oauth/access_token`);
  url.searchParams.set('client_id', config.meta.appId);
  url.searchParams.set('client_secret', config.meta.appSecret);
  url.searchParams.set('code', code);

  const res = await fetch(url, { method: 'GET' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new WhatsAppConnectError('Could not complete the WhatsApp connection — the signup session may have expired.', {
      status: 502,
      detail: `code exchange failed (${res.status}): ${JSON.stringify(body)}`,
    });
  }
  if (typeof body.access_token !== 'string' || !body.access_token) {
    throw new WhatsAppConnectError('Could not complete the WhatsApp connection — Meta did not return an access token.', {
      status: 502,
      detail: `code exchange returned no access_token (keys: ${Object.keys(body).join(', ') || 'none'})`,
    });
  }
  return body; // { access_token, token_type, ... } — caller persists access_token encrypted
}

/**
 * Register the connected phone number for Cloud API use with a two-step
 * verification PIN. Required before the number can send/receive via the
 * Cloud API at all — Embedded Signup does not do this step automatically.
 * Authenticates with the customer's business token (see module docstring).
 */
export async function registerPhoneNumber(phoneNumberId, pin, businessToken) {
  const res = await fetch(`${GRAPH_BASE}/${phoneNumberId}/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${businessToken}`,
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success !== true) {
    throw new WhatsAppConnectError('WhatsApp connected, but the number could not be registered for messaging.', {
      status: 502,
      detail: `phone number registration failed (${res.status}): ${JSON.stringify(body)}`,
    });
  }
  return body;
}

/**
 * Subscribe this app to the WABA's webhooks (the "messages" field etc.).
 * Embedded Signup may already do this depending on flow version — per the
 * spec, don't assume it silently worked. Subscribes, then reads the
 * subscription list back to confirm this app is actually on it.
 */
export async function subscribeToWabaWebhooks(wabaId, businessToken) {
  const subscribeRes = await fetch(`${GRAPH_BASE}/${wabaId}/subscribed_apps`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${businessToken}` },
  });
  const subscribeBody = await subscribeRes.json().catch(() => ({}));
  if (!subscribeRes.ok) {
    throw new WhatsAppConnectError('WhatsApp connected, but webhook delivery could not be enabled — messages may not arrive.', {
      status: 502,
      detail: `subscribed_apps POST failed (${subscribeRes.status}): ${JSON.stringify(subscribeBody)}`,
    });
  }

  // Belt-and-suspenders: confirm this app's own ID is actually in the list,
  // rather than trusting the POST's 200 alone (per the spec's explicit
  // "do not assume it silently worked").
  const checkRes = await fetch(`${GRAPH_BASE}/${wabaId}/subscribed_apps`, {
    headers: { Authorization: `Bearer ${businessToken}` },
  });
  const checkBody = await checkRes.json().catch(() => ({}));
  const subscribed = checkRes.ok && Array.isArray(checkBody.data) &&
    checkBody.data.some((app) => String(app.whatsapp_business_api_data?.id) === String(config.meta.appId));
  if (!subscribed) {
    throw new WhatsAppConnectError('WhatsApp connected, but webhook delivery could not be confirmed — messages may not arrive.', {
      status: 502,
      detail: `app ${config.meta.appId} not present in subscribed_apps for WABA ${wabaId}: ${JSON.stringify(checkBody)}`,
    });
  }
}
