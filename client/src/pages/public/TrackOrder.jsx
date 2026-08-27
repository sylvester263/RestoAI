import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { publicApi } from '../../lib/api';
import { getIdentity } from '../../lib/publicOrderStore';
import { subscribeToPush, pushSupported } from '../../lib/push';
import { CheckCircle2, Clock, Flame, PackageCheck, XCircle, AlertCircle, Star, Bell } from 'lucide-react';

const STEPS = [
  { key: 'new', label: 'Order received', icon: AlertCircle },
  { key: 'confirmed', label: 'Confirmed', icon: Clock },
  { key: 'preparing', label: 'Preparing', icon: Flame },
  { key: 'ready', label: 'Ready', icon: PackageCheck },
  { key: 'delivered', label: 'Delivered', icon: CheckCircle2 },
];

export default function TrackOrder() {
  const { tenantSlug, orderId } = useParams();
  const [searchParams] = useSearchParams();
  const phone = searchParams.get('phone') || getIdentity(tenantSlug)?.phone || '';
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!phone) {
      setError(true);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let timeoutId;

    async function load() {
      try {
        const res = await publicApi.getOrderStatus(tenantSlug, orderId, phone);
        if (cancelled) return;
        setOrder(res.order);
        if (!['delivered', 'cancelled'].includes(res.order.status)) {
          timeoutId = setTimeout(load, 10000);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [tenantSlug, orderId, phone]);

  if (loading) return <div className="flex items-center justify-center py-20">Loading order...</div>;

  if (error || !order) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-gray-500">We couldn't find that order.</p>
        <Link to={`/order/${tenantSlug}`} className="text-sm text-brand-600 hover:underline">Back to menu</Link>
      </div>
    );
  }

  if (order.status === 'cancelled') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
        <XCircle className="h-10 w-10 text-red-500" />
        <p className="font-medium text-gray-900">This order was cancelled</p>
        <Link to={`/order/${tenantSlug}`} className="text-sm text-brand-600 hover:underline">Back to menu</Link>
      </div>
    );
  }

  const stepIndex = STEPS.findIndex((s) => s.key === order.status);

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="mx-auto max-w-lg">
        <h1 className="mb-1 text-2xl font-bold text-gray-900">Order #{order.order_number}</h1>
        <p className="mb-6 text-sm text-gray-500">Tracking your order</p>

        <NotifyBanner tenantSlug={tenantSlug} phone={phone} status={order.status} />

        {order.eta && (
          <div className="card mb-4 flex items-center gap-3 bg-brand-50 border-brand-200">
            <Clock className="h-5 w-5 shrink-0 text-brand-600" />
            <div className="text-sm text-brand-800">
              <span className="font-semibold">
                Ready in ~{order.eta.estimated_minutes_min}-{order.eta.estimated_minutes_max} mins
              </span>
              {order.eta.queue_ahead > 0 && (
                <span className="text-brand-600"> · {order.eta.queue_ahead} order{order.eta.queue_ahead > 1 ? 's' : ''} ahead in the kitchen</span>
              )}
            </div>
          </div>
        )}

        <div className="card mb-4">
          <div className="space-y-4">
            {STEPS.map((step, i) => {
              const Icon = step.icon;
              const reached = i <= stepIndex;
              return (
                <div key={step.key} className="flex items-center gap-3">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-full ${reached ? 'bg-brand-100 text-brand-600' : 'bg-gray-100 text-gray-400'}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className={reached ? 'font-medium text-gray-900' : 'text-gray-400'}>{step.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <h2 className="mb-3 text-sm font-semibold text-gray-600">Order details</h2>
          <div className="space-y-2 text-sm">
            {order.items.map((item, i) => (
              <div key={i} className="flex justify-between">
                <span>{item.quantity}x {item.name}</span>
                <span>Rs. {Number(item.total_price).toLocaleString()}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-between border-t border-gray-100 pt-3 text-base font-semibold text-gray-900">
            <span>Total</span>
            <span>Rs. {Number(order.total).toLocaleString()}</span>
          </div>
          <p className="mt-3 text-xs text-gray-500">Delivering to: {order.delivery_address}</p>
        </div>

        {order.status === 'delivered' && (
          <ReviewPrompt tenantSlug={tenantSlug} orderId={order.id} phone={phone} />
        )}
      </div>
    </div>
  );
}

function NotifyBanner({ tenantSlug, phone, status }) {
  const [dismissed, setDismissed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);

  const alreadyDecided = !pushSupported() || (typeof Notification !== 'undefined' && Notification.permission !== 'default');
  if (dismissed || alreadyDecided || ['delivered', 'cancelled'].includes(status)) return null;

  async function handleEnable() {
    setSubscribing(true);
    try {
      await subscribeToPush(tenantSlug, phone);
    } catch {
      // permission denied or unsupported — fail silently, banner just closes
    } finally {
      setSubscribing(false);
      setDismissed(true);
    }
  }

  return (
    <div className="card mb-4 flex items-center justify-between gap-3 bg-brand-50 border-brand-200">
      <div className="flex items-center gap-2 text-sm text-brand-800">
        <Bell className="h-4 w-4 shrink-0" />
        Get notified the moment your order status changes.
      </div>
      <div className="flex shrink-0 gap-2">
        <button onClick={() => setDismissed(true)} className="text-xs text-gray-500 hover:text-gray-700">Not now</button>
        <button onClick={handleEnable} disabled={subscribing} className="btn-primary px-3 py-1.5 text-xs">
          {subscribing ? 'Enabling...' : 'Enable'}
        </button>
      </div>
    </div>
  );
}

function ReviewPrompt({ tenantSlug, orderId, phone }) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [err, setErr] = useState('');

  async function handleSubmit() {
    if (!rating) return;
    setSubmitting(true);
    setErr('');
    try {
      await publicApi.submitReview(tenantSlug, { order_id: orderId, phone, rating, comment: comment || undefined });
      setSubmitted(true);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="card mt-4 text-center text-sm text-gray-600">
        Thanks for your feedback! 🎉
      </div>
    );
  }

  return (
    <div className="card mt-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-600">How was your order?</h2>
      <div className="mb-3 flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            className="p-0.5"
          >
            <Star
              className={`h-7 w-7 ${(hover || rating) >= n ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`}
            />
          </button>
        ))}
      </div>
      <textarea
        className="input mb-3 w-full"
        rows={2}
        placeholder="Leave a comment (optional)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      {err && <p className="mb-2 text-xs text-red-600">{err}</p>}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!rating || submitting}
        className="btn-primary w-full justify-center"
      >
        {submitting ? 'Submitting...' : 'Submit review'}
      </button>
    </div>
  );
}
