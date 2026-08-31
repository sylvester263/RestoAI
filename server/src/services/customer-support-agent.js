/**
 * Customer Support Agent (impl-27) — WhatsApp-based support flow.
 *
 * Design principles (from spec):
 * - Grounded answers only: every factual answer comes from real tenant data.
 * - Mandatory human escalation for anything non-routine (complaints, emotional).
 * - No silent closure: a ticket is only resolved on customer confirmation or staff action.
 * - Context-rich handoff: staff get full conversation + AI classification.
 *
 * Reuses existing shared logic:
 * - generateAgentText from ai-agent.js for Qwen phrasing (no duplicate AI client).
 * - sendReply from whatsapp.js for outbound WhatsApp delivery.
 * - getOrCreateCustomer from orders.js for customer resolution.
 */
import { query } from '../db/pool.js';
import { generateAgentText } from './ai-agent.js';
import { sendReply } from './whatsapp.js';

// ── Deterministic classification patterns ──
// Spec: "deterministic keyword/pattern rules where possible, Qwen only for
// ambiguous cases." These run BEFORE any AI call — fast, predictable, auditable.

const COMPLAINT_KEYWORDS = [
  'complain', 'complaint', 'terrible', 'horrible', 'worst', 'unacceptable',
  'disgusting', 'rude', 'manager', 'supervisor', 'refund', 'compensation',
  'lawsuit', 'report', 'food poisoning', 'sick', 'unhealthy', 'dirty',
  'never coming back', 'worst experience', 'shame', 'fraud', 'scam',
];

const ORDER_ISSUE_KEYWORDS = [
  'wrong order', 'wrong item', 'missing item', 'missing order', 'late',
  'not delivered', 'never arrived', 'cold food', 'stale', 'damaged',
  'incorrect', 'short', 'didn\'t get', 'haven\'t received',
];

const POSITIVE_KEYWORDS = [
  'thank', 'thanks', 'great', 'perfect', 'excellent', 'love it', 'shukriya',
  'bohat acha', 'best', 'amazing', 'wonderful',
];

function isComplaint(text) {
  const lower = text.toLowerCase();
  return COMPLAINT_KEYWORDS.some((kw) => lower.includes(kw));
}

function hasOrderKeywords(text) {
  const lower = text.toLowerCase();
  return ORDER_ISSUE_KEYWORDS.some((kw) => lower.includes(kw));
}

