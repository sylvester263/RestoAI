/**
 * Order Service — shared order-domain logic used by both the WhatsApp AI
 * pipeline and the public web ordering flow, so pricing and order-creation
 * exist in exactly one place.
 */
import { query } from '../db/pool.js';

export class OrderError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true;
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
    `SELECT id, name, price FROM menu_items WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND is_available = true`,
    [tenantId, ids],
  );
  const byId = new Map(res.rows.map((row) => [row.id, row]));

  const orderItems = [];
  for (const cartItem of cartItems) {
    const menuItem = byId.get(cartItem.menu_item_id);
    if (!menuItem) {
      throw new OrderError(400, `One or more items are no longer available`);
    }
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
export function calculatePricing(orderItems) {
  const subtotal = orderItems.reduce((sum, i) => sum + i.total_price, 0);
  const tax = Math.round(subtotal * 0.05);
  const deliveryFee = 100;
  const total = subtotal + tax + deliveryFee;
  return { subtotal, tax, delivery_fee: deliveryFee, total };
}

// ── Persist a finalized order ──
export async function createOrder({ tenantId, customer, items, pricing, deliveryAddress, paymentMethod, channel, notes }) {
  const branchRes = await query('SELECT id FROM branches WHERE tenant_id = $1 LIMIT 1', [tenantId]);

  const orderRes = await query(
    `INSERT INTO orders (tenant_id, branch_id, customer_id, channel, status, subtotal, tax, delivery_fee, total, delivery_address, payment_method, notes)
     VALUES ($1, $2, $3, $4, 'new', $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      tenantId,
      branchRes.rows[0]?.id,
      customer.id,
      channel,
      pricing.subtotal,
      pricing.tax,
      pricing.delivery_fee,
      pricing.total,
      deliveryAddress || customer.address,
      paymentMethod,
      notes || null,
    ],
  );

  const order = orderRes.rows[0];

  for (const item of items) {
    await query(
      `INSERT INTO order_items (order_id, menu_item_id, name, quantity, unit_price, total_price)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [order.id, item.menu_item_id, item.name, item.quantity, item.unit_price, item.total_price],
    );
  }

  await query(
    `UPDATE customers SET order_count = order_count + 1, total_spent = total_spent + $2, updated_at = NOW() WHERE id = $1`,
    [customer.id, pricing.total],
  );

  return { ...order, items };
}
