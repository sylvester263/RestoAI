/**
 * Super Admin App (impl-29) — main application after authentication.
 *
 * Views:
 * - tenants: List of all tenants (default: sorted by expiration)
 * - tenant-detail: Single tenant with subscription management
 * - audit-log: Filterable audit trail
 *
 * Uses internal state routing — no need for react-router since this is a
 * completely separate app shell from the tenant admin panel.
 */
import { useState, useEffect, useCallback } from 'react';
import { superAdminApi } from './superAdminApi';
import {
  Building2, FileText, LogOut, Search, AlertTriangle, CheckCircle,
  XCircle, Clock, ChevronLeft, RefreshCw, Shield, Calendar,
} from 'lucide-react';

export default function SuperAdminApp({ admin, onLogout }) {
  const [view, setView] = useState('tenants'); // 'tenants' | 'tenant-detail' | 'audit-log'
  const [tenants, setTenants] = useState([]);
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [auditLog, setAuditLog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('expiring'); // 'all' | 'expiring'
  const [expiringDays, setExpiringDays] = useState(30);
  const [auditFilters, setAuditFilters] = useState({ days: 30, limit: 50 });

  const loadTenants = useCallback(async () => {
    setLoading(true);
    try {
      const data = filter === 'expiring'
        ? await superAdminApi.getExpiringTenants(expiringDays)
        : await superAdminApi.getTenants();
      setTenants(data.tenants || []);
    } catch (err) {
      console.error('Failed to load tenants:', err);
    } finally {
      setLoading(false);
    }
  }, [filter, expiringDays]);

  const loadAuditLog = useCallback(async () => {
    setLoading(true);
    try {
      const data = await superAdminApi.getAuditLog(auditFilters);
      setAuditLog(data.entries || []);
    } catch (err) {
      console.error('Failed to load audit log:', err);
    } finally {
      setLoading(false);
    }
  }, [auditFilters]);

  useEffect(() => {
    if (view === 'tenants') loadTenants();
    if (view === 'audit-log') loadAuditLog();
  }, [view, loadTenants, loadAuditLog]);

  async function openTenantDetail(id) {
    setLoading(true);
    try {
      const data = await superAdminApi.getTenant(id);
      setSelectedTenant(data);
      setView('tenant-detail');
    } catch (err) {
      console.error('Failed to load tenant:', err);
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem('superAdminToken');
    onLogout();
  }

  const statusColor = (status) => {
    switch (status) {
      case 'active': return 'text-green-400 bg-green-900/30';
      case 'trial': return 'text-blue-400 bg-blue-900/30';
      case 'suspended': return 'text-red-400 bg-red-900/30';
      case 'cancelled': return 'text-gray-400 bg-gray-700';
      default: return 'text-gray-400 bg-gray-700';
    }
  };

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-6 h-6 text-red-400" />
            <h1 className="text-lg font-bold text-white">RestoAI Super Admin</h1>
            <span className="text-sm text-gray-400">{admin?.email}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setView('tenants')}
              className={`px-3 py-1.5 rounded text-sm flex items-center gap-1.5 ${view === 'tenants' || view === 'tenant-detail' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              <Building2 className="w-4 h-4" /> Tenants
            </button>
            <button
              onClick={() => setView('audit-log')}
              className={`px-3 py-1.5 rounded text-sm flex items-center gap-1.5 ${view === 'audit-log' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              <FileText className="w-4 h-4" /> Audit Log
            </button>
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 rounded text-sm text-gray-400 hover:text-red-400 flex items-center gap-1.5"
            >
              <LogOut className="w-4 h-4" /> Logout
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto p-6">
        {view === 'tenants' && (
          <TenantsView
            tenants={tenants}
            loading={loading}
            filter={filter}
            setFilter={setFilter}
            expiringDays={expiringDays}
            setExpiringDays={setExpiringDays}
            onRefresh={loadTenants}
            onSelect={openTenantDetail}
            statusColor={statusColor}
          />
        )}

        {view === 'tenant-detail' && selectedTenant && (
          <TenantDetailView
            tenant={selectedTenant}
            loading={loading}
            onBack={() => setView('tenants')}
            onRefresh={() => openTenantDetail(selectedTenant.tenant?.id || selectedTenant.tenant?.id)}
            statusColor={statusColor}
            onAction={loadTenants}
          />
        )}

        {view === 'audit-log' && (
          <AuditLogView
            entries={auditLog}
            loading={loading}
            filters={auditFilters}
            setFilters={setAuditFilters}
            onRefresh={loadAuditLog}
          />
        )}
      </main>
    </div>
  );
}

/* ── Tenants List View ── */
function TenantsView({ tenants, loading, filter, setFilter, expiringDays, setExpiringDays, onRefresh, onSelect, statusColor }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-white">Tenants</h2>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-gray-800 rounded-lg p-1">
            <button
              onClick={() => setFilter('expiring')}
              className={`px-3 py-1 rounded text-sm ${filter === 'expiring' ? 'bg-gray-700 text-white' : 'text-gray-400'}`}
            >
              Expiring Soon
            </button>
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1 rounded text-sm ${filter === 'all' ? 'bg-gray-700 text-white' : 'text-gray-400'}`}
            >
              All
            </button>
          </div>
          {filter === 'expiring' && (
            <select
              value={expiringDays}
              onChange={(e) => setExpiringDays(Number(e.target.value))}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white"
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
            </select>
          )}
          <button onClick={onRefresh} className="p-2 text-gray-400 hover:text-white">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {tenants.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          {loading ? 'Loading...' : 'No tenants found'}
        </div>
      ) : (
        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-750 border-b border-gray-700">
              <tr className="text-left text-sm text-gray-400">
                <th className="px-4 py-3">Restaurant</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3">Branches</th>
                <th className="px-4 py-3">Last Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {tenants.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => onSelect(t.id)}
                  className="hover:bg-gray-750 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{t.name}</div>
                    <div className="text-xs text-gray-500">{t.slug}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor(t.subscription_status)}`}>
                      {t.subscription_status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300">{t.subscription_plan || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-300">
                    {t.subscription_period_end
                      ? new Date(t.subscription_period_end).toLocaleDateString()
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300">{t.branch_count || 0}</td>
                  <td className="px-4 py-3 text-sm text-gray-400">
                    {t.last_activity
                      ? `${Math.floor((Date.now() - new Date(t.last_activity)) / 86400000)}d ago`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Tenant Detail View ── */
function TenantDetailView({ tenant, loading, onBack, onRefresh, statusColor, onAction }) {
  const [action, setAction] = useState(null); // 'extend' | 'suspend' | 'reactivate' | 'comp'
  const [reason, setReason] = useState('');
  const [newEndDate, setNewEndDate] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  const t = tenant.tenant || {};
  const branches = tenant.branches || [];
  const users = tenant.users || [];

  async function handleAction(e) {
    e.preventDefault();
    setActionLoading(true);
    setActionError('');
    setActionSuccess('');
    try {
      switch (action) {
        case 'extend':
          await superAdminApi.extendSubscription(t.id, newEndDate, reason);
          setActionSuccess('Subscription extended');
          break;
        case 'suspend':
          await superAdminApi.suspendTenant(t.id, reason);
          setActionSuccess('Tenant suspended');
          break;
        case 'reactivate':
          await superAdminApi.reactivateTenant(t.id, reason);
          setActionSuccess('Tenant reactivated');
          break;
        case 'comp':
          await superAdminApi.applyComp(t.id, newEndDate, reason);
          setActionSuccess('Comp period applied');
          break;
      }
      setAction(null);
      setReason('');
      setNewEndDate('');
      onRefresh();
      onAction();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-400 hover:text-white mb-4">
        <ChevronLeft className="w-4 h-4" /> Back to tenants
      </button>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-white">{t.name}</h2>
          <p className="text-sm text-gray-400">{t.slug} · {t.phone || 'No phone'} · {t.address || 'No address'}</p>
        </div>
        <span className={`px-3 py-1 rounded text-sm font-medium ${statusColor(t.subscription_status)}`}>
          {t.subscription_status}
        </span>
      </div>

      {/* Subscription Info */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 mb-6">
        <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
          <Calendar className="w-4 h-4" /> Subscription
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Plan</span>
            <p className="text-white">{t.subscription_plan || '—'}</p>
          </div>
          <div>
            <span className="text-gray-500">Period Start</span>
            <p className="text-white">{t.subscription_period_start ? new Date(t.subscription_period_start).toLocaleDateString() : '—'}</p>
          </div>
          <div>
            <span className="text-gray-500">Period End</span>
            <p className="text-white">{t.subscription_period_end ? new Date(t.subscription_period_end).toLocaleDateString() : '—'}</p>
          </div>
          <div>
            <span className="text-gray-500">Notes</span>
            <p className="text-white text-xs">{t.subscription_notes || '—'}</p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => setAction('extend')}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded"
          >
            Extend
          </button>
          <button
            onClick={() => setAction('comp')}
            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded"
          >
            Apply Comp
          </button>
          {t.subscription_status === 'suspended' ? (
            <button
              onClick={() => setAction('reactivate')}
              className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded flex items-center gap-1"
            >
              <CheckCircle className="w-3.5 h-3.5" /> Reactivate
            </button>
          ) : (
            <button
              onClick={() => setAction('suspend')}
              className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded flex items-center gap-1"
            >
              <XCircle className="w-3.5 h-3.5" /> Suspend
            </button>
          )}
        </div>
      </div>

      {/* Action Modal */}
      {action && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 mb-6">
          <h4 className="text-sm font-medium text-white mb-3 capitalize">{action} Subscription</h4>
          {actionError && (
            <div className="mb-3 p-2 bg-red-900/30 border border-red-700 rounded text-red-300 text-sm">{actionError}</div>
          )}
          {actionSuccess && (
            <div className="mb-3 p-2 bg-green-900/30 border border-green-700 rounded text-green-300 text-sm">{actionSuccess}</div>
          )}
          <form onSubmit={handleAction}>
            <div className="mb-3">
              <label className="block text-sm text-gray-400 mb-1">Reason (required)</label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-red-500"
                required
              />
            </div>
            {(action === 'extend' || action === 'comp') && (
              <div className="mb-3">
                <label className="block text-sm text-gray-400 mb-1">New End Date</label>
                <input
                  type="date"
                  value={newEndDate}
                  onChange={(e) => setNewEndDate(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-red-500"
                  required
                />
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={actionLoading}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded disabled:opacity-50"
              >
                {actionLoading ? 'Processing...' : 'Confirm'}
              </button>
              <button
                type="button"
                onClick={() => { setAction(null); setReason(''); setNewEndDate(''); setActionError(''); }}
                className="px-3 py-1.5 text-gray-400 hover:text-white text-sm"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Branches */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 mb-6">
        <h3 className="text-sm font-medium text-gray-300 mb-3">Branches ({branches.length})</h3>
        {branches.length === 0 ? (
          <p className="text-sm text-gray-500">No branches</p>
        ) : (
          <div className="space-y-2">
            {branches.map((b) => (
              <div key={b.id} className="flex items-center justify-between text-sm">
                <span className="text-white">{b.name}</span>
                <span className={`px-2 py-0.5 rounded text-xs ${b.is_active ? 'bg-green-900/30 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
                  {b.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Users */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <h3 className="text-sm font-medium text-gray-300 mb-3">Users ({users.length})</h3>
        {users.length === 0 ? (
          <p className="text-sm text-gray-500">No users</p>
        ) : (
          <div className="space-y-2">
            {users.map((u) => (
              <div key={u.id} className="flex items-center justify-between text-sm">
                <div>
                  <span className="text-white">{u.name}</span>
                  <span className="text-gray-500 ml-2">{u.email}</span>
                </div>
                <span className="px-2 py-0.5 rounded text-xs bg-gray-700 text-gray-300 capitalize">{u.role}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Audit Log View ── */
function AuditLogView({ entries, loading, filters, setFilters, onRefresh }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-white">Audit Log</h2>
        <div className="flex items-center gap-3">
          <select
            value={filters.days}
            onChange={(e) => setFilters({ ...filters, days: Number(e.target.value) })}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last year</option>
          </select>
          <button onClick={onRefresh} className="p-2 text-gray-400 hover:text-white">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          {loading ? 'Loading...' : 'No audit entries'}
        </div>
      ) : (
        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          <table className="w-full">
            <thead className="border-b border-gray-700">
              <tr className="text-left text-sm text-gray-400">
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Admin</th>
                <th className="px-4 py-3">Tenant</th>
                <th className="px-4 py-3">Details</th>
                <th className="px-4 py-3">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {entries.map((entry) => (
                <tr key={entry.id} className="text-sm">
                  <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                    {new Date(entry.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-700 text-gray-200">
                      {entry.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-300 text-xs">{entry.admin_email || entry.super_admin_id?.slice(0, 8)}</td>
                  <td className="px-4 py-3 text-gray-300 text-xs">{entry.tenant_name || entry.target_tenant_id?.slice(0, 8) || '—'}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs max-w-xs truncate">
                    {entry.details ? JSON.stringify(entry.details).slice(0, 80) : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs font-mono">{entry.ip_address || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
