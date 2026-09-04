/**
 * WhatsApp Embedded Signup (impl-30) — the Graph API calls needed to turn a
 * completed frontend Facebook Login for Business flow into a working,
 * message-capable connection for one tenant.
 *
 * Key architectural point (per the spec — do not relitigate this): under
 * the Tech Provider delegated-access model, WHATSAPP_TOKEN
 * (config.whatsapp.token) is a single platform-level System User token that
 * every tenant's Embedded Signup implicitly grants access to. It is NOT
 * exchanged per tenant and nothing here stores a per-tenant token — only
 * per-tenant IDs (waba_id, phone_number_id) vary. See services/whatsapp.js's
 * sendReply() for the other half of this: outbound sends now resolve
 * phone_number_id per tenant instead of assuming one global number.
 *
 * Meta API surface note: the register and subscribed_apps endpoints below
 * are implemented against the documented Cloud API shape as of
 * implementation time. The exact code-exchange endpoint and the
 * subscribed_apps write behavior are the two details most likely to have
 * drifted by the time this runs against a real Live app — re-confirm both
 * against https://developers.facebook.com/docs/whatsapp/embedded-signup/
 * before relying on this against production traffic, per the spec's own
 * caution on this exact point.
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
 * The resulting token is intentionally NOT returned to the caller for
 * storage — per the architectural note above, ongoing API calls use the
 * durable platform System User token (config.whatsapp.token), not this
 * short-lived exchange result. This call still matters: it's the step that
 * completes/confirms the authorization on Meta's side for this specific
 * signup session.
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
  return body; // { access_token, token_type, expires_in } — not persisted, see docstring
}

/**
 * Register the connected phone number for Cloud API use with a two-step
 * verification PIN. Required before the number can send/receive via the
 * Cloud API at all — Embedded Signup does not do this step automatically.
 * Uses the platform System User token, not a per-tenant token (see module docstring).
 */
export async function registerPhoneNumber(phoneNumberId, pin) {
  const res = await fetch(`${GRAPH_BASE}/${phoneNumberId}/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.whatsapp.token}`,
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
export async function subscribeToWabaWebhooks(wabaId) {
  const subscribeRes = await fetch(`${GRAPH_BASE}/${wabaId}/subscribed_apps`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.whatsapp.token}` },
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
    headers: { Authorization: `Bearer ${config.whatsapp.token}` },
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
