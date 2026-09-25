/**
 * Plan & Billing (impl-32) — owner picks a plan, sees RestoAI's bank
 * details and the exact amount, pays by bank transfer, then submits the
 * transaction reference (and optionally a receipt screenshot). A super admin
 * verifies it; the owner gets a WhatsApp message either way.
 *
 * A plan chosen on the marketing page arrives as ?plan=&branches=&pack=.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { toast } from '../components/ui/toast';
import { Skeleton } from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';
import { normalizeSelection, monthlyAmount, planById, formatRs } from '../lib/pricing';
import {
  CreditCard, Landmark, Clock, CheckCircle2, XCircle, AlertTriangle, Sparkles, Copy, Check, Upload, X, Mail,
} from 'lucide-react';

const STATUS_BADGE = {
  trial: 'bg-blue-100 text-blue-700',
  active: 'bg-green-100 text-green-700',
  suspended: 'bg-red-100 text-red-700',
  cancelled: 'bg-[var(--surface-3)] text-[var(--text-secondary)]',
};
const SUB_BADGE = {
  pending: { cls: 'bg-amber-100 text-amber-700', icon: Clock, label: 'Pending verification' },
  approved: { cls: 'bg-green-100 text-green-700', icon: CheckCircle2, label: 'Approved' },
  rejected: { cls: 'bg-red-100 text-red-700', icon: XCircle, label: 'Rejected' },
};

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('en-PK', { dateStyle: 'medium' }) : '—';
}

function CopyValue({ label, value }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-[var(--text-secondary)]">{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-mono text-sm font-medium text-[var(--text-primary)]">{value}</span>
        <button
          type="button"
          onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ } }}
          className="rounded p-1 text-[var(--text-tertiary)] hover:bg-[var(--surface-3)] hover:text-[var(--text-secondary)]"
          aria-label={`Copy ${label}`}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </span>
    </div>
  );
}

export default function Billing() {
  const [searchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [sel, setSel] = useState(null);
  const [reference, setReference] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const fileRef = useRef(null);

  function load() {
    return api.getBilling()
      .then((res) => {
        setData(res);
        setSel((prev) => prev || normalizeSelection(res.pricing, {
          plan: searchParams.get('plan') || res.subscription.subscription_plan || 'starter',
          branches: searchParams.get('branches') || res.subscription.branch_count,
          pack: searchParams.has('pack') ? searchParams.get('pack') === '1' : res.subscription.ai_agent_pack_enabled,
        }));
      })
      .catch(setLoadError);
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const amount = useMemo(() => (data && sel ? monthlyAmount(data.pricing, sel) : null), [data, sel]);

  if (loadError) {
    return loadError.status === 403
      ? <EmptyState icon={AlertTriangle} title="Only the owner can manage the plan" description="Plan and payments are handled by the restaurant owner." />
      : <EmptyState icon={AlertTriangle} title="Couldn't load your plan" description={loadError.message} action={{ label: 'Retry', onClick: () => { setLoadError(null); load(); } }} />;
  }
  if (!data || !sel) return <div className="space-y-6"><Skeleton className="h-8 w-48" /><Skeleton.Card /><Skeleton.Card /></div>;

  const { subscription: sub, pending, submissions, bank, pricing } = data;
  const currentPlan = planById(pricing, sub.subscription_plan);
  const selPlan = planById(pricing, sel.plan);
  const lastRejected = !pending && submissions[0]?.status === 'rejected' ? submissions[0] : null;

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      await api.submitPayment({
        plan: sel.plan,
        branch_count: sel.branches,
        agent_pack: sel.pack,
        claimed_amount: amount,
        bank_reference_number: reference.trim(),
      }, receipt);
      toast.success("Payment submitted — we'll message you on WhatsApp once it's verified");
      setReference('');
      setReceipt(null);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-[var(--text-primary)]"><CreditCard className="h-6 w-6 text-brand-600" /> Plan & Billing</h1>
        <p className="text-sm text-[var(--text-secondary)]">Flat monthly pricing, 0% commission on every order. Pay by bank transfer — we verify it and switch your plan on.</p>
      </div>

      {/* ── Current plan ── */}
      <div className="card mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-tertiary)]">Current plan</p>
            <p className="mt-1 text-xl font-bold text-[var(--text-primary)]">{currentPlan ? currentPlan.name : 'No paid plan yet'}</p>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              {sub.subscription_status === 'active' && sub.subscription_period_end ? `Paid until ${fmtDate(sub.subscription_period_end)}` : sub.subscription_status === 'trial' ? 'Free trial' : ''}
              {' · '}{sub.branch_count} branch{sub.branch_count === 1 ? '' : 'es'}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className={`badge capitalize ${STATUS_BADGE[sub.subscription_status] || STATUS_BADGE.cancelled}`}>{sub.subscription_status}</span>
            <span className={`badge ${sub.ai_agent_pack_enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-[var(--surface-3)] text-[var(--text-secondary)]'}`}>
              <Sparkles className="mr-1 h-3 w-3" /> AI Agent Pack {sub.ai_agent_pack_enabled ? 'on' : 'off'}
            </span>
          </div>
        </div>
      </div>

      {pending ? (
        /* ── Pending verification ── */
        <div className="card mb-6 border-amber-300 dark:border-amber-800">
          <div className="flex items-start gap-3">
            <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="font-semibold text-[var(--text-primary)]">Payment pending verification</p>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                We received your {planById(pricing, pending.claimed_plan)?.name} payment of {formatRs(pending.claimed_amount)} (reference <span className="font-mono">{pending.bank_reference_number}</span>) on {fmtDate(pending.submitted_at)}.
                We'll check it against our bank statement and message you on WhatsApp. Your plan switches on as soon as it's approved.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
          {lastRejected && (
            <div className="card mb-6 border-red-300 dark:border-red-900">
              <div className="flex items-start gap-3">
                <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                <div>
                  <p className="font-semibold text-[var(--text-primary)]">Your last payment couldn't be verified</p>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">Reason: {lastRejected.rejection_reason}</p>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">Fix it below and submit again — nothing on your account was changed.</p>
                </div>
              </div>
            </div>
          )}

          {/* ── 1. Choose a plan ── */}
          <h2 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">1. Choose your plan</h2>
          <div className="mb-6 grid gap-3 md:grid-cols-3">
            {pricing.plans.map((p) => {
              const selected = sel.plan === p.id;
              return (
                <div
                  key={p.id}
                  role={p.self_serve ? 'button' : undefined}
                  tabIndex={p.self_serve ? 0 : undefined}
                  onClick={() => p.self_serve && setSel(normalizeSelection(pricing, { ...sel, plan: p.id }))}
                  onKeyDown={(e) => { if (p.self_serve && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setSel(normalizeSelection(pricing, { ...sel, plan: p.id })); } }}
                  className={`card !p-4 ${p.self_serve ? 'cursor-pointer' : ''} ${selected ? 'ring-2 ring-brand-500' : ''}`}
                >
                  <p className="font-semibold text-[var(--text-primary)]">{p.name}</p>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">
                    {p.monthly != null ? `${formatRs(p.monthly)}/month` : p.per_branch != null ? `${formatRs(p.per_branch)}/branch/month` : 'Custom pricing'}
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                    {p.max_branches === p.min_branches ? `${p.min_branches} branch` : p.max_branches ? `${p.min_branches}–${p.max_branches} branches` : `${p.min_branches}+ branches`}
                  </p>
                  <p className="mt-2 text-xs text-[var(--text-secondary)]">
                    AI Agent Pack: {p.agent_pack_included ? <span className="font-medium text-emerald-600">Included</span> : `+${formatRs(pricing.agent_pack_monthly)}/month`}
                  </p>
                  {!p.self_serve && (
                    <a href="/#contact" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline" onClick={(e) => e.stopPropagation()}>
                      <Mail className="h-3 w-3" /> Talk to us for a quote
                    </a>
                  )}
                </div>
              );
            })}
          </div>

          <div className="card mb-6 space-y-4">
            {selPlan.max_branches > selPlan.min_branches && (
              <label className="flex items-center justify-between gap-3 text-sm">
                <span className="text-[var(--text-secondary)]">Number of branches</span>
                <select className="input w-24" value={sel.branches} onChange={(e) => setSel({ ...sel, branches: Number(e.target.value) })}>
                  {Array.from({ length: selPlan.max_branches - selPlan.min_branches + 1 }, (_, i) => selPlan.min_branches + i).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            )}
            <label className={`flex items-start justify-between gap-3 text-sm ${selPlan.agent_pack_included ? 'opacity-70' : ''}`}>
              <span>
                <span className="font-medium text-[var(--text-primary)]">AI Agent Pack</span>
                <span className="block text-xs text-[var(--text-secondary)]">
                  Daily briefing, win-back, reconciliation, replenishment, menu insights, abuse detection, customer support, your WhatsApp business assistant, rider dispatch and ETAs. WhatsApp AI ordering is always included.
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {!selPlan.agent_pack_included && <span className="text-[var(--text-secondary)]">+{formatRs(pricing.agent_pack_monthly)}</span>}
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={sel.pack}
                  disabled={selPlan.agent_pack_included}
                  onChange={(e) => setSel({ ...sel, pack: e.target.checked })}
                  aria-label="Include the AI Agent Pack"
                />
                {selPlan.agent_pack_included && <span className="text-xs font-medium text-emerald-600">Included</span>}
              </span>
            </label>
            <div className="flex items-center justify-between border-t border-[var(--border-light)] pt-4">
              <span className="font-semibold text-[var(--text-primary)]">Total per month</span>
              <span className="text-2xl font-bold text-[var(--text-primary)]">{formatRs(amount)}</span>
            </div>
          </div>

          {/* ── 2. Transfer ── */}
          <h2 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">2. Transfer {formatRs(amount)} to RestoAI</h2>
          {bank ? (
            <div className="card mb-6">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]"><Landmark className="h-4 w-4" /> Bank transfer details</div>
              <div className="divide-y divide-[var(--border-light)]">
                <CopyValue label="Bank" value={bank.bank_name} />
                <CopyValue label="Account title" value={bank.account_title} />
                <CopyValue label="Account number" value={bank.account_number} />
                {bank.iban && <CopyValue label="IBAN" value={bank.iban} />}
                <CopyValue label="Amount" value={String(amount)} />
              </div>
              <p className="mt-3 text-xs text-[var(--text-tertiary)]">Send exactly this amount so we can match your transfer quickly.</p>
            </div>
          ) : (
            <div className="card mb-6 border-amber-300 text-sm text-[var(--text-secondary)] dark:border-amber-800">
              <AlertTriangle className="mb-1 inline h-4 w-4 text-amber-600" /> Bank transfer details aren't available yet. Please contact RestoAI support to pay — don't transfer money until you have our account details.
            </div>
          )}

          {/* ── 3. Submit ── */}
          <h2 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">3. Tell us you've paid</h2>
          <form onSubmit={handleSubmit} className="card mb-6 space-y-4">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-[var(--text-primary)]">Transaction / reference number</span>
              <input
                className="input w-full"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="As shown in your banking app or receipt"
                maxLength={100}
                required
                disabled={!bank}
              />
            </label>
            <div className="text-sm">
              <span className="mb-1 block font-medium text-[var(--text-primary)]">Receipt screenshot <span className="font-normal text-[var(--text-tertiary)]">(optional, speeds up verification)</span></span>
              {receipt ? (
                <span className="inline-flex items-center gap-2 rounded-lg bg-[var(--surface-3)] px-3 py-1.5 text-xs">
                  {receipt.name}
                  <button type="button" onClick={() => setReceipt(null)} aria-label="Remove receipt"><X className="h-3 w-3" /></button>
                </span>
              ) : (
                <button type="button" onClick={() => fileRef.current?.click()} disabled={!bank} className="btn-secondary text-xs">
                  <Upload className="h-3.5 w-3.5" /> Choose image
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { setReceipt(e.target.files?.[0] || null); e.target.value = ''; }} />
            </div>
            {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
            <button type="submit" className="btn-primary" disabled={!bank || submitting || !reference.trim() || amount == null}>
              {submitting ? 'Submitting…' : `Submit ${formatRs(amount)} payment for verification`}
            </button>
          </form>
        </>
      )}

      {/* ── History ── */}
      {submissions.length > 0 && (
        <>
          <h2 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">Payment history</h2>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-light)] text-left text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
                  <th className="py-2 pr-4">Submitted</th>
                  <th className="py-2 pr-4">Plan</th>
                  <th className="py-2 pr-4">Amount</th>
                  <th className="py-2 pr-4">Reference</th>
                  <th className="py-2 pr-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-light)]">
                {submissions.map((s) => {
                  const b = SUB_BADGE[s.status];
                  return (
                    <tr key={s.id}>
                      <td className="py-2 pr-4 text-[var(--text-secondary)]">{fmtDate(s.submitted_at)}</td>
                      <td className="py-2 pr-4 text-[var(--text-primary)]">
                        {planById(pricing, s.claimed_plan)?.name}{s.claimed_plan === 'growth' ? ` · ${s.claimed_branch_count} branches` : ''}{s.claimed_agent_pack ? ' + Agent Pack' : ''}
                      </td>
                      <td className="py-2 pr-4 text-[var(--text-primary)]">{formatRs(s.claimed_amount)}</td>
                      <td className="py-2 pr-4 font-mono text-xs text-[var(--text-secondary)]">{s.bank_reference_number}</td>
                      <td className="py-2 pr-4">
                        <span className={`badge ${b.cls}`}><b.icon className="mr-1 h-3 w-3" /> {b.label}</span>
                        {s.status === 'rejected' && s.rejection_reason && <p className="mt-1 text-xs text-[var(--text-tertiary)]">{s.rejection_reason}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
