import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { publicApi } from '../../lib/api';
import { getCart, clearCart, getIdentity, setIdentity } from '../../lib/publicOrderStore';
import { ArrowLeft, Gift } from 'lucide-react';

export default function Checkout() {
  const { tenantSlug } = useParams();
  const navigate = useNavigate();
  const [cart, setCart] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', delivery_address: '', payment_method: 'cash', notes: '' });
  const [loyalty, setLoyalty] = useState(null); // { enabled, balance, redemption_rate }
  const [redeem, setRedeem] = useState(false);

  useEffect(() => {
    const items = getCart(tenantSlug);
    setCart(items);
    if (items.length === 0) {
      navigate(`/order/${tenantSlug}`);
      return;
    }
    const identity = getIdentity(tenantSlug);
    if (identity) {
      setForm((f) => ({ ...f, name: identity.name || '', phone: identity.phone || '' }));
    }
  }, [tenantSlug, navigate]);

  // Look up loyalty balance once we have a phone number to check against
  useEffect(() => {
    if (!form.phone || form.phone.trim().length < 7) {
      setLoyalty(null);
      return;
    }
    const timer = setTimeout(() => {
      publicApi.getLoyaltyBalance(tenantSlug, form.phone.trim())
        .then(setLoyalty)
        .catch(() => setLoyalty(null));
    }, 500);
    return () => clearTimeout(timer);
  }, [tenantSlug, form.phone]);

  const subtotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const tax = Math.round(subtotal * 0.05);
  const deliveryFee = 100;
  const canRedeem = loyalty?.enabled && loyalty.balance > 0;
  const redeemDiscount = canRedeem && redeem
    ? Math.round(loyalty.balance * loyalty.redemption_rate * 100) / 100
    : 0;
  const total = Math.max(0, subtotal + tax + deliveryFee - redeemDiscount);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await publicApi.createOrder(tenantSlug, {
        customer_name: form.name,
        customer_phone: form.phone,
        delivery_address: form.delivery_address,
        payment_method: form.payment_method,
        notes: form.notes || undefined,
        redeem_points: canRedeem && redeem ? loyalty.balance : undefined,
        items: cart.map((i) => ({ menu_item_id: i.menu_item_id, quantity: i.quantity })),
      });
      setIdentity(tenantSlug, { name: form.name, phone: form.phone });
      clearCart(tenantSlug);
      navigate(`/order/${tenantSlug}/track/${res.order.id}?phone=${encodeURIComponent(form.phone)}`);
    } catch (err) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="mx-auto max-w-lg">
        <Link to={`/order/${tenantSlug}`} className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-4 w-4" /> Back to menu
        </Link>

        <h1 className="mb-4 text-2xl font-bold text-gray-900">Checkout</h1>

        <div className="card mb-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-600">Your order</h2>
          <div className="space-y-2 text-sm">
            {cart.map((item) => (
              <div key={item.menu_item_id} className="flex justify-between">
                <span>{item.quantity}x {item.name}</span>
                <span>Rs. {(item.price * item.quantity).toLocaleString()}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-1 border-t border-gray-100 pt-3 text-sm text-gray-600">
            <div className="flex justify-between"><span>Subtotal</span><span>Rs. {subtotal.toLocaleString()}</span></div>
            <div className="flex justify-between"><span>Tax</span><span>Rs. {tax.toLocaleString()}</span></div>
            <div className="flex justify-between"><span>Delivery fee</span><span>Rs. {deliveryFee.toLocaleString()}</span></div>
            {redeemDiscount > 0 && (
              <div className="flex justify-between text-green-600"><span>Loyalty discount</span><span>-Rs. {redeemDiscount.toLocaleString()}</span></div>
            )}
            <div className="flex justify-between text-base font-semibold text-gray-900">
              <span>Total</span><span>Rs. {total.toLocaleString()}</span>
            </div>
          </div>

          {canRedeem && (
            <label className="mt-3 flex items-center gap-2 rounded-lg bg-brand-50 p-3 text-sm text-brand-800 cursor-pointer">
              <input
                type="checkbox"
                checked={redeem}
                onChange={(e) => setRedeem(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-brand-600"
              />
              <Gift className="h-4 w-4 shrink-0" />
              <span>
                Redeem {loyalty.balance} points for Rs. {(Math.round(loyalty.balance * loyalty.redemption_rate * 100) / 100).toLocaleString()} off
              </span>
            </label>
          )}
        </div>

        <form onSubmit={handleSubmit} className="card space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Your name</label>
            <input
              className="input"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Phone number</label>
            <input
              className="input"
              required
              placeholder="+92300..."
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Delivery address</label>
            <input
              className="input"
              required
              value={form.delivery_address}
              onChange={(e) => setForm({ ...form, delivery_address: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Payment method</label>
            <select
              className="input"
              value={form.payment_method}
              onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
            >
              <option value="cash">Cash on delivery</option>
              <option value="jazzcash">JazzCash</option>
              <option value="easypaisa">EasyPaisa</option>
              <option value="card">Card on delivery</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Notes (optional)</label>
            <input
              className="input"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          <button type="submit" disabled={submitting} className="btn-primary w-full justify-center">
            {submitting ? 'Placing order...' : `Place order · Rs. ${total.toLocaleString()}`}
          </button>
        </form>
      </div>
    </div>
  );
}
