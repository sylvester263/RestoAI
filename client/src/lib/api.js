const API_BASE = '/api';

function getToken() {
  return localStorage.getItem('token');
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options.headers,
  };

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    localStorage.removeItem('token');
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  let data;
  try {
    data = await res.json();
  } catch {
    if (res.status === 429) throw new Error('Too many requests — please wait a moment and try again.');
    throw new Error(`Request failed (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(data.error?.message || 'Request failed');
  }
  return data;
}

export const api = {
  // Auth
  login: (body) => request('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  register: (body) => request('/auth/register', { method: 'POST', body: JSON.stringify(body) }),

  // Menu
  getMenu: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/menu${qs ? `?${qs}` : ''}`);
  },
  getCategories: () => request('/menu/categories'),
  createMenuItem: (body) => request('/menu', { method: 'POST', body: JSON.stringify(body) }),
  updateMenuItem: (id, body) => request(`/menu/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteMenuItem: (id) => request(`/menu/${id}`, { method: 'DELETE' }),
  digitizeMenu: (image_base64) => request('/menu/digitize', { method: 'POST', body: JSON.stringify({ image_base64 }) }),

  // Orders
  getOrders: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/orders${qs ? `?${qs}` : ''}`);
  },
  getKitchenOrders: () => request('/orders/kitchen'),
  getOrder: (id) => request(`/orders/${id}`),
  updateOrderStatus: (id, status) =>
    request(`/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),

  // Branches
  getBranches: () => request('/branches'),
  createBranch: (body) => request('/branches', { method: 'POST', body: JSON.stringify(body) }),
  updateBranch: (id, body) => request(`/branches/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  // Dine-in tables
  getTables: (branchId) => request(`/branches/${branchId}/tables`),
  createTable: (branchId, tableNumber) =>
    request(`/branches/${branchId}/tables`, { method: 'POST', body: JSON.stringify({ table_number: tableNumber }) }),
  closeTableSession: (sessionId) => request(`/table-sessions/${sessionId}/close`, { method: 'POST' }),

  // Reservations
  getReservations: (branchId, date) => request(`/branches/${branchId}/reservations${date ? `?date=${date}` : ''}`),
  updateReservationStatus: (id, status) =>
    request(`/reservations/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),

  // Insights
  getDashboard: () => request('/insights/dashboard'),
  queryInsights: (question) =>
    request('/insights/query', { method: 'POST', body: JSON.stringify({ question }) }),

  // WhatsApp simulation
  simulateWhatsApp: (phone, message) =>
    request('/whatsapp/simulate', { method: 'POST', body: JSON.stringify({ phone, message }) }),

  // Inventory
  getInventory: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/inventory${qs ? `?${qs}` : ''}`);
  },
  createInventoryItem: (body) => request('/inventory', { method: 'POST', body: JSON.stringify(body) }),
  updateInventoryItem: (id, body) => request(`/inventory/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteInventoryItem: (id) => request(`/inventory/${id}`, { method: 'DELETE' }),
  restockItem: (id, quantity) => request(`/inventory/${id}/restock`, { method: 'POST', body: JSON.stringify({ quantity }) }),

  // Campaigns
  getCampaigns: () => request('/campaigns'),
  createCampaign: (body) => request('/campaigns', { method: 'POST', body: JSON.stringify(body) }),
  addRecipients: (id) => request(`/campaigns/${id}/recipients`, { method: 'POST' }),
  sendCampaign: (id) => request(`/campaigns/${id}/send`, { method: 'POST' }),
  getCampaignStatus: (id) => request(`/campaigns/${id}/status`),

  // POS
  getPosTabs: (branchId) => request(`/pos/tabs${branchId ? `?branch_id=${branchId}` : ''}`),
  getPosTab: (id) => request(`/pos/tabs/${id}`),
  openPosTab: (body) => request('/pos/tabs', { method: 'POST', body: JSON.stringify(body) }),
  addPosTabItems: (id, body) => request(`/pos/tabs/${id}/items`, { method: 'POST', body: JSON.stringify(body) }),
  applyPosTabDiscount: (id, body) => request(`/pos/tabs/${id}/discount`, { method: 'POST', body: JSON.stringify(body) }),
  voidPosTab: (id) => request(`/pos/tabs/${id}/void`, { method: 'POST' }),
  settlePosTab: (id, paymentMethod) =>
    request(`/pos/tabs/${id}/settle`, { method: 'POST', body: JSON.stringify({ payment_method: paymentMethod }) }),

  // Landing page builder
  getLandingPage: () => request('/landing-page'),
  saveLandingPage: (body) => request('/landing-page', { method: 'PUT', body: JSON.stringify(body) }),
  checkSubdomain: (value) => request(`/landing-page/subdomain-check?value=${encodeURIComponent(value)}`),
  publishLandingPage: (published = true) =>
    request('/landing-page/publish', { method: 'POST', body: JSON.stringify({ published }) }),
};

// Public customer ordering endpoints — unauthenticated, no tenant JWT
export const publicApi = {
  getRestaurant: (slug) => request(`/public/${slug}`),
  getMenu: (slug) => request(`/public/${slug}/menu`),
  createOrder: (slug, body) => request(`/public/${slug}/orders`, { method: 'POST', body: JSON.stringify(body) }),
  getOrderStatus: (slug, orderId, phone) =>
    request(`/public/${slug}/orders/${orderId}?phone=${encodeURIComponent(phone)}`),
  createReservation: (slug, body) =>
    request(`/public/${slug}/reservations`, { method: 'POST', body: JSON.stringify(body) }),

  // Loyalty
  getLoyaltyBalance: (slug, phone) => request(`/public/${slug}/loyalty/balance?phone=${encodeURIComponent(phone)}`),

  // Reviews
  submitReview: (slug, body) => request(`/public/${slug}/reviews`, { method: 'POST', body: JSON.stringify(body) }),
  getItemReviews: (slug, menuItemId) => request(`/public/${slug}/reviews/item/${menuItemId}`),

  // Push notifications
  getVapidKey: (slug) => request(`/public/${slug}`).then((r) => r.vapidPublicKey),
  subscribePush: (slug, body) =>
    request(`/public/${slug}/notifications/subscribe`, { method: 'POST', body: JSON.stringify(body) }),

  // In-app AI assistant
  getRecommendation: (slug, message) =>
    request(`/public/${slug}/recommendations`, { method: 'POST', body: JSON.stringify({ message }) }),
};

// Published landing pages — unauthenticated, resolved by subdomain
export const sitesApi = {
  getSite: (subdomain) => request(`/sites/${subdomain}`),
};

// Dine-in table session endpoints — unauthenticated, scanned via QR
export const tableApi = {
  getSession: (qrToken) => request(`/table-sessions/${qrToken}`),
  placeOrder: (sessionId, body) =>
    request(`/table-sessions/${sessionId}/orders`, { method: 'POST', body: JSON.stringify(body) }),
  requestBill: (sessionId) => request(`/table-sessions/${sessionId}/request-bill`, { method: 'POST' }),
  getBill: (sessionId) => request(`/table-sessions/${sessionId}/bill`),
};

// In-store display boards — unauthenticated, meant to run unattended on a TV
export const displayApi = {
  getTokenBoard: (branchId) => request(`/branches/${branchId}/token-board`),
  getMenuBoard: (branchId) => request(`/branches/${branchId}/menu-board`),
};
