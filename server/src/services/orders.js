/**
 * Order Service — shared order-domain logic used by both the WhatsApp AI
 * pipeline and the public web ordering flow, so pricing and order-creation
 * exist in exactly one place.
 */
import { query, withTransaction } from '../db/pool.js';
import { createPaymentForOrder } from './payments.js';
import { depleteIngredientsForOrder, autoDisableUnmakeableItems, alertIfCrossedThreshold } from './inventory.js';

export class OrderError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.expose = true;
    // Optional machine-readable extras (e.g. which cart items are sold out)
    // so a client can fix the cart rather than just show the sentence.
    this.details = details;
  }
}

// ── Get or create a customer record ──
export async function getOrCreateCustomer(tenantId, phone, { name, address } = {}) {
  const res = await query(
    'SELECT * FROM customers WHERE tenant_id = $1 AND phone = $2',
    [tenantId, phone],
  );
  if (res.rows.length > 0) {
    if (name || address) {
      const updated = await query(
        `UPDATE customers SET name = COALESCE($3, name), address = COALESCE($4, address), updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 RETURNING *`,
        [res.rows[0].id, tenantId, name || null, address || null],
      );
      return updated.rows[0];
    }
    return res.rows[0];
  }

  const newRes = await query(
    'INSERT INTO customers (tenant_id, phone, name, address) VALUES ($1, $2, $3, $4) RETURNING *',
    [tenantId, phone, name || null, address || null],
  );
  return newRes.rows[0];
}

// ── Resolve cart items (menu_item_id + quantity) against server-trusted prices ──
export async function resolveOrderItems(tenantId, cartItems) {
  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    throw new OrderError(400, 'Cart is empty');
  }

  const ids = cartItems.map((i) => i.menu_item_id);
  const res = await query(
    `SELECT id, name, price, is_available FROM menu_items WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
    [tenantId, ids],
  );
  const byId = new Map(res.rows.map((row) => [row.id, row]));

  // Tell the customer *which* items can't be ordered, and hand the ids back
  // so the client can drop them from the cart (audit C6: a sold-out item
  // stuck in the cart used to make checkout impossible).
  const blocked = cartItems
    .map((c) => ({ id: c.menu_item_id, row: byId.get(c.menu_item_id) }))
    .filter(({ row }) => !row || !row.is_available);
  if (blocked.length > 0) {
    const names = blocked.map(({ row }) => row?.name).filter(Boolean);
    const message = names.length === 0
      ? 'One of the items in your cart is no longer on the menu. Please remove it and try again.'
      : names.length === 1
        ? `"${names[0]}" is sold out right now — please remove it from your cart to continue.`
        : `${names.map((n) => `"${n}"`).join(', ')} are sold out right now — please remove them from your cart to continue.`;
    throw new OrderError(400, message, { unavailable_item_ids: blocked.map(({ id }) => id) });
  }

  const orderItems = [];
  for (const cartItem of cartItems) {
    const menuItem = byId.get(cartItem.menu_item_id);
    const quantity = Math.max(1, Math.min(50, Math.trunc(cartItem.quantity) || 1));
    const unitPrice = parseFloat(menuItem.price);
    orderItems.push({
      menu_item_id: menuItem.id,
      name: menuItem.name,
      quantity,
      unit_price: unitPrice,
      total_price: unitPrice * quantity,
    });
  }
  return orderItems;
}

// ── Compute subtotal/tax/delivery/total from resolved order items ──
// deliveryFee defaults to the existing flat fee; dine-in orders pass 0.
// discount (e.g. redeemed loyalty points) is subtracted from the total, floored at 0.
// taxRate is a fraction (0.05 = 5%) and defaults to the pre-impl-24 flat rate
// for every channel except POS, which passes the branch's configured
// tax_config rate instead (see routes/pos.js) — POS settlement then
// recomputes tax on the post-discount subtotal anyway (services/pos-billing.js),
// so this per-round figure is a provisional/display value until settled.
export function calculatePricing(orderItems, { deliveryFee = 100, discount = 0, taxRate = 0.05 } = {}) {
  const subtotal = orderItems.reduce((sum, i) => sum + i.total_price, 0);
  const tax = Math.round(subtotal * taxRate);
  const total = Math.max(0, subtotal + tax + deliveryFee - discount);
  return { subtotal, tax, delivery_fee: deliveryFee, discount, total };
}

// ── Persist a finalized order ──
export async function createOrder({ tenantId, customer, items, pricing, deliveryAddress, paymentMethod, channel, notes, branchId, tableSessionId, posTabId }) {
  let resolvedBranchId = branchId;
  if (!resolvedBranchId) {
    const branchRes = await query('SELECT id FROM branches WHERE tenant_id = $1 LIMIT 1', [tenantId]);
    resolvedBranchId = branchRes.rows[0]?.id;
  }

  // Order creation, item rows, the customer's running totals, and impl-08's
  // recipe-based ingredient depletion all happen in one transaction — stock
  // and orders must never be able to drift out of sync with each other.
  const { order, touchedIngredients } = await withTransaction(async (client) => {
    const orderRes = await client.query(
      `INSERT INTO orders (tenant_id, branch_id, customer_id, channel, status, subtotal, tax, delivery_fee, discount_amount, total, delivery_address, payment_method, notes, table_session_id, pos_tab_id)
       VALUES ($1, $2, $3, $4, 'new', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        tenantId,
        resolvedBranchId,
        customer.id,
        channel,
        pricing.subtotal,
        pricing.tax,
        pricing.delivery_fee,
        pricing.discount || 0,
        pricing.total,
        tableSessionId ? null : (deliveryAddress || customer.address),
        paymentMethod || null,
        notes || null,
        tableSessionId || null,
        posTabId || null,
      ],
    );
    const order = orderRes.rows[0];

    for (const item of items) {
      await client.query(
        `INSERT INTO order_items (order_id, menu_item_id, name, quantity, unit_price, total_price)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [order.id, item.menu_item_id, item.name, item.quantity, item.unit_price, item.total_price],
      );
    }

    if (customer?.id) {
      await client.query(
        `UPDATE customers SET order_count = order_count + 1, total_spent = total_spent + $2, updated_at = NOW() WHERE id = $1`,
        [customer.id, pricing.total],
      );
    }

    const touchedIngredients = await depleteIngredientsForOrder(client, items);
    if (touchedIngredients.size > 0) {
      await autoDisableUnmakeableItems(client, tenantId, [...touchedIngredients.keys()]);
    }

    return { order, touchedIngredients };
  });

  // Auto-create a payment record (COD starts pending, marked paid on delivery)
  if (paymentMethod) {
    await createPaymentForOrder(tenantId, order.id, pricing.total, paymentMethod);
  }

  // Best-effort, post-commit — a notification failure must never roll back a sale.
  alertIfCrossedThreshold(tenantId, touchedIngredients).catch((err) =>
    console.error('[inventory] low-stock alert failed:', err.message));

  return { ...order, items };
}
