/**
 * Owner WhatsApp Business Assistant (impl-28) — two-way conversational
 * assistant for the restaurant owner/manager. Text your own WhatsApp number
 * and get real, data-grounded answers about your business.
 *
 * Design principles (from spec):
 * - Routing check FIRST: a verified users.phone lookup (scoped to the tenant
 *   that owns the receiving WhatsApp number) distinguishes owner/manager
 *   messages from customer messages BEFORE any intent classification runs.
 * - Reuses generateInsights directly for data questions — no NL-to-SQL
 *   reimplementation.
 * - "What needs attention" aggregates the 4 agent flag/suggestion tables.
 * - Branch-access scoping: a manager's WhatsApp answers are scoped to only
 *   their assigned branch(es), matching the dashboard access controls.
 * - Rate limiting: generous (60/hour) but catches runaway loops.
 * - Every number in a reply is traceable to a real query result.
 *
 * Reuses existing shared logic:
 * - generateInsights from ai-agent.js (same engine behind /api/insights/query)
 * - generateAgentText from ai-agent.js for Qwen phrasing
 * - sendReply from whatsapp.js for outbound WhatsApp delivery
 */
import { query } from '../db/pool.js';
import { generateInsights, generateAgentText } from './ai-agent.js';
import { sendReply } from './whatsapp.js';

// ── Rate limiting (in-memory, per-owner) ──
// Generous cap: 60/hour. Normal owner usage (a few messages per day) will
// never hit this. It catches runaway loops or accidental spam, not real use.
const rateLimitMap = new Map(); // userId -> { count, windowStart }
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 60;

