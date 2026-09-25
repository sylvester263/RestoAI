/**
 * Super Admin billing views (impl-32): the "Needs Action" strip, the Payment
 * Verification Queue, the (intentionally small) Revenue Overview, and the
 * tenant-detail plan panel with the manual AI Agent Pack toggle.
 * Styling matches the rest of the super-admin shell (SuperAdminApp.jsx).
 */
import { useCallback, useEffect, useState } from 'react';
import { superAdminApi } from './superAdminApi';
import { RefreshCw, CheckCircle, XCircle, Clock, Sparkles, ExternalLink, AlertTriangle } from 'lucide-react';

const PLAN_NAMES = { starter: 'Starter', growth: 'Growth', enterprise: 'Enterprise' };
const rs = (n) => `Rs. ${Number(n).toLocaleString('en-PK')}`;
const when = (d) => (d ? new Date(d).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export function planLabel(plan, branches, pack) {
  if (!plan) return '—';
  const name = PLAN_NAMES[plan] || plan;
  const b = plan === 'growth' && branches ? ` · ${branches} branches` : '';
  return `${name}${b}${pack ? ' + Agent Pack' : ''}`;
}

// ── Needs Action strip (top of every list view) ──
export function NeedsActionStrip({ onOpenPayments, onOpenExpiring, refreshKey }) {
  const [counts, setCounts] = useState(null);
  useEffect(() => {
    superAdminApi.getNeedsAction().then(setCounts).catch(() => setCounts(null));
  }, [refreshKey]);
  if (!counts) return null;
  const items = [
    { n: counts.pending_payments, label: 'payment' + (counts.pending_payments === 1 ? '' : 's') + ' to verify', onClick: onOpenPayments, tone: 'amber' },
    { n: counts.expiring_30d, label: 'subscription' + (counts.expiring_30d === 1 ? '' : 's') + ' expiring in 30 days', onClick: onOpenExpiring, tone: 'blue' },
  ];
  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-2">
      {items.map((it) => (
        <button
          key={it.label}
          onClick={it.onClick}
          className={`flex items-center justify-between rounded-lg border px-4 py-3 text-left ${it.n > 0
            ? (it.tone === 'amber' ? 'border-amber-700 bg-amber-900/20' : 'border-blue-700 bg-blue-900/20')
            : 'border-gray-700 bg-gray-800'}`}
        >
          <span className="text-sm text-gray-300">{it.label}</span>
          <span className={`text-2xl font-bold ${it.n > 0 ? 'text-white' : 'text-gray-500'}`}>{it.n}</span>
        </button>
      ))}
    </div>
  );
}

