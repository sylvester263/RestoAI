import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { toast } from '../components/ui/toast';
import { Skeleton } from '../components/ui/Skeleton';
import {
  Sparkles, UserX, ShieldAlert, Wallet, Bike, ToggleLeft, ToggleRight,
  ClipboardList, Brain, Clock, Send, BarChart3, Package, AlertTriangle,
  CheckCircle2, XCircle, ChevronRight, Zap, Lock,
} from 'lucide-react';

// ── Severity badge styles ──────────────────────────────────────────
const SEVERITY_STYLES = {
  high: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  low: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
};

// ── Agent registry — defines all 8 agents and their UI metadata ────
const AGENTS = [
  { id: 'briefing',      name: 'Daily Briefing',     icon: Send,          color: 'text-emerald-600', status: 'active' },
  { id: 'winback',       name: 'Win-Back',           icon: UserX,         color: 'text-amber-600',   status: 'active' },
  { id: 'dispatch',      name: 'Rider Dispatch',     icon: Bike,          color: 'text-blue-600',    status: 'active' },
  { id: 'eta',           name: 'ETA Tracking',       icon: Clock,         color: 'text-purple-600',  status: 'active' },
  { id: 'reconciliation',name: 'Reconciliation',     icon: Wallet,        color: 'text-red-600',     status: 'active' },
  { id: 'replenishment', name: 'Replenishment',      icon: Package,       color: 'text-teal-600',    status: 'active' },
  { id: 'menu_insight',  name: 'Menu Insights',      icon: Brain,         color: 'text-indigo-600',  status: 'active' },
  { id: 'abuse',         name: 'Abuse Detection',    icon: ShieldAlert,   color: 'text-rose-600',    status: 'active' },
];

// ── Sub-component: Agent overview card ──────────────────────────────
function AgentCard({ agent, count, label, accent }) {
  const Icon = agent.icon;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-3)] ${agent.color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-[var(--text-primary)]">{agent.name}</p>
        {count !== undefined ? (
          <p className={`text-sm font-semibold ${accent || 'text-[var(--text-primary)]'}`}>
            {count} <span className="font-normal text-[var(--text-tertiary)]">{label}</span>
          </p>
        ) : (
          <p className="text-xs text-[var(--text-tertiary)]">{label}</p>
        )}
      </div>
      <div className={`h-2 w-2 shrink-0 rounded-full ${agent.status === 'active' ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
    </div>
  );
}

// ── Sub-component: Action panel with header + scrollable list ──────
function ActionPanel({ icon: Icon, title, count, accent, description, children }) {
  return (
    <div className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface-2)] shadow-sm">
      <div className="flex items-center justify-between border-b border-[var(--border-light)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${accent || 'text-[var(--text-secondary)]'}`} />
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
          {count !== undefined && count > 0 && (
            <span className={`badge ${accent === 'text-red-600' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'}`}>
              {count}
            </span>
          )}
        </div>
        {count !== undefined && count > 0 && (
          <ChevronRight className="h-4 w-4 text-[var(--text-tertiary)]" />
        )}
      </div>
      {description && (
        <p className="border-b border-[var(--border-light)] px-4 py-2 text-xs text-[var(--text-secondary)]">{description}</p>
      )}
      <div className="max-h-72 flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {children}
      </div>
    </div>
  );
}

