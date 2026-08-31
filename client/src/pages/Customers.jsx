import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { toast } from '../components/ui/toast';
import { Skeleton } from '../components/ui/Skeleton';
import Modal from '../components/ui/Modal';
import {
  Search, Tag, X, Plus, Star, Wallet, ShoppingBag, Users, Loader2,
} from 'lucide-react';

export default function Customers() {
  const [tab, setTab] = useState('customers'); // 'customers' | 'segments'

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Customers</h1>
          <p className="text-sm text-[var(--text-secondary)]">Tag customers, build segments, review profiles.</p>
        </div>
        <div className="flex rounded-lg border border-[var(--border)] bg-white p-1">
          <button
            onClick={() => setTab('customers')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === 'customers' ? 'bg-brand-600 text-white' : 'text-[var(--text-secondary)]'}`}
          >
            All Customers
          </button>
          <button
            onClick={() => setTab('segments')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === 'segments' ? 'bg-brand-600 text-white' : 'text-[var(--text-secondary)]'}`}
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
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input className="input pl-9" placeholder="Search by name or phone..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="max-h-[36rem] space-y-2 overflow-y-auto">
          {!loading && customers.length === 0 && <p className="text-sm text-[var(--text-tertiary)]">No customers found</p>}
          {loading && <Skeleton.List rows={4} />}
          {customers.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={`w-full rounded-lg border p-3 text-left transition-colors ${selectedId === c.id ? 'border-brand-500 bg-brand-50' : 'border-[var(--border)] bg-[var(--surface-2)] hover:border-[var(--border)]'}`}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-[var(--text-primary)]">{c.name || 'Unknown'}</p>
                <span className="text-xs text-[var(--text-tertiary)]">{c.order_count} orders</span>
              </div>
              <p className="text-xs text-[var(--text-secondary)]">{c.phone}</p>
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
          <div className="card flex h-64 items-center justify-center text-[var(--text-tertiary)]">Select a customer to view their profile</div>
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
      toast.error(err.message);
    }
  }

  async function handleRemoveTag(tag) {
    try {
      await api.removeCustomerTag(id, tag);
      load();
      onTagsChanged();
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (loading || !profile) return <div className="card flex h-64 items-center justify-center text-[var(--text-tertiary)]"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  const { customer, tags, orders, reviews, loyalty_balance } = profile;

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">{customer.name || 'Unknown'}</h2>
            <p className="text-sm text-[var(--text-secondary)]">{customer.phone}</p>
          </div>
        </div>
        <div className="mb-3 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-lg bg-[var(--surface-3)] p-3">
            <ShoppingBag className="mx-auto mb-1 h-4 w-4 text-[var(--text-tertiary)]" />
            <p className="text-lg font-bold text-[var(--text-primary)]">{customer.order_count}</p>
            <p className="text-xs text-[var(--text-secondary)]">Orders</p>
          </div>
          <div className="rounded-lg bg-[var(--surface-3)] p-3">
            <Wallet className="mx-auto mb-1 h-4 w-4 text-[var(--text-tertiary)]" />
            <p className="text-lg font-bold text-[var(--text-primary)]">Rs. {Number(customer.total_spent).toLocaleString()}</p>
            <p className="text-xs text-[var(--text-secondary)]">Total Spent</p>
          </div>
          <div className="rounded-lg bg-[var(--surface-3)] p-3">
            <Star className="mx-auto mb-1 h-4 w-4 text-[var(--text-tertiary)]" />
            <p className="text-lg font-bold text-[var(--text-primary)]">{loyalty_balance ?? '—'}</p>
            <p className="text-xs text-[var(--text-secondary)]">Loyalty Points</p>
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
        <h3 className="mb-3 text-sm font-semibold text-[var(--text-secondary)]">Order History</h3>
        <div className="max-h-48 space-y-2 overflow-y-auto">
          {orders.length === 0 && <p className="text-sm text-[var(--text-tertiary)]">No orders yet</p>}
          {orders.map((o) => (
            <div key={o.id} className="flex items-center justify-between text-sm">
              <span>#{o.order_number} · <span className="uppercase text-xs text-[var(--text-tertiary)]">{o.channel}</span> · {o.status}</span>
              <span className="font-medium">Rs. {Number(o.total).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      {reviews.length > 0 && (
        <div className="card">
          <h3 className="mb-3 text-sm font-semibold text-[var(--text-secondary)]">Reviews</h3>
          <div className="space-y-2">
            {reviews.map((r, i) => (
              <div key={i} className="text-sm">
                <span className="text-yellow-500">{'★'.repeat(r.rating)}</span>
                {r.comment && <p className="text-[var(--text-secondary)]">{r.comment}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const RFM_COLORS = {
  'Champions': 'bg-emerald-50 border-emerald-200 text-emerald-700',
  'Loyal customers': 'bg-teal-50 border-teal-200 text-teal-700',
  'Recent/promising': 'bg-blue-50 border-blue-200 text-blue-700',
  'Needs attention': 'bg-amber-50 border-amber-200 text-amber-700',
  'About to sleep': 'bg-orange-50 border-orange-200 text-orange-700',
  'Cannot lose them': 'bg-red-50 border-red-200 text-red-700',
  'Lost': 'bg-[var(--surface-3)] border-[var(--border)] text-[var(--text-secondary)]',
};

function Segments() {
  const [segments, setSegments] = useState([]);
  const [rfmSummary, setRfmSummary] = useState([]);
  const [rfmLoading, setRfmLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [preview, setPreview] = useState(null);
  const [rfmPreview, setRfmPreview] = useState(null);

  const load = useCallback(() => {
    api.getSegments().then((res) => setSegments(res.segments));
    setRfmLoading(true);
    api.getRfmSegments().then((res) => setRfmSummary(res.summary)).finally(() => setRfmLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handlePreview(seg) {
    const res = await api.getSegmentCustomers(seg.id);
    setPreview({ segment: seg, ...res });
  }

  async function handleRfmPreview(label) {
    const res = await api.getRfmSegmentCustomers(label);
    setRfmPreview(res);
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="mb-1 text-sm font-semibold text-[var(--text-secondary)]">RFM segments</h2>
        <p className="mb-3 text-xs text-[var(--text-secondary)]">Built in — every customer with an order, scored by recency, frequency, and spend.</p>
        {rfmLoading ? (
          <p className="text-sm text-[var(--text-tertiary)]">Scoring customers...</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {rfmSummary.map((s) => (
              <button
                key={s.label}
                onClick={() => handleRfmPreview(s.label)}
                className={`rounded-lg border p-3 text-left transition-opacity hover:opacity-80 ${RFM_COLORS[s.label] || 'bg-[var(--surface-3)] border-[var(--border)] text-[var(--text-secondary)]'}`}
              >
                <p className="text-lg font-bold">{s.count}</p>
                <p className="text-xs font-medium">{s.label}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--text-secondary)]">Custom segments</h2>
        <button onClick={() => setShowNew(true)} className="btn-primary"><Users className="h-4 w-4" /> New Segment</button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {segments.length === 0 && <p className="text-sm text-[var(--text-tertiary)]">No segments yet</p>}
        {segments.map((s) => (
          <div key={s.id} className="card">
            <h3 className="mb-2 font-semibold text-[var(--text-primary)]">{s.name}</h3>
            <div className="mb-3 space-y-1 text-xs text-[var(--text-secondary)]">
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
      {rfmPreview && (
        <PreviewModal
          data={{ segment: { name: rfmPreview.label }, customers: rfmPreview.customers, count: rfmPreview.count }}
          onClose={() => setRfmPreview(null)}
        />
      )}
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
    <Modal open={true} onClose={onClose} title="New Segment">
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
    </Modal>
  );
}

function PreviewModal({ data, onClose }) {
  return (
    <Modal open={true} onClose={onClose} title={data.segment.name}>
      <p className="mb-3 text-sm text-[var(--text-secondary)]">{data.count} matching customer{data.count !== 1 ? 's' : ''}</p>
      <div className="max-h-[60vh] space-y-2 overflow-y-auto">
        {data.customers.map((c) => (
          <div key={c.id} className="flex items-center justify-between rounded-lg border border-[var(--border-light)] p-2 text-sm">
            <span>{c.name || c.phone}</span>
            <span className="text-[var(--text-tertiary)]">{c.order_count} orders</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
