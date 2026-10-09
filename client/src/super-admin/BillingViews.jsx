/**
 * Super Admin billing views (impl-32): the "Needs Action" strip, the Payment
 * Verification Queue, the (intentionally small) Revenue Overview, and the
 * tenant-detail plan panel with the manual AI Agent Pack toggle.
 * Styling matches the rest of the super-admin shell (SuperAdminApp.jsx).
 */
import { useCallback, useEffect, useState } from 'react';
import { superAdminApi } from './superAdminApi';
import { RefreshCw, CheckCircle, XCircle, Clock, Sparkles, ExternalLink, AlertTriangle } from 'lucide-react';

const PLAN_NAMES = { pos_only: 'POS Only', starter: 'Starter', growth: 'Growth', enterprise: 'Enterprise' };
const rs = (n) => `Rs. ${Number(n).toLocaleString('en-PK')}`;
const when = (d) => (d ? new Date(d).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export function planLabel(plan, branches, pack) {
  if (!plan) return '—';
  const name = PLAN_NAMES[plan] || plan;
  const b = (plan === 'growth' || plan === 'pos_only') && branches ? ` · ${branches} branches` : '';
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

// ── impl-33: per-tenant module overrides ──
// Plan changes (payment approval) reset these to the plan's preset; a toggle
// here is a deliberate exception and needs a reason, like the Agent Pack.
export function TenantModulesPanel({ tenantId, modules, labels, fiscalProvider, onChanged }) {
  const [pending, setPending] = useState(null); // { module, enabled } or { fiscal: provider }
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!modules) return null;

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (pending.fiscal) await superAdminApi.setFiscalProvider(tenantId, pending.fiscal, reason);
      else await superAdminApi.setTenantModule(tenantId, pending.module, pending.enabled, reason);
      setPending(null);
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
      <h3 className="mb-3 text-sm font-medium text-gray-300">Modules</h3>
      <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(modules).map(([module, enabled]) => (
          <div key={module} className="flex items-center justify-between rounded border border-gray-700 px-3 py-2">
            <span className={enabled ? 'text-white' : 'text-gray-500'}>{labels?.[module] || module}</span>
            <button
              type="button"
              onClick={() => { setPending({ module, enabled: !enabled }); setReason(''); setError(''); }}
              className={`text-xs ${enabled ? 'text-emerald-400' : 'text-gray-400'} hover:underline`}
            >
              {enabled ? 'On' : 'Off'}
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 text-sm">
        <span className="text-gray-500">Fiscal invoicing (FBR/PRA)</span>
        <select
          value={pending?.fiscal || fiscalProvider || 'none'}
          onChange={(e) => { setPending(e.target.value === (fiscalProvider || 'none') ? null : { fiscal: e.target.value }); setReason(''); setError(''); }}
          className="rounded border border-gray-600 bg-gray-700 px-2 py-1 text-sm text-white"
        >
          <option value="none">None</option>
          <option value="pra">PRA (Punjab) — not configured yet</option>
          <option value="fbr">FBR — not configured yet</option>
          <option value="stub">Stub (dev only)</option>
        </select>
      </div>
      {pending && (
        <form onSubmit={save} className="mt-4 flex flex-wrap items-center gap-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={pending.fiscal ? `Reason for setting the fiscal provider to ${pending.fiscal}` : `Reason for turning ${labels?.[pending.module] || pending.module} ${pending.enabled ? 'on' : 'off'}`}
            className="min-w-0 flex-1 rounded border border-gray-600 bg-gray-700 px-3 py-1.5 text-sm text-white"
            required
            maxLength={500}
          />
          <button type="submit" disabled={busy} className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50">
            {busy ? 'Saving…' : pending.fiscal ? 'Save' : `Turn ${pending.enabled ? 'on' : 'off'}`}
          </button>
          <button type="button" onClick={() => setPending(null)} className="px-2 text-sm text-gray-400 hover:text-white">Cancel</button>
        </form>
      )}
      {error && <p className="mt-2 flex items-center gap-1 text-sm text-red-300"><AlertTriangle className="h-3.5 w-3.5" /> {error}</p>}
    </div>
  );
}

// ── impl-34: FBR Digital Invoicing settings (per tenant) ──
// Tokens are write-only: the server only says whether one is set. Production
// mode/tokens are refused outside a production deployment. HS code, UOM, sale
// type and rate are left blank on purpose — they must come from FBR / a tax
// adviser for this restaurant (see impl-34).
const FBR_FIELDS = [
  ['seller_ntn_cnic', 'Seller NTN / CNIC (7 or 13 digits)'],
  ['seller_business_name', 'Seller business name'],
  ['seller_province', 'Seller province (as in FBR provinces list)'],
  ['seller_address', 'Seller address'],
  ['business_activity', 'Business activity (FBR profile)'],
  ['sector', 'Sector (FBR profile)'],
  ['sandbox_scenario_id', 'Sandbox scenario (e.g. SN019)'],
  ['hs_code', 'HS code'],
  ['uom', 'UOM (from FBR UOM list)'],
  ['sale_type', 'Sale type'],
  ['rate_desc', 'Rate description (from FBR, e.g. "16%")'],
  ['rate_value', 'Rate % (must equal the branch tax rate)'],
  ['walkin_buyer_name', 'Walk-in buyer name'],
  ['walkin_buyer_province', 'Walk-in buyer province (blank = seller\'s)'],
  ['walkin_buyer_address', 'Walk-in buyer address (blank = seller\'s)'],
];

export function FbrSettingsPanel({ tenantId }) {
  const [settings, setSettings] = useState(null);
  const [missing, setMissing] = useState([]);
  const [form, setForm] = useState({});
  const [token, setToken] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState(null);

  const load = useCallback(() => {
    superAdminApi.getFbrSettings(tenantId).then((r) => {
      setSettings(r.settings);
      setMissing(r.missing || []);
      setForm(Object.fromEntries(FBR_FIELDS.map(([k]) => [k, r.settings?.[k] ?? ''])));
    }).catch((err) => setMessage(err.message));
  }, [tenantId]);
  useEffect(() => { load(); }, [load]);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const body = { reason };
      for (const [k] of FBR_FIELDS) {
        const v = typeof form[k] === 'string' ? form[k].trim() : form[k];
        if (v === '' || v == null) continue;
        body[k] = k === 'rate_value' ? Number(v) : v;
      }
      if (token.trim()) body.sandbox_token = token.trim();
      const r = await superAdminApi.saveFbrSettings(tenantId, body);
      setSettings(r.settings);
      setMissing(r.missing || []);
      setToken('');
      setReason('');
      setMessage('Saved');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function run(fn) {
    setBusy(true);
    setResult(null);
    try {
      setResult(await fn());
    } catch (err) {
      setResult({ error: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-6 rounded-lg border border-gray-700 bg-gray-800 p-4" data-testid="fbr-settings">
      <h3 className="mb-1 text-sm font-medium text-gray-300">FBR Digital Invoicing (sandbox)</h3>
      <p className="mb-3 text-xs text-gray-500">
        Sandbox token: {settings?.has_sandbox_token ? 'set' : 'not set'} · Environment: {settings?.environment || 'sandbox'} ·{' '}
        {missing.length ? <span className="text-amber-400">Missing: {missing.join(', ')}</span> : <span className="text-emerald-400">Complete</span>}
      </p>
      <form onSubmit={save} className="grid gap-2 sm:grid-cols-2">
        {FBR_FIELDS.map(([k, label]) => (
          <label key={k} className="text-xs text-gray-400">
            {label}
            <input value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              className="mt-0.5 w-full rounded border border-gray-600 bg-gray-700 px-2 py-1 text-sm text-white" />
          </label>
        ))}
        <label className="text-xs text-gray-400 sm:col-span-2">
          Sandbox token (write-only — leave blank to keep the current one)
          <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)}
            className="mt-0.5 w-full rounded border border-gray-600 bg-gray-700 px-2 py-1 text-sm text-white" />
        </label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for this change" required maxLength={500}
          className="rounded border border-gray-600 bg-gray-700 px-2 py-1 text-sm text-white sm:col-span-2" />
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button type="submit" disabled={busy} className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50">Save settings</button>
          <button type="button" disabled={busy} onClick={() => run(() => superAdminApi.getFbrReference(tenantId, 'provinces'))} className="rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-300">Load provinces</button>
          <button type="button" disabled={busy} onClick={() => run(() => superAdminApi.getFbrReference(tenantId, 'uom'))} className="rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-300">Load UOM list</button>
          <button type="button" disabled={busy} onClick={() => run(() => superAdminApi.validateFbr(tenantId))} className="rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-300">Validate latest bill (no posting)</button>
        </div>
      </form>
      {message && <p className="mt-2 text-sm text-gray-300">{message}</p>}
      {result && <pre className="mt-3 max-h-64 overflow-auto rounded bg-gray-900 p-2 text-xs text-gray-300">{JSON.stringify(result, null, 2)}</pre>}
    </div>
  );
}
