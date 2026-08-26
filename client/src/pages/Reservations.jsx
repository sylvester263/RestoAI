import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ChevronLeft, ChevronRight, Users } from 'lucide-react';

// Karachi calendar date, not the browser's UTC/local date — the restaurant
// operates on Pakistan time regardless of where staff happen to be browsing
// from, and toISOString() rolls back a day once it's past midnight there.
function toLocalDateString(d) {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
}

const STATUS_FLOW = { confirmed: 'seated', seated: 'completed' };
const STATUS_STYLE = {
  confirmed: 'bg-blue-100 text-blue-700',
  seated: 'bg-green-100 text-green-700',
  completed: 'bg-gray-100 text-gray-500',
  cancelled: 'bg-red-100 text-red-600',
  no_show: 'bg-amber-100 text-amber-700',
};

export default function Reservations() {
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState('');
  const [date, setDate] = useState(toLocalDateString(new Date()));
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getBranches().then((res) => {
      setBranches(res.branches);
      if (res.branches.length > 0) setBranchId(res.branches[0].id);
    });
  }, []);

  useEffect(() => {
    if (!branchId) return;
    load();
  }, [branchId, date]);

  async function load() {
    setLoading(true);
    try {
      const res = await api.getReservations(branchId, date);
      setReservations(res.reservations);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(id, status) {
    try {
      await api.updateReservationStatus(id, status);
      load();
    } catch (err) {
      alert(err.message);
    }
  }

  function shiftDate(days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    setDate(toLocalDateString(d));
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reservations</h1>
          <p className="text-sm text-gray-500">{reservations.length} booking{reservations.length !== 1 ? 's' : ''} on this day</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => shiftDate(-1)} className="rounded-lg border border-gray-300 p-2 hover:bg-gray-50"><ChevronLeft className="h-4 w-4" /></button>
          <input type="date" className="input w-40" value={date} onChange={(e) => setDate(e.target.value)} />
          <button onClick={() => shiftDate(1)} className="rounded-lg border border-gray-300 p-2 hover:bg-gray-50"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">Loading reservations...</div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-4 py-3 font-medium text-gray-600">Time</th>
                <th className="px-4 py-3 font-medium text-gray-600">Guest</th>
                <th className="px-4 py-3 font-medium text-gray-600">Party</th>
                <th className="px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {reservations.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {new Date(r.reserved_for).toLocaleTimeString('en-PK', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-gray-900">{r.customer_name}</p>
                    <p className="text-xs text-gray-400">{r.customer_phone}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600"><Users className="mr-1 inline h-3 w-3" />{r.party_size}</td>
                  <td className="px-4 py-3">
                    <span className={`badge ${STATUS_STYLE[r.status]}`}>{r.status.replace('_', ' ')}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {STATUS_FLOW[r.status] && (
                        <button onClick={() => updateStatus(r.id, STATUS_FLOW[r.status])} className="btn-secondary !px-2 !py-1 text-xs">
                          Mark {STATUS_FLOW[r.status]}
                        </button>
                      )}
                      {['confirmed', 'seated'].includes(r.status) && (
                        <button onClick={() => updateStatus(r.id, 'cancelled')} className="text-xs text-gray-400 hover:text-red-600">
                          Cancel
                        </button>
                      )}
                      {r.status === 'confirmed' && (
                        <button onClick={() => updateStatus(r.id, 'no_show')} className="text-xs text-gray-400 hover:text-amber-600">
                          No-show
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {reservations.length === 0 && (
            <div className="py-12 text-center text-sm text-gray-400">No reservations for this day</div>
          )}
        </div>
      )}
    </div>
  );
}
