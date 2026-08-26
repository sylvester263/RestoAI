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

  const data = await res.json();
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