function isPositive(text) {
  const lower = text.toLowerCase();
  return POSITIVE_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Classify a support message's sub-category using deterministic rules.
 * Complaint check runs first — a message with both order-issue AND complaint
 * language ("my order was wrong and I'm furious") is treated as a complaint
 * because the escalation rule is the safety-critical one.
 */
function classifyCategory(text) {
  if (isComplaint(text)) return 'complaint';
  if (hasOrderKeywords(text)) return 'order_issue';
  return 'question';
}

// ── Resolution confirmation patterns ──
const AFFIRMATIVE = ['yes', 'yeah', 'yep', 'yup', 'haan', 'ji', 'sure', 'ok', 'okay', 'resolved', 'fixed', 'done', 'bilkul'];
const NEGATIVE = ['no', 'nope', 'nah', 'not', 'still', 'nahi', 'problem', 'issue', 'worse'];

function isConfirmation(text) {
  const lower = text.toLowerCase().trim();
  // Check NEGATIVE first — "no" + "resolved" in the same message like
  // "no, it's not resolved" should be treated as negative, not positive.
  // Negative signals are safety-critical (escalation path) so they take priority.
  if (NEGATIVE.some((w) => lower.includes(w))) return 'no';
  if (AFFIRMATIVE.some((w) => lower.includes(w))) return 'yes';
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT — called from whatsapp.js when intent='support'
// or when the conversation is already in support mode.
// ═══════════════════════════════════════════════════════════════════

/**
 * Handle a support-related WhatsApp message.
 * Creates or continues a support ticket, classifies the issue, and responds.
 *
 * @param {string} tenantId - Resolved server-side, never from client input
 * @param {object} customer - From getOrCreateCustomer()
 * @param {string} phone - Customer's WhatsApp number
 * @param {string} text - Raw message text
 * @param {object} conversation - Conversation DB row (for context updates)
 * @returns {Promise<{reply: string}>}
 */
export async function handleSupportMessage(tenantId, customer, phone, text, conversation) {
  // 1. Find or create a support ticket for this customer
  let ticket = await getActiveTicket(tenantId, customer.id);

  if (!ticket) {
    // New issue — classify and create
    const category = classifyCategory(text);
    ticket = await createTicket(tenantId, customer.id, category);
  }

  // 2. Log the incoming customer message
  await logMessage(ticket.id, 'customer', text);

  // 3. Route based on ticket state
  let reply;
  if (ticket.pending_confirmation) {
    reply = await handleResolutionConfirmation(ticket, phone, text);
  } else if (ticket.status === 'escalated') {
    reply = await handleEscalatedFollowup(ticket, phone, text);
  } else if (ticket.status === 'open') {
    reply = await handleOpenTicket(ticket, tenantId, customer, phone, text);
  } else {
    // Ticket is ai_handled or resolved — treat as new issue
    const category = classifyCategory(text);
    const newTicket = await createTicket(tenantId, customer.id, category);
    await logMessage(newTicket.id, 'customer', text);
    reply = await handleOpenTicket(newTicket, tenantId, customer, phone, text);
  }

  // 4. Send the reply via WhatsApp
  await sendReply(phone, reply);

  return { reply };
}

// ═══════════════════════════════════════════════════════════════════
// TICKET QUERIES
// ═══════════════════════════════════════════════════════════════════

async function getActiveTicket(tenantId, customerId) {
  const res = await query(
    `SELECT * FROM support_tickets
     WHERE tenant_id = $1 AND customer_id = $2
       AND status IN ('open', 'escalated', 'ai_handled')
     ORDER BY created_at DESC LIMIT 1`,
    [tenantId, customerId],
  );
  return res.rows[0] || null;
}

async function createTicket(tenantId, customerId, category) {
  const res = await query(
    `INSERT INTO support_tickets (tenant_id, customer_id, category)
     VALUES ($1, $2, $3) RETURNING *`,
    [tenantId, customerId, category],
  );
  return res.rows[0];
}

async function logMessage(ticketId, sender, content) {
  await query(
    `INSERT INTO support_messages (ticket_id, sender, content) VALUES ($1, $2, $3)`,
    [ticketId, sender, content],
  );
}

// ═══════════════════════════════════════════════════════════════════
// ROUTING: handle based on ticket state
// ═══════════════════════════════════════════════════════════════════

/**
 * Handle a message on an open ticket — classify the issue and respond.
 * This is where the main classification + response logic lives.
 */
async function handleOpenTicket(ticket, tenantId, customer, phone, text) {
  // Re-classify using the ORIGINAL ticket category (set at creation) plus
  // the current message text for additional signal.
  const category = ticket.category;

  if (category === 'complaint') {
    return handleComplaint(ticket, tenantId, customer, phone, text);
  }

  if (category === 'order_issue') {
    return handleOrderIssue(ticket, tenantId, customer, phone, text);
  }

  // 'question', 'feedback', 'other' — routine handling
  return handleRoutineQuestion(ticket, tenantId, customer, phone, text);
}

// ═══════════════════════════════════════════════════════════════════
// COMPLAINT — mandatory escalation, ZERO AI-attempted resolution
// ═══════════════════════════════════════════════════════════════════

/**
 * Handle a complaint: escalate immediately, never attempt AI resolution.
 * Spec: "do NOT attempt AI resolution — immediately mark the ticket escalated,
 * notify staff, and reply to the customer with a warm, honest acknowledgment."
 */
async function handleComplaint(ticket, tenantId, customer, phone, text) {
  // Build the context package for staff — full conversation + classification
  const classification = `Complaint from ${customer.name || customer.phone}. Category: complaint. Requires human attention.`;
  const suggestedResolution = 'Customer needs personal attention from a team member. Review conversation and respond directly.';

  // Escalate immediately — no AI resolution attempted
  await query(
    `UPDATE support_tickets SET status = 'escalated', ai_classification = $1, ai_suggested_resolution = $2, updated_at = NOW() WHERE id = $3`,
    [classification, suggestedResolution, ticket.id],
  );

  // Log the AI classification message for staff context
  await logMessage(ticket.id, 'ai', '[ESCALATED — complaint detected. A team member will follow up personally.]');

  // Warm, honest acknowledgment — never a canned "your issue is resolved"
  const reply = `I'm really sorry to hear about your experience. I've flagged this for our team and someone will personally follow up with you shortly. Your concern is important to us. 🙏`;
  await logMessage(ticket.id, 'ai', reply);

  return reply;
}

// ═══════════════════════════════════════════════════════════════════
// ORDER ISSUE — look up actual order data, respond from real records
// ═══════════════════════════════════════════════════════════════════

/**
 * Handle an order issue: look up the customer's actual recent orders,
 * acknowledge the specific order, and respond from real data.
 * Spec: "Do not fabricate order details."
 */
async function handleOrderIssue(ticket, tenantId, customer, phone, text) {
  // Look up the customer's recent orders (tenant+phone scoped)
  const orderRes = await query(
    `SELECT o.id, o.order_number, o.status, o.total, o.created_at, o.channel,
            array_agg(oi.name || ' x' || oi.quantity) as items
     FROM orders o
     LEFT JOIN order_items oi ON oi.order_id = o.id
     WHERE o.tenant_id = $1 AND o.customer_id = $2
     GROUP BY o.id
     ORDER BY o.created_at DESC LIMIT 3`,
    [tenantId, customer.id],
  );

  if (orderRes.rows.length === 0) {
    // No orders found — can't fabricate. Escalate.
    await query(
      `UPDATE support_tickets SET status = 'escalated', ai_classification = $1, ai_suggested_resolution = $2, updated_at = NOW() WHERE id = $3`,
      ['Order issue but no recent orders found for this customer. Needs human lookup.', 'Verify order existence manually and respond.', ticket.id],
    );
    const reply = "I'd like to help with your order concern, but I'm not able to find a recent order on your account right now. Let me connect you with a team member who can look into this directly.";
    await logMessage(ticket.id, 'ai', reply);
    return reply;
  }

  // Link the ticket to the most recent order
  const recentOrder = orderRes.rows[0];
  await query(`UPDATE support_tickets SET order_id = $1, updated_at = NOW() WHERE id = $2`, [recentOrder.id, ticket.id]);

  // Build order summary for AI grounding
  const orderSummary = orderRes.rows.map((o) => ({
    order_number: o.order_number,
    status: o.status,
    total: o.total,
    items: o.items,
    created_at: new Date(o.created_at).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }),
    channel: o.channel,
  }));

  // Use Qwen to phrase a grounded response (reuses shared generateAgentText)
  const systemPrompt = `You are a restaurant support assistant responding to a customer about their order issue.
IMPORTANT RULES:
- ONLY reference the real order data provided below. Never fabricate order numbers, statuses, or details.
- Be empathetic and acknowledge the issue.
- Keep the response concise (under 100 words).
- If the order was late, acknowledge the delay with the actual time.
- If the order had wrong items, acknowledge the specific items.
- After addressing the issue, ask: "Did that help resolve your concern?"
- Respond in the same language the customer used (English, Urdu, or Roman Urdu).`;

  const userContent = `Customer message: "${text}"

Customer's recent orders:
${JSON.stringify(orderSummary, null, 2)}

Reference the specific order (by order number) and its actual status. Ask if this resolved their concern.`;

  let reply;
  try {
    reply = await generateAgentText(systemPrompt, userContent);
  } catch (err) {
    console.error('[support-agent] AI phrasing failed, using fallback:', err.message);
    const o = orderSummary[0];
    reply = `I can see your recent order #${o.order_number} (${o.status}, Rs. ${o.total} on ${o.created_at}). Let me look into this for you. Did that help address your concern?`;
  }

  await logMessage(ticket.id, 'ai', reply);

  // Set pending_confirmation — we need to verify the customer is satisfied
  await query(
    `UPDATE support_tickets SET status = 'ai_handled', pending_confirmation = true, updated_at = NOW() WHERE id = $1`,
    [ticket.id],
  );

  return reply;
}

