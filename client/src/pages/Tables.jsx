import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Plus, QrCode, X } from 'lucide-react';

export default function Tables() {
  const { tenant } = useAuth();
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState('');
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newTableNumber, setNewTableNumber] = useState('');
  const [qrTable, setQrTable] = useState(null);

  useEffect(() => {
    api.getBranches().then((res) => {
      setBranches(res.branches);
      if (res.branches.length > 0) setBranchId(res.branches[0].id);
    });
  }, []);

  useEffect(() => {
    if (!branchId) return;
    loadTables();
  }, [branchId]);

  async function loadTables() {
    setLoading(true);
    try {
      const res = await api.getTables(branchId);
      setTables(res.tables);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddTable(e) {
    e.preventDefault();
    if (!newTableNumber.trim()) return;
    try {
      await api.createTable(branchId, newTableNumber.trim());
      setNewTableNumber('');
      loadTables();
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleCloseSession(sessionId) {
    if (!confirm('Close this table session? This should only be done after the bill is settled.')) return;
    try {
      await api.closeTableSession(sessionId);
      loadTables();
    } catch (err) {
      alert(err.message);
    }
  }

  const qrUrl = qrTable ? `${window.location.origin}/table/${qrTable.qr_code_token}` : '';

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tables</h1>
          <p className="text-sm text-gray-500">Dine-in QR ordering — print a table's QR and stick it on for customers to scan</p>
        </div>
        {branches.length > 1 && (
          <select className="input w-48" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
      </div>

      <form onSubmit={handleAddTable} className="card mb-6 flex items-end gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-gray-600">Table number</label>
          <input className="input" placeholder="e.g. 12" value={newTableNumber} onChange={(e) => setNewTableNumber(e.target.value)} />
        </div>
        <button type="submit" className="btn-primary"><Plus className="h-4 w-4" /> Add Table</button>
      </form>

      {loading ? (
        <div className="flex items-center justify-center py-20">Loading tables...</div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {tables.map((t) => (
            <div key={t.id} className="card flex flex-col items-center gap-3 text-center">
              <p className="text-lg font-semibold text-gray-900">Table {t.table_number}</p>
              {t.open_session_id ? (
                <span className={`badge ${t.session_status === 'bill_requested' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                  {t.session_status === 'bill_requested' ? 'Bill requested' : 'Occupied'}
                </span>
              ) : (
                <span className="badge bg-gray-100 text-gray-500">Free</span>
              )}
              <button onClick={() => setQrTable(t)} className="btn-secondary w-full">
                <QrCode className="h-4 w-4" /> Show QR
              </button>
              {t.open_session_id && (
                <button onClick={() => handleCloseSession(t.open_session_id)} className="text-xs text-gray-500 hover:text-red-600">
                  Close session
                </button>
              )}
            </div>
          ))}
          {tables.length === 0 && (
            <p className="col-span-full py-12 text-center text-sm text-gray-400">No tables yet — add one above</p>
          )}
        </div>
      )}

      {qrTable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setQrTable(null)}>
          <div className="card w-full max-w-xs text-center" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Table {qrTable.table_number}</h2>
              <button onClick={() => setQrTable(null)}><X className="h-5 w-5 text-gray-400" /></button>
            </div>
            <div className="flex justify-center rounded-lg bg-white p-4">
              <QRCodeSVG value={qrUrl} size={200} />
            </div>
            <p className="mt-3 break-all text-xs text-gray-400">{qrUrl}</p>
            <p className="mt-2 text-xs text-gray-500">{tenant?.name}</p>
          </div>
        </div>
      )}
    </div>
  );
}
