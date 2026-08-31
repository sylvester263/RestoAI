import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { toast, confirmAction } from '../components/ui/toast';
import { Skeleton } from '../components/ui/Skeleton';
import Modal from '../components/ui/Modal';
import {
  Package, AlertTriangle, Plus, Edit2, Trash2, X, Truck, ClipboardList, Sparkles, CheckCircle2,
} from 'lucide-react';

const TABS = [
  { key: 'ingredients', label: 'Ingredients', icon: Package },
  { key: 'suppliers', label: 'Suppliers', icon: Truck },
  { key: 'orders', label: 'Purchase Orders', icon: ClipboardList },
];

export default function Inventory() {
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState('ingredients');
  const [ingredients, setIngredients] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showLowOnly, setShowLowOnly] = useState(searchParams.get('low_stock') === 'true');

  const [showIngredientForm, setShowIngredientForm] = useState(false);
  const [editingIngredient, setEditingIngredient] = useState(null);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [showPoForm, setShowPoForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (showLowOnly) params.low_stock = 'true';
      const [ingRes, supRes, poRes, sugRes] = await Promise.all([
        api.getIngredients(params),
        api.getSuppliers(),
        api.getPurchaseOrders(),
        api.getReplenishmentSuggestions('pending').catch(() => ({ suggestions: [] })),
      ]);
      setIngredients(ingRes.ingredients);
      setSuppliers(supRes.suppliers);
      setPurchaseOrders(poRes.purchase_orders);
      setSuggestions(sugRes.suggestions);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [showLowOnly]);

  useEffect(() => { load(); }, [load]);

  async function handleDeleteIngredient(id) {
    const ok = await confirmAction('Delete this ingredient?', 'This cannot be undone.');
    if (!ok) return;
    try {
      await api.deleteIngredient(id);
      toast.success('Ingredient deleted');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleApproveSuggestion(suggestion) {
    try {
      await api.approveReplenishmentSuggestion(suggestion.id);
      toast.success('Replenishment approved — draft PO created');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleDismissSuggestion(id) {
    try {
      await api.dismissReplenishmentSuggestion(id);
      setSuggestions((prev) => prev.filter((s) => s.id !== id));
      toast.success('Suggestion dismissed');
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleReceivePo(id) {
    try {
      await api.receivePurchaseOrder(id);
      toast.success('Purchase order received');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  const lowStockCount = ingredients.filter((i) => Number(i.current_stock) <= Number(i.low_stock_threshold)).length;

  if (loading) return <div className="space-y-6"><Skeleton className="h-8 w-32" /><Skeleton.Table rows={6} cols={6} /></div>;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Inventory</h1>
          <p className="text-sm text-[var(--text-secondary)]">Ingredients, suppliers, and purchase orders.</p>
        </div>
        {tab === 'ingredients' && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowLowOnly(!showLowOnly)}
              className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                showLowOnly ? 'bg-red-100 text-red-700' : 'bg-[var(--surface-3)] text-[var(--text-secondary)] hover:bg-[var(--border)]'
              }`}
            >
              <AlertTriangle className="h-4 w-4" />
              Low stock {lowStockCount > 0 && `(${lowStockCount})`}
            </button>
            <button onClick={() => { setEditingIngredient(null); setShowIngredientForm(true); }} className="btn-primary">
              <Plus className="h-4 w-4" /> Add Ingredient
            </button>
          </div>
        )}
        {tab === 'suppliers' && (
          <button onClick={() => { setEditingSupplier(null); setShowSupplierForm(true); }} className="btn-primary">
            <Plus className="h-4 w-4" /> Add Supplier
          </button>
        )}
        {tab === 'orders' && (
          <button onClick={() => setShowPoForm(true)} className="btn-primary">
            <Plus className="h-4 w-4" /> New Purchase Order
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 border-b border-[var(--border)]">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === key ? 'border-brand-600 text-brand-600' : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-secondary)]'
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {/* Suggested reorders (impl-19) — shown above every tab, since it's actionable */}
      {suggestions.length > 0 && (
        <div className="card mb-6 border-brand-200 bg-brand-50">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand-800">
            <Sparkles className="h-4 w-4" /> Suggested Reorders
          </h2>
          <div className="space-y-2">
            {suggestions.map((s) => (
              <div key={s.id} className="rounded-lg bg-white p-3 text-sm">
                <p className="mb-2 text-[var(--text-secondary)]">{s.reasoning}</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--text-secondary)]">Suggested: {Number(s.suggested_quantity).toFixed(1)} {s.unit} of {s.ingredient_name}</span>
                  <div className="flex gap-3 text-xs">
                    <button onClick={() => handleDismissSuggestion(s.id)} className="font-medium text-[var(--text-secondary)] hover:underline">Dismiss</button>
                    <button onClick={() => handleApproveSuggestion(s)} className="font-medium text-brand-700 hover:underline">Approve → Draft PO</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'ingredients' && (
        <IngredientsTable
          ingredients={ingredients}
          onEdit={(i) => { setEditingIngredient(i); setShowIngredientForm(true); }}
          onDelete={handleDeleteIngredient}
        />
      )}
      {tab === 'suppliers' && (
        <SuppliersTable
          suppliers={suppliers}
          onEdit={(s) => { setEditingSupplier(s); setShowSupplierForm(true); }}
        />
      )}
      {tab === 'orders' && (
        <PurchaseOrdersTable purchaseOrders={purchaseOrders} onReceive={handleReceivePo} />
      )}

      {showIngredientForm && (
        <IngredientFormModal
          ingredient={editingIngredient}
          suppliers={suppliers}
          onClose={() => setShowIngredientForm(false)}
          onSaved={() => { setShowIngredientForm(false); load(); }}
        />
      )}
      {showSupplierForm && (
        <SupplierFormModal
          supplier={editingSupplier}
          onClose={() => setShowSupplierForm(false)}
          onSaved={() => { setShowSupplierForm(false); load(); }}
        />
      )}
      {showPoForm && (
        <PurchaseOrderFormModal
          suppliers={suppliers}
          ingredients={ingredients}
          onClose={() => setShowPoForm(false)}
          onCreated={() => { setShowPoForm(false); load(); }}
        />
      )}
    </div>
  );
}

function IngredientsTable({ ingredients, onEdit, onDelete }) {
  if (ingredients.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-[var(--text-tertiary)]">
        <Package className="mb-4 h-16 w-16" />
        <p className="text-lg font-medium">No ingredients tracked yet</p>
        <p className="text-sm">Add ingredients, then attach a recipe to a menu item.</p>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--surface-3)]">
          <tr className="text-left text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
            <th className="px-4 py-3">Ingredient</th>
            <th className="px-4 py-3 text-right">Current Stock</th>
            <th className="px-4 py-3 text-right">Threshold</th>
            <th className="px-4 py-3 text-right">Cost/Unit</th>
            <th className="px-4 py-3">Preferred Supplier</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-light)]">
          {ingredients.map((item) => {
            const qty = Number(item.current_stock);
            const min = Number(item.low_stock_threshold);
            const isLow = qty <= min;
            return (
              <tr key={item.id} className={isLow ? 'bg-red-50' : ''}>
                <td className="px-4 py-3 font-medium text-[var(--text-primary)]">{item.name}</td>
                <td className="px-4 py-3 text-right font-semibold">
                  {qty} <span className="text-xs text-[var(--text-tertiary)]">{item.unit}</span>
                </td>
                <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{min} {item.unit}</td>
                <td className="px-4 py-3 text-right text-[var(--text-secondary)]">Rs. {Number(item.cost_per_unit).toLocaleString()}</td>
                <td className="px-4 py-3 text-[var(--text-secondary)]">{item.preferred_supplier_name || '—'}</td>
                <td className="px-4 py-3">
                  {isLow ? (
                    <span className="badge bg-red-100 text-red-700"><AlertTriangle className="mr-1 h-3 w-3" /> Low</span>
                  ) : (
                    <span className="badge bg-green-100 text-green-700">OK</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => onEdit(item)} className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-3)]" title="Edit">
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button onClick={() => onDelete(item.id)} className="rounded p-1.5 text-red-500 hover:bg-red-50" title="Delete">
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
  );
}

function SuppliersTable({ suppliers, onEdit }) {
  if (suppliers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-[var(--text-tertiary)]">
        <Truck className="mb-4 h-16 w-16" />
        <p className="text-lg font-medium">No suppliers yet</p>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--surface-3)]">
          <tr className="text-left text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Phone</th>
            <th className="px-4 py-3">Email</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-light)]">
          {suppliers.map((s) => (
            <tr key={s.id}>
              <td className="px-4 py-3 font-medium text-[var(--text-primary)]">{s.name}</td>
              <td className="px-4 py-3 text-[var(--text-secondary)]">{s.contact_phone || '—'}</td>
              <td className="px-4 py-3 text-[var(--text-secondary)]">{s.contact_email || '—'}</td>
              <td className="px-4 py-3 text-right">
                <button onClick={() => onEdit(s)} className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-3)]" title="Edit">
                  <Edit2 className="h-4 w-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const PO_STATUS_STYLES = {
  draft: 'bg-[var(--surface-3)] text-[var(--text-secondary)]',
  ordered: 'bg-blue-100 text-blue-700',
  received: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

function PurchaseOrdersTable({ purchaseOrders, onReceive }) {
  if (purchaseOrders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-[var(--text-tertiary)]">
        <ClipboardList className="mb-4 h-16 w-16" />
        <p className="text-lg font-medium">No purchase orders yet</p>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--surface-3)]">
          <tr className="text-left text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
            <th className="px-4 py-3">Supplier</th>
            <th className="px-4 py-3 text-right">Items</th>
            <th className="px-4 py-3 text-right">Total Cost</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Created</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-light)]">
          {purchaseOrders.map((po) => (
            <tr key={po.id}>
              <td className="px-4 py-3 font-medium text-[var(--text-primary)]">{po.supplier_name}</td>
              <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{po.item_count}</td>
              <td className="px-4 py-3 text-right text-[var(--text-secondary)]">Rs. {Number(po.total_cost).toLocaleString()}</td>
              <td className="px-4 py-3">
                <span className={`badge ${PO_STATUS_STYLES[po.status]}`}>{po.status}</span>
              </td>
              <td className="px-4 py-3 text-[var(--text-secondary)]">{new Date(po.created_at).toLocaleDateString()}</td>
              <td className="px-4 py-3 text-right">
                {(po.status === 'draft' || po.status === 'ordered') && (
                  <button onClick={() => onReceive(po.id)} className="btn-secondary text-xs">
                    <CheckCircle2 className="h-3 w-3" /> Mark Received
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IngredientFormModal({ ingredient, suppliers, onClose, onSaved }) {
  const [form, setForm] = useState(ingredient ? {
    name: ingredient.name,
    unit: ingredient.unit,
    current_stock: Number(ingredient.current_stock),
    low_stock_threshold: Number(ingredient.low_stock_threshold),
    cost_per_unit: Number(ingredient.cost_per_unit),
    preferred_supplier_id: ingredient.preferred_supplier_id || '',
  } : { name: '', unit: 'kg', current_stock: 0, low_stock_threshold: 0, cost_per_unit: 0, preferred_supplier_id: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const payload = { ...form, preferred_supplier_id: form.preferred_supplier_id || null };
      if (ingredient) {
        await api.updateIngredient(ingredient.id, payload);
      } else {
        await api.createIngredient(payload);
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={true} onClose={onClose} title={ingredient ? 'Edit Ingredient' : 'New Ingredient'}>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Name</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Chicken (whole)" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Unit</label>
            <select className="input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
              <option value="kg">kg</option>
              <option value="litre">litre</option>
              <option value="piece">piece</option>
              <option value="pack">pack</option>
              <option value="dozen">dozen</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Current Stock</label>
            <input type="number" className="input" min="0" step="0.1" value={form.current_stock} onChange={(e) => setForm({ ...form, current_stock: Number(e.target.value) })} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Low Stock Threshold</label>
            <input type="number" className="input" min="0" step="0.1" value={form.low_stock_threshold} onChange={(e) => setForm({ ...form, low_stock_threshold: Number(e.target.value) })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Cost/Unit (PKR)</label>
            <input type="number" className="input" min="0" step="0.01" value={form.cost_per_unit} onChange={(e) => setForm({ ...form, cost_per_unit: Number(e.target.value) })} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Preferred Supplier</label>
          <select className="input" value={form.preferred_supplier_id} onChange={(e) => setForm({ ...form, preferred_supplier_id: e.target.value })}>
            <option value="">None</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={handleSave} disabled={saving || !form.name} className="btn-primary">{ingredient ? 'Save changes' : 'Add ingredient'}</button>
      </div>
    </Modal>
  );
}

function SupplierFormModal({ supplier, onClose, onSaved }) {
  const [form, setForm] = useState(supplier ? {
    name: supplier.name, contact_phone: supplier.contact_phone || '', contact_email: supplier.contact_email || '',
  } : { name: '', contact_phone: '', contact_email: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const payload = { name: form.name, contact_phone: form.contact_phone || null, contact_email: form.contact_email || null };
      if (supplier) {
        await api.updateSupplier(supplier.id, payload);
      } else {
        await api.createSupplier(payload);
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={true} onClose={onClose} title={supplier ? 'Edit Supplier' : 'New Supplier'}>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Name</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Phone</label>
          <input className="input" value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Email</label>
          <input className="input" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={handleSave} disabled={saving || !form.name} className="btn-primary">{supplier ? 'Save changes' : 'Add supplier'}</button>
      </div>
    </Modal>
  );
}

function PurchaseOrderFormModal({ suppliers, ingredients, onClose, onCreated }) {
  const [supplierId, setSupplierId] = useState('');
  const [lines, setLines] = useState([{ ingredient_id: '', quantity: '', unit_cost: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function updateLine(i, field, value) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, { ingredient_id: '', quantity: '', unit_cost: '' }]);
  }

  function removeLine(i) {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleCreate() {
    setSaving(true);
    setError('');
    try {
      const items = lines
        .filter((l) => l.ingredient_id && l.quantity && l.unit_cost)
        .map((l) => ({ ingredient_id: l.ingredient_id, quantity: Number(l.quantity), unit_cost: Number(l.unit_cost) }));
      if (!supplierId || items.length === 0) {
        setError('Pick a supplier and at least one ingredient with quantity/cost');
        setSaving(false);
        return;
      }
      await api.createPurchaseOrder({ supplier_id: supplierId, items });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={true} onClose={onClose} title="New Purchase Order" size="lg">
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Supplier</label>
          <select className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Select a supplier...</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <label className="block text-xs font-medium text-[var(--text-secondary)]">Line Items</label>
          {lines.map((line, i) => (
            <div key={i} className="flex items-center gap-2">
              <select className="input flex-1 text-sm" value={line.ingredient_id} onChange={(e) => updateLine(i, 'ingredient_id', e.target.value)}>
                <option value="">Ingredient...</option>
                {ingredients.map((ing) => <option key={ing.id} value={ing.id}>{ing.name}</option>)}
              </select>
              <input type="number" className="input w-24 text-sm" placeholder="Qty" min="0" step="0.1" value={line.quantity} onChange={(e) => updateLine(i, 'quantity', e.target.value)} />
              <input type="number" className="input w-28 text-sm" placeholder="Unit cost" min="0" step="0.01" value={line.unit_cost} onChange={(e) => updateLine(i, 'unit_cost', e.target.value)} />
              {lines.length > 1 && (
                <button onClick={() => removeLine(i)} className="text-[var(--text-tertiary)] hover:text-red-500"><X className="h-4 w-4" /></button>
              )}
            </div>
          ))}
          <button onClick={addLine} className="text-xs font-medium text-brand-600 hover:underline">+ Add line</button>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={handleCreate} disabled={saving} className="btn-primary">Create Draft PO</button>
      </div>
    </Modal>
  );
}
