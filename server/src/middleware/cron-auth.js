/**
 * Guards scheduler-triggered endpoints (the /api/agents "run" routes) that
 * have no logged-in user to authenticate — a shared secret header stands
 * in for a JWT, same class of concern as the WhatsApp webhook's HMAC check.
 */
import config from '../config.js';

// Accepts either a plain X-Cron-Secret header (manual/demo trigger, matches
// the impl-14..21 spec) or `Authorization: Bearer <secret>` — Vercel Cron
// automatically sends the latter, populated from the project's CRON_SECRET
// env var, when it invokes a scheduled path with a GET request.
export function requireCronSecret(req, res, next) {
  const headerSecret = req.headers['x-cron-secret'];
  const authHeader = req.headers.authorization;
  const bearerSecret = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const provided = headerSecret || bearerSecret;

  if (!provided || provided !== config.cronSecret) {
    return res.status(401).json({ error: { message: 'Unauthorized' } });
  }
  next();
}
