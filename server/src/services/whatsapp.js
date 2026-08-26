/**
 * WhatsApp Service — Handles incoming messages, orchestrates the order flow,
 * and sends replies via the WhatsApp Cloud API.
 *
 * For the demo/sandbox, the sendReply function logs instead of calling the real API
 * when WHATSAPP_TOKEN is not configured.
 */
import config from '../config.js';
import { query } from '../db/pool.js';
import { parseOrderMessage, generateRecommendation } from './ai-agent.js';
import { getOrCreateCustomer, calculatePricing, createOrder } from './orders.js';
import { getBalance } from './loyalty.js';

/**
 * Process an incoming WhatsApp message through the order agent pipeline.
 * @param {string} tenantId
 * @param {object} message - WhatsApp message object
 * @returns {Promise<object>} The reply that was sent (or would be sent)
 */
export async function processWhatsAppMessage(tenantId, message) {
  const phone = message.from;
  const text = message.type === 'text' ? message.text.body : '';

  if (!text) {
    // Only handle text messages for MVP
    return { reply: "I can only process text messages right now. Please type your order!" };
  }

  // 1. Get or create conversation record
  let conversation = await getOrCreateConversation(tenantId, phone);

  // 2. Get or create customer record
  const customer = await getOrCreateCustomer(tenantId, phone);

  // 3. Load available menu items for the tenant
  const menuRes = await query(
    `SELECT mi.*, mc.name as category_name
     FROM menu_items mi
     LEFT JOIN menu_categories mc ON mi.category_id = mc.id
     WHERE mi.tenant_id = $1 AND mi.is_available = true
     ORDER BY mc.sort_order, mi.name`,
    [tenantId],
  );
  const menuItems = menuRes.rows;

  // 4. Build conversation context from JSONB history
  const conversationContext = conversation.context || {};

  // 5. Check if there's a pending draft order awaiting confirmation
  const pendingDraft = conversationContext.pending_draft;
  let reply;
  let parsed = null;

  // 5a. Handle confirmation of a pending draft order
  const AFFIRMATIVE = ['confirm', 'yes', 'ok', 'haan', 'ji', 'yup', 'yeah', 'done', 'sure', 'bilkul'];
  const lowerText = text.toLowerCase();
  const isAffirm = AFFIRMATIVE.some((w) => lowerText.includes(w));
  if (pendingDraft && isAffirm) {
    const orderResult = await finalizeOrder(tenantId, customer, pendingDraft);
    reply = `✅ Your order has been confirmed!\n\n📋 *Order #${orderResult.order_number}*\n`;
    reply += orderResult.items.map((i) => `  • ${i.quantity}x ${i.name} — Rs. ${i.total_price}`).join('\n');
    reply += `\n\n💰 *Total: Rs. ${orderResult.total}*`;
    reply += `\n⏱ Estimated prep time: ~${config.timing.estimatedPrepMax} mins`;
    reply += `\n\nThank you for ordering with us! 🎉`;

    delete conversationContext.pending_draft;
    await query(
      `UPDATE conversations SET state = 'completed', order_id = $2, updated_at = NOW() WHERE id = $1`,
      [conversation.id, orderResult.id],
    );
  }
  // 5b. If pending draft and customer sends a non-affirmative message
  else if (pendingDraft && !isAffirm) {
    delete conversationContext.pending_draft;
    parsed = await parseOrderMessage(text, menuItems, conversationContext);
    reply = parsed.reply_message;

    if (parsed.intent === 'order' && parsed.items.length > 0 && parsed.confidence >= 0.7) {
      const draft = buildDraftOrder(parsed, menuItems);
      if (draft) {
        conversationContext.pending_draft = draft;
        reply = buildConfirmationMessage(draft);
      }
    } else if (parsed.intent === 'recommendation') {
      reply = await generateRecommendation(text, menuItems, conversationContext);
    } else if (parsed.intent === 'reservation') {
      reply = await handleReservationRequest(tenantId, customer, parsed);
    } else if (parsed.intent === 'loyalty_balance') {
      const balance = await getBalance(tenantId, customer.id);
      reply = `You have ${balance} loyalty points! 🎉`;
    }
  }
  // 5c. No pending draft — classify and handle normally
  else {
    parsed = await parseOrderMessage(text, menuItems, conversationContext);
    reply = parsed.reply_message;

    if (parsed.intent === 'order' && parsed.items.length > 0 && parsed.confidence >= 0.7) {
      // Store as pending draft — do NOT create order yet, wait for confirmation
      const draft = buildDraftOrder(parsed, menuItems);
      if (draft) {
        conversationContext.pending_draft = draft;
        reply = buildConfirmationMessage(draft);
      }
    } else if (parsed.intent === 'recommendation') {
      // Feature 3: AI-powered menu recommendations (read-only, no order created)
      reply = await generateRecommendation(text, menuItems, conversationContext);
    } else if (parsed.intent === 'reservation') {
      reply = await handleReservationRequest(tenantId, customer, parsed);
    } else if (parsed.intent === 'loyalty_balance') {
      const balance = await getBalance(tenantId, customer.id);
      reply = `You have ${balance} loyalty points! 🎉`;
    }
    // For greeting/question/chitchat/menu_request — reply is already set from parsed.reply_message
  }

  // 9. Persist conversation message history in JSONB context
  if (!conversationContext.messages) conversationContext.messages = [];
  conversationContext.messages.push({ role: 'customer', message: text, timestamp: new Date().toISOString() });
  conversationContext.messages.push({ role: 'bot', message: reply, timestamp: new Date().toISOString() });
  // Keep last 20 messages to avoid JSONB bloat
  conversationContext.messages = conversationContext.messages.slice(-20);
  await query(
    `UPDATE conversations SET context = $2, updated_at = NOW() WHERE id = $1`,
    [conversation.id, JSON.stringify(conversationContext)],
  );

  // 10. Send reply via WhatsApp (or log for demo)
  await sendReply(phone, reply);

  return { reply, parsed };
}

