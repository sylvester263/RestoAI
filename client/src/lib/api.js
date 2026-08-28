const API_BASE = '/api';

function getToken() {
  return localStorage.getItem('token');
}

async function parseResponse(res) {
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

  return parseResponse(res);
}

// For unauthenticated endpoints (contact form, invite-accept) — no token
// attached, no redirect-on-401, since there's no session to have expired.
async function requestPublic(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  return parseResponse(res);
}

// Rider requests use a separate token (a different localStorage key and a
// different JWT type — see server/src/middleware/auth.js) so a rider
// session and an owner/staff session can coexist in the same browser
// without clobbering each other, and expiry redirects to the rider login.
function getRiderToken() {
  return localStorage.getItem('riderToken');
}

async function requestRider(path, options = {}) {
  const token = getRiderToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options.headers,
  };

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    localStorage.removeItem('riderToken');
    localStorage.removeItem('riderInfo');
    window.location.href = '/rider/login';
    throw new Error('Session expired');
  }

  return parseResponse(res);
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
  uploadMenuItemImage: (id, file) => {
    const form = new FormData();
    form.append('photo', file);
    const token = getToken();
    return fetch(`${API_BASE}/menu/${id}/image`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Upload failed');
      return data;
    });
  },
  deleteMenuItemImage: (id) => request(`/menu/${id}/image`, { method: 'DELETE' }),

  // Orders
  getOrders: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/orders${qs ? `?${qs}` : ''}`);
  },
  getKitchenOrders: () => request('/orders/kitchen'),
  getOrder: (id) => request(`/orders/${id}`),
  updateOrderStatus: (id, status) =>
    request(`/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  getUnassignedDeliveries: () => request('/orders/deliveries/unassigned'),
  assignRider: (orderId, riderId) =>
    request(`/orders/${orderId}/assign-rider`, { method: 'POST', body: JSON.stringify({ rider_id: riderId || undefined }) }),
  updateDeliveryStatus: (orderId, status, cashCollected) =>
    request(`/orders/${orderId}/delivery-status`, { method: 'POST', body: JSON.stringify({ status, cash_collected: cashCollected }) }),

  // Riders
  getRiders: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/riders${qs ? `?${qs}` : ''}`);
  },
  createRider: (body) => request('/riders', { method: 'POST', body: JSON.stringify(body) }),
  updateRider: (id, body) => request(`/riders/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  getRiderAssignments: (id) => request(`/riders/${id}/assignments`),
  reconcileRider: (id, periodStart, periodEnd) =>
    request(`/riders/${id}/reconcile`, { method: 'POST', body: JSON.stringify({ period_start: periodStart, period_end: periodEnd }) }),
  getReconciliations: () => request('/riders/reconciliations'),
  resetRiderPin: (id) => request(`/riders/${id}/reset-pin`, { method: 'POST' }),

  // Staff invites (owner/manager)
  getStaffInvites: () => request('/staff-invites'),
  createStaffInvite: (body) => request('/staff-invites', { method: 'POST', body: JSON.stringify(body) }),

  // Customers (CRM)
  getCustomers: (search) => request(`/customers${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  getCustomerProfile: (id) => request(`/customers/${id}/profile`),
  addCustomerTag: (id, tag) => request(`/customers/${id}/tags`, { method: 'POST', body: JSON.stringify({ tag }) }),
  removeCustomerTag: (id, tag) => request(`/customers/${id}/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' }),

  // Segments
  getSegments: () => request('/segments'),
  createSegment: (body) => request('/segments', { method: 'POST', body: JSON.stringify(body) }),
  getSegmentCustomers: (id) => request(`/segments/${id}/customers`),
  getRfmSegments: () => request('/segments/rfm'),
  getRfmSegmentCustomers: (label) => request(`/segments/rfm/customers?label=${encodeURIComponent(label)}`),

  // Permissions (owner-only)
  getPermissions: () => request('/permissions'),
  updateRolePermissions: (role, permissionKeys) =>
    request(`/permissions/${role}`, { method: 'PUT', body: JSON.stringify({ permission_keys: permissionKeys }) }),

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

  // Branch analytics (impl-25)
  compareBranches: (period) => request(`/analytics/branches/compare?period=${period}`),
  getBranchAnalytics: (id, period) => request(`/analytics/branches/${id}?period=${period}`),
  getBranchBenchmark: (id, period) => request(`/analytics/branches/${id}/benchmark?period=${period}`),
  getBranchStaffPerformance: (id, period) => request(`/analytics/branches/${id}/staff-performance?period=${period}`),
  queryInsights: (question) =>
    request('/insights/query', { method: 'POST', body: JSON.stringify({ question }) }),

  // WhatsApp simulation
  simulateWhatsApp: (phone, message) =>
    request('/whatsapp/simulate', { method: 'POST', body: JSON.stringify({ phone, message }) }),

  // Inventory — ingredients (impl-08)
  getIngredients: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/inventory${qs ? `?${qs}` : ''}`);
  },
  createIngredient: (body) => request('/inventory', { method: 'POST', body: JSON.stringify(body) }),
  updateIngredient: (id, body) => request(`/inventory/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteIngredient: (id) => request(`/inventory/${id}`, { method: 'DELETE' }),

  // Recipes (impl-08)
  getMenuItemRecipe: (menuItemId) => request(`/menu/${menuItemId}/recipe`),
  setMenuItemRecipe: (menuItemId, ingredients) =>
    request(`/menu/${menuItemId}/recipe`, { method: 'PUT', body: JSON.stringify({ ingredients }) }),

  // Suppliers (impl-08)
  getSuppliers: () => request('/suppliers'),
  createSupplier: (body) => request('/suppliers', { method: 'POST', body: JSON.stringify(body) }),
  updateSupplier: (id, body) => request(`/suppliers/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  // Purchase orders (impl-08)
  getPurchaseOrders: () => request('/purchase-orders'),
  getPurchaseOrder: (id) => request(`/purchase-orders/${id}`),
  createPurchaseOrder: (body) => request('/purchase-orders', { method: 'POST', body: JSON.stringify(body) }),
  receivePurchaseOrder: (id) => request(`/purchase-orders/${id}/receive`, { method: 'POST' }),

  // Replenishment agent (impl-19)
  getReplenishmentSuggestions: (status = 'pending') => request(`/agents/replenishment/suggestions?status=${status}`),
  approveReplenishmentSuggestion: (id, supplierId) =>
    request(`/agents/replenishment/suggestions/${id}/approve`, { method: 'POST', body: JSON.stringify(supplierId ? { supplier_id: supplierId } : {}) }),
  dismissReplenishmentSuggestion: (id) =>
    request(`/agents/replenishment/suggestions/${id}/status`, { method: 'PUT', body: JSON.stringify({ status: 'dismissed' }) }),

  // Menu insight agent (impl-20)
  getMenuInsights: (status = 'new') => request(`/agents/menu-insights?status=${status}`),
  updateMenuInsightStatus: (id, status) =>
    request(`/agents/menu-insights/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),

  // Coupons (impl-12)
  getCoupons: () => request('/coupons'),
  createCoupon: (body) => request('/coupons', { method: 'POST', body: JSON.stringify(body) }),
  setCouponActive: (id, active) => request(`/coupons/${id}`, { method: 'PUT', body: JSON.stringify({ active }) }),

  // Campaigns
  getCampaigns: () => request('/campaigns'),
  createCampaign: (body) => request('/campaigns', { method: 'POST', body: JSON.stringify(body) }),
  addRecipients: (id, body) => request(`/campaigns/${id}/recipients`, { method: 'POST', body: JSON.stringify(body || {}) }),
  sendCampaign: (id) => request(`/campaigns/${id}/send`, { method: 'POST' }),
  getCampaignStatus: (id) => request(`/campaigns/${id}/status`),

  // POS
  getPosTabs: (branchId) => request(`/pos/tabs${branchId ? `?branch_id=${branchId}` : ''}`),
  getPosTab: (id) => request(`/pos/tabs/${id}`),
  openPosTab: (body) => request('/pos/tabs', { method: 'POST', body: JSON.stringify(body) }),
  addPosTabItems: (id, body) => request(`/pos/tabs/${id}/items`, { method: 'POST', body: JSON.stringify(body) }),
  applyPosTabDiscount: (id, body) => request(`/pos/tabs/${id}/discount`, { method: 'POST', body: JSON.stringify(body) }),
  voidPosTab: (id) => request(`/pos/tabs/${id}/void`, { method: 'POST' }),
  settlePosTab: (id, body) => request(`/pos/tabs/${id}/settle`, { method: 'POST', body: JSON.stringify(body) }),
  holdPosTab: (id) => request(`/pos/tabs/${id}/hold`, { method: 'POST' }),
  resumePosTab: (id) => request(`/pos/tabs/${id}/resume`, { method: 'POST' }),
  transferPosTab: (id, tableId) => request(`/pos/tabs/${id}/transfer`, { method: 'POST', body: JSON.stringify({ table_id: tableId }) }),
  voidPosTabItem: (id, body) => request(`/pos/tabs/${id}/void-item`, { method: 'POST', body: JSON.stringify(body) }),
  refundPosOrder: (orderId, body) => request(`/pos/orders/${orderId}/refund`, { method: 'POST', body: JSON.stringify(body) }),
  getPosOrderVoids: (orderId) => request(`/pos/orders/${orderId}/voids`),
  getPosReceipt: (orderId) => request(`/pos/receipts/${orderId}`),
  getTaxConfig: (branchId) => request(`/pos/tax-config?branch_id=${branchId}`),
  setTaxConfig: (branchId, body) => request('/pos/tax-config', { method: 'PUT', body: JSON.stringify({ branch_id: branchId, ...body }) }),
  openPosShift: (body) => request('/pos/shifts/open', { method: 'POST', body: JSON.stringify(body) }),
  getCurrentPosShift: (branchId) => request(`/pos/shifts/current?branch_id=${branchId}`),
  getPosShifts: (branchId) => request(`/pos/shifts${branchId ? `?branch_id=${branchId}` : ''}`),
  closePosShift: (id, closingCashCounted) =>
    request(`/pos/shifts/${id}/close`, { method: 'POST', body: JSON.stringify({ closing_cash_counted: closingCashCounted }) }),
  getPosZReport: (id) => request(`/pos/shifts/${id}/z-report`),

  // Landing page builder
  getLandingPage: () => request('/landing-page'),
  saveLandingPage: (body) => request('/landing-page', { method: 'PUT', body: JSON.stringify(body) }),
  checkSubdomain: (value) => request(`/landing-page/subdomain-check?value=${encodeURIComponent(value)}`),
  publishLandingPage: (published = true) =>
    request('/landing-page/publish', { method: 'POST', body: JSON.stringify({ published }) }),

  // Agentic AI systems (impl-14..21)
  getAgentSettings: () => request('/agents/settings'),
  updateAgentSettings: (body) => request('/agents/settings', { method: 'PUT', body: JSON.stringify(body) }),
  getWinbackPreview: () => request('/agents/winback/preview'),
  suggestDispatchRider: (orderId) => request(`/agents/dispatch/suggest/${orderId}`),
  getReconciliationFlags: (status = 'open') => request(`/agents/reconciliation/flags?status=${status}`),
  updateReconciliationFlagStatus: (id, status) =>
    request(`/agents/reconciliation/flags/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
  getAbuseFlags: (status = 'open') => request(`/agents/abuse-detection/flags?status=${status}`),
  updateAbuseFlagStatus: (id, status) =>
    request(`/agents/abuse-detection/flags/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
};

// RestoAI's own marketing site — unauthenticated, no tenant JWT (this is a
// lead for RestoAI itself, not a request scoped to any restaurant tenant)
export const marketingApi = {
  submitContact: (body) => requestPublic('/contact', { method: 'POST', body: JSON.stringify(body) }),
  acceptStaffInvite: (token, body) => requestPublic(`/staff-invites/${token}/accept`, { method: 'POST', body: JSON.stringify(body) }),
};

// Rider self-service app — separate token type (JWT signed with a distinct
// secret server-side), separate localStorage key, own login/expiry flow.
export const riderApi = {
  login: (tenantSlug, phone, pin) =>
    requestPublic('/rider-auth/login', { method: 'POST', body: JSON.stringify({ tenantSlug, phone, pin }) }),
  me: () => requestRider('/rider-app/me'),
  getAssignments: () => requestRider('/rider-app/assignments'),
  getSummary: () => requestRider('/rider-app/summary'),
  updateAssignmentStatus: (orderId, status, cashCollected) =>
    requestRider(`/rider-app/assignments/${orderId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status, cash_collected: cashCollected }),
    }),
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

  // Coupons (impl-12)
  previewCoupon: (slug, code, phone, subtotal) =>
    request(`/public/${slug}/coupons/${encodeURIComponent(code)}/preview?phone=${encodeURIComponent(phone || '')}&subtotal=${subtotal}`),
  validateCoupon: (slug, body) => request(`/public/${slug}/coupons/validate`, { method: 'POST', body: JSON.stringify(body) }),
  getReferralCode: (slug, phone) => request(`/public/${slug}/referral?phone=${encodeURIComponent(phone)}`),

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
