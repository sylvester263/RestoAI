import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { riderApi } from '../../lib/api';
import { Bike, LogOut, Package, CheckCircle2, Wallet, MapPin, Phone } from 'lucide-react';

export default function RiderDashboard() {
  const navigate = useNavigate();
  const [rider, setRider] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [summary, setSummary] = useState({ cash_collected_today: 0, delivered_today: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const [meRes, assignmentsRes, summaryRes] = await Promise.all([
        riderApi.me(),
        riderApi.getAssignments(),
        riderApi.getSummary(),
      ]);
      setRider(meRes.rider);
      setAssignments(assignmentsRes.assignments);
      setSummary(summaryRes);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!localStorage.getItem('riderToken')) {
      navigate('/rider/login');
      return;
    }
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [load, navigate]);

  function handleLogout() {
    localStorage.removeItem('riderToken');
    localStorage.removeItem('riderInfo');
    navigate('/rider/login');
  }

  async function handlePickedUp(orderId) {
    setBusyId(orderId);
    try {
      await riderApi.updateAssignmentStatus(orderId, 'picked_up');
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelivered(assignment) {
    let cashCollected;
    if (assignment.payment_method === 'cash') {
      const input = window.prompt(`Cash collected for order #${assignment.order_number}?`, assignment.total);
      if (input === null) return;
      cashCollected = parseFloat(input);
      if (Number.isNaN(cashCollected) || cashCollected < 0) {
        alert('Enter a valid amount');
        return;
      }
    }
    setBusyId(assignment.order_id);
    try {
      await riderApi.updateAssignmentStatus(assignment.order_id, 'delivered', cashCollected);
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="flex h-screen items-center justify-center text-gray-400">Loading...</div>;

  const active = assignments.filter((a) => !a.delivered_at);
  const completedToday = assignments.filter((a) => a.delivered_at);

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <Bike className="h-5 w-5 text-brand-600" />
          <div>
            <p className="text-sm font-semibold text-gray-900">{rider?.name}</p>
            <p className="text-xs text-gray-500">{rider?.branch_name} · {rider?.tenant_name}</p>
          </div>
        </div>
        <button onClick={handleLogout} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
          <LogOut className="h-5 w-5" />
        </button>
      </div>

      <div className="mx-auto max-w-lg px-4 py-4">
        {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {/* Cash summary */}
        <div className="card mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-brand-600" />
            <div>
              <p className="text-xs text-gray-500">Cash collected today</p>
              <p className="text-lg font-bold text-gray-900">Rs. {Number(summary.cash_collected_today).toLocaleString()}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500">Delivered</p>
            <p className="text-lg font-bold text-gray-900">{summary.delivered_today}</p>
          </div>
        </div>

        {/* Active deliveries */}
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-700"><Package className="h-4 w-4" /> Your deliveries ({active.length})</h2>
        <div className="mb-6 space-y-3">
          {active.length === 0 && <p className="rounded-lg border border-dashed border-gray-200 p-4 text-center text-sm text-gray-400">No deliveries assigned right now</p>}
          {active.map((a) => (
            <div key={a.id} className="card">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-semibold text-gray-900">Order #{a.order_number}</p>
                <span className="text-sm font-semibold text-gray-900">Rs. {Number(a.total).toLocaleString()}</span>
              </div>
              {a.customer_name && <p className="mb-1 text-sm text-gray-600">{a.customer_name}</p>}
              {a.customer_phone && (
                <a href={`tel:${a.customer_phone}`} className="mb-1 flex items-center gap-1 text-sm text-brand-600">
                  <Phone className="h-3 w-3" /> {a.customer_phone}
                </a>
              )}
              {a.delivery_address && (
                <p className="mb-3 flex items-start gap-1 text-sm text-gray-500"><MapPin className="mt-0.5 h-3 w-3 shrink-0" /> {a.delivery_address}</p>
              )}
              <p className="mb-3 text-xs uppercase tracking-wide text-gray-400">
                {a.payment_method === 'cash' ? 'Cash on delivery' : a.payment_method} · {a.picked_up_at ? 'Picked up' : 'Not picked up yet'}
              </p>
              <div className="flex gap-2">
                {!a.picked_up_at && (
                  <button onClick={() => handlePickedUp(a.order_id)} disabled={busyId === a.order_id} className="btn-secondary flex-1 justify-center">
                    Mark picked up
                  </button>
                )}
                <button onClick={() => handleDelivered(a)} disabled={busyId === a.order_id} className="btn-primary flex-1 justify-center">
                  <CheckCircle2 className="h-4 w-4" /> Mark delivered
                </button>
              </div>
            </div>
          ))}
        </div>

        {completedToday.length > 0 && (
          <>
            <h2 className="mb-2 text-sm font-semibold text-gray-700">Delivered today ({completedToday.length})</h2>
            <div className="space-y-2">
              {completedToday.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm">
                  <span className="text-gray-700">#{a.order_number}</span>
                  <span className="text-gray-500">{new Date(a.delivered_at).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