function checkRateLimit(userId) {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(userId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// ── Deterministic message classification ──
// These run BEFORE any AI call — fast, predictable, auditable.

const ATTENTION_KEYWORDS = [
  'attention', 'needs attention', 'what needs', 'flagged', 'flags', 'alerts',
  'issues', 'problems', 'overview', 'status', 'anything wrong', 'kya haal',
  'kya zaroorat', 'update', 'briefing', 'summary of issues',
];

const CAPABILITY_KEYWORDS = [
  'what can you do', 'help', 'capabilities', 'what do you know',
  'how can you help', 'what are your features', 'commands',
];

function classifyOwnerMessage(text) {
  const lower = text.toLowerCase().trim();
  if (ATTENTION_KEYWORDS.some((kw) => lower.includes(kw))) return 'attention';
  if (CAPABILITY_KEYWORDS.some((kw) => lower.includes(kw))) return 'capability';
  return 'data_question';
}

// ── Branch name resolution ──
// When an owner asks "how's the Gulberg branch doing", resolve the branch
// name to a branch_id for scoping. Simple case-insensitive name match.

async function resolveBranchByName(tenantId, text) {
  const branchesRes = await query(
    'SELECT id, name FROM branches WHERE tenant_id = $1',
    [tenantId],
  );
  if (branchesRes.rows.length === 0) return null;

  const lower = text.toLowerCase();
  for (const branch of branchesRes.rows) {
    if (lower.includes(branch.name.toLowerCase())) {
      return branch.id;
    }
  }
  return null; // No specific branch mentioned — tenant-wide default
}

// ── Branch access lookup ──
// Mirrors the same logic as auth.js attachBranchAccess: owner gets null
// (unrestricted), non-owner gets a Set of branch_ids from user_branch_access.
// This is a standalone query (not using the middleware) because the WhatsApp
// pipeline doesn't go through Express middleware.

async function getUserBranchAccess(userId, role) {
  if (role === 'owner') return null; // owner — unrestricted
  const res = await query(
    'SELECT branch_id FROM user_branch_access WHERE user_id = $1',
    [userId],
  );
  return new Set(res.rows.map((r) => r.branch_id));
}

// ═══════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT — called from whatsapp.js when the sender's phone
// matches a verified users.phone for owner/manager role.
// ═══════════════════════════════════════════════════════════════════

/**
 * Handle a message from a verified owner/manager.
 * @param {string} tenantId - Resolved from phone_number_id → tenant lookup
 * @param {object} user - The matched users row (id, role, name, phone)
 * @param {string} text - Raw message text
 * @returns {Promise<{reply: string}>}
 */
export async function handleOwnerMessage(tenantId, user, text) {
  // Rate limit check
  if (!checkRateLimit(user.id)) {
    return {
      reply: "You've sent quite a few messages — please wait a moment before trying again.",
    };
  }

  const category = classifyOwnerMessage(text);

  let reply;
  if (category === 'attention') {
    reply = await handleAttentionQuery(tenantId, user);
  } else if (category === 'capability') {
    reply = handleCapabilityQuestion();
  } else {
    reply = await handleDataQuestion(tenantId, user, text);
  }

  await sendReply(user.phone, reply);
  return { reply };
}

// ═══════════════════════════════════════════════════════════════════
// DATA QUESTION — routes to generateInsights (same NL-to-grounded-answer
// engine behind /api/insights/query and the daily briefing).
// ═══════════════════════════════════════════════════════════════════

async function handleDataQuestion(tenantId, user, text) {
  // Resolve branch scoping for managers
  const branchAccess = await getUserBranchAccess(user.id, user.role);
  let branchIds = null;

  if (branchAccess !== null) {
    // Manager — scoped to assigned branches
    branchIds = Array.from(branchAccess);
    if (branchIds.length === 0) {
      return "You don't have access to any branches yet. Please contact the owner to set up branch access.";
    }
  }

  // Check if a specific branch was mentioned in the question
  const mentionedBranchId = await resolveBranchByName(tenantId, text);
  if (mentionedBranchId && branchAccess === null) {
    // Owner asking about a specific branch — scope to just that branch
    branchIds = [mentionedBranchId];
  } else if (mentionedBranchId && branchAccess !== null) {
    // Manager asking about a specific branch — verify they have access
    if (!branchAccess.has(mentionedBranchId)) {
      return "You don't have access to that branch.";
    }
    branchIds = [mentionedBranchId];
  }

  // Use generateInsights directly — same engine, just with optional branch scoping
  try {
    const answer = await generateInsights(tenantId, text, {
      branchIds,
      history: [],
    });
    return answer;
  } catch (err) {
    console.error('[business-assistant] data question failed:', err.message);
    return "Sorry, I couldn't process that question right now. Please try rephrasing.";
  }
}

// ═══════════════════════════════════════════════════════════════════
// "WHAT NEEDS ATTENTION" — aggregates the 4 agent flag/suggestion tables
// (reconciliation, abuse, replenishment, menu insights) into one
// coherent WhatsApp-style summary.
// ═══════════════════════════════════════════════════════════════════

async function handleAttentionQuery(tenantId, user) {
  // Resolve branch scoping for managers
  const branchAccess = await getUserBranchAccess(user.id, user.role);
  let branchFilter = '';
  const params = [tenantId];

  if (branchAccess !== null) {
    const branchIds = Array.from(branchAccess);
    if (branchIds.length === 0) {
      return "You don't have access to any branches yet.";
    }
    // For the attention query, we need to filter by branch if manager
    // Use a different approach: filter in JS after fetching, since the
    // agent tables have varying column structures (some have branch_id
    // indirectly via order_id/ingredient_id, not directly).
  }

  // Query all 4 agent tables in parallel
  const [reconRes, abuseRes, replenRes, menuRes] = await Promise.all([
    query(
      `SELECT rf.flag_type, rf.description, rf.severity, rf.status,
              o.order_number
       FROM agent_reconciliation_flags rf
       LEFT JOIN orders o ON o.id = rf.order_id
       WHERE rf.tenant_id = $1 AND rf.status = 'open'
       ORDER BY rf.severity DESC, rf.detected_at DESC LIMIT 10`,
      params,
    ),
    query(
      `SELECT af.flag_type, af.description, af.severity, af.status
       FROM agent_abuse_flags af
       WHERE af.tenant_id = $1 AND af.status = 'open'
       ORDER BY af.severity DESC, af.detected_at DESC LIMIT 10`,
      params,
    ),
    query(
      `SELECT rs.suggested_quantity, rs.reasoning, rs.status,
              i.name as ingredient_name, i.unit, i.current_stock, i.low_stock_threshold
       FROM agent_replenishment_suggestions rs
       JOIN ingredients i ON i.id = rs.ingredient_id
       WHERE rs.tenant_id = $1 AND rs.status = 'pending'
       ORDER BY rs.created_at DESC LIMIT 10`,
      params,
    ),
    query(
      `SELECT mi.insight_type, mi.recommendation, mi.status,
              m.name as menu_item_name
       FROM agent_menu_insights mi
       JOIN menu_items m ON m.id = mi.menu_item_id
       WHERE mi.tenant_id = $1 AND mi.status = 'new'
       ORDER BY mi.generated_at DESC LIMIT 10`,
      params,
    ),
  ]);

  // If manager, filter results to only their assigned branches
  // (reconciliation flags and replenishment suggestions have branch via
  // orders/ingredients; abuse flags and menu insights are tenant-wide)
  let reconRows = reconRes.rows;
  let replenRows = replenRes.rows;

  if (branchAccess !== null) {
    // For reconciliation: filter by order → branch_id
    // Since we JOIN orders, we'd need the branch_id. Let's re-query with branch filter.
    if (Array.from(branchAccess).length > 0) {
      const branchIds = Array.from(branchAccess);
      const branchReconRes = await query(
        `SELECT rf.flag_type, rf.description, rf.severity, rf.status,
                o.order_number
         FROM agent_reconciliation_flags rf
         LEFT JOIN orders o ON o.id = rf.order_id
         WHERE rf.tenant_id = $1 AND rf.status = 'open'
           AND (o.branch_id = ANY($2) OR rf.order_id IS NULL)
         ORDER BY rf.severity DESC, rf.detected_at DESC LIMIT 10`,
        [tenantId, branchIds],
      );
      reconRows = branchReconRes.rows;

      const branchReplenRes = await query(
        `SELECT rs.suggested_quantity, rs.reasoning, rs.status,
                i.name as ingredient_name, i.unit, i.current_stock, i.low_stock_threshold
         FROM agent_replenishment_suggestions rs
         JOIN ingredients i ON i.id = rs.ingredient_id
         WHERE rs.tenant_id = $1 AND rs.status = 'pending'
           AND i.branch_id = ANY($2)
         ORDER BY rs.created_at DESC LIMIT 10`,
        [tenantId, branchIds],
      );
      replenRows = branchReplenRes.rows;
    }
  }

  // Build the factual payload for AI summarization
  const flags = {
    reconciliation: reconRows.map((r) => ({
      type: r.flag_type,
      description: r.description,
      severity: r.severity,
      order: r.order_number ? `#${r.order_number}` : null,
    })),
    abuse: abuseRes.rows.map((r) => ({
      type: r.flag_type,
      description: r.description,
      severity: r.severity,
    })),
    replenishment: replenRows.map((r) => ({
      ingredient: r.ingredient_name,
      suggested_qty: `${r.suggested_quantity} ${r.unit}`,
      current_stock: `${r.current_stock} ${r.unit}`,
      threshold: `${r.low_stock_threshold} ${r.unit}`,
      reasoning: r.reasoning,
    })),
    menu_insights: menuRes.rows.map((r) => ({
      item: r.menu_item_name,
      type: r.insight_type,
      recommendation: r.recommendation,
    })),
  };

  const totalFlags = flags.reconciliation.length + flags.abuse.length +
    flags.replenishment.length + flags.menu_insights.length;

  if (totalFlags === 0) {
    return "Everything looks good right now — no open flags or pending suggestions across reconciliation, abuse detection, inventory replenishment, or menu insights. 👍";
  }

  // Use generateAgentText for a conversational summary
  const systemPrompt = `You are a restaurant business assistant summarizing what needs the owner's attention.
IMPORTANT RULES:
- ONLY reference the real data provided below. Never fabricate numbers or issues.
- Keep it concise and WhatsApp-appropriate (plain text, no markdown, under 150 words).
- Group by category: reconciliation issues, abuse alerts, inventory needs, menu insights.
- Mention severity levels (high/medium/low) where relevant.
- If a category has no flags, skip it — don't say "no issues in X".
- End with a brief count: "X items need your attention."
- Use a conversational, direct tone — like a trusted advisor briefing the owner.`;

  const userContent = `Here's what needs attention:
${JSON.stringify(flags, null, 2)}

Total items: ${totalFlags} across ${[flags.reconciliation.length > 0 ? 'reconciliation' : null, flags.abuse.length > 0 ? 'abuse detection' : null, flags.replenishment.length > 0 ? 'inventory' : null, flags.menu_insights.length > 0 ? 'menu insights' : null].filter(Boolean).join(', ')}.

Summarize this for the owner.`;

  try {
    return await generateAgentText(systemPrompt, userContent);
  } catch (err) {
    console.error('[business-assistant] attention summary failed:', err.message);
    // Fallback: plain text summary without AI phrasing
    const parts = [];
    if (flags.reconciliation.length > 0) parts.push(`Reconciliation: ${flags.reconciliation.length} open flags`);
    if (flags.abuse.length > 0) parts.push(`Abuse: ${flags.abuse.length} alerts`);
    if (flags.replenishment.length > 0) parts.push(`Inventory: ${flags.replenishment.length} items need restocking`);
    if (flags.menu_insights.length > 0) parts.push(`Menu: ${flags.menu_insights.length} insights`);
    return `${totalFlags} items need your attention.\n${parts.join('\n')}`;
  }
}

// ═══════════════════════════════════════════════════════════════════
// CAPABILITY QUESTION — answer from a fixed, accurate description
// of real capabilities. Never invent features.
// ═══════════════════════════════════════════════════════════════════

function handleCapabilityQuestion() {
  return [
    "I can help you with:",
    "• Sales & revenue questions (e.g. 'what were yesterday's sales?', 'top items this week')",
    "• Business overview ('what needs my attention?', 'any issues today?')",
    "• Branch performance ('how's the Gulberg branch doing?')",
    "• Order data ('how many orders today?', 'average order value')",
    "• Customer insights ('top customers', 'repeat rate')",
    "",
    "Just ask naturally — I'll look up the real data and give you a straight answer.",
  ].join('\n');
}
