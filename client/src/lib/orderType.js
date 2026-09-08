// Display labels for the `order_type` code the server puts on every order
// payload. The client never derives order type itself — that logic lives in
// exactly one place, server/src/utils/order-type.js — so a surface can only
// ever disagree with another by mislabelling, never by misclassifying.
export const ORDER_TYPE_LABELS = {
  dine_in: 'Dine-in',
  delivery: 'Delivery',
  counter: 'Counter',
  pickup: 'Pickup',
};

export function orderTypeLabel(orderType) {
  return ORDER_TYPE_LABELS[orderType] || 'Order';
}

// Human labels for order statuses, shared by every staff surface.
export const STATUS_LABELS = {
  new: 'New',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  ready: 'Ready',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

// Which status a staff "advance" action moves an order to. Only delivery
// orders pass through out_for_delivery; the server enforces the same rule.
export function nextStatusFor(order) {
  const flow = order.order_type === 'delivery'
    ? ['new', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered']
    : ['new', 'confirmed', 'preparing', 'ready', 'delivered'];
  const i = flow.indexOf(order.status);
  return i >= 0 && i < flow.length - 1 ? flow[i + 1] : null;
}