// ═══════════════════════════════════════════════════════════════════
// ROUTINE QUESTION — answer from real branch/menu data
// ═══════════════════════════════════════════════════════════════════

/**
 * Handle a routine question (hours, menu, policy): answer from real data.
 * Same grounding discipline as the existing recommendation agent.
 */
async function handleRoutineQuestion(ticket, tenantId, customer, phone, text) {
  // Load real branch + menu data for grounding
  const branchRes = await query(
    'SELECT name, address, phone FROM branches WHERE tenant_id = $1 LIMIT 1',
    [tenantId],
  );
  const branch = branchRes.rows[0];

  const menuRes = await query(
    `SELECT mi.name, mi.price, mi.is_available, mc.name as category
     FROM menu_items mi LEFT JOIN menu_categories mc ON mi.category_id = mc.id
     WHERE mi.tenant_id = $1 ORDER BY mc.sort_order, mi.name LIMIT 30`,
    [tenantId],
  );

  const context = {
    branch: branch || { name: 'Our restaurant', address: '', phone: '' },
    now: new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }),
    menu: menuRes.rows.map((m) => ({
      name: m.name,
      price: m.price,
      available: m.is_available,
      category: m.category,
    })),
  };

  const systemPrompt = `You are a restaurant support assistant answering a customer's question.
IMPORTANT RULES:
- ONLY use the data provided below. Never invent information.
- If asked about hours and no hours data is provided, say you'll check and get back to them.
- If asked about menu items, reference only items from the provided menu data.
- If asked about an order and no order data is available, say you'll connect them with the team.
- Be friendly and concise (under 80 words).
- After answering, ask: "Did that answer your question?"
- Respond in the same language the customer used.`;

  const userContent = `Customer question: "${text}"

Restaurant data:
${JSON.stringify(context, null, 2)}`;

  let reply;
  try {
    reply = await generateAgentText(systemPrompt, userContent);
  } catch (err) {
    console.error('[support-agent] routine question AI failed:', err.message);
    reply = "Thanks for reaching out! Let me get the right information for you. Could you tell me a bit more about what you need help with?";
  }

  await logMessage(ticket.id, 'ai', reply);

  // Set pending_confirmation — need to verify the question was answered
  await query(
    `UPDATE support_tickets SET status = 'ai_handled', pending_confirmation = true, updated_at = NOW() WHERE id = $1`,
    [ticket.id],
  );

  return reply;
}

