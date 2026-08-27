import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import {
  Search, Tag, X, Plus, Star, Wallet, ShoppingBag, Users, Loader2,
} from 'lucide-react';

export default function Customers() {
  const [tab, setTab] = useState('customers'); // 'customers' | 'segments'

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
          <p className="text-sm text-gray-500">Tag customers, build segments, review profiles.</p>
        </div>
        <div className="flex rounded-lg border border-gray-200 bg-white p-1">
          <button
            onClick={() => setTab('customers')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === 'customers' ? 'bg-brand-600 text-white' : 'text-gray-600'}`}
          >
            All Customers
          </button>
          <button
            onClick={() => setTab('segments')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === 'segments' ? 'bg-brand-600 text-white' : 'text-gray-600'}`}
          >
            Segments
          </button>
        </div>
      </div>

      {tab === 'customers' ? <CustomerList /> : <Segments />}
    </div>
  );
}

function CustomerList() {
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback((q) => {
    setLoading(true);
    api.getCustomers(q).then((res) => setCustomers(res.customers)).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => load(search), 400);
    return () => clearTimeout(timer);
  }, [search, load]);

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="lg:col-span-2">
        <div className="mb-3 relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9" placeholder="Search by name or phone..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="max-h-[36rem] space-y-2 overflow-y-auto">
          {loading && <p className="text-sm text-gray-400">Loading...</p>}
          {!loading && customers.length === 0 && <p className="text-sm text-gray-400">No customers found</p>}
          {customers.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={`w-full rounded-lg border p-3 text-left transition-colors ${selectedId === c.id ? 'border-brand-500 bg-brand-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900">{c.name || 'Unknown'}</p>
                <span className="text-xs text-gray-400">{c.order_count} orders</span>
              </div>
              <p className="text-xs text-gray-500">{c.phone}</p>
              {c.tags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {c.tags.map((t) => <span key={t} className="badge bg-purple-100 text-purple-700 text-[10px]">{t}</span>)}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="lg:col-span-3">
        {selectedId ? <CustomerProfile id={selectedId} onTagsChanged={() => load(search)} /> : (
          <div className="card flex h-64 items-center justify-center text-gray-400">Select a customer to view their profile</div>
        )}
      </div>
    </div>
  );
}

function CustomerProfile({ id, onTagsChanged }) {
  const [profile, setProfile] = useState(null);
  const [newTag, setNewTag] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.getCustomerProfile(id).then(setProfile).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function handleAddTag() {
    if (!newTag.trim()) return;
    try {
      await api.addCustomerTag(id, newTag.trim().toLowerCase());
      setNewTag('');
      load();
      onTagsChanged();
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleRemoveTag(tag) {
    try {
      await api.removeCustomerTag(id, tag);
      load();
      onTagsChanged();
    } catch (err) {
      alert(err.message);
    }
  }

  if (loading || !profile) return <div className="card flex h-64 items-center justify-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  const { customer, tags, orders, reviews, loyalty_balance } = profile;

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{customer.name || 'Unknown'}</h2>
            <p className="text-sm text-gray-500">{customer.phone}</p>
          </div>
        </div>
        <div className="mb-3 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-lg bg-gray-50 p-3">
            <ShoppingBag className="mx-auto mb-1 h-4 w-4 text-gray-400" />
            <p className="text-lg font-bold text-gray-900">{customer.order_count}</p>
            <p className="text-xs text-gray-500">Orders</p>
          </div>
          <div className="rounded-lg bg-gray-50 p-3">
            <Wallet className="mx-auto mb-1 h-4 w-4 text-gray-400" />
            <p className="text-lg font-bold text-gray-900">Rs. {Number(customer.total_spent).toLocaleString()}</p>
            <p className="text-xs text-gray-500">Total Spent</p>
          </div>
          <div className="rounded-lg bg-gray-50 p-3">
            <Star className="mx-auto mb-1 h-4 w-4 text-gray-400" />
            <p className="text-lg font-bold text-gray-900">{loyalty_balance ?? '—'}</p>
            <p className="text-xs text-gray-500">Loyalty Points</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tags.map((t) => (
            <span key={t} className="badge flex items-center gap-1 bg-purple-100 text-purple-700">
              <Tag className="h-3 w-3" /> {t}
              <button onClick={() => handleRemoveTag(t)} className="ml-1 hover:text-purple-900"><X className="h-3 w-3" /></button>
            </span>
          ))}
          <div className="flex items-center gap-1">
            <input
              className="input h-7 w-28 text-xs"
              placeholder="Add tag"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
            />
            <button onClick={handleAddTag} className="rounded p-1.5 text-brand-600 hover:bg-brand-50"><Plus className="h-4 w-4" /></button>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">Order History</h3>
        <div className="max-h-48 space-y-2 overflow-y-auto">
          {orders.length === 0 && <p className="text-sm text-gray-400">No orders yet</p>}
          {orders.map((o) => (
            <div key={o.id} className="flex items-center justify-between text-sm">
              <span>#{o.order_number} · <span className="uppercase text-xs text-gray-400">{o.channel}</span> · {o.status}</span>
              <span className="font-medium">Rs. {Number(o.total).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      {reviews.length > 0 && (
        <div className="card">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">Reviews</h3>
          <div className="space-y-2">
            {reviews.map((r, i) => (
              <div key={i} className="text-sm">
                <span className="text-yellow-500">{'★'.repeat(r.rating)}</span>
                {r.comment && <p className="text-gray-600">{r.comment}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Segments() {
  const [segments, setSegments] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [preview, setPreview] = useState(null);

  const load = useCallback(() => {
    api.getSegments().then((res) => setSegments(res.segments));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handlePreview(seg) {
    const res = await api.getSegmentCustomers(seg.id);
    setPreview({ segment: seg, ...res });
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button onClick={() => setShowNew(true)} className="btn-primary"><Users className="h-4 w-4" /> New Segment</button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {segments.length === 0 && <p className="text-sm text-gray-400">No segments yet</p>}
        {segments.map((s) => (
          <div key={s.id} className="card">
            <h3 className="mb-2 font-semibold text-gray-900">{s.name}</h3>
            <div className="mb-3 space-y-1 text-xs text-gray-500">
              {s.filter_rules.min_orders !== undefined && <p>Min orders: {s.filter_rules.min_orders}</p>}
              {s.filter_rules.min_spend !== undefined && <p>Min spend: Rs. {s.filter_rules.min_spend}</p>}
              {s.filter_rules.last_order_days_ago_lt !== undefined && <p>Ordered in last {s.filter_rules.last_order_days_ago_lt} days</p>}
              {s.filter_rules.tags && <p>Tags: {s.filter_rules.tags.join(', ')}</p>}
            </div>
            <button onClick={() => handlePreview(s)} className="btn-secondary w-full justify-center text-sm">Preview Matches</button>
          </div>
        ))}
      </div>

      {showNew && <NewSegmentModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />}
      {preview && <PreviewModal data={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function NewSegmentModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [minOrders, setMinOrders] = useState('');
  const [minSpend, setMinSpend] = useState('');
  const [recencyDays, setRecencyDays] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleCreate() {
    const filter_rules = {};
    if (minOrders) filter_rules.min_orders = Number(minOrders);
    if (minSpend) filter_rules.min_spend = Number(minSpend);
    if (recencyDays) filter_rules.last_order_days_ago_lt = Number(recencyDays);
    if (tags.trim()) filter_rules.tags = tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);

    if (Object.keys(filter_rules).length === 0) {
      setError('Add at least one rule');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.createSegment({ name, filter_rules });
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
          <h3 className="text-lg font-semibold">New Segment</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3">
          <input className="input" placeholder="Segment name" value={name} onChange={(e) => setName(e.target.value)} />
          <input type="number" className="input" placeholder="Min orders (optional)" value={minOrders} onChange={(e) => setMinOrders(e.target.value)} />
          <input type="number" className="input" placeholder="Min total spend (optional)" value={minSpend} onChange={(e) => setMinSpend(e.target.value)} />
          <input type="number" className="input" placeholder="Ordered within last N days (optional)" value={recencyDays} onChange={(e) => setRecencyDays(e.target.value)} />
          <input className="input" placeholder="Tags, comma-separated (optional)" value={tags} onChange={(e) => setTags(e.target.value)} />
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <button onClick={handleCreate} disabled={saving || !name} className="btn-primary mt-4 w-full justify-center">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create Segment'}
        </button>
      </div>
    </div>
  );
}

function PreviewModal({ data, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="max-h-[80vh] w-96 overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{data.segment.name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>
        <p className="mb-3 text-sm text-gray-500">{data.count} matching customer{data.count !== 1 ? 's' : ''}</p>
        <div className="space-y-2">
          {data.customers.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-lg border border-gray-100 p-2 text-sm">
              <span>{c.name || c.phone}</span>
              <span className="text-gray-400">{c.order_count} orders</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
