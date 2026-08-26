// Tenant-slug-scoped localStorage helpers for the public customer ordering
// flow. No backend session exists for customers, so cart + identity persist
// per-restaurant in the browser only.

const cartKey = (slug) => `restoai_cart_${slug}`;
const identityKey = (slug) => `restoai_identity_${slug}`;

export function getCart(slug) {
  try {
    return JSON.parse(localStorage.getItem(cartKey(slug)) || '[]');
  } catch {
    return [];
  }
}

export function setCart(slug, items) {
  localStorage.setItem(cartKey(slug), JSON.stringify(items));
}

export function clearCart(slug) {
  localStorage.removeItem(cartKey(slug));
}

export function addToCart(slug, item) {
  const cart = getCart(slug);
  const existing = cart.find((i) => i.menu_item_id === item.menu_item_id);
  if (existing) {
    existing.quantity += item.quantity;
  } else {
    cart.push(item);
  }
  setCart(slug, cart);
  return cart;
}

export function updateCartQuantity(slug, menuItemId, quantity) {
  let cart = getCart(slug);
  if (quantity <= 0) {
    cart = cart.filter((i) => i.menu_item_id !== menuItemId);
  } else {
    const item = cart.find((i) => i.menu_item_id === menuItemId);
    if (item) item.quantity = quantity;
  }
  setCart(slug, cart);
  return cart;
}

export function getIdentity(slug) {
  try {
    return JSON.parse(localStorage.getItem(identityKey(slug)) || 'null');
  } catch {
    return null;
  }
}

export function setIdentity(slug, { name, phone }) {
  localStorage.setItem(identityKey(slug), JSON.stringify({ name, phone }));
}
