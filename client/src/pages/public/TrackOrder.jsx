import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { publicApi } from '../../lib/api';
import { getIdentity } from '../../lib/publicOrderStore';
import { subscribeToPush, pushSupported } from '../../lib/push';
import { CheckCircle2, Clock, Flame, PackageCheck, XCircle, AlertCircle, Star, Bell, Gift, Copy, Check, Bike, Phone } from 'lucide-react';

// The stepper follows the order's lifecycle. `order_type` is decided by the
// server (utils/order-type.js) and sent on the tracking payload — only
// delivery orders have the "Out for delivery" leg; pickup and dine-in go
// straight from Ready to Delivered, exactly as before.
function stepsFor(orderType) {
  const steps = [
    { key: 'new', label: 'Order received', icon: AlertCircle },
    { key: 'confirmed', label: 'Confirmed', icon: Clock },
    { key: 'preparing', label: 'Preparing', icon: Flame },
    { key: 'ready', label: 'Ready', icon: PackageCheck },
  ];
  if (orderType === 'delivery') steps.push({ key: 'out_for_delivery', label: 'Out for delivery', icon: Bike });
  steps.push({ key: 'delivered', label: orderType === 'delivery' ? 'Delivered' : orderType === 'dine_in' ? 'Served' : 'Collected', icon: CheckCircle2 });
  return steps;
}

// The word for "this order is fully done" changes with how it was fulfilled.
const COMPLETION_VERB = { delivery: 'Delivered', dine_in: 'Served', pickup: 'Collected', counter: 'Collected' };

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-PK', { timeZone: 'Asia/Karachi', hour: 'numeric', minute: '2-digit' });
}

// What the customer still has to do about money, in their words.
const PAYMENT_METHOD_NAMES = { cash: 'in cash', jazzcash: 'by JazzCash', easypaisa: 'by EasyPaisa', card: 'by card' };
function paymentReminderFor(order) {
  const how = PAYMENT_METHOD_NAMES[order.payment_method];
  if (!how) return null;
  const total = Number(order.total).toLocaleString();
  if (order.order_type === 'delivery') return `Pay Rs. ${total} ${how}${how === 'in cash' ? '' : ' to the rider'} when your order arrives.`;
  if (order.order_type === 'pickup') return `Pay Rs. ${total} ${how} when you collect your order.`;
  return null; // dine-in and counter orders settle at the table / till
}

