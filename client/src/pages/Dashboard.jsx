import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Skeleton } from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';
import {
  TrendingUp, ShoppingBag, Users, DollarSign,
  ArrowUpRight, Package, Star, AlertTriangle, Building2, ChevronLeft,
} from 'lucide-react';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getDashboard()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-40" />
      <Skeleton.KpiRow count={5} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton.Card /><Skeleton.Card /><Skeleton.Card /><Skeleton.Card />
      </div>
    </div>
  );
  if (!data) return <EmptyState icon={AlertTriangle} title="Failed to load dashboard" description="Check your connection and try again." action={{ label: 'Retry', onClick: () => window.location.reload() }} />;

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
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500">Today's restaurant overview</p>
      </div>

      {/* KPI Cards */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard icon={ShoppingBag} label="Today's Orders" value={data.today.orders} color="text-blue-600" bg="bg-blue-50" />
        <KpiCard icon={DollarSign} label="Today's Revenue" value={`Rs. ${data.today.revenue.toLocaleString()}`} color="text-green-600" bg="bg-green-50" />
        <KpiCard icon={Users} label="Customers" value={data.recent_customers.length} color="text-purple-600" bg="bg-purple-50" />
        <KpiCard icon={TrendingUp} label="Top Item" value={data.top_items[0]?.name || 'N/A'} color="text-orange-600" bg="bg-orange-50" />
        <KpiCard
          icon={Star}
          label="Avg Rating (30d)"
          value={data.reviews?.count ? `${data.reviews.average} ★ (${data.reviews.count})` : 'No reviews yet'}
          color="text-yellow-600"
          bg="bg-yellow-50"
        />
      </div>

      {/* Low-stock alert */}
      {data.low_stock_count > 0 && (
        <a href="/inventory?low_stock=true" className="mb-6 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 hover:bg-red-100 transition-colors">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span>{data.low_stock_count} inventory item{data.low_stock_count > 1 ? 's' : ''} below minimum stock level</span>
          <ArrowUpRight className="ml-auto h-4 w-4" />
        </a>
      )}

      <BranchAnalytics />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Weekly Trend */}
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">7-Day Revenue Trend</h2>
          <div className="space-y-3">
            {data.weekly_trend.map((day) => (
              <div key={day.date} className="flex items-center gap-3">
                <span className="w-24 text-sm text-gray-500">{new Date(day.date).toLocaleDateString('en-PK', { weekday: 'short' })}</span>
                <div className="flex-1">
                  <div className="h-6 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-brand-500 transition-all"
                      style={{ width: `${Math.min((parseFloat(day.revenue) / Math.max(...data.weekly_trend.map(d => parseFloat(d.revenue))) * 100), 100)}%` }}
                    />
                  </div>
                </div>
                <span className="w-24 text-right text-sm font-medium">Rs. {parseFloat(day.revenue).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Top Items */}
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Top Selling Items (30 days)</h2>
          <div className="space-y-3">
            {data.top_items.map((item, i) => (
              <div key={item.name} className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">{i + 1}</span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{item.name}</p>
                  <p className="text-xs text-gray-500">{item.total_qty} sold</p>
                </div>
                <span className="text-sm font-medium text-gray-900">Rs. {parseFloat(item.total_revenue).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Order Status */}
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Today's Order Status</h2>
          <div className="flex flex-wrap gap-3">
            {data.status_breakdown.map((s) => (
              <div key={s.status} className={`badge ${statusColors[s.status] || 'bg-gray-100 text-gray-700'}`}>
                {s.status}: {s.count}
              </div>
            ))}
            {data.status_breakdown.length === 0 && <p className="text-sm text-gray-400">No orders today yet</p>}
          </div>
        </div>

        {/* Food-cost margins (impl-08) — only items with a recipe defined have real cost data */}
        {data.food_cost_margins?.length > 0 && (
          <div className="card">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">Food-Cost Margins</h2>
            <div className="space-y-3">
              {data.food_cost_margins.map((m) => (
                <div key={m.menu_item_id} className="flex items-center gap-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">{m.name}</p>
                    <p className="text-xs text-gray-500">Cost Rs. {m.unit_cost.toLocaleString()} · Price Rs. {m.price.toLocaleString()}</p>
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
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Recent Customers</h2>
          <div className="space-y-3">
            {data.recent_customers.slice(0, 5).map((c) => (
              <div key={c.id} className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-200 text-sm font-medium text-gray-700">
                  {c.name?.[0] || '?'}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{c.name || c.phone}</p>
                  <p className="text-xs text-gray-500">{c.phone}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium">{c.total_orders} orders</p>
                  <p className="text-xs text-gray-500">Rs. {parseFloat(c.total_spent).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
];

// impl-25: an owner sees a side-by-side comparison and drills into a branch
// from there; a manager whose access is locked to exactly one branch skips
// straight to that branch's drill-down (the comparison view has nothing to
// show them). A non-owner with zero assigned branches sees a clear message
// rather than an empty, confusing section.
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
      <div className="card mb-6 flex items-center gap-3 text-sm text-gray-500">
        <Building2 className="h-5 w-5 shrink-0 text-gray-400" />
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
            <button onClick={() => setDrilldownId(null)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100" title="Back to comparison">
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Building2 className="h-5 w-5 text-brand-600" />
            {drilldownId ? compare.branches.find((b) => b.branch_id === drilldownId)?.branch_name : 'Branch Comparison'}
          </h2>
        </div>
        <div className="flex rounded-lg border border-gray-200 bg-white p-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`rounded-md px-3 py-1 text-xs font-medium ${period === p.key ? 'bg-brand-600 text-white' : 'text-gray-600'}`}
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
          className="w-full rounded-lg border border-gray-200 p-3 text-left hover:border-brand-300 hover:bg-brand-50/50 transition-colors"
        >
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-medium text-gray-900">{b.branch_name}</span>
            <span className="text-gray-500">{b.order_count} orders · Rs. {b.avg_order_value.toLocaleString()} avg</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-5 flex-1 overflow-hidden rounded-full bg-gray-100">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${(b.revenue / maxRevenue) * 100}%` }} />
            </div>
            <span className="w-28 shrink-0 text-right text-sm font-semibold text-gray-900">Rs. {b.revenue.toLocaleString()}</span>
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

  if (!detail) return <p className="py-8 text-center text-sm text-gray-400">Loading branch data...</p>;

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
        <div className="col-span-full rounded-lg bg-gray-50 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">vs. chain average ({benchmark.branch_count} branches)</p>
          <div className="flex flex-wrap gap-4 text-sm">
            <BenchmarkStat label="Revenue" pct={benchmark.vs_chain_average_pct.revenue} />
            <BenchmarkStat label="Orders" pct={benchmark.vs_chain_average_pct.order_count} />
            <BenchmarkStat label="Avg order" pct={benchmark.vs_chain_average_pct.avg_order_value} />
          </div>
        </div>
      )}

      <div>
        <p className="mb-2 text-sm font-semibold text-gray-700">Revenue trend (7 days)</p>
        <div className="space-y-2">
          {detail.revenue_trend.length === 0 && <p className="text-xs text-gray-400">No orders in this window</p>}
          {detail.revenue_trend.map((d) => (
            <div key={d.date} className="flex items-center gap-2 text-xs">
              <span className="w-16 text-gray-500">{new Date(d.date).toLocaleDateString('en-PK', { weekday: 'short' })}</span>
              <div className="h-4 flex-1 overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-brand-500" style={{ width: `${(d.revenue / maxTrend) * 100}%` }} />
              </div>
              <span className="w-20 shrink-0 text-right font-medium">Rs. {d.revenue.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold text-gray-700">Top items</p>
        <div className="space-y-2">
          {detail.top_items.length === 0 && <p className="text-xs text-gray-400">No items sold in this window</p>}
          {detail.top_items.map((item) => (
            <div key={item.name} className="flex items-center justify-between text-xs">
              <span className="text-gray-700">{item.name}</span>
              <span className="text-gray-500">{item.total_qty} sold · Rs. {item.total_revenue.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold text-gray-700">Peak hours</p>
        <div className="flex items-end gap-1" style={{ height: '60px' }}>
          {Array.from({ length: 24 }, (_, h) => detail.peak_hours.find((p) => p.hour === h)?.count || 0).map((count, h) => (
            <div key={h} className="flex-1 rounded-t bg-brand-500" style={{ height: `${(count / maxHourCount) * 100}%`, minHeight: count > 0 ? '2px' : 0 }} title={`${h}:00 — ${count} orders`} />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-gray-400"><span>12am</span><span>12pm</span><span>11pm</span></div>
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold text-gray-700">Staff performance</p>
        {!staff?.has_data ? (
          <p className="text-xs text-gray-400">{staff?.message || 'Loading...'}</p>
        ) : (
          <div className="space-y-2">
            {staff.staff.map((s) => (
              <div key={s.user_id} className="flex items-center justify-between text-xs">
                <span className="text-gray-700">{s.name}</span>
                <span className="text-gray-500">{s.tab_count} tabs · Rs. {s.total_sales.toLocaleString()} · Rs. {s.avg_ticket.toLocaleString()} avg</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3 text-center">
      <p className="text-lg font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

function BenchmarkStat({ label, pct }) {
  const color = pct === null ? 'text-gray-400' : pct > 0 ? 'text-green-600' : pct < 0 ? 'text-red-600' : 'text-gray-500';
  return (
    <span className="text-gray-600">
      {label}: <span className={`font-semibold ${color}`}>{pct === null ? 'n/a' : `${pct > 0 ? '+' : ''}${pct}%`}</span>
    </span>
  );
}

function KpiCard({ icon: Icon, label, value, color, bg }) {
  return (
    <div className="card flex items-center gap-4">
      <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${bg}`}>
        <Icon className={`h-6 w-6 ${color}`} />
      </div>
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <p className="text-xl font-bold text-gray-900">{value}</p>
      </div>
    </div>
  );
}
