import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Package, AlertTriangle, Plus, Edit2, Trash2, RefreshCw, X } from 'lucide-react';

export default function Inventory() {
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showLowOnly, setShowLowOnly] = useState(searchParams.get('low_stock') === 'true');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', unit: 'kg', current_qty: 0, min_qty: 0 });
  const [restockId, setRestockId] = useState(null);
  const [restockQty, setRestockQty] = useState('');

  async function load() {
    setLoading(true);
    try {
      const params = {};
      if (showLowOnly) params.low_stock = 'true';
      const res = await api.getInventory(params);
      setItems(res.items);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [showLowOnly]);

  function openCreate() {
    setEditing(null);
    setForm({ name: '', unit: 'kg', current_qty: 0, min_qty: 0 });
    setShowForm(true);
  }

  function openEdit(item) {
    setEditing(item);
    setForm({ name: item.name, unit: item.unit, current_qty: Number(item.current_qty), min_qty: Number(item.min_qty) });
    setShowForm(true);
  }

  async function handleSave() {
    try {
      if (editing) {
        await api.updateInventoryItem(editing.id, form);
      } else {
        await api.createInventoryItem(form);
      }
      setShowForm(false);
      load();
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this inventory item?')) return;
    try {
      await api.deleteInventoryItem(id);
      load();
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleRestock() {
    if (!restockQty || Number(restockQty) <= 0) return;
    try {
      await api.restockItem(restockId, Number(restockQty));
      setRestockId(null);
      setRestockQty('');
      load();
    } catch (err) {
      alert(err.message);
    }
  }

  const lowStockCount = items.filter((i) => Number(i.current_qty) <= Number(i.min_qty)).length;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
          <p className="text-sm text-gray-500">{items.length} items tracked</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowLowOnly(!showLowOnly)}
            className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              showLowOnly ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <AlertTriangle className="h-4 w-4" />
            Low stock {lowStockCount > 0 && `(${lowStockCount})`}
          </button>
          <button onClick={openCreate} className="btn-primary flex items-center gap-2">
            <Plus className="h-4 w-4" /> Add item
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-20 text-center text-gray-400">Loading inventory...</div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <Package className="mb-4 h-16 w-16" />
          <p className="text-lg font-medium">{showLowOnly ? 'No low-stock items!' : 'No inventory items yet'}</p>
          <p className="text-sm">{showLowOnly ? 'All stock levels are healthy.' : 'Click "Add item" to start tracking.'}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Branch</th>
                <th className="px-4 py-3 text-right">Current Stock</th>
                <th className="px-4 py-3 text-right">Min Level</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last Restocked</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => {
                const qty = Number(item.current_qty);
                const min = Number(item.min_qty);
                const isLow = qty <= min;
                return (
                  <tr key={item.id} className={isLow ? 'bg-red-50' : ''}>
                    <td className="px-4 py-3 font-medium text-gray-900">{item.name}</td>
                    <td className="px-4 py-3 text-gray-500">{item.branch_name || '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold">
                      {qty} <span className="text-xs text-gray-400">{item.unit}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500">{min} {item.unit}</td>
                    <td className="px-4 py-3">
                      {isLow ? (
                        <span className="badge bg-red-100 text-red-700">
                          <AlertTriangle className="mr-1 h-3 w-3" /> Low
                        </span>
                      ) : (
                        <span className="badge bg-green-100 text-green-700">OK</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {item.last_restocked ? new Date(item.last_restocked).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => { setRestockId(item.id); setRestockQty(''); }} className="rounded p-1.5 text-green-600 hover:bg-green-50" title="Restock">
                          <RefreshCw className="h-4 w-4" />
                        </button>
                        <button onClick={() => openEdit(item)} className="rounded p-1.5 text-gray-500 hover:bg-gray-100" title="Edit">
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button onClick={() => handleDelete(item.id)} className="rounded p-1.5 text-red-500 hover:bg-red-50" title="Delete">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Restock modal */}
      {restockId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setRestockId(null)}>
          <div className="w-80 rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-lg font-semibold">Restock Item</h3>
            <input
              type="number"
              className="input mb-4 w-full"
              placeholder="Quantity to add"
              min="1"
              value={restockQty}
              onChange={(e) => setRestockQty(e.target.value)}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setRestockId(null)} className="btn-secondary">Cancel</button>
              <button onClick={handleRestock} className="btn-primary">Restock</button>
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowForm(false)}>
          <div className="w-96 rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">{editing ? 'Edit Item' : 'New Inventory Item'}</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Name</label>
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Chicken (whole)" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Unit</label>
                  <select className="input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                    <option value="kg">kg</option>
                    <option value="litre">litre</option>
                    <option value="piece">piece</option>
                    <option value="pack">pack</option>
                    <option value="dozen">dozen</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Current Qty</label>
                  <input type="number" className="input" min="0" step="0.1" value={form.current_qty} onChange={(e) => setForm({ ...form, current_qty: Number(e.target.value) })} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Low Stock Threshold ({form.unit})</label>
                <input type="number" className="input" min="0" step="0.1" value={form.min_qty} onChange={(e) => setForm({ ...form, min_qty: Number(e.target.value) })} />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleSave} className="btn-primary">{editing ? 'Save changes' : 'Add item'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
