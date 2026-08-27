import { useEffect, useState, useCallback } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import {
  Plus, Minus, X, Receipt, Phone, UtensilsCrossed,
  Clock, Percent, CreditCard, Loader2, Trash2,
} from 'lucide-react';

const TYPE_ICON = { counter: Receipt, dine_in: UtensilsCrossed, phone: Phone };
const TYPE_LABEL = { counter: 'Counter', dine_in: 'Dine-in', phone: 'Phone' };

function elapsed(createdAt) {
  const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function POS() {
  const { user } = useAuth();
  const canDiscount = user?.role === 'owner' || user?.role === 'manager';

  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState('');
  const [tabs, setTabs] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null); // { tab, orders, subtotal }
  const [menuItems, setMenuItems] = useState([]);
  const [cart, setCart] = useState([]);
  const [showNewTab, setShowNewTab] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const loadTabs = useCallback(async (bId) => {
    if (!bId) return;
    try {
      const res = await api.getPosTabs(bId);
      setTabs(res.tabs);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const loadDetail = useCallback(async (id) => {
    if (!id) { setDetail(null); return; }
    try {
      const res = await api.getPosTab(id);
      setDetail(res);
    } catch (err) {
      setSelectedId(null);
      setDetail(null);
    }
  }, []);

  useEffect(() => {
    Promise.all([api.getBranches(), api.getMenu({ available_only: 'true' })]).then(([bRes, mRes]) => {
      setBranches(bRes.branches);
      setMenuItems(mRes.items);
      if (bRes.branches.length > 0) setBranchId(bRes.branches[0].id);
    });
  }, []);

  useEffect(() => {
    if (!branchId) return;
    loadTabs(branchId);
    const interval = setInterval(() => loadTabs(branchId), 10000);
    return () => clearInterval(interval);
  }, [branchId, loadTabs]);

  useEffect(() => {
    loadDetail(selectedId);
    if (!selectedId) return;
    const interval = setInterval(() => loadDetail(selectedId), 8000);
    return () => clearInterval(interval);
  }, [selectedId, loadDetail]);

  function selectTab(id) {
    setSelectedId(id);
    setCart([]);
    setError('');
  }

  function addToCart(item) {
    setCart((c) => {
      const existing = c.find((i) => i.menu_item_id === item.id);
      if (existing) {
        return c.map((i) => (i.menu_item_id === item.id ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [...c, { menu_item_id: item.id, name: item.name, price: Number(item.price), quantity: 1 }];
    });
  }

  function changeQty(itemId, delta) {
    setCart((c) => c
      .map((i) => (i.menu_item_id === itemId ? { ...i, quantity: i.quantity + delta } : i))
      .filter((i) => i.quantity > 0));
  }

  async function sendRound() {
    if (cart.length === 0) return;
    setSending(true);
    setError('');
    try {
      await api.addPosTabItems(selectedId, {
        items: cart.map((i) => ({ menu_item_id: i.menu_item_id, quantity: i.quantity })),
      });
      setCart([]);
      await Promise.all([loadDetail(selectedId), loadTabs(branchId)]);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function handleVoid() {
    if (!confirm('Void this tab? This cannot be undone.')) return;
    try {
      await api.voidPosTab(selectedId);
      setSelectedId(null);
      loadTabs(branchId);
    } catch (err) {
      setError(err.message);
    }
  }

  const grouped = menuItems.reduce((acc, item) => {
    const cat = item.category_name || item.category_id || 'Menu';
    (acc[cat] = acc[cat] || []).push(item);
    return acc;
  }, {});
  const cartTotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);

  return (
    <div className="flex h-[calc(100vh-3rem)] gap-6">
      {/* ── Floor view ── */}
      <div className="flex w-80 shrink-0 flex-col">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">POS</h1>
          <button onClick={() => setShowNewTab(true)} className="btn-primary text-sm"><Plus className="h-4 w-4" /> New Tab</button>
        </div>
        {branches.length > 1 && (
          <select className="input mb-3" value={branchId} onChange={(e) => { setBranchId(e.target.value); setSelectedId(null); }}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <div className="flex-1 space-y-2 overflow-y-auto">
          {tabs.length === 0 && <p className="mt-8 text-center text-sm text-gray-400">No open tabs</p>}
          {tabs.map((tab) => {
            const Icon = TYPE_ICON[tab.order_type];
            return (
              <button
                key={tab.id}
                onClick={() => selectTab(tab.id)}
                className={`w-full rounded-xl border p-3 text-left transition-colors ${selectedId === tab.id ? 'border-brand-500 bg-brand-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                    <Icon className="h-4 w-4" />
                    {TYPE_LABEL[tab.order_type]}{tab.table_number ? ` · Table ${tab.table_number}` : ''}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-gray-400"><Clock className="h-3 w-3" /> {elapsed(tab.created_at)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-sm">
                  <span className="text-gray-500">{tab.round_count} round{tab.round_count !== '1' ? 's' : ''}</span>
                  <span className="font-semibold text-gray-900">Rs. {Number(tab.running_total).toLocaleString()}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tab detail ── */}
      <div className="flex-1 overflow-y-auto">
        {!detail ? (
          <div className="flex h-full items-center justify-center text-gray-400">Select or open a tab</div>
        ) : (
          <TabDetail
            detail={detail}
            cart={cart}
            grouped={grouped}
            cartTotal={cartTotal}
            sending={sending}
            error={error}
            canDiscount={canDiscount}
            onAddToCart={addToCart}
            onChangeQty={changeQty}
            onSendRound={sendRound}
            onVoid={handleVoid}
            onDiscounted={() => loadDetail(selectedId)}
            onSettled={() => { setSelectedId(null); loadTabs(branchId); }}
          />
        )}
      </div>

      {showNewTab && (
        <NewTabModal
          branchId={branchId}
          onClose={() => setShowNewTab(false)}
          onCreated={(tab) => { setShowNewTab(false); loadTabs(branchId).then(() => selectTab(tab.id)); }}
        />
      )}
    </div>
  );
}

function TabDetail({ detail, cart, grouped, cartTotal, sending, error, canDiscount, onAddToCart, onChangeQty, onSendRound, onVoid, onDiscounted, onSettled }) {
  const { tab, orders, subtotal } = detail;
  const [discountAmount, setDiscountAmount] = useState(tab.discount_amount > 0 ? String(tab.discount_amount) : '');
  const [discountReason, setDiscountReason] = useState(tab.discount_reason || '');
  const [showSettle, setShowSettle] = useState(false);

  const netTotal = Math.max(0, subtotal - (parseFloat(tab.discount_amount) || 0));

  async function handleApplyDiscount() {
    try {
      await api.applyPosTabDiscount(tab.id, { discount_amount: Number(discountAmount) || 0, discount_reason: discountReason || undefined });
      onDiscounted();
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {tab.order_type === 'dine_in' ? `Table ${tab.table_number}` : tab.order_type === 'phone' ? 'Phone Order' : 'Counter Order'}
          </h2>
          {tab.customer_name && <p className="text-sm text-gray-500">{tab.customer_name} {tab.customer_phone && `· ${tab.customer_phone}`}</p>}
        </div>
        <button onClick={onVoid} className="rounded-lg p-2 text-red-500 hover:bg-red-50" title="Void tab"><Trash2 className="h-4 w-4" /></button>
      </div>

      {/* Rounds already sent */}
      {orders.length > 0 && (
        <div className="card">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">Rounds</h3>
          <div className="space-y-3">
            {orders.map((o, i) => (
              <div key={o.id} className="border-b border-gray-100 pb-3 last:border-0 last:pb-0">
                <p className="mb-1 text-xs font-medium text-gray-400">Round {i + 1} · {new Date(o.created_at).toLocaleTimeString()}</p>
                {o.items.map((item, j) => (
                  <div key={j} className="flex justify-between text-sm text-gray-700">
                    <span>{item.quantity}x {item.name}</span>
                    <span>Rs. {Number(item.total_price).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add items */}
      <div className="card">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">Add Items</h3>
        <div className="max-h-64 space-y-4 overflow-y-auto">
          {Object.entries(grouped).map(([cat, items]) => (
            <div key={cat}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{cat}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => onAddToCart(item)}
                    className="rounded-lg border border-gray-200 p-2 text-left text-xs hover:border-brand-400 hover:bg-brand-50"
                  >
                    <p className="font-medium text-gray-900 line-clamp-1">{item.name}</p>
                    <p className="text-brand-600">Rs. {Number(item.price).toLocaleString()}</p>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {cart.length > 0 && (
          <div className="mt-4 space-y-2 border-t border-gray-100 pt-3">
            {cart.map((i) => (
              <div key={i.menu_item_id} className="flex items-center justify-between text-sm">
                <span>{i.name}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => onChangeQty(i.menu_item_id, -1)} className="rounded border border-gray-300 p-1"><Minus className="h-3 w-3" /></button>
                  <span className="w-5 text-center">{i.quantity}</span>
                  <button onClick={() => onChangeQty(i.menu_item_id, 1)} className="rounded border border-gray-300 p-1"><Plus className="h-3 w-3" /></button>
                  <span className="w-16 text-right font-medium">Rs. {(i.price * i.quantity).toLocaleString()}</span>
                </div>
              </div>
            ))}
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button onClick={onSendRound} disabled={sending} className="btn-primary mt-2 w-full justify-center">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : `Send Round · Rs. ${cartTotal.toLocaleString()}`}
            </button>
          </div>
        )}
      </div>

      {/* Discount */}
      {canDiscount && orders.length > 0 && (
        <div className="card">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700"><Percent className="h-4 w-4" /> Discount</h3>
          <div className="flex gap-2">
            <input type="number" min="0" className="input" placeholder="Amount" value={discountAmount} onChange={(e) => setDiscountAmount(e.target.value)} />
            <input className="input" placeholder="Reason (optional)" value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} />
            <button onClick={handleApplyDiscount} className="btn-secondary shrink-0">Apply</button>
          </div>
        </div>
      )}

      {/* Bill + settle */}
      {orders.length > 0 && (
        <div className="card">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>Rs. {subtotal.toLocaleString()}</span></div>
            {tab.discount_amount > 0 && (
              <div className="flex justify-between text-green-600"><span>Discount{tab.discount_reason ? ` (${tab.discount_reason})` : ''}</span><span>-Rs. {Number(tab.discount_amount).toLocaleString()}</span></div>
            )}
            <div className="flex justify-between text-base font-bold text-gray-900"><span>Total</span><span>Rs. {netTotal.toLocaleString()}</span></div>
          </div>
          <button onClick={() => setShowSettle(true)} className="btn-primary mt-4 w-full justify-center">
            <CreditCard className="h-4 w-4" /> Settle Bill
          </button>
        </div>
      )}

      {showSettle && (
        <SettleModal tabId={tab.id} total={netTotal} onClose={() => setShowSettle(false)} onSettled={onSettled} />
      )}
    </div>
  );
}

function SettleModal({ tabId, total, onClose, onSettled }) {
  const [method, setMethod] = useState('cash');
  const [settling, setSettling] = useState(false);
  const [error, setError] = useState('');

  async function handleSettle() {
    setSettling(true);
    setError('');
    try {
      await api.settlePosTab(tabId, method);
      onSettled();
    } catch (err) {
      setError(err.message);
    } finally {
      setSettling(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-96 rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-lg font-semibold">Settle Bill</h3>
        <p className="mb-4 text-2xl font-bold text-gray-900">Rs. {total.toLocaleString()}</p>
        <label className="mb-1 block text-xs font-medium text-gray-600">Payment method</label>
        <select className="input mb-4" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="cash">Cash</option>
          <option value="card">Card</option>
          <option value="jazzcash">JazzCash</option>
          <option value="easypaisa">EasyPaisa</option>
        </select>
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleSettle} disabled={settling} className="btn-primary">
            {settling ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm & Close Tab'}
          </button>
        </div>
      </div>
    </div>
  );
}

function NewTabModal({ branchId, onClose, onCreated }) {
  const [orderType, setOrderType] = useState('counter');
  const [tables, setTables] = useState([]);
  const [tableId, setTableId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (orderType === 'dine_in' && branchId) {
      api.getTables(branchId).then((res) => setTables(res.tables));
    }
  }, [orderType, branchId]);

  async function handleCreate() {
    if (orderType === 'dine_in' && !tableId) {
      setError('Select a table');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const res = await api.openPosTab({
        order_type: orderType,
        branch_id: branchId,
        table_id: orderType === 'dine_in' ? tableId : undefined,
        customer_name: customerName || undefined,
        customer_phone: customerPhone || undefined,
      });
      onCreated(res.tab);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-96 rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">New Tab</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>
        <div className="mb-4 grid grid-cols-3 gap-2">
          {['counter', 'dine_in', 'phone'].map((t) => {
            const Icon = TYPE_ICON[t];
            return (
              <button
                key={t}
                onClick={() => setOrderType(t)}
                className={`flex flex-col items-center gap-1 rounded-lg border-2 p-3 text-xs font-medium ${orderType === t ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-600'}`}
              >
                <Icon className="h-5 w-5" />
                {TYPE_LABEL[t]}
              </button>
            );
          })}
        </div>

        {orderType === 'dine_in' && (
          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-gray-600">Table</label>
            <select className="input" value={tableId} onChange={(e) => setTableId(e.target.value)}>
              <option value="">Select a table…</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>Table {t.table_number}{t.open_session_id ? ' (occupied)' : ''}</option>
              ))}
            </select>
          </div>
        )}

        <div className="mb-3">
          <label className="mb-1 block text-xs font-medium text-gray-600">Customer name (optional)</label>
          <input className="input" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
        </div>
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-gray-600">Phone (optional)</label>
          <input className="input" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
        </div>

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        <button onClick={handleCreate} disabled={creating} className="btn-primary w-full justify-center">
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Open Tab'}
        </button>
      </div>
    </div>
  );
}
