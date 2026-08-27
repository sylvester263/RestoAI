import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { Tag, Plus, X, ToggleLeft, ToggleRight, Sparkles } from 'lucide-react';

export default function Coupons() {
  const [coupons, setCoupons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.getCoupons();
      setCoupons(res.coupons);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleToggleActive(coupon) {
    try {
      await api.setCouponActive(coupon.id, !coupon.active);
      load();
    } catch (err) {
      alert(err.message);
    }
  }

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400">Loading coupons...</div>;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Coupons</h1>
          <p className="text-sm text-gray-500">Discount codes — manual ones you create, plus real codes minted by the win-back agent.</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="h-4 w-4" /> New Coupon</button>
      </div>

      {coupons.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <Tag className="mb-4 h-16 w-16" />
          <p className="text-lg font-medium">No coupons yet</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Discount</th>
                <th className="px-4 py-3">Target</th>
                <th className="px-4 py-3 text-right">Redemptions</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {coupons.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3 font-mono font-medium text-gray-900">{c.code}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {c.discount_type === 'percent' ? `${Number(c.discount_value)}%` : `Rs. ${Number(c.discount_value).toLocaleString()}`}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {c.customer_id ? (
                      <span className="flex items-center gap-1"><Sparkles className="h-3 w-3 text-brand-500" /> {c.customer_name || c.customer_phone}</span>
                    ) : 'Anyone'}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500">{c.redemption_count}{c.max_redemptions ? ` / ${c.max_redemptions}` : ''}</td>
                  <td className="px-4 py-3 text-gray-500">{c.expires_at ? new Date(c.expires_at).toLocaleDateString() : 'Never'}</td>
                  <td className="px-4 py-3">
                    <span className={`badge ${c.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {c.active ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleToggleActive(c)} className="text-gray-400 hover:text-brand-600">
                      {c.active ? <ToggleRight className="h-6 w-6" /> : <ToggleLeft className="h-6 w-6" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <CouponFormModal onClose={() => setShowForm(false)} onCreated={() => { setShowForm(false); load(); }} />
      )}
    </div>
  );
}

function CouponFormModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ code: '', discount_type: 'percent', discount_value: '', max_redemptions: '', expires_at: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleCreate() {
    setSaving(true);
    setError('');
    try {
      const payload = {
        discount_type: form.discount_type,
        discount_value: Number(form.discount_value),
      };
      if (form.code) payload.code = form.code.toUpperCase();
      if (form.max_redemptions) payload.max_redemptions = Number(form.max_redemptions);
      if (form.expires_at) payload.expires_at = new Date(`${form.expires_at}T23:59:59`).toISOString();
      await api.createCoupon(payload);
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-96 rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">New Coupon</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Code (optional — auto-generated if blank)</label>
            <input className="input font-mono" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. WELCOME10" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Type</label>
              <select className="input" value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value })}>
                <option value="percent">Percent off</option>
                <option value="fixed">Fixed amount (PKR)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Value</label>
              <input type="number" className="input" min="0" value={form.discount_value} onChange={(e) => setForm({ ...form, discount_value: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Max total redemptions</label>
              <input type="number" className="input" min="1" placeholder="Unlimited" value={form.max_redemptions} onChange={(e) => setForm({ ...form, max_redemptions: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Expires</label>
              <input type="date" className="input" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} />
            </div>
          </div>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleCreate} disabled={saving || !form.discount_value} className="btn-primary">Create Coupon</button>
        </div>
      </div>
    </div>
  );
}
