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
};