// ── Helper: Get or create a conversation record ──
async function getOrCreateConversation(tenantId, phone) {
  let res = await query(
    `SELECT * FROM conversations WHERE tenant_id = $1 AND phone = $2 ORDER BY updated_at DESC LIMIT 1`,
    [tenantId, phone],
  );

  // If no conversation or last one was completed > 30min ago, create new
  if (res.rows.length === 0 || (res.rows[0].state === 'completed' && isOlderThan30Min(res.rows[0].updated_at))) {
    const newRes = await query(
      `INSERT INTO conversations (tenant_id, phone, state) VALUES ($1, $2, 'idle') RETURNING *`,
      [tenantId, phone],
    );
    return newRes.rows[0];
  }

  return res.rows[0];
}

// ── Helper: Book a table from a conversationally-parsed reservation request ──
async function handleReservationRequest(tenantId, customer, parsed) {
  if (!parsed.party_size || !parsed.reserved_for) {
    return "I'd love to book that for you — could you confirm the number of people and the date/time?";
  }
  const reservedFor = new Date(parsed.reserved_for);
  if (Number.isNaN(reservedFor.getTime()) || reservedFor <= new Date()) {
    return "That date/time doesn't look right — could you tell me the day and time again?";
  }

  const branchRes = await query('SELECT id FROM branches WHERE tenant_id = $1 LIMIT 1', [tenantId]);
  const branchId = branchRes.rows[0]?.id;
  if (!branchId) return "Sorry, I can't book a table right now — please call the restaurant directly.";

  await query(
    `INSERT INTO reservations (tenant_id, branch_id, customer_name, customer_phone, party_size, reserved_for)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tenantId, branchId, customer.name || 'Guest', customer.phone, parsed.party_size, reservedFor],
  );

  const when = reservedFor.toLocaleString('en-PK', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' });
  return `✅ Table booked for ${parsed.party_size} on ${when}. See you then!`;
}

// ── Helper: Build a draft order from parsed AI output (not yet saved to DB) ──
function buildDraftOrder(parsed, menuItems) {
  const orderItems = [];
  for (const parsedItem of parsed.items) {
    const match = menuItems.find((mi) =>
      mi.name.toLowerCase().includes(parsedItem.name.toLowerCase()) ||
      parsedItem.name.toLowerCase().includes(mi.name.toLowerCase()),
    );
    if (match) {
      orderItems.push({
        menu_item_id: match.id,
        name: match.name,
        quantity: parsedItem.quantity || 1,
        unit_price: parseFloat(match.price),
        total_price: parseFloat(match.price) * (parsedItem.quantity || 1),
      });
    }
  }
  if (orderItems.length === 0) return null;

  const pricing = calculatePricing(orderItems);

  return {
    items: orderItems,
    ...pricing,
    delivery_address: parsed.delivery_address || null,
    payment_method: parsed.payment_method || 'cash',
  };
}

// ── Helper: Format confirmation message from a draft order ──
function buildConfirmationMessage(draft) {
  let msg = '📋 *Order Summary:*\n';
  msg += draft.items.map((i) => `  • ${i.quantity}x ${i.name} — Rs. ${i.total_price}`).join('\n');
  msg += `\n\n💰 *Total: Rs. ${draft.total}*`;
  msg += `\n⏱ Estimated time: ~${config.timing.estimatedPrepMax} mins`;
  msg += `\n\nReply "yes" to confirm or tell me what to change.`;
  return msg;
}

// ── Helper: Finalize a confirmed order — saves to DB ──
async function finalizeOrder(tenantId, customer, draft) {
  return createOrder({
    tenantId,
    customer,
    items: draft.items,
    pricing: { subtotal: draft.subtotal, tax: draft.tax, delivery_fee: draft.delivery_fee, total: draft.total },
    deliveryAddress: draft.delivery_address || customer.address,
    paymentMethod: draft.payment_method,
    channel: 'whatsapp',
  });
}

// ── Helper: Send reply via WhatsApp Cloud API ──
export async function sendReply(phone, text) {
  // In demo mode (no token or placeholder), log to console instead of sending
  const token = config.whatsapp.token;
  if (!token || token.startsWith('your-')) {
    console.log(`[whatsapp:demo] → ${phone}: ${text.slice(0, 200)}…`);
    return;
  }

  const url = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.whatsapp.token}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body: text },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[whatsapp] send failed (${res.status}): ${errText}`);
  }
}

// ── Feature 1: Order status change notification (fire-and-forget) ──
export const STATUS_MESSAGES = {
  confirmed: "Order confirmed ✅ We're getting started!",
  preparing: 'Your order is being prepared 🍳',
  ready: 'Your order is ready! 🎉',
  delivered: 'Delivered! Enjoy your meal 🍽️',
  cancelled: 'Your order has been cancelled. Sorry for the inconvenience.',
};

export async function notifyStatusChange(orderId, tenantId, newStatus) {
  const template = STATUS_MESSAGES[newStatus];
  if (!template) return;

  try {
    const res = await query(
      `SELECT c.phone FROM orders o
       LEFT JOIN customers c ON o.customer_id = c.id
       WHERE o.id = $1 AND o.tenant_id = $2`,
      [orderId, tenantId],
    );
    const phone = res.rows[0]?.phone;
    if (!phone) return;
    await sendReply(phone, template);
  } catch (err) {
    console.error('[whatsapp] status notification failed:', err.message);
  }
}

// ── Utility ──
function isOlderThan30Min(timestamp) {
  return Date.now() - new Date(timestamp).getTime() > 30 * 60 * 1000;
}
