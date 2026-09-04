/**
 * Daily Briefing Agent (impl-14) — every morning, proactively summarize
 * yesterday's business to the tenant owner over WhatsApp, without anyone
 * asking. Reuses the existing insights SQL+summary pipeline rather than a
 * second AI integration path.
 */
import { query } from '../db/pool.js';
import { generateInsights } from './ai-agent.js';
import { sendReply } from './whatsapp.js';

const BRIEFING_QUESTION =
  "Summarize yesterday's business performance for this restaurant: total orders, revenue, any low-stock " +
  'inventory alerts, any customers who haven\'t ordered in 20+ days, and anything unusual worth flagging. ' +
  'Keep it to 4-6 short lines in a WhatsApp-message style — no markdown, no headers, just plain conversational ' +
  'text a busy owner can read in 10 seconds.';

export async function generateBriefingForTenant(tenantId) {
  return generateInsights(tenantId, BRIEFING_QUESTION);
}

/**
 * Generates and sends today's briefing for one tenant. Idempotent via the
 * agent_briefing_log unique constraint — inserting first, then sending,
 * means a duplicate-key conflict is caught before a second message ever
 * goes out.
 */
export async function sendBriefingForTenant(tenantId) {
  const tenantRes = await query('SELECT phone FROM tenants WHERE id = $1', [tenantId]);
  const phone = tenantRes.rows[0]?.phone;
  if (!phone) return { status: 'skipped', reason: 'no phone on file for this tenant' };

  // Cheap pre-check before paying for a Qwen round-trip — the INSERT below
  // is still the real race-safe guard, this just avoids wasted AI calls on
  // a plain re-run of the same day.
  const alreadySent = await query(
    'SELECT 1 FROM agent_briefing_log WHERE tenant_id = $1 AND briefing_date = CURRENT_DATE',
    [tenantId],
  );
  if (alreadySent.rows.length > 0) return { status: 'skipped', reason: 'already sent today' };

  const content = await generateBriefingForTenant(tenantId);

  try {
    await query(
      `INSERT INTO agent_briefing_log (tenant_id, briefing_date, content) VALUES ($1, CURRENT_DATE, $2)`,
      [tenantId, content],
    );
  } catch (err) {
    if (err.code === '23505') {
      return { status: 'skipped', reason: 'already sent today' };
    }
    throw err;
  }

  await sendReply(phone, content, tenantId);
  return { status: 'sent' };
}
