import { useState, useCallback } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Skeleton } from '../components/ui/Skeleton';
import usePolling from '../hooks/usePolling';
import useEvents from '../hooks/useEvents';
import { orderTypeLabel, statusLabel } from '../lib/orderType';
import CancelOrderModal from '../components/CancelOrderModal';
import { toast } from '../components/ui/toast';
import { ChefHat, Clock, CheckCircle2, Flame, AlertCircle, XCircle } from 'lucide-react';

// Presentation only (icon/color) — the label text itself comes from
// statusLabel() so it can never drift from what Orders.jsx shows for the
// same status (audit I7).
const STATUS_CONFIG = {
  new: { icon: AlertCircle, color: 'border-blue-400 bg-blue-50', btnColor: 'bg-blue-600 hover:bg-blue-700' },
  confirmed: { icon: Clock, color: 'border-yellow-400 bg-yellow-50', btnColor: 'bg-yellow-600 hover:bg-yellow-700' },
  preparing: { icon: Flame, color: 'border-orange-400 bg-orange-50', btnColor: 'bg-orange-600 hover:bg-orange-700' },
};

const NEXT_STATUS = { new: 'confirmed', confirmed: 'preparing', preparing: 'ready' };

// What tapping the button actually does, in the cook's words — not the
// system's status code (audit I7: "raw codes on badges and buttons").
const ADVANCE_VERB = { new: 'Confirm order', confirmed: 'Start preparing', preparing: 'Mark ready' };

export default function Kitchen() {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cancelTarget, setCancelTarget] = useState(null);

  const loadOrders = useCallback(async () => {
    try {
      const res = await api.getKitchenOrders();
      setOrders(res.orders);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  usePolling(loadOrders, 3000);
  // SSE real-time push (works when server is long-lived; polling fallback on serverless)
  useEvents(`kitchen:${user?.tenant_id || ''}`, loadOrders, 10000, { enabled: !!user?.tenant_id });

  function advanceStatus(order) {
    const next = NEXT_STATUS[order.status];
    if (!next) return;
    const prevOrders = [...orders];

    // Optimistic: update UI instantly
    if (next === 'ready') {
      setOrders((prev) => prev.filter((o) => o.id !== order.id));
    } else {
      setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: next } : o)));
    }

    // Reconcile in background — roll back on failure
    api.updateOrderStatus(order.id, next).catch((err) => {
      setOrders(prevOrders);
      toast.error(`Couldn't update order #${order.order_number}: ${err.message}`);
    });
  }

  function getElapsedTime(createdAt) {
    const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
  }

  return (
    <div className="min-h-screen bg-gray-900 p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ChefHat className="h-8 w-8 text-orange-400" />
          <h1 className="text-2xl font-bold text-white">Kitchen Display</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex h-3 w-3 animate-pulse rounded-full bg-green-400" />
          <span className="text-sm text-gray-400">Live</span>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"><Skeleton.Card /><Skeleton.Card /><Skeleton.Card /></div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
          <CheckCircle2 className="mb-4 h-16 w-16 text-green-400" />
          <p className="text-xl font-medium">All caught up!</p>
          <p className="text-sm">No pending orders in the kitchen</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {orders.map((order) => {
            const config = STATUS_CONFIG[order.status] || STATUS_CONFIG.new;
            const StatusIcon = config.icon;
            return (
              <div key={order.id} className={`rounded-xl border-l-4 ${config.color} p-4 shadow-lg`}>
                {/* Header */}
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StatusIcon className="h-5 w-5" />
                    <span className="font-bold text-gray-900">#{order.order_number}</span>
                    {order.table_number && (
                      <span className="badge bg-purple-100 text-purple-700">Table {order.table_number}</span>
                    )}
                    <span className="badge bg-white/50 text-gray-700">{statusLabel(order.status)}</span>
                  </div>
                  <span className="flex items-center gap-2 text-xs text-gray-500">
                    <Clock className="h-3 w-3" />
                    {getElapsedTime(order.created_at)}
                    <button
                      onClick={() => setCancelTarget(order)}
                      title="Cancel this order"
                      aria-label={`Cancel order #${order.order_number}`}
                      className="rounded p-0.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <XCircle className="h-4 w-4" />
                    </button>
                  </span>
                </div>

                {/* Items */}
                <div className="mb-4 space-y-2">
                  {(order.items || []).map((item, i) => (
                    <div key={i} className="flex items-start justify-between">
                      <div>
                        <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-800 text-xs font-bold text-white">
                          {item.quantity}
                        </span>
                        <span className="text-sm font-medium text-gray-900">{item.name}</span>
                      </div>
                      {item.notes && <span className="text-xs italic text-gray-500">{item.notes}</span>}
                    </div>
                  ))}
                </div>

                {/* Customer's note — the one thing they typed for the cook, so it gets the loudest slot on the card */}
                {order.notes && (
                  <div className="mb-4 rounded-lg border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <span className="mr-1 font-semibold">Customer note:</span>{order.notes}
                  </div>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between border-t border-gray-200 pt-3">
                  <div className="text-xs text-gray-500">
                    {orderTypeLabel(order.order_type)} • {order.payment_method || 'unpaid'}
                  </div>
                  {NEXT_STATUS[order.status] && (
                    <button
                      onClick={() => advanceStatus(order)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white ${config.btnColor} transition-colors`}
                    >
                      {ADVANCE_VERB[order.status]}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CancelOrderModal
        order={cancelTarget}
        onClose={() => setCancelTarget(null)}
        onCancelled={(updated) => setOrders((prev) => prev.filter((o) => o.id !== updated.id))}
      />
    </div>
  );
}
