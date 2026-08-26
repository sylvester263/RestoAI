import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import {
  TrendingUp, ShoppingBag, Users, DollarSign,
  ArrowUpRight, Package,
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

  if (loading) return <div className="flex items-center justify-center py-20">Loading dashboard...</div>;
  if (!data) return <div className="text-center py-20 text-gray-500">Failed to load dashboard</div>;

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
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={ShoppingBag} label="Today's Orders" value={data.today.orders} color="text-blue-600" bg="bg-blue-50" />
        <KpiCard icon={DollarSign} label="Today's Revenue" value={`Rs. ${data.today.revenue.toLocaleString()}`} color="text-green-600" bg="bg-green-50" />
        <KpiCard icon={Users} label="Customers" value={data.recent_customers.length} color="text-purple-600" bg="bg-purple-50" />
        <KpiCard icon={TrendingUp} label="Top Item" value={data.top_items[0]?.name || 'N/A'} color="text-orange-600" bg="bg-orange-50" />
      </div>

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