// ── Payment Verification Queue ──
export function PaymentsView({ onSelectTenant, onChanged }) {
  const [status, setStatus] = useState('pending');
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rejecting, setRejecting] = useState(null); // payment id
  const [confirmingApprove, setConfirmingApprove] = useState(null); // payment id
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await superAdminApi.getPayments(status);
      setPayments(data.payments || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [status]);
  useEffect(() => { load(); }, [load]);

  async function approve(p) {
    setConfirmingApprove(null);
    setBusy(p.id);
    setError('');
    try {
      const res = await superAdminApi.approvePayment(p.id);
      setNotice(`Approved — ${p.tenant_name} is active until ${new Date(res.tenant.subscription_period_end).toLocaleDateString()}. WhatsApp confirmation sent to the owner.`);
      await load();
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function reject(e) {
    e.preventDefault();
    const p = payments.find((x) => x.id === rejecting);
    setBusy(rejecting);
    setError('');
    try {
      await superAdminApi.rejectPayment(rejecting, reason);
      setNotice(`Rejected ${p?.tenant_name}'s payment. The owner was told why on WhatsApp; their subscription is unchanged.`);
      setRejecting(null);
      setReason('');
      await load();
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">Payment Verification</h2>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg bg-gray-800 p-1">
            {['pending', 'approved', 'rejected', 'all'].map((s) => (
              <button key={s} onClick={() => setStatus(s)} className={`rounded px-3 py-1 text-sm capitalize ${status === s ? 'bg-gray-700 text-white' : 'text-gray-400'}`}>{s}</button>
            ))}
          </div>
          <button onClick={load} className="p-2 text-gray-400 hover:text-white" aria-label="Refresh"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
        </div>
      </div>

      {notice && <div className="mb-4 rounded border border-green-700 bg-green-900/30 p-2 text-sm text-green-300">{notice}</div>}
      {error && <div className="mb-4 rounded border border-red-700 bg-red-900/30 p-2 text-sm text-red-300">{error}</div>}

      {payments.length === 0 ? (
        <div className="py-12 text-center text-gray-500">{loading ? 'Loading...' : status === 'pending' ? 'Nothing waiting for verification' : 'No payments'}</div>
      ) : (
        <div className="space-y-3">
          {payments.map((p) => (
            <div key={p.id} className="rounded-lg border border-gray-700 bg-gray-800 p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <button onClick={() => onSelectTenant(p.tenant_id)} className="font-medium text-white hover:underline">{p.tenant_name}</button>
                  <span className="ml-2 text-xs text-gray-500">{p.tenant_slug} · currently {p.subscription_status}{p.subscription_plan ? ` (${PLAN_NAMES[p.subscription_plan] || p.subscription_plan})` : ''}</span>
                  <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
                    <div><span className="block text-xs text-gray-500">Claimed plan</span><span className="text-gray-200">{planLabel(p.claimed_plan, p.claimed_branch_count, p.claimed_agent_pack)}</span></div>
                    <div><span className="block text-xs text-gray-500">Amount</span><span className="font-semibold text-white">{rs(p.claimed_amount)}</span></div>
                    <div><span className="block text-xs text-gray-500">Bank reference</span><span className="font-mono text-gray-200">{p.bank_reference_number}</span></div>
                    <div><span className="block text-xs text-gray-500">Submitted</span><span className="text-gray-200">{when(p.submitted_at)}</span></div>
                  </div>
                  {p.status !== 'pending' && (
                    <p className="mt-2 text-xs text-gray-400">
                      {p.status === 'approved' ? <CheckCircle className="mr-1 inline h-3 w-3 text-green-400" /> : <XCircle className="mr-1 inline h-3 w-3 text-red-400" />}
                      {p.status} by {p.reviewed_by_email || '—'} · {when(p.reviewed_at)}{p.rejection_reason ? ` — ${p.rejection_reason}` : ''}
                    </p>
                  )}
                </div>
                {p.receipt_image_url ? (
                  <a href={p.receipt_image_url} target="_blank" rel="noreferrer" className="block shrink-0" title="Open receipt full size">
                    <img src={p.receipt_image_url} alt={`Transfer receipt for ${p.bank_reference_number}`} className="h-28 w-28 rounded border border-gray-600 object-cover" />
                    <span className="mt-1 flex items-center gap-1 text-xs text-gray-400"><ExternalLink className="h-3 w-3" /> Full size</span>
                  </a>
                ) : (
                  <span className="shrink-0 text-xs text-gray-500">No receipt image</span>
                )}
              </div>

              {p.status === 'pending' && (
                rejecting === p.id ? (
                  <form onSubmit={reject} className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Reason (sent to the owner) — e.g. no matching transfer on the statement"
                      className="min-w-0 flex-1 rounded border border-gray-600 bg-gray-700 px-3 py-1.5 text-sm text-white"
                      required
                      maxLength={500}
                    />
                    <button type="submit" disabled={busy === p.id} className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50">Confirm reject</button>
                    <button type="button" onClick={() => { setRejecting(null); setReason(''); }} className="px-2 text-sm text-gray-400 hover:text-white">Cancel</button>
                  </form>
                ) : confirmingApprove === p.id ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded border border-green-800 bg-green-900/20 p-2 text-sm">
                    <span className="flex-1 text-green-200">
                      Activate {planLabel(p.claimed_plan, p.claimed_branch_count, p.claimed_agent_pack)} for one month? Only approve once {rs(p.claimed_amount)} with reference {p.bank_reference_number} is on the bank statement.
                    </span>
                    <button onClick={() => approve(p)} className="rounded bg-green-600 px-3 py-1.5 text-white hover:bg-green-700">Yes, approve</button>
                    <button onClick={() => setConfirmingApprove(null)} className="px-2 text-gray-400 hover:text-white">Cancel</button>
                  </div>
                ) : (
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => setConfirmingApprove(p.id)} disabled={busy === p.id} className="flex items-center gap-1 rounded bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700 disabled:opacity-50">
                      <CheckCircle className="h-3.5 w-3.5" /> {busy === p.id ? 'Approving…' : 'Approve'}
                    </button>
                    <button onClick={() => { setRejecting(p.id); setReason(''); }} className="flex items-center gap-1 rounded bg-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-600">
                      <XCircle className="h-3.5 w-3.5" /> Reject
                    </button>
                  </div>
                )
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Revenue Overview (intentionally minimal) ──
export function RevenueView() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    superAdminApi.getRevenue().then(setData).catch((err) => setError(err.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">Revenue Overview</h2>
        <button onClick={load} className="p-2 text-gray-400 hover:text-white" aria-label="Refresh"><RefreshCw className="h-4 w-4" /></button>
      </div>
      {error && <div className="mb-4 rounded border border-red-700 bg-red-900/30 p-2 text-sm text-red-300">{error}</div>}
      {!data ? (
        <div className="py-12 text-center text-gray-500">Loading...</div>
      ) : (
        <>
          <div className="mb-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
              <p className="text-xs text-gray-500">Verified payments this month</p>
              <p className="mt-1 text-2xl font-bold text-white">{rs(data.approved_this_month.total)}</p>
              <p className="text-xs text-gray-400">{data.approved_this_month.count} approved (Pakistan time, since the 1st)</p>
            </div>
            <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
              <p className="text-xs text-gray-500">Waiting for verification</p>
              <p className="mt-1 text-2xl font-bold text-white">{rs(data.pending.total)}</p>
              <p className="text-xs text-gray-400">{data.pending.count} pending — not counted as revenue</p>
            </div>
            <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
              <p className="flex items-center gap-1 text-xs text-gray-500"><Sparkles className="h-3 w-3" /> AI Agent Pack</p>
              <p className="mt-1 text-2xl font-bold text-white">{data.agent_pack.enabled_active} <span className="text-sm font-normal text-gray-400">active tenants</span></p>
              <p className="text-xs text-gray-400">{data.agent_pack.enabled} of {data.agent_pack.tenants} tenants have it enabled in total</p>
            </div>
          </div>
          <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
            <h3 className="mb-3 text-sm font-medium text-gray-300">Active subscriptions by tier</h3>
            {data.active_by_plan.length === 0 ? (
              <p className="text-sm text-gray-500">No active subscriptions yet</p>
            ) : (
              <div className="space-y-2">
                {data.active_by_plan.map((r) => (
                  <div key={r.plan} className="flex justify-between text-sm">
                    <span className="text-gray-200">{PLAN_NAMES[r.plan] || (r.plan === 'none' ? 'No plan set' : r.plan)}</span>
                    <span className="font-medium text-white">{r.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Tenant detail: two-dimensional plan + manual Agent Pack toggle ──
export function TenantPlanPanel({ tenant, payments, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const enabled = !!tenant.ai_agent_pack_enabled;

  async function toggle(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await superAdminApi.setAgentPack(tenant.id, !enabled, reason);
      setEditing(false);
      setReason('');
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-6 rounded-lg border border-gray-700 bg-gray-800 p-4">
      <h3 className="mb-3 text-sm font-medium text-gray-300">Plan</h3>
      <div className="grid gap-4 text-sm md:grid-cols-3">
        <div>
          <span className="text-gray-500">Branch tier</span>
          <p className="text-white">{PLAN_NAMES[tenant.subscription_plan] || tenant.subscription_plan || 'None yet'}</p>
          <p className="text-xs text-gray-500">{tenant.branch_count} branch{Number(tenant.branch_count) === 1 ? '' : 'es'} on file</p>
        </div>
        <div>
          <span className="text-gray-500">AI Agent Pack</span>
          <p className={enabled ? 'text-emerald-400' : 'text-gray-300'}><Sparkles className="mr-1 inline h-3.5 w-3.5" />{enabled ? 'Enabled' : 'Off'}</p>
          {!editing && (
            <button onClick={() => setEditing(true)} className="mt-1 text-xs text-blue-400 hover:underline">{enabled ? 'Turn off…' : 'Turn on (comp)…'}</button>
          )}
        </div>
        <div>
          <span className="text-gray-500">Latest payment</span>
          {payments?.[0] ? (
            <p className="text-white">{rs(payments[0].claimed_amount)} · <span className="capitalize">{payments[0].status}</span></p>
          ) : <p className="text-gray-400">None</p>}
        </div>
      </div>
      {editing && (
        <form onSubmit={toggle} className="mt-4 flex flex-wrap items-center gap-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={enabled ? 'Reason for turning the Agent Pack off' : 'Reason (e.g. comped for onboarding support)'}
            className="min-w-0 flex-1 rounded border border-gray-600 bg-gray-700 px-3 py-1.5 text-sm text-white"
            required
            maxLength={500}
          />
          <button type="submit" disabled={busy} className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50">
            {busy ? 'Saving…' : enabled ? 'Turn off Agent Pack' : 'Turn on Agent Pack'}
          </button>
          <button type="button" onClick={() => { setEditing(false); setReason(''); setError(''); }} className="px-2 text-sm text-gray-400 hover:text-white">Cancel</button>
        </form>
      )}
      {error && <p className="mt-2 flex items-center gap-1 text-sm text-red-300"><AlertTriangle className="h-3.5 w-3.5" /> {error}</p>}

      {payments?.length > 0 && (
        <div className="mt-4 border-t border-gray-700 pt-3">
          <h4 className="mb-2 text-xs font-medium uppercase text-gray-500">Payment history</h4>
          <div className="space-y-1">
            {payments.map((p) => (
              <div key={p.id} className="flex flex-wrap justify-between gap-2 text-xs">
                <span className="text-gray-300">{when(p.submitted_at)} · {planLabel(p.claimed_plan, p.claimed_branch_count, p.claimed_agent_pack)}</span>
                <span className="text-gray-400">
                  {rs(p.claimed_amount)} · ref <span className="font-mono">{p.bank_reference_number}</span> ·{' '}
                  <span className={p.status === 'approved' ? 'text-green-400' : p.status === 'rejected' ? 'text-red-400' : 'text-amber-400'}>
                    {p.status === 'pending' && <Clock className="mr-0.5 inline h-3 w-3" />}{p.status}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
