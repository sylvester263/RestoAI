/**
 * Super Admin API (impl-29) — completely separate from the tenant-scoped api.
 * Uses its own token (superAdminToken) stored in localStorage, signed with a
 * dedicated JWT secret server-side.
 */
const API_BASE = '/api';

function getSuperAdminToken() {
  return localStorage.getItem('superAdminToken');
}

async function request(path, options = {}) {
  const token = getSuperAdminToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options.headers,
  };
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Request failed (${res.status})`);
  }
  if (res.status === 401) {
    localStorage.removeItem('superAdminToken');
    throw new Error('Session expired');
  }
  if (!res.ok) {
    throw new Error(data.error?.message || 'Request failed');
  }
  return data;
}

// Public (unauthenticated) requests — no token attached
async function requestPublic(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Request failed (${res.status})`);
  }
  if (!res.ok) throw new Error(data.error?.message || 'Request failed');
  return data;
}

export const superAdminApi = {
  // Auth (public)
  loginStep1: (email, password) =>
    requestPublic('/super-admin/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  loginStep2: (mfaToken, totpCode) =>
    requestPublic('/super-admin/verify-mfa', {
      method: 'POST',
      body: JSON.stringify({ mfaToken, totpCode }),
    }),
  setupMfaPhase1: (mfaToken) =>
    requestPublic('/super-admin/setup-mfa', {
      method: 'POST',
      body: JSON.stringify({ mfaToken }),
    }),
  setupMfaPhase2: (mfaToken, secret, totpCode) =>
    requestPublic('/super-admin/setup-mfa', {
      method: 'POST',
      body: JSON.stringify({ mfaToken, secret, totpCode }),
    }),

  // Tenants (authenticated)
  getTenants: () => request('/super-admin/tenants'),
  getExpiringTenants: (days = 30) => request(`/super-admin/tenants/expiring?days=${days}`),
  getTenant: (id) => request(`/super-admin/tenants/${id}`),
  extendSubscription: (id, newEndDate, reason) =>
    request(`/super-admin/tenants/${id}/extend`, {
      method: 'POST',
      body: JSON.stringify({ newEndDate, reason }),
    }),
  suspendTenant: (id, reason) =>
    request(`/super-admin/tenants/${id}/suspend`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  reactivateTenant: (id, reason) =>
    request(`/super-admin/tenants/${id}/reactivate`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  applyComp: (id, endDate, reason) =>
    request(`/super-admin/tenants/${id}/comp`, {
      method: 'POST',
      body: JSON.stringify({ endDate, reason }),
    }),

  // Audit log (authenticated)
  getAuditLog: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/super-admin/audit-log${qs ? `?${qs}` : ''}`);
  },
};
