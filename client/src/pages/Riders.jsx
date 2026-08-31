import { useState, useCallback } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { toast } from '../components/ui/toast';
import { Skeleton } from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import usePolling from '../hooks/usePolling';
import {
  Bike, Plus, Package, CheckCircle2, Truck, Wallet, Loader2, Sparkles, Copy, Check,
} from 'lucide-react';

export default function Riders() {
  const { user } = useAuth();
  const canManage = user?.role === 'owner' || user?.role === 'manager';

  const [riders, setRiders] = useState([]);
  const [unassigned, setUnassigned] = useState([]);
  const [active, setActive] = useState([]); // assignments in progress, across riders
  const [reconciliations, setReconciliations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewRider, setShowNewRider] = useState(false);
  const [showReconcile, setShowReconcile] = useState(null); // rider object
  const [pinResult, setPinResult] = useState(null); // { rider, pin } — shown once after create/reset
  const [suggestions, setSuggestions] = useState({}); // orderId -> { rider, reasoning } | 'loading' | error string

  const load = useCallback(async () => {
    try {
      const [ridersRes, unassignedRes, reconRes] = await Promise.all([
        api.getRiders(),
        api.getUnassignedDeliveries(),
        api.getReconciliations(),
      ]);
      setRiders(ridersRes.riders);
      setUnassigned(unassignedRes.orders);
      setReconciliations(reconRes.reconciliations);

      const assignmentLists = await Promise.all(ridersRes.riders.map((r) => api.getRiderAssignments(r.id)));
      const activeAssignments = ridersRes.riders.flatMap((r, i) =>
        assignmentLists[i].assignments
          .filter((a) => !a.delivered_at)
          .map((a) => ({ ...a, rider_name: r.name })));
      setActive(activeAssignments);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  usePolling(load, 15000);

  async function handleAssign(orderId, riderId) {
    try {
      await api.assignRider(orderId, riderId || undefined);
      toast.success('Rider assigned');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleAskAgent(orderId) {
    setSuggestions((s) => ({ ...s, [orderId]: 'loading' }));
    try {
      const suggestion = await api.suggestDispatchRider(orderId);
      setSuggestions((s) => ({ ...s, [orderId]: suggestion }));
    } catch (err) {
      setSuggestions((s) => ({ ...s, [orderId]: { error: err.message } }));
    }
  }

  async function handleConfirmSuggestion(orderId, riderId) {
    await handleAssign(orderId, riderId);
    setSuggestions((s) => {
      const next = { ...s };
      delete next[orderId];
      return next;
    });
  }

  async function handleDeliveryStatus(orderId, status) {
    try {
      await api.updateDeliveryStatus(orderId, status);
      toast.success('Delivery status updated');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleToggleRiderStatus(rider) {
    try {
      await api.updateRider(rider.id, { status: rider.status === 'active' ? 'inactive' : 'active' });
      toast.success('Rider status updated');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleResetPin(rider) {
    try {
      const res = await api.resetRiderPin(rider.id);
      setPinResult({ rider, pin: res.pin });
      toast.success('New PIN generated');
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (loading) return <div className="space-y-6"><Skeleton className="h-8 w-40" /><div className="grid gap-6 lg:grid-cols-2"><Skeleton.Card /><Skeleton.Card /></div></div>;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Riders &amp; Delivery</h1>
          <p className="text-sm text-gray-500">Assign deliveries, track riders, reconcile cash.</p>
        </div>
        {canManage && (
          <button onClick={() => setShowNewRider(true)} className="btn-primary"><Plus className="h-4 w-4" /> Add Rider</button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Roster */}
        <div className="card">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-700"><Bike className="h-4 w-4" /> Roster</h2>
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {riders.length === 0 && <EmptyState icon={Bike} title="No riders yet" description="Add your first rider to start managing deliveries." action={canManage ? { label: 'Add Rider', onClick: () => setShowNewRider(true) } : undefined} />}
            {riders.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-lg border border-gray-100 p-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">{r.name}</p>
                  <p className="text-xs text-gray-500">{r.phone} · {r.branch_name}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="badge bg-blue-100 text-blue-700">{r.active_deliveries} active</span>
                  <span className={`badge ${r.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{r.status}</span>
                  {canManage && (
                    <button onClick={() => handleToggleRiderStatus(r)} className="text-xs font-medium text-brand-600 hover:underline">
                      {r.status === 'active' ? 'Deactivate' : 'Activate'}
                    </button>
                  )}
                  {canManage && (
                    <button onClick={() => setShowReconcile(r)} className="text-xs font-medium text-brand-600 hover:underline">Reconcile</button>
                  )}
                  {canManage && (
                    <button onClick={() => handleResetPin(r)} className="text-xs font-medium text-brand-600 hover:underline" title="Generate a new login PIN">
                      Reset PIN
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Unassigned deliveries */}
        <div className="card">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-700"><Package className="h-4 w-4" /> Unassigned Deliveries</h2>
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {unassigned.length === 0 && <EmptyState icon={Package} title="All caught up" description="No unassigned deliveries right now." />}
            {unassigned.map((o) => (
              <div key={o.id} className="rounded-lg border border-gray-100 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-900">#{o.order_number} · {o.customer_name || 'Unknown'}</p>
                  <span className="text-sm font-semibold text-gray-900">Rs. {Number(o.total).toLocaleString()}</span>
                </div>
                <p className="mb-2 text-xs text-gray-500">{o.delivery_address}</p>
                <div className="flex gap-2">
                  <select
                    className="input text-xs"
                    defaultValue=""
                    onChange={(e) => e.target.value && handleAssign(o.id, e.target.value)}
                  >
                    <option value="">Assign to...</option>
                    {riders.filter((r) => r.status === 'active').map((r) => (
                      <option key={r.id} value={r.id}>{r.name} ({r.active_deliveries} active)</option>
                    ))}
                  </select>
                  <button onClick={() => handleAssign(o.id)} className="btn-secondary shrink-0 text-xs">Auto-assign</button>
                  <button onClick={() => handleAskAgent(o.id)} className="btn-secondary shrink-0 text-xs" title="Ask the dispatch agent">
                    <Sparkles className="h-3 w-3" />
                  </button>
                </div>

                {suggestions[o.id] === 'loading' && (
                  <p className="mt-2 text-xs text-gray-400">Asking the agent...</p>
                )}
                {suggestions[o.id] && suggestions[o.id] !== 'loading' && (
                  suggestions[o.id].error ? (
                    <p className="mt-2 text-xs text-red-600">{suggestions[o.id].error}</p>
                  ) : (
                    <div className="mt-2 rounded-lg bg-brand-50 p-2 text-xs text-brand-800">
                      <p className="mb-1"><span className="font-semibold">Agent suggests: {suggestions[o.id].rider.name}</span> — {suggestions[o.id].reasoning}</p>
                      <button
                        onClick={() => handleConfirmSuggestion(o.id, suggestions[o.id].rider.id)}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        Confirm this rider
                      </button>
                    </div>
                  )
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Active deliveries */}
        <div className="card">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-700"><Truck className="h-4 w-4" /> Active Deliveries</h2>
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {active.length === 0 && <EmptyState icon={Truck} title="No active deliveries" description="Deliveries in progress will show here." />}
            {active.map((a) => (
              <div key={a.id} className="rounded-lg border border-gray-100 p-3">
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-900">#{a.order_number} · {a.customer_name || 'Unknown'}</p>
                  <span className="text-sm font-semibold text-gray-900">Rs. {Number(a.total).toLocaleString()}</span>
                </div>
                <p className="mb-2 text-xs text-gray-500">Rider: {a.rider_name} · {a.picked_up_at ? 'Picked up' : 'Not picked up'}</p>
                <div className="flex gap-2">
                  {!a.picked_up_at && (
                    <button onClick={() => handleDeliveryStatus(a.order_id, 'picked_up')} className="btn-secondary text-xs">Mark Picked Up</button>
                  )}
                  <button onClick={() => handleDeliveryStatus(a.order_id, 'delivered')} className="btn-primary text-xs">
                    <CheckCircle2 className="h-3 w-3" /> Mark Delivered
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Reconciliation history */}
        <div className="card">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-700"><Wallet className="h-4 w-4" /> Reconciliation History</h2>
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {reconciliations.length === 0 && <EmptyState icon={Wallet} title="No reconciliations yet" description="Cash reconciliations will appear here." />}
            {reconciliations.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-lg border border-gray-100 p-3 text-sm">
                <div>
                  <p className="font-medium text-gray-900">{r.rider_name}</p>
                  <p className="text-xs text-gray-500">
                    {new Date(r.period_start).toLocaleDateString()} – {new Date(r.period_end).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right">
                  <p>Expected Rs. {Number(r.total_expected).toLocaleString()} · Collected Rs. {Number(r.total_collected).toLocaleString()}</p>
                  <p className={Number(r.variance) === 0 ? 'text-gray-400' : Number(r.variance) < 0 ? 'text-red-600' : 'text-green-600'}>
                    Variance: {Number(r.variance) > 0 ? '+' : ''}{Number(r.variance).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showNewRider && (
        <NewRiderModal
          onClose={() => setShowNewRider(false)}
          onCreated={(rider, pin) => { setShowNewRider(false); setPinResult({ rider, pin }); load(); }}
        />
      )}
      {showReconcile && <ReconcileModal rider={showReconcile} onClose={() => setShowReconcile(null)} onDone={() => { setShowReconcile(null); load(); }} />}
      {pinResult && <PinResultModal rider={pinResult.rider} pin={pinResult.pin} onClose={() => setPinResult(null)} />}
    </div>
  );
}

function NewRiderModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleCreate() {
    setSaving(true);
    setError('');
    try {
      const res = await api.createRider({ name, phone });
      onCreated(res.rider, res.pin);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={true} onClose={onClose} title="Add Rider">
      <div className="space-y-3">
        <input className="input" placeholder="Rider name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" placeholder="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <p className="mt-2 text-xs text-gray-400">A login PIN is generated automatically — you'll see it once after saving, to share with the rider.</p>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <button onClick={handleCreate} disabled={saving || !name || !phone} className="btn-primary mt-4 w-full justify-center">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add Rider'}
      </button>
    </Modal>
  );
}

function PinResultModal({ rider, pin, onClose }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard?.writeText(pin).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Modal open={true} onClose={onClose} title={`${rider.name}'s PIN`} size="md">
      <p className="mb-3 text-sm text-gray-500">
        Share this PIN with {rider.name} directly (in person or by phone) — it won't be shown again. They log in at{' '}
        <span className="font-medium text-gray-700">/rider/login</span> with their phone number and this PIN.
      </p>
      <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
        <span className="text-2xl font-bold tracking-widest text-gray-900">{pin}</span>
        <button onClick={handleCopy} className="btn-secondary text-xs">
          {copied ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
        </button>
      </div>
      <button onClick={onClose} className="btn-primary mt-4 w-full justify-center">Done</button>
    </Modal>
  );
}

function ReconcileModal({ rider, onClose, onDone }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleReconcile() {
    setSaving(true);
    setError('');
    try {
      const res = await api.reconcileRider(rider.id, `${start}T00:00:00Z`, `${end}T23:59:59Z`);
      setResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={true} onClose={onClose} title={`Reconcile — ${rider.name}`}>
      {!result ? (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">From</label>
              <input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">To</label>
              <input type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
          <button onClick={handleReconcile} disabled={saving} className="btn-primary w-full justify-center">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Run Reconciliation'}
          </button>
        </>
      ) : (
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-gray-500">Deliveries reconciled</span><span>{result.assignments_reconciled}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Expected</span><span>Rs. {Number(result.reconciliation.total_expected).toLocaleString()}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Collected</span><span>Rs. {Number(result.reconciliation.total_collected).toLocaleString()}</span></div>
          <div className="flex justify-between font-semibold"><span>Variance</span><span>Rs. {Number(result.reconciliation.variance).toLocaleString()}</span></div>
          <button onClick={onDone} className="btn-primary mt-4 w-full justify-center">Done</button>
        </div>
      )}
    </Modal>
  );
}