// ═══════════════════════════════════════════════════════════════════
// RESOLUTION CONFIRMATION — the "no silent closure" safeguard
// ═══════════════════════════════════════════════════════════════════

/**
 * Handle the customer's response to "Did that solve it?"
 * - "yes" → mark ai_handled (effectively resolved)
 * - "no" or unrecognized → escalate (never silently close)
 *
 * Spec: "Only mark ai_handled → effectively resolved on positive confirmation;
 * a 'no' or no response after a reasonable window escalates automatically
 * rather than sitting silently closed."
 */
async function handleResolutionConfirmation(ticket, phone, text) {
  const confirmation = isConfirmation(text);

  // Note: customer message is already logged by handleSupportMessage before
  // this function is called — do NOT log it again here (would create duplicates).

  if (confirmation === 'yes') {
    // Positive confirmation — mark as effectively resolved
    // But only if the ticket was ai_handled (not escalated with pending flag)
    if (ticket.status === 'ai_handled') {
      await query(
        `UPDATE support_tickets SET pending_confirmation = false, updated_at = NOW() WHERE id = $1`,
        [ticket.id],
      );
      const reply = "Glad I could help! Don't hesitate to reach out if you need anything else. Have a great day! 😊";
      await logMessage(ticket.id, 'ai', reply);
      return reply;
    }
    // If escalated, a "yes" doesn't auto-close — staff handles closure
    const reply = "Thank you for confirming! Our team will wrap this up shortly.";
    await logMessage(ticket.id, 'ai', reply);
    await query(
      `UPDATE support_tickets SET pending_confirmation = false, updated_at = NOW() WHERE id = $1`,
      [ticket.id],
    );
    return reply;
  }

  // "no" or unrecognized → escalate (never silently close)
  if (ticket.status !== 'escalated') {
    await query(
      `UPDATE support_tickets SET status = 'escalated', pending_confirmation = false, ai_classification = COALESCE(ai_classification, '') || ' | Customer indicated issue was NOT resolved.', updated_at = NOW() WHERE id = $1`,
      [ticket.id],
    );
    await logMessage(ticket.id, 'ai', '[ESCALATED — customer indicated the issue was not resolved. Human follow-up required.]');
  }

  const reply = "I'm sorry I couldn't resolve that for you. I've escalated this to a team member who will help you personally. They'll be in touch shortly.";
  await logMessage(ticket.id, 'ai', reply);
  return reply;
}

