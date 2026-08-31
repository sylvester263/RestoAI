import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Skeleton } from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';
import { Search, Filter, ChevronDown, ChevronUp, ShoppingBag } from 'lucide-react';

const STATUS_COLORS = {
  new: 'bg-blue-100 text-blue-700',
  confirmed: 'bg-yellow-100 text-yellow-700',
  preparing: 'bg-orange-100 text-orange-700',
  ready: 'bg-emerald-100 text-emerald-700',
  delivered: 'bg-gray-100 text-[var(--text-secondary)]',
  cancelled: 'bg-red-100 text-red-700',
};

const NEXT_STATUS = {
  new: 'confirmed',
  confirmed: 'preparing',
  preparing: 'ready',
  ready: 'delivered',
};

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [search, setSearch] = useState('');

  async function loadOrders() {
    setLoading(true);
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      const res = await api.getOrders(params);
      setOrders(res.orders);
      setTotal(res.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadOrders(); }, [statusFilter]);

  function advanceStatus(order) {
    const next = NEXT_STATUS[order.status];
    if (!next) return;
    const snapshot = [...orders];

    // Optimistic: update UI instantly
    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: next } : o)));

    // Reconcile in background — roll back on failure
    api.updateOrderStatus(order.id, next).catch(() => {
      setOrders(snapshot);
    });
  }

  const filtered = orders.filter((o) =>
    (o.customer_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (o.customer_phone || '').includes(search) ||
    String(o.order_number).includes(search),
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Orders</h1>
        <p className="text-sm text-[var(--text-secondary)]">{total} total orders</p>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input className="input pl-10" placeholder="Search by customer, phone, or order #..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-[var(--text-tertiary)]" />
          {['', 'new', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled'].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === s ? 'bg-brand-600 text-white' : 'bg-[var(--surface-3)] text-[var(--text-secondary)] hover:bg-[var(--border)]'
              }`}
            >
              {s || 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* Order list */}
      {loading ? (
        <Skeleton.List rows={6} />
      ) : (
        <div className="space-y-3">
          {filtered.map((order) => (
            <div key={order.id} className="card cursor-pointer p-4 transition-shadow hover:shadow-md" onClick={() => setExpanded(expanded === order.id ? null : order.id)}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div>
                    <p className="font-semibold text-[var(--text-primary)]">#{order.order_number}</p>
                    <p className="text-xs text-[var(--text-secondary)]">{new Date(order.created_at).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[var(--text-primary)]">{order.customer_name || 'Unknown'}</p>
                    <p className="text-xs text-[var(--text-secondary)]">{order.customer_phone}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`badge ${STATUS_COLORS[order.status]}`}>{order.status}</span>
                  <span className="text-sm font-semibold">Rs. {Number(order.total).toLocaleString()}</span>
                  <span className="text-xs text-[var(--text-tertiary)] uppercase">{order.channel}</span>
                  {order.payment && (
                    <span className={`badge ${order.payment.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                      {order.payment.method.toUpperCase()} · {order.payment.status}
                    </span>
                  )}
                  {expanded === order.id ? <ChevronUp className="h-4 w-4 text-[var(--text-tertiary)]" /> : <ChevronDown className="h-4 w-4 text-[var(--text-tertiary)]" />}
                </div>
              </div>

              {/* Expanded details */}
              {expanded === order.id && (
                <div className="mt-4 border-t border-[var(--border-light)] pt-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="font-medium text-[var(--text-secondary)]">Delivery Address</p>
                      <p className="text-[var(--text-secondary)]">{order.delivery_address || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="font-medium text-[var(--text-secondary)]">Payment</p>
                      <p className="text-[var(--text-secondary)] capitalize">
                        {order.payment
                          ? `${order.payment.method} — ${order.payment.status} (Rs. ${Number(order.payment.amount).toLocaleString()})`
                          : order.payment_method}
                      </p>
                    </div>
                    <div>
                      <p className="font-medium text-[var(--text-secondary)]">Breakdown</p>
                      <p className="text-[var(--text-secondary)]">
                        Subtotal: Rs. {Number(order.subtotal).toLocaleString()} | Tax: Rs. {Number(order.tax).toLocaleString()} | Delivery: Rs. {Number(order.delivery_fee).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  {NEXT_STATUS[order.status] && (
                    <div className="mt-4">
                      <button
                        onClick={(e) => { e.stopPropagation(); advanceStatus(order); }}
                        className="btn-primary text-sm"
                      >
                        Move to {NEXT_STATUS[order.status]}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <EmptyState
              icon={ShoppingBag}
              title={search || statusFilter ? 'No matching orders' : 'No orders yet'}
              description={search || statusFilter ? 'Try adjusting your search or filter.' : 'Orders from all channels will appear here.'}
            />
          )}
        </div>
      )}
    </div>
  );
}