export default function TrackOrder() {
  const { tenantSlug, orderId } = useParams();
  const [searchParams] = useSearchParams();
  const phone = searchParams.get('phone') || getIdentity(tenantSlug)?.phone || '';
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [restaurantPhone, setRestaurantPhone] = useState(null);
  // True while the last refresh failed for a transient reason (rate limit,
  // network blip). The order we already have stays on screen; we keep
  // retrying with a longer gap. Only a real 404 means "not found".
  const [refreshTrouble, setRefreshTrouble] = useState(false);

  // One-time fetch, not part of the 10s poll — a restaurant's phone number
  // doesn't change mid-order, so this must never repeat on every refresh.
  useEffect(() => {
    publicApi.getRestaurant(tenantSlug).then((res) => setRestaurantPhone(res.restaurant?.phone || null)).catch(() => {});
  }, [tenantSlug]);

  useEffect(() => {
    if (!phone) {
      setError(true);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let timeoutId;
    let haveOrder = false;

    async function load() {
      try {
        const res = await publicApi.getOrderStatus(tenantSlug, orderId, phone);
        if (cancelled) return;
        haveOrder = true;
        setOrder(res.order);
        setRefreshTrouble(false);
        if (!['delivered', 'cancelled'].includes(res.order.status)) {
          timeoutId = setTimeout(load, 10000);
        }
      } catch (err) {
        if (cancelled) return;
        if (err.status === 404 && !haveOrder) {
          setError(true);
        } else {
          // 429, 5xx, offline — never turn a working order into "not found".
          setRefreshTrouble(true);
          timeoutId = setTimeout(load, err.status === 429 ? 30000 : 15000);
        }
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

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-[var(--text-secondary)]">We couldn't find that order.</p>
        <Link to={`/order/${tenantSlug}`} className="text-sm text-brand-600 hover:underline">Back to menu</Link>
      </div>
    );
  }

  if (!order) {
    // First load failed for a transient reason — say so, keep retrying.
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="font-medium text-[var(--text-primary)]">Having trouble loading your order right now.</p>
        <p className="text-sm text-[var(--text-secondary)]">Your order is safe — we're retrying automatically.</p>
      </div>
    );
  }

  if (order.status === 'cancelled') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
        <XCircle className="h-10 w-10 text-red-500" />
        <p className="font-medium text-[var(--text-primary)]">Order #{order.order_number} was cancelled</p>
        {order.cancellation_reason && (
          <p className="max-w-xs text-sm text-[var(--text-secondary)]">{order.cancellation_reason}</p>
        )}
        {restaurantPhone && (
          <a href={`tel:${restaurantPhone}`} className="flex items-center gap-1.5 text-sm text-brand-600 hover:underline">
            <Phone className="h-3.5 w-3.5" /> Call the restaurant: {restaurantPhone}
          </a>
        )}
        <Link to={`/order/${tenantSlug}`} className="text-sm text-brand-600 hover:underline">Back to menu</Link>
      </div>
    );
  }

  const STEPS = stepsFor(order.order_type);
  const stepIndex = STEPS.findIndex((s) => s.key === order.status);
  // Checkout redirects here with `placed=1`. Until the kitchen has moved the
  // order along, this page is the customer's receipt — it must say plainly
  // that the order went through, not just start tracking it.
  const justPlaced = searchParams.get('placed') === '1' && ['new', 'confirmed'].includes(order.status);
  const paymentReminder = paymentReminderFor(order);

  return (
    <div className="min-h-screen bg-[var(--surface-1)] px-4 py-6">
      <div className="mx-auto max-w-lg">
        {justPlaced ? (
          <div className="card mb-4 border-green-200 bg-green-50">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-7 w-7 shrink-0 text-green-600" />
              <div className="space-y-1.5 text-sm text-green-900">
                <h1 className="text-xl font-bold">Your order has been placed! 🎉</h1>
                <p>Order <span className="font-semibold">#{order.order_number}</span> is with the restaurant. They will confirm it in a moment and start cooking.</p>
                {paymentReminder && <p className="font-medium">{paymentReminder}</p>}
                {order.notes && (
                  <p className="text-green-800">Your note — <span className="italic">"{order.notes}"</span> — has been passed to the kitchen.</p>
                )}
                <p className="text-xs text-green-700">Keep this page open or come back to it any time; it updates on its own. We'll also message you on WhatsApp at each step.</p>
              </div>
            </div>
          </div>
        ) : order.status === 'delivered' ? (
          <>
            <h1 className="mb-1 text-2xl font-bold text-[var(--text-primary)]">{COMPLETION_VERB[order.order_type] || 'Delivered'} at {formatTime(order.updated_at)}</h1>
            <p className="mb-6 text-sm text-[var(--text-secondary)]">Order #{order.order_number} · Thank you for ordering with us!</p>
          </>
        ) : (
          <div className="mb-6">
            <h1 className="mb-1 text-2xl font-bold text-[var(--text-primary)]">Order #{order.order_number}</h1>
            <p className="text-sm text-[var(--text-secondary)]">Tracking your order</p>
            {order.status_message && (
              <p className="mt-1 text-sm text-[var(--text-primary)]">{order.status_message}</p>
            )}
          </div>
        )}

        {refreshTrouble && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <Clock className="h-4 w-4 shrink-0" />
            Having trouble refreshing — showing the last update we received. Retrying automatically…
          </div>
        )}

        <NotifyBanner tenantSlug={tenantSlug} phone={phone} status={order.status} />

        {order.eta && (
          <div className="card mb-4 flex items-center gap-3 bg-brand-50 border-brand-200">
            <Clock className="h-5 w-5 shrink-0 text-brand-600" />
            <div className="text-sm text-brand-800">
              <span className="font-semibold">
                {order.order_type === 'delivery' ? 'Leaving the kitchen' : order.order_type === 'dine_in' ? 'At your table' : 'Ready for pickup'} in ~{order.eta.estimated_minutes_min}-{order.eta.estimated_minutes_max} mins
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
                  <div className={`flex h-8 w-8 items-center justify-center rounded-full ${reached ? 'bg-brand-100 text-brand-600' : 'bg-[var(--surface-3)] text-[var(--text-tertiary)]'}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className={reached ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'}>{step.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <h2 className="mb-3 text-sm font-semibold text-[var(--text-secondary)]">Order details</h2>
          <div className="space-y-2 text-sm">
            {order.items.map((item, i) => (
              <div key={i} className="flex justify-between">
                <span>{item.quantity}x {item.name}</span>
                <span>Rs. {Number(item.total_price).toLocaleString()}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-between border-t border-[var(--border-light)] pt-3 text-base font-semibold text-[var(--text-primary)]">
            <span>Total</span>
            <span>Rs. {Number(order.total).toLocaleString()}</span>
          </div>
          {order.order_type === 'delivery' && (
            <p className="mt-3 text-xs text-[var(--text-secondary)]">Delivering to: {order.delivery_address}</p>
          )}
          {order.order_type === 'pickup' && (
            <p className="mt-3 text-xs text-[var(--text-secondary)]">Collect from the restaurant when it's ready.</p>
          )}
          {order.order_type === 'dine_in' && (
            <p className="mt-3 text-xs text-[var(--text-secondary)]">Served to your table.</p>
          )}
          {paymentReminder && order.status !== 'delivered' && (
            <p className="mt-1 text-xs text-[var(--text-secondary)]">{paymentReminder}</p>
          )}
          {order.notes && (
            <p className="mt-1 text-xs text-[var(--text-secondary)]">Your note: <span className="italic">"{order.notes}"</span></p>
          )}
        </div>

        {order.status === 'delivered' && (
          <ReviewPrompt tenantSlug={tenantSlug} orderId={order.id} phone={phone} />
        )}

        <ReferralCard tenantSlug={tenantSlug} phone={phone} />

        {restaurantPhone && order.status !== 'delivered' && (
          <p className="mt-4 text-center text-xs text-[var(--text-tertiary)]">
            Question about your order?{' '}
            <a href={`tel:${restaurantPhone}`} className="text-brand-600 hover:underline">Call the restaurant: {restaurantPhone}</a>
          </p>
        )}
      </div>
    </div>
  );
}

function ReferralCard({ tenantSlug, phone }) {
  const [code, setCode] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!phone) return;
    publicApi.getReferralCode(tenantSlug, phone).then((res) => setCode(res.code)).catch(() => {});
  }, [tenantSlug, phone]);

  if (!code) return null;

  function handleCopy() {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="card mt-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
        <Gift className="h-4 w-4 shrink-0 text-brand-600" />
        <span>Share code <span className="font-mono font-semibold text-[var(--text-primary)]">{code}</span> — your friend gets a discount on their first order, and you earn a reward once it's delivered.</span>
      </div>
      <button onClick={handleCopy} className="btn-secondary shrink-0 px-3 py-1.5 text-xs">
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
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
        <button onClick={() => setDismissed(true)} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-secondary)]">Not now</button>
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
      <div className="card mt-4 text-center text-sm text-[var(--text-secondary)]">
        Thanks for your feedback! 🎉
      </div>
    );
  }

  return (
    <div className="card mt-4">
      <h2 className="mb-3 text-sm font-semibold text-[var(--text-secondary)]">How was your order?</h2>
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
