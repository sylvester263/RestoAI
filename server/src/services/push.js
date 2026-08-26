/**
 * Web Push Service — sends browser push notifications to subscribed
 * customers, in parallel with the existing WhatsApp channel (never a
 * replacement for it). No-ops quietly if VAPID keys aren't configured,
 * matching the demo-mode pattern already used for WhatsApp.
 */
import webpush from 'web-push';
import config from '../config.js';
import { query } from '../db/pool.js';

let configured = false;
if (config.vapid.publicKey && config.vapid.privateKey) {
  webpush.setVapidDetails('mailto:support@restoai.app', config.vapid.publicKey, config.vapid.privateKey);
  configured = true;
}

export async function sendPushToCustomer(customerId, payload) {
  if (!configured) {
    console.log(`[push:demo] → customer ${customerId}: ${JSON.stringify(payload)}`);
    return;
  }

  const res = await query('SELECT id, endpoint, keys FROM push_subscriptions WHERE customer_id = $1', [customerId]);
  for (const sub of res.rows) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify(payload),
      );
    } catch (err) {
      // Expired/invalid subscriptions are routine — clean them up, don't crash the caller.
      if (err.statusCode === 404 || err.statusCode === 410) {
        await query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
      } else {
        console.error('[push] send failed:', err.message);
      }
    }
  }
}
