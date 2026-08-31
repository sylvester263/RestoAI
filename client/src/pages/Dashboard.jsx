import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Skeleton } from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';
import {
  TrendingUp, ShoppingBag, Users, DollarSign,
  Package, Star, AlertTriangle, Building2, ChevronLeft,
  Bell, Wallet, ShieldAlert, Lightbulb,
} from 'lucide-react';

export default function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Agent-flag data for the "Needs Attention" section — fetched in parallel
  // with the main dashboard but rendered progressively so a slow or failing
  // agent endpoint never blocks the KPIs below.
  const [reconFlags, setReconFlags] = useState([]);
  const [abuseFlags, setAbuseFlags] = useState([]);
  const [replenishment, setReplenishment] = useState([]);
  const [menuInsights, setMenuInsights] = useState([]);

  useEffect(() => {
    api.getDashboard()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));

    // Attention items — each is independent; a failure just leaves that
    // card in its empty state rather than breaking the whole dashboard.
    api.getReconciliationFlags('open').then((r) => setReconFlags(r.flags)).catch(() => {});
    api.getAbuseFlags('open').then((r) => setAbuseFlags(r.flags)).catch(() => {});
    api.getReplenishmentSuggestions('pending').then((r) => setReplenishment(r.suggestions)).catch(() => {});
    api.getMenuInsights('new').then((r) => setMenuInsights(r.insights)).catch(() => {});
  }, []);

  if (loading) return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-24 w-full" />
      <Skeleton.KpiRow count={5} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton.Card /><Skeleton.Card /><Skeleton.Card /><Skeleton.Card />
      </div>
    </div>
  );
  if (!data) return <EmptyState icon={AlertTriangle} title="Failed to load dashboard" description="Check your connection and try again." action={{ label: 'Retry', onClick: () => window.location.reload() }} />;

  // Build the attention items from whatever agent data has arrived so far.
  // Each item carries a count, severity, label, short detail line, and the
  // route the owner should navigate to in order to act on it.
  const attentionItems = [];

  if (reconFlags.length > 0) {
    const highCount = reconFlags.filter((f) => f.severity === 'high').length;
    attentionItems.push({
      icon: Wallet,
      label: 'Reconciliation flags',
      count: reconFlags.length,
      detail: highCount > 0 ? `${highCount} high severity` : 'All medium or low',
      severity: highCount > 0 ? 'high' : 'medium',
      onClick: () => navigate('/agents'),
    });
  }

  if (abuseFlags.length > 0) {
    const highCount = abuseFlags.filter((f) => f.severity === 'high').length;
    attentionItems.push({
      icon: ShieldAlert,
      label: 'Abuse detection',
      count: abuseFlags.length,
      detail: highCount > 0 ? `${highCount} high severity` : 'All medium or low',
      severity: highCount > 0 ? 'high' : 'medium',
      onClick: () => navigate('/agents'),
    });
  }

  if (data.low_stock_count > 0) {
    attentionItems.push({
      icon: Package,
      label: 'Low stock',
      count: data.low_stock_count,
      detail: `${data.low_stock_count} ingredient${data.low_stock_count > 1 ? 's' : ''} below minimum`,
      severity: data.low_stock_count > 3 ? 'high' : 'medium',
      onClick: () => navigate('/inventory'),
    });
  }

  if (replenishment.length > 0) {
    attentionItems.push({
      icon: TrendingUp,
      label: 'Replenishment',
      count: replenishment.length,
      detail: `${replenishment.length} suggestion${replenishment.length > 1 ? 's' : ''} pending review`,
      severity: 'medium',
      onClick: () => navigate('/inventory'),
    });
  }

  if (menuInsights.length > 0) {
    attentionItems.push({
      icon: Lightbulb,
      label: 'Menu insights',
      count: menuInsights.length,
      detail: `${menuInsights.length} new recommendation${menuInsights.length > 1 ? 's' : ''}`,
      severity: 'low',
      onClick: () => navigate('/insights'),
    });
  }

  const statusColors = {
    new: 'bg-blue-100 text-blue-700',
    confirmed: 'bg-yellow-100 text-yellow-700',
    preparing: 'bg-orange-100 text-orange-700',
    ready: 'bg-green-100 text-green-700',
    delivered: 'bg-gray-100 text-gray-700',
    cancelled: 'bg-red-100 text-red-700',
  };

  return (
    <div>
      {/* ── Header ── */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Dashboard</h1>
        <p className="text-sm text-[var(--text-secondary)]">What needs your attention today</p>
      </div>

      {/* ── Needs Your Attention ── */}
      <div className="mb-6">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          <Bell className="h-4 w-4" />
          Needs your attention
        </h2>

        {attentionItems.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {attentionItems.map((item) => (
              <AttentionCard key={item.label} item={item} />
            ))}
          </div>
        ) : (
          <div className="card flex items-center gap-3 py-4 text-sm text-[var(--text-secondary)]">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-green-600">
              <Star className="h-4 w-4" />
            </div>
            All clear — nothing needs your attention right now.
          </div>
        )}
      </div>

      {/* ── KPI Summary (deprioritized — flat, compact) ── */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard icon={ShoppingBag} label="Today's Orders" value={data.today.orders} accent="text-blue-600 dark:text-blue-400" />
        <KpiCard icon={DollarSign} label="Revenue" value={`Rs. ${data.today.revenue.toLocaleString()}`} accent="text-green-600 dark:text-green-400" />
        <KpiCard icon={Users} label="Customers" value={data.recent_customers.length} accent="text-purple-600 dark:text-purple-400" />
        <KpiCard icon={TrendingUp} label="Top Item" value={data.top_items[0]?.name || 'N/A'} accent="text-orange-600 dark:text-orange-400" />
        <KpiCard
          icon={Star}
          label="Avg Rating"
          value={data.reviews?.count ? `${data.reviews.average} ★` : 'No reviews'}
          accent="text-yellow-600"
          sub={data.reviews?.count ? `${data.reviews.count} reviews` : undefined}
        />
      </div>

      {/* ── Branch analytics (impl-25) ── */}
      <BranchAnalytics />

      {/* ── Detail cards ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Weekly Trend */}
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">7-Day Revenue Trend</h2>
          <div className="space-y-3">
            {data.weekly_trend.map((day) => (
              <div key={day.date} className="flex items-center gap-3">
                <span className="w-24 text-sm text-[var(--text-secondary)]">{new Date(day.date).toLocaleDateString('en-PK', { weekday: 'short' })}</span>
                <div className="flex-1">
                  <div className="h-6 rounded-full bg-[var(--surface-3)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-brand-500 transition-all"
                      style={{ width: `${Math.min((parseFloat(day.revenue) / Math.max(...data.weekly_trend.map(d => parseFloat(d.revenue))) * 100), 100)}%` }}
                    />
                  </div>
                </div>
                <span className="w-24 text-right text-sm font-medium text-[var(--text-primary)]">Rs. {parseFloat(day.revenue).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Top Items */}
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">Top Selling Items (30 days)</h2>
          <div className="space-y-3">
            {data.top_items.map((item, i) => (
              <div key={item.name} className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">{i + 1}</span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{item.name}</p>
                  <p className="text-xs text-[var(--text-secondary)]">{item.total_qty} sold</p>
                </div>
                <span className="text-sm font-medium text-[var(--text-primary)]">Rs. {parseFloat(item.total_revenue).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Order Status */}
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">Today's Order Status</h2>
          <div className="flex flex-wrap gap-3">
            {data.status_breakdown.map((s) => (
              <div key={s.status} className={`badge ${statusColors[s.status] || 'bg-[var(--surface-3)] text-[var(--text-secondary)]'}`}>
                {s.status}: {s.count}
              </div>
            ))}
            {data.status_breakdown.length === 0 && <p className="text-sm text-[var(--text-tertiary)]">No orders today yet</p>}
          </div>
        </div>

        {/* Food-cost margins (impl-08) — only items with a recipe defined have real cost data */}
        {data.food_cost_margins?.length > 0 && (
          <div className="card">
            <h2 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">Food-Cost Margins</h2>
            <div className="space-y-3">
              {data.food_cost_margins.map((m) => (
                <div key={m.menu_item_id} className="flex items-center gap-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[var(--text-primary)]">{m.name}</p>
                    <p className="text-xs text-[var(--text-secondary)]">Cost Rs. {m.unit_cost.toLocaleString()} · Price Rs. {m.price.toLocaleString()}</p>
                  </div>
                  <span className={`badge ${m.margin_pct >= 40 ? 'bg-green-100 text-green-700' : m.margin_pct < 15 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                    {m.margin_pct}% margin
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Customers */}
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">Recent Customers</h2>
          <div className="space-y-3">
            {data.recent_customers.slice(0, 5).map((c) => (
              <div key={c.id} className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-3)] text-sm font-medium text-[var(--text-secondary)]">
                  {c.name?.[0] || '?'}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{c.name || c.phone}</p>
                  <p className="text-xs text-[var(--text-secondary)]">{c.phone}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{c.total_orders} orders</p>
                  <p className="text-xs text-[var(--text-secondary)]">Rs. {parseFloat(c.total_spent).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Needs-Attention card ─────────────────────────────────────────────────────
// Clickable card that surfaces one category of owner attention. The left
// accent bar colour reflects the highest severity flag in that category.

function AttentionCard({ item }) {
  const { icon: Icon, label, count, detail, severity, onClick } = item;

  const severityAccent = {
    high: 'border-l-red-500',
    medium: 'border-l-amber-500',
    low: 'border-l-blue-500',
  };

  return (
    <button
      onClick={onClick}
      className={`card flex w-full items-center gap-3 border-l-4 ${severityAccent[severity] || 'border-l-blue-500'} !p-3 text-left transition-colors hover:bg-[var(--surface-3)]`}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-3)]">
        <Icon className="h-5 w-5 text-[var(--text-secondary)]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[var(--text-primary)]">{label}</p>
        <p className="truncate text-xs text-[var(--text-tertiary)]">{detail}</p>
      </div>
      <span className="shrink-0 text-xl font-bold text-[var(--text-primary)]">{count}</span>
    </button>
  );
}

// ── Branch analytics (impl-25) ───────────────────────────────────────────────
// An owner sees a side-by-side comparison and drills into a branch from there;
// a manager whose access is locked to exactly one branch skips straight to
// that branch's drill-down (the comparison view has nothing to show them). A
// non-owner with zero assigned branches sees a clear message rather than an
// empty, confusing section.

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
];

function BranchAnalytics() {
  const [period, setPeriod] = useState('today');
  const [compare, setCompare] = useState(null);
  const [loading, setLoading] = useState(true);
  const [drilldownId, setDrilldownId] = useState(null);

  useEffect(() => {
    setLoading(true);
    api.compareBranches(period).then(setCompare).catch(console.error).finally(() => setLoading(false));
  }, [period]);

  // Manager locked to exactly one branch — go straight to drill-down, no toggle to show.
  useEffect(() => {
    if (compare?.branches?.length === 1) setDrilldownId(compare.branches[0].branch_id);
  }, [compare]);

  if (loading && !compare) return null;
  if (!compare || compare.branches.length === 0) {
    return (
      <div className="card mb-6 flex items-center gap-3 text-sm text-[var(--text-secondary)]">
        <Building2 className="h-5 w-5 shrink-0 text-[var(--text-tertiary)]" />
        No branches assigned to your account yet — ask the owner to grant you branch access.
      </div>
    );
  }

  const singleBranch = compare.branches.length === 1;

  return (
    <div className="card mb-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {drilldownId && !singleBranch && (
            <button onClick={() => setDrilldownId(null)} className="rounded-lg p-1.5 text-[var(--text-tertiary)] hover:bg-[var(--surface-3)]" title="Back to comparison">
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          <h2 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Building2 className="h-5 w-5 text-brand-600" />
            {drilldownId ? compare.branches.find((b) => b.branch_id === drilldownId)?.branch_name : 'Branch Comparison'}
          </h2>
        </div>
        <div className="flex rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`rounded-md px-3 py-1 text-xs font-medium ${period === p.key ? 'bg-brand-600 text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {drilldownId ? (
        <BranchDrilldown branchId={drilldownId} period={period} />
      ) : (
        <BranchCompareTable branches={compare.branches} onSelect={setDrilldownId} />
      )}
    </div>
  );
}

function BranchCompareTable({ branches, onSelect }) {
  const maxRevenue = Math.max(...branches.map((b) => b.revenue), 1);
  return (
    <div className="space-y-3">
      {branches.map((b) => (
        <button
          key={b.branch_id}
          onClick={() => onSelect(b.branch_id)}
          className="w-full rounded-lg border border-[var(--border)] p-3 text-left hover:border-brand-300 hover:bg-brand-50/50 transition-colors dark:hover:border-brand-700 dark:hover:bg-brand-900/20"
        >
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-medium text-[var(--text-primary)]">{b.branch_name}</span>
            <span className="text-[var(--text-secondary)]">{b.order_count} orders · Rs. {b.avg_order_value.toLocaleString()} avg</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-5 flex-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${(b.revenue / maxRevenue) * 100}%` }} />
            </div>
            <span className="w-28 shrink-0 text-right text-sm font-semibold text-[var(--text-primary)]">Rs. {b.revenue.toLocaleString()}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function BranchDrilldown({ branchId, period }) {
  const [detail, setDetail] = useState(null);
  const [benchmark, setBenchmark] = useState(null);
  const [staff, setStaff] = useState(null);

  useEffect(() => {
    setDetail(null);
    setBenchmark(null);
    setStaff(null);
    Promise.all([
      api.getBranchAnalytics(branchId, period),
      api.getBranchBenchmark(branchId, period),
      api.getBranchStaffPerformance(branchId, period),
    ]).then(([d, b, s]) => { setDetail(d); setBenchmark(b); setStaff(s); }).catch(console.error);
  }, [branchId, period]);

  if (!detail) return <p className="py-8 text-center text-sm text-[var(--text-tertiary)]">Loading branch data...</p>;

  const maxTrend = Math.max(...detail.revenue_trend.map((d) => d.revenue), 1);
  const maxHourCount = Math.max(...detail.peak_hours.map((h) => h.count), 1);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="grid grid-cols-3 gap-3">
        <MiniStat label="Orders" value={detail.order_count} />
        <MiniStat label="Revenue" value={`Rs. ${detail.revenue.toLocaleString()}`} />
        <MiniStat label="Avg order" value={`Rs. ${detail.avg_order_value.toLocaleString()}`} />
      </div>

      {benchmark && (
        <div className="col-span-full rounded-lg bg-[var(--surface-3)] p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">vs. chain average ({benchmark.branch_count} branches)</p>
          <div className="flex flex-wrap gap-4 text-sm">
            <BenchmarkStat label="Revenue" pct={benchmark.vs_chain_average_pct.revenue} />
            <BenchmarkStat label="Orders" pct={benchmark.vs_chain_average_pct.order_count} />
            <BenchmarkStat label="Avg order" pct={benchmark.vs_chain_average_pct.avg_order_value} />
          </div>
        </div>
      )}

      <div>
        <p className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Revenue trend (7 days)</p>
        <div className="space-y-2">
          {detail.revenue_trend.length === 0 && <p className="text-xs text-[var(--text-tertiary)]">No orders in this window</p>}
          {detail.revenue_trend.map((d) => (
            <div key={d.date} className="flex items-center gap-2 text-xs">
              <span className="w-16 text-[var(--text-secondary)]">{new Date(d.date).toLocaleDateString('en-PK', { weekday: 'short' })}</span>
              <div className="h-4 flex-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
                <div className="h-full rounded-full bg-brand-500" style={{ width: `${(d.revenue / maxTrend) * 100}%` }} />
              </div>
              <span className="w-20 shrink-0 text-right font-medium text-[var(--text-primary)]">Rs. {d.revenue.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Top items</p>
        <div className="space-y-2">
          {detail.top_items.length === 0 && <p className="text-xs text-[var(--text-tertiary)]">No items sold in this window</p>}
          {detail.top_items.map((item) => (
            <div key={item.name} className="flex items-center justify-between text-xs">
              <span className="text-[var(--text-primary)]">{item.name}</span>
              <span className="text-[var(--text-secondary)]">{item.total_qty} sold · Rs. {item.total_revenue.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Peak hours</p>
        <div className="flex items-end gap-1" style={{ height: '60px' }}>
          {Array.from({ length: 24 }, (_, h) => detail.peak_hours.find((p) => p.hour === h)?.count || 0).map((count, h) => (
            <div key={h} className="flex-1 rounded-t bg-brand-500" style={{ height: `${(count / maxHourCount) * 100}%`, minHeight: count > 0 ? '2px' : 0 }} title={`${h}:00 — ${count} orders`} />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-[var(--text-tertiary)]"><span>12am</span><span>12pm</span><span>11pm</span></div>
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Staff performance</p>
        {!staff?.has_data ? (
          <p className="text-xs text-[var(--text-tertiary)]">{staff?.message || 'Loading...'}</p>
        ) : (
          <div className="space-y-2">
            {staff.staff.map((s) => (
              <div key={s.user_id} className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-primary)]">{s.name}</span>
                <span className="text-[var(--text-secondary)]">{s.tab_count} tabs · Rs. {s.total_sales.toLocaleString()} · Rs. {s.avg_ticket.toLocaleString()} avg</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Shared presentational helpers ────────────────────────────────────────────

function MiniStat({ label, value }) {
  return (
    <div className="rounded-lg bg-[var(--surface-3)] p-3 text-center">
      <p className="text-lg font-bold text-[var(--text-primary)]">{value}</p>
      <p className="text-xs text-[var(--text-secondary)]">{label}</p>
    </div>
  );
}

function BenchmarkStat({ label, pct }) {
  const color = pct === null ? 'text-[var(--text-tertiary)]' : pct > 0 ? 'text-green-600' : pct < 0 ? 'text-red-600' : 'text-[var(--text-secondary)]';
  return (
    <span className="text-[var(--text-secondary)]">
      {label}: <span className={`font-semibold ${color}`}>{pct === null ? 'n/a' : `${pct > 0 ? '+' : ''}${pct}%`}</span>
    </span>
  );
}

// Flat, compact KPI card — intentionally less visually prominent than the
// attention cards above so the hierarchy stays clear.
function KpiCard({ icon: Icon, label, value, accent, sub }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
      <Icon className={`h-4 w-4 shrink-0 ${accent}`} />
      <div className="min-w-0">
        <p className="truncate text-xs text-[var(--text-tertiary)]">{label}</p>
        <p className="truncate text-base font-semibold text-[var(--text-primary)]">{value}</p>
        {sub && <p className="truncate text-[10px] text-[var(--text-tertiary)]">{sub}</p>}
      </div>
    </div>
  );
}
