/**
 * Order type — the ONE place that decides whether an order is dine-in,
 * delivery, counter (POS walk-up) or pickup.
 *
 * Every surface that needs to know (kitchen display, order tracking, WhatsApp
 * and push wording, the token board, rider dispatch) must use this module,
 * either by calling getOrderType() on a row or by selecting orderTypeSql()
 * as `order_type` so the client receives the answer ready-made. The client
 * never derives it: client/src/lib/orderType.js only maps the code to a
 * label. Drift between per-surface re-implementations is exactly what let a
 * delivery order be told "Your order is ready! Come collect it" and show up
 * on the in-store pickup board.
 *
 * Precedence (matches the original Kitchen.jsx 4-way check):
 *   1. table_session_id set        → dine_in
 *   2. delivery address present    → delivery
 *   3. channel = 'pos'             → counter
 *   4. otherwise                   → pickup
 */

export const ORDER_TYPES = Object.freeze({
  DINE_IN: 'dine_in',
  DELIVERY: 'delivery',
  COUNTER: 'counter',
  PICKUP: 'pickup',
});

export function getOrderType(order) {
  if (!order) return ORDER_TYPES.PICKUP;
  if (order.table_session_id) return ORDER_TYPES.DINE_IN;
  if (order.delivery_address && String(order.delivery_address).trim() !== '') return ORDER_TYPES.DELIVERY;
  if (order.channel === 'pos') return ORDER_TYPES.COUNTER;
  return ORDER_TYPES.PICKUP;
}

export function isDelivery(order) {
  return getOrderType(order) === ORDER_TYPES.DELIVERY;
}

/**
 * The same rule as a SQL CASE expression, for queries that need to filter or
 * label in the database (token board, unassigned deliveries, list payloads).
 * Keep the branch order identical to getOrderType() above.
 *
 *   SELECT ${orderTypeSql('o')} AS order_type FROM orders o ...
 *   WHERE ${orderTypeSql('o')} <> 'delivery'
 */
export function orderTypeSql(alias = 'o') {
  const a = alias ? `${alias}.` : '';
  return `(CASE
    WHEN ${a}table_session_id IS NOT NULL THEN '${ORDER_TYPES.DINE_IN}'
    WHEN NULLIF(BTRIM(${a}delivery_address), '') IS NOT NULL THEN '${ORDER_TYPES.DELIVERY}'
    WHEN ${a}channel = 'pos' THEN '${ORDER_TYPES.COUNTER}'
    ELSE '${ORDER_TYPES.PICKUP}'
  END)`;
}

/**
 * Status lifecycle per order type. `out_for_delivery` exists only for
 * delivery orders; everything else goes straight from ready to delivered.
 */
export function statusFlowFor(orderType) {
  return orderType === ORDER_TYPES.DELIVERY
    ? ['new', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered']
    : ['new', 'confirmed', 'preparing', 'ready', 'delivered'];
}

export function canEnterStatus(order, status) {
  if (status === 'cancelled') return true;
  return statusFlowFor(getOrderType(order)).includes(status);
}