// ═══════════════════════════════════════════════════════════════════
// ESCALATED FOLLOW-UP — customer sends more info on an escalated ticket
// ═══════════════════════════════════════════════════════════════════

/**
 * Handle a follow-up message on an already-escalated ticket.
 * Just logs the message — no AI resolution attempted.
 */
async function handleEscalatedFollowup(ticket, phone, text) {
  // Note: customer message is already logged by handleSupportMessage before
  // this function is called — do NOT log it again here.

  const reply = "Thank you for the additional information. I've added it to your case and our team will review it. Someone will follow up with you soon.";
  await logMessage(ticket.id, 'ai', reply);
  return reply;
}

// ═══════════════════════════════════════════════════════════════════
// STAFF ACTIONS — called from support routes
// ═══════════════════════════════════════════════════════════════════

/**
 * Staff replies to a ticket. Sends the reply via WhatsApp and logs it.
 * @returns {object} The ticket row + customer phone for the route handler
 */
export async function staffReplyToTicket(ticketId, tenantId, userId, content) {
  // Verify ticket belongs to this tenant (tenant scoping)
  const ticketRes = await query(
    `SELECT st.*, c.phone, c.name as customer_name
     FROM support_tickets st
     JOIN customers c ON c.id = st.customer_id
     WHERE st.id = $1 AND st.tenant_id = $2`,
    [ticketId, tenantId],
  );
  if (ticketRes.rows.length === 0) return null;

  const ticket = ticketRes.rows[0];

  // Log the staff message
  await logMessage(ticketId, 'staff', content);

  // Send via WhatsApp to the customer
  await sendReply(ticket.phone, `🏪 *Team Response:*\n${content}`);

  // Update ticket — staff interaction clears pending_confirmation
  await query(
    `UPDATE support_tickets SET pending_confirmation = false, updated_at = NOW() WHERE id = $1`,
    [ticketId],
  );

  return { ticket, customerPhone: ticket.phone };
}

/**
 * Update ticket status (resolve/reopen). Only manager/owner should call this.
 */
export async function updateTicketStatus(ticketId, tenantId, userId, newStatus) {
  const resolvedBy = newStatus === 'resolved' ? userId : null;
  const resolvedAt = newStatus === 'resolved' ? new Date() : null;

  const res = await query(
    `UPDATE support_tickets
     SET status = $1, resolved_by = $2, resolved_at = $3, pending_confirmation = false, updated_at = NOW()
     WHERE id = $4 AND tenant_id = $5
     RETURNING *`,
    [newStatus, resolvedBy, resolvedAt, ticketId, tenantId],
  );
  return res.rows[0] || null;
}