// ── Sub-component: Empty state ─────────────────────────────────────
function EmptyState({ message }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-[var(--border)] px-3 py-4">
      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
      <p className="text-sm text-[var(--text-tertiary)]">{message}</p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Main component
// ════════════════════════════════════════════════════════════════════

export default function Agents() {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';

  const [settings, setSettings] = useState(null);
  const [lapsed, setLapsed] = useState([]);
  const [reconFlags, setReconFlags] = useState([]);
  const [abuseFlags, setAbuseFlags] = useState([]);
  const [replenishment, setReplenishment] = useState([]);
  const [menuInsights, setMenuInsights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);

  const load = useCallback(async () => {
    try {
      const [lapsedRes, reconRes, abuseRes, replenRes, menuRes] = await Promise.all([
        api.getWinbackPreview(),
        api.getReconciliationFlags('open'),
        api.getAbuseFlags('open'),
        api.getReplenishmentSuggestions('pending'),
        api.getMenuInsights('new'),
      ]);
      setLapsed(lapsedRes.customers || []);
      setReconFlags(reconRes.flags || []);
      setAbuseFlags(abuseRes.flags || []);
      setReplenishment(replenRes.suggestions || []);
      setMenuInsights(menuRes.insights || []);
      if (isOwner) {
        const settingsRes = await api.getAgentSettings();
        setSettings(settingsRes);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [isOwner]);

  useEffect(() => { load(); }, [load]);

  // ── Settings handlers ──
  async function toggleWinback() {
    setSavingSettings(true);
    try {
      const updated = await api.updateAgentSettings({ winback_enabled: !settings.winback_enabled });
      setSettings(updated);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingSettings(false);
    }
  }

  async function setDispatchMode(mode) {
    setSavingSettings(true);
    try {
      const updated = await api.updateAgentSettings({ dispatch_mode: mode });
      setSettings(updated);
      toast.success('Dispatch mode updated');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingSettings(false);
    }
  }

  // ── Flag action handlers ──
  async function handleReconStatus(id, status) {
    try {
      await api.updateReconciliationFlagStatus(id, status);
      setReconFlags((flags) => flags.filter((f) => f.id !== id));
      toast.success('Flag updated');
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleAbuseStatus(id, status) {
    try {
      await api.updateAbuseFlagStatus(id, status);
      setAbuseFlags((flags) => flags.filter((f) => f.id !== id));
      toast.success('Flag updated');
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleReplenishment(id, action) {
    try {
      if (action === 'dismiss') {
        await api.dismissReplenishmentSuggestion(id);
        setReplenishment((s) => s.filter((r) => r.id !== id));
        toast.success('Suggestion dismissed');
      } else {
        await api.approveReplenishmentSuggestion(id);
        setReplenishment((s) => s.map((r) => r.id === id ? { ...r, status: 'approved' } : r));
        toast.success('Purchase order created');
      }
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleMenuInsight(id, status) {
    try {
      await api.updateMenuInsightStatus(id, status);
      setMenuInsights((ins) => ins.filter((i) => i.id !== id));
      toast.success(status === 'acted_on' ? 'Marked as acted on' : 'Acknowledged');
    } catch (err) {
      toast.error(err.message);
    }
  }

  // ── Derived counts for the overview strip ──
  const highRecon = reconFlags.filter((f) => f.severity === 'high').length;
  const highAbuse = abuseFlags.filter((f) => f.severity === 'high').length;
  const totalAttention = lapsed.length + reconFlags.length + abuseFlags.length + replenishment.length + menuInsights.length;

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton.Card key={i} />)}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton.Card /><Skeleton.Card />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Page header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-[var(--text-primary)]">
            <Sparkles className="h-6 w-6 text-brand-600" /> AI Agents
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Proactive automation running behind the scenes — review what it found and control what it's allowed to do.
          </p>
        </div>
        {totalAttention > 0 && (
          <div className="flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" />
            {totalAttention} item{totalAttention > 1 ? 's' : ''} need{totalAttention === 1 ? 's' : ''} review
          </div>
        )}
      </div>

      {/* ── Agent overview strip ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <AgentCard agent={AGENTS[0]} label="Daily briefing" />
        <AgentCard agent={AGENTS[1]} count={lapsed.length} label="lapsed customers" accent={lapsed.length > 0 ? 'text-amber-600' : undefined} />
        <AgentCard agent={AGENTS[2]} label={settings?.dispatch_mode === 'auto' ? 'Full auto-assign' : 'Suggest only'} />
        <AgentCard agent={AGENTS[3]} label="ETA tracking" />
        <AgentCard agent={AGENTS[4]} count={reconFlags.length} label={highRecon > 0 ? `${highRecon} high severity` : 'open flags'} accent={highRecon > 0 ? 'text-red-600' : reconFlags.length > 0 ? 'text-amber-600' : undefined} />
        <AgentCard agent={AGENTS[5]} count={replenishment.length} label="pending suggestions" accent={replenishment.length > 0 ? 'text-teal-600' : undefined} />
        <AgentCard agent={AGENTS[6]} count={menuInsights.length} label="new insights" accent={menuInsights.length > 0 ? 'text-indigo-600' : undefined} />
        <AgentCard agent={AGENTS[7]} count={abuseFlags.length} label={highAbuse > 0 ? `${highAbuse} high severity` : 'open flags'} accent={highAbuse > 0 ? 'text-red-600' : abuseFlags.length > 0 ? 'text-amber-600' : undefined} />
      </div>

      {/* ── Automation controls (owner-only) ── */}
      {isOwner && settings && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <Zap className="h-4 w-4 text-brand-600" /> Automation Controls
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border border-[var(--border-light)] bg-[var(--surface-1)] p-3">
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">Win-back messages</p>
                <p className="text-xs text-[var(--text-secondary)]">Auto-message customers who've gone quiet</p>
              </div>
              <button onClick={toggleWinback} disabled={savingSettings} className="text-brand-600 transition-opacity hover:opacity-80" aria-label={settings.winback_enabled ? 'Disable win-back' : 'Enable win-back'}>
                {settings.winback_enabled ? <ToggleRight className="h-7 w-7" /> : <ToggleLeft className="h-7 w-7 text-[var(--text-tertiary)]" />}
              </button>
            </div>
            <div className="rounded-lg border border-[var(--border-light)] bg-[var(--surface-1)] p-3">
              <p className="mb-2 text-sm font-medium text-[var(--text-primary)]">Rider dispatch</p>
              <div className="flex gap-2 text-xs">
                <button
                  onClick={() => setDispatchMode('suggest_only')}
                  disabled={savingSettings}
                  className={`rounded-lg px-3 py-1.5 font-medium transition-colors ${settings.dispatch_mode === 'suggest_only' ? 'bg-brand-600 text-white' : 'bg-[var(--surface-3)] text-[var(--text-secondary)] hover:bg-[var(--border)]'}`}
                >
                  Suggest only
                </button>
                <button
                  onClick={() => setDispatchMode('auto')}
                  disabled={savingSettings}
                  className={`rounded-lg px-3 py-1.5 font-medium transition-colors ${settings.dispatch_mode === 'auto' ? 'bg-brand-600 text-white' : 'bg-[var(--surface-3)] text-[var(--text-secondary)] hover:bg-[var(--border)]'}`}
                >
                  Full auto-assign
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Action panels ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Win-Back */}
        <ActionPanel icon={UserX} title="Win-Back" count={lapsed.length} accent="text-amber-600" description="Customers who'd be messaged on the next scheduled run.">
          {lapsed.length === 0 && <EmptyState message="No lapsed customers right now" />}
          {lapsed.map((c) => (
            <div key={c.id} className="rounded-lg border border-[var(--border-light)] bg-[var(--surface-1)] p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-[var(--text-primary)]">{c.name || c.phone}</p>
                <span className="badge bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">{c.days_since_last_order}d quiet</span>
              </div>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{c.phone}{c.favorite_item ? ` · usually orders ${c.favorite_item}` : ''}</p>
            </div>
          ))}
        </ActionPanel>

        {/* Payment Reconciliation */}
        <ActionPanel icon={Wallet} title="Payment Reconciliation" count={reconFlags.length} accent="text-red-600">
          {reconFlags.length === 0 && <EmptyState message="No open reconciliation flags" />}
          {reconFlags.map((f) => (
            <div key={f.id} className="rounded-lg border border-[var(--border-light)] bg-[var(--surface-1)] p-3">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className={`badge ${SEVERITY_STYLES[f.severity]}`}>{f.severity}</span>
                {f.order_number && <span className="text-xs text-[var(--text-tertiary)]">Order #{f.order_number}</span>}
              </div>
              <p className="mb-2 text-sm text-[var(--text-secondary)]">{f.description}</p>
              <div className="flex gap-3 text-xs">
                <button onClick={() => handleReconStatus(f.id, 'resolved')} className="flex items-center gap-1 font-medium text-emerald-600 hover:underline">
                  <CheckCircle2 className="h-3 w-3" /> Resolve
                </button>
                <button onClick={() => handleReconStatus(f.id, 'dismissed')} className="flex items-center gap-1 font-medium text-[var(--text-tertiary)] hover:underline">
                  <XCircle className="h-3 w-3" /> Dismiss
                </button>
              </div>
            </div>
          ))}
        </ActionPanel>

        {/* Abuse Detection */}
        <ActionPanel icon={ShieldAlert} title="Abuse Detection" count={abuseFlags.length} accent="text-rose-600" description="Surfaced for human judgment — nothing here is ever auto-blocked.">
          {abuseFlags.length === 0 && <EmptyState message="No open abuse flags" />}
          {abuseFlags.map((f) => (
            <div key={f.id} className="rounded-lg border border-[var(--border-light)] bg-[var(--surface-1)] p-3">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className={`badge ${SEVERITY_STYLES[f.severity]}`}>{f.severity}</span>
                <span className="text-xs uppercase tracking-wide text-[var(--text-tertiary)]">{f.flag_type.replace('_', ' ')}</span>
              </div>
              <p className="mb-2 text-sm text-[var(--text-secondary)]">{f.description}</p>
              <div className="flex gap-3 text-xs">
                <button onClick={() => handleAbuseStatus(f.id, 'confirmed')} className="flex items-center gap-1 font-medium text-red-600 hover:underline">
                  <AlertTriangle className="h-3 w-3" /> Confirm
                </button>
                <button onClick={() => handleAbuseStatus(f.id, 'false_positive')} className="flex items-center gap-1 font-medium text-[var(--text-tertiary)] hover:underline">
                  <XCircle className="h-3 w-3" /> False positive
                </button>
              </div>
            </div>
          ))}
        </ActionPanel>

        {/* Replenishment Suggestions */}
        <ActionPanel icon={Package} title="Replenishment" count={replenishment.length} accent="text-teal-600" description="Suggest-only — never auto-orders. Approve to create a purchase order.">
          {replenishment.length === 0 && <EmptyState message="No pending replenishment suggestions" />}
          {replenishment.map((r) => (
            <div key={r.id} className="rounded-lg border border-[var(--border-light)] bg-[var(--surface-1)] p-3">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-sm font-medium text-[var(--text-primary)]">{r.ingredient_name}</p>
                <span className="text-xs text-[var(--text-tertiary)]">{r.suggested_quantity} {r.unit}</span>
              </div>
              <p className="mb-2 text-xs text-[var(--text-secondary)]">{r.reason || 'Stock below threshold'}</p>
              <div className="flex gap-3 text-xs">
                <button onClick={() => handleReplenishment(r.id, 'approve')} className="flex items-center gap-1 font-medium text-teal-600 hover:underline">
                  <CheckCircle2 className="h-3 w-3" /> Approve PO
                </button>
                <button onClick={() => handleReplenishment(r.id, 'dismiss')} className="flex items-center gap-1 font-medium text-[var(--text-tertiary)] hover:underline">
                  <XCircle className="h-3 w-3" /> Dismiss
                </button>
              </div>
            </div>
          ))}
        </ActionPanel>

        {/* Menu Insights */}
        <ActionPanel icon={Brain} title="Menu Insights" count={menuInsights.length} accent="text-indigo-600" description="AI-generated pricing and positioning recommendations.">
          {menuInsights.length === 0 && <EmptyState message="No new menu insights" />}
          {menuInsights.map((mi) => (
            <div key={mi.id} className="rounded-lg border border-[var(--border-light)] bg-[var(--surface-1)] p-3">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-sm font-medium text-[var(--text-primary)]">{mi.menu_item_name}</p>
                <span className="badge bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">{mi.insight_type}</span>
              </div>
              <p className="mb-2 text-sm text-[var(--text-secondary)]">{mi.recommendation}</p>
              <div className="flex gap-3 text-xs">
                <button onClick={() => handleMenuInsight(mi.id, 'acted_on')} className="flex items-center gap-1 font-medium text-indigo-600 hover:underline">
                  <CheckCircle2 className="h-3 w-3" /> Acted on
                </button>
                <button onClick={() => handleMenuInsight(mi.id, 'acknowledged')} className="flex items-center gap-1 font-medium text-[var(--text-tertiary)] hover:underline">
                  <BarChart3 className="h-3 w-3" /> Acknowledge
                </button>
                <button onClick={() => handleMenuInsight(mi.id, 'dismissed')} className="flex items-center gap-1 font-medium text-[var(--text-tertiary)] hover:underline">
                  <XCircle className="h-3 w-3" /> Dismiss
                </button>
              </div>
            </div>
          ))}
        </ActionPanel>
      </div>
    </div>
  );
}
