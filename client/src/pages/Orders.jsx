import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Skeleton } from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';
import { toast, confirmAction } from '../components/ui/toast';
import { orderTypeLabel, statusLabel, nextStatusFor } from '../lib/orderType';
import { Search, Filter, ChevronDown, ChevronUp, ShoppingBag, XCircle, Bike } from 'lucide-react';

const STATUS_COLORS = {
  new: 'bg-blue-100 text-blue-700',
  confirmed: 'bg-yellow-100 text-yellow-700',
  preparing: 'bg-orange-100 text-orange-700',
  ready: 'bg-emerald-100 text-emerald-700',
  out_for_delivery: 'bg-sky-100 text-sky-700',
  delivered: 'bg-gray-100 text-[var(--text-secondary)]',
  cancelled: 'bg-red-100 text-red-700',
};

const STATUS_FILTERS = ['', 'new', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'];

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
    const next = nextStatusFor(order);
    if (!next) return;
    const snapshot = [...orders];

    // Optimistic: update UI instantly
    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: next } : o)));

    // Reconcile in background — roll back on failure
    api.updateOrderStatus(order.id, next).catch((err) => {
      setOrders(snapshot);
      toast.error(`Couldn't update order #${order.order_number}: ${err.message}`);
    });
  }

  async function cancelOrder(order) {
    const ok = await confirmAction(
      `Cancel order #${order.order_number}?`,
      'The customer will be told their order was cancelled. This cannot be undone.',
    );
    if (!ok) return;
    try {
      await api.updateOrderStatus(order.id, 'cancelled');
      setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: 'cancelled' } : o)));
      toast.success(`Order #${order.order_number} cancelled — customer notified`);
    } catch (err) {
      toast.error(`Couldn't cancel order #${order.order_number}: ${err.message}`);
    }
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
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === s ? 'bg-brand-600 text-white' : 'bg-[var(--surface-3)] text-[var(--text-secondary)] hover:bg-[var(--border)]'
              }`}
            >
              {s ? statusLabel(s) : 'All'}
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
                  <span className={`badge ${STATUS_COLORS[order.status]}`}>{statusLabel(order.status)}</span>
                  {order.status === 'out_for_delivery' && (
                    <span className="flex items-center gap-1 text-xs font-medium text-sky-700">
                      <Bike className="h-3.5 w-3.5" /> {order.rider_name || 'rider'}
                    </span>
                  )}
                  <span className="text-sm font-semibold">Rs. {Number(order.total).toLocaleString()}</span>
                  <span className="text-xs text-[var(--text-tertiary)]">{orderTypeLabel(order.order_type)} · <span className="uppercase">{order.channel}</span></span>
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
                    <div>
                      <p className="font-medium text-[var(--text-secondary)]">Items</p>
                      <ul className="text-[var(--text-secondary)]">
                        {(order.items || []).map((item, i) => (
                          <li key={i} className="flex justify-between gap-3">
                            <span>{item.quantity}x {item.name}</span>
                            <span>Rs. {Number(item.total_price).toLocaleString()}</span>
                          </li>
                        ))}
                        {(!order.items || order.items.length === 0) && <li>No items recorded</li>}
                      </ul>
                    </div>
                    {order.order_type === 'delivery' && (
                      <div>
                        <p className="font-medium text-[var(--text-secondary)]">Rider</p>
                        <p className="text-[var(--text-secondary)]">
                          {order.rider_name
                            ? `${order.rider_name} · ${order.rider_delivered_at ? 'delivered' : order.rider_picked_up_at ? 'on the way' : 'assigned, not picked up yet'}`
                            : 'Not assigned yet'}
                        </p>
                      </div>
                    )}
                    {order.notes && (
                      <div className="col-span-2 rounded-lg border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-amber-900">
                        <span className="mr-1 font-semibold">Customer note:</span>{order.notes}
                      </div>
                    )}
                  </div>
                  {!['delivered', 'cancelled'].includes(order.status) && (
                    <div className="mt-4 flex items-center gap-3">
                      {nextStatusFor(order) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); advanceStatus(order); }}
                          className="btn-primary text-sm"
                        >
                          Move to {statusLabel(nextStatusFor(order)).toLowerCase()}
                        </button>
                      )}
                      {!['delivered', 'cancelled'].includes(order.status) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); cancelOrder(order); }}
                          className="btn-secondary text-sm text-red-600 hover:bg-red-50"
                        >
                          <XCircle className="h-4 w-4" /> Cancel order
                        </button>
                      )}
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
