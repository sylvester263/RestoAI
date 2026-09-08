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
import { handleSupportMessage } from './customer-support-agent.js';
import { handleOwnerMessage } from './business-assistant-agent.js';
import { getOrCreateCustomer, calculatePricing, createOrder } from './orders.js';
import { getBalance } from './loyalty.js';
import { previewCoupon, validateAndApplyCoupon, attachRedemptionToOrder } from './coupons.js';
import { OrderError } from './orders.js';
import { getOrderType } from '../utils/order-type.js';

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

  // ── impl-28: Owner/manager routing check ──
  // BEFORE any intent classification or customer pipeline logic, check if
  // the sender's phone matches a verified users.phone for owner/manager
  // role on this tenant. If matched, route entirely to the business
  // assistant — never let the two paths blend.
  const ownerRes = await query(
    `SELECT id, name, role, phone FROM users
     WHERE tenant_id = $1 AND phone = $2 AND role IN ('owner', 'manager')`,
    [tenantId, phone],
  );
  if (ownerRes.rows.length > 0) {
    const ownerUser = ownerRes.rows[0];
    const result = await handleOwnerMessage(tenantId, ownerUser, text);
    return result;
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

  // 5-pre. Support mode: if the conversation is already in a support flow,
  // route ALL messages through the support handler until the ticket is
  // resolved. This prevents a customer mid-support from accidentally
  // triggering a new order flow, and ensures resolution confirmations
  // are handled correctly (no silent closure).
  if (conversationContext.in_support) {
    const supportResult = await handleSupportMessage(tenantId, customer, phone, text, conversation);
    reply = supportResult.reply;
    parsed = { intent: 'support' };

    // Update conversation context
    if (!conversationContext.messages) conversationContext.messages = [];
    conversationContext.messages.push({ role: 'customer', message: text, timestamp: new Date().toISOString() });
    conversationContext.messages.push({ role: 'bot', message: reply, timestamp: new Date().toISOString() });
    conversationContext.messages = conversationContext.messages.slice(-20);

    // Check if the support ticket is now resolved — clear in_support flag
    const ticketCheck = await query(
      `SELECT status FROM support_tickets WHERE tenant_id = $1 AND customer_id = $2 AND status IN ('open','escalated','ai_handled') ORDER BY created_at DESC LIMIT 1`,
      [tenantId, customer.id],
    );
    if (ticketCheck.rows.length === 0) {
      delete conversationContext.in_support;
    }

    await query(
      `UPDATE conversations SET context = $2, updated_at = NOW() WHERE id = $1`,
      [conversation.id, JSON.stringify(conversationContext)],
    );
    await sendReply(phone, reply, tenantId);
    return { reply, parsed };
  }

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
      const draft = await buildDraftOrder(parsed, menuItems, tenantId, customer.id);
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
    } else if (parsed.intent === 'support') {
      // Support intent detected — enter support mode
      conversationContext.in_support = true;
      const supportResult = await handleSupportMessage(tenantId, customer, phone, text, conversation);
      reply = supportResult.reply;
    }
  }
  // 5c. No pending draft — classify and handle normally
  else {
    parsed = await parseOrderMessage(text, menuItems, conversationContext);
    reply = parsed.reply_message;

    if (parsed.intent === 'order' && parsed.items.length > 0 && parsed.confidence >= 0.7) {
      // Store as pending draft — do NOT create order yet, wait for confirmation
      const draft = await buildDraftOrder(parsed, menuItems, tenantId, customer.id);
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
    } else if (parsed.intent === 'support') {
      // Support intent detected — enter support mode
      conversationContext.in_support = true;
      const supportResult = await handleSupportMessage(tenantId, customer, phone, text, conversation);
      reply = supportResult.reply;
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
  await sendReply(phone, reply, tenantId);

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
// A mentioned coupon code is only previewed here (no lock, no redemption) —
// the real, concurrency-safe redemption happens once at finalizeOrder, the
// same split public.js already uses (preview at cart-build time, atomic
// redeem at order-creation time). An invalid/expired code doesn't block the
// order — it's just dropped, with a note in the confirmation message.
async function buildDraftOrder(parsed, menuItems, tenantId, customerId) {
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

  let couponCode = null;
  let couponError = null;
  let discount = 0;
  if (parsed.coupon_code) {
    const subtotal = orderItems.reduce((sum, i) => sum + i.total_price, 0);
    try {
      const result = await previewCoupon(tenantId, parsed.coupon_code, customerId, subtotal, { items: orderItems, deliveryFee: 100 });
      couponCode = parsed.coupon_code.toUpperCase();
      discount = result.discount;
    } catch (err) {
      couponError = err instanceof OrderError ? err.message : 'Could not apply that code';
    }
  }

  const pricing = calculatePricing(orderItems, { discount });

  return {
    items: orderItems,
    ...pricing,
    delivery_address: parsed.delivery_address || null,
    payment_method: parsed.payment_method || 'cash',
    coupon_code: couponCode,
    coupon_error: couponError,
  };
}

// ── Helper: Format confirmation message from a draft order ──
function buildConfirmationMessage(draft) {
  let msg = '📋 *Order Summary:*\n';
  msg += draft.items.map((i) => `  • ${i.quantity}x ${i.name} — Rs. ${i.total_price}`).join('\n');
  if (draft.coupon_code) {
    msg += `\n\n🏷 Code *${draft.coupon_code}* applied: -Rs. ${draft.discount}`;
  } else if (draft.coupon_error) {
    msg += `\n\n⚠️ ${draft.coupon_error} — order will proceed without it.`;
  }
  msg += `\n\n💰 *Total: Rs. ${draft.total}*`;
  msg += `\n⏱ Estimated time: ~${config.timing.estimatedPrepMax} mins`;
  msg += `\n\nReply "yes" to confirm or tell me what to change.`;
  return msg;
}

// ── Helper: Finalize a confirmed order — saves to DB ──
// Never trusts the draft's previewed discount — a coupon mentioned earlier
// in the conversation could have been used up or expired by confirmation
// time, so it's re-validated and atomically redeemed here, same principle
// as the public checkout flow never trusting a client-supplied amount.
async function finalizeOrder(tenantId, customer, draft) {
  let pricing = { subtotal: draft.subtotal, tax: draft.tax, delivery_fee: draft.delivery_fee, total: draft.total };
  let couponRedemptionId = null;

  if (draft.coupon_code) {
    try {
      const result = await validateAndApplyCoupon(tenantId, customer.id, draft.coupon_code, draft.subtotal, {
        items: draft.items, deliveryFee: draft.delivery_fee,
      });
      couponRedemptionId = result.redemptionId;
      pricing = calculatePricing(draft.items, { discount: result.discount, deliveryFee: draft.delivery_fee });
    } catch {
      // Code stopped working between preview and confirmation (e.g. someone
      // else used the last redemption) — proceed without it rather than
      // failing the whole order at the finalize step.
      pricing = calculatePricing(draft.items, { deliveryFee: draft.delivery_fee });
    }
  }

  const order = await createOrder({
    tenantId,
    customer,
    items: draft.items,
    pricing,
    deliveryAddress: draft.delivery_address || customer.address,
    paymentMethod: draft.payment_method,
    channel: 'whatsapp',
  });

  if (couponRedemptionId) {
    await attachRedemptionToOrder(couponRedemptionId, order.id);
  }

  return order;
}

// ── Helper: resolve which Meta phone_number_id a tenant's messages should
// send from. impl-30 (Embedded Signup) lets each tenant connect their own
// number — prefer that; fall back to the single platform-wide env-configured
// number for tenants that haven't connected one yet (unchanged legacy
// behavior, e.g. demo/single-tenant deployments before impl-30 is used). ──
async function resolveSendingPhoneNumberId(tenantId) {
  if (tenantId) {
    const res = await query(
      `SELECT whatsapp_phone_number_id FROM tenants WHERE id = $1 AND whatsapp_connection_status = 'connected'`,
      [tenantId],
    );
    const id = res.rows[0]?.whatsapp_phone_number_id;
    if (id) return id;
  }
  return config.whatsapp.phoneNumberId || null;
}

// ── Helper: Send reply via WhatsApp Cloud API ──
// tenantId is optional but should be passed whenever the caller has one —
// it's what makes a per-tenant connected number (impl-30) actually used
// instead of silently falling back to the platform default for every tenant.
export async function sendReply(phone, text, tenantId) {
  // In demo mode (no token or placeholder), log to console instead of sending
  const token = config.whatsapp.token;
  if (!token || token.startsWith('your-')) {
    console.log(`[whatsapp:demo] → ${phone}: ${text.slice(0, 200)}…`);
    return;
  }

  const phoneNumberId = await resolveSendingPhoneNumberId(tenantId);
  if (!phoneNumberId) {
    console.error(`[whatsapp] no phone_number_id available (tenant ${tenantId || 'unknown'}) — cannot send`);
    return;
  }

  const url = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${phoneNumberId}/messages`;
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
// Customer-facing wording for every status change. Single source of truth
// for WhatsApp (notifyStatusChange) AND push (routes/orders.js). Order type
// comes from utils/order-type.js — never re-derive it here. Returns null for
// statuses that should not message the customer (e.g. 'new' — handled by
// orderPlacedMessage at checkout).
export function getStatusMessage({ status, orderType = 'delivery', riderName = null }) {
  switch (status) {
    case 'confirmed':
      return "Order confirmed ✅ We're getting started!";
    case 'preparing':
      return 'Your order is being prepared 🍳';
    case 'ready':
      // "Ready" means something different depending on who has to move next.
      // Only a pickup customer should ever be told to come and collect.
      switch (orderType) {
        case 'delivery':
          return 'Your order is ready and will be heading out for delivery shortly! 🛵';
        case 'dine_in':
          return 'Your order is ready and on its way to your table! 🍽️';
        case 'counter':
          return 'Your order is ready! 🎉 Please collect it from the counter.';
        default: // pickup
          return "Your order is ready for pickup! 🎉 Come and collect it whenever you're ready.";
      }
    case 'out_for_delivery':
      // Delivery only (utils/order-type.js gates the transition). Name the
      // rider when we have one; never block the message on it.
      return riderName
        ? `Your order is on its way! 🛵 ${riderName} is bringing it to you now.`
        : 'Your order is on its way! 🛵 Our rider is bringing it to you now.';
    case 'delivered':
      // For everyone but delivery customers this is "collected / served".
      return orderType === 'delivery'
        ? 'Delivered! Enjoy your meal 🍽️'
        : 'Enjoy your meal! 🍽️ Thank you for ordering with us.';
    case 'cancelled':
      return 'Your order has been cancelled. Sorry for the inconvenience.';
    default:
      return null;
  }
}

const PAYMENT_LINES = {
  cash: (total) => `Please keep Rs. ${total} ready in cash for the rider.`,
  jazzcash: (total) => `Pay Rs. ${total} by JazzCash to the rider when your order arrives.`,
  easypaisa: (total) => `Pay Rs. ${total} by EasyPaisa to the rider when your order arrives.`,
  card: (total) => `Pay Rs. ${total} by card when your order arrives.`,
};

// Sent the moment a web order is placed. Deliberately worded as "received",
// not "confirmed": the kitchen's confirmation (STATUS_MESSAGES.confirmed)
// follows as its own message, and the two must not read as duplicates.
export function orderPlacedMessage({ restaurantName, order, items, paymentMethod, notes }) {
  const total = Number(order.total).toLocaleString();
  const lines = [
    `📝 We've received your order #${order.order_number} at ${restaurantName}.`,
    '',
    ...items.map((i) => `  • ${i.quantity}x ${i.name} — Rs. ${Number(i.total_price).toLocaleString()}`),
    '',
    `💰 Total: Rs. ${total}`,
  ];
  const pay = PAYMENT_LINES[paymentMethod];
  if (pay) lines.push(pay(total));
  if (notes) lines.push(`📋 Your note: "${notes}"`);
  lines.push('', "We'll message you as soon as the kitchen confirms it.");
  return lines.join('\n');
}

export async function notifyStatusChange(orderId, tenantId, newStatus) {
  try {
    // One lookup gives us the phone, the fields order type is derived from,
    // and the most recent rider (for the out-for-delivery message).
    const res = await query(
      `SELECT c.phone, o.branch_id, o.table_session_id, o.delivery_address, o.channel, ra.rider_name
       FROM orders o
       LEFT JOIN customers c ON o.customer_id = c.id
       LEFT JOIN LATERAL (
         SELECT r.name AS rider_name FROM rider_assignments x JOIN riders r ON r.id = x.rider_id
         WHERE x.order_id = o.id ORDER BY x.assigned_at DESC LIMIT 1
       ) ra ON true
       WHERE o.id = $1 AND o.tenant_id = $2`,
      [orderId, tenantId],
    );
    const row = res.rows[0];
    const phone = row?.phone;
    if (!phone) return;

    let template = getStatusMessage({ status: newStatus, orderType: getOrderType(row), riderName: row.rider_name });
    if (!template) return;

    // impl-17: recomputed at this exact moment, since the queue may have
    // shifted since the order was placed — never reuse a stale estimate.
    if (newStatus === 'preparing' && row.branch_id) {
      try {
        const { estimateReadyTime } = await import('./eta-agent.js');
        const eta = await estimateReadyTime(row.branch_id, orderId);
        template += ` Estimated ready in ~${eta.estimated_minutes_max} mins.`;
      } catch (err) {
        console.error('[eta-agent] estimate failed (status message sent without it):', err.message);
      }
    }

    await sendReply(phone, template, tenantId);
  } catch (err) {
    console.error('[whatsapp] status notification failed:', err.message);
  }
}

// ── Utility ──
function isOlderThan30Min(timestamp) {
  return Date.now() - new Date(timestamp).getTime() > 30 * 60 * 1000;
}
