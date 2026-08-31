import { useEffect, useState, useCallback } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { toast, confirmAction } from '../../components/ui/toast';
import Modal from '../../components/ui/Modal';
import usePolling from '../../hooks/usePolling';
import useKeyboardShortcuts from '../../hooks/useKeyboardShortcuts';
import useEvents from '../../hooks/useEvents';
import {
  Plus, Minus, X, Receipt, Phone, UtensilsCrossed,
  Clock, Percent, CreditCard, Loader2, Trash2, Pause, Play,
  ArrowRightLeft, Printer, RotateCcw, Settings, Wallet,
} from 'lucide-react';

const TYPE_ICON = { counter: Receipt, dine_in: UtensilsCrossed, phone: Phone };
const TYPE_LABEL = { counter: 'Counter', dine_in: 'Dine-in', phone: 'Phone' };
const METHOD_LABEL = { cash: 'Cash', card: 'Card', jazzcash: 'JazzCash', easypaisa: 'EasyPaisa', cod: 'Cash' };

function elapsed(createdAt) {
  const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function POS() {
  const { user } = useAuth();
  const canDiscount = user?.role === 'owner' || user?.role === 'manager';
  const canRefund = canDiscount;

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
  const [shift, setShift] = useState(null);
  const [showTaxSettings, setShowTaxSettings] = useState(false);
  const [receiptOrderId, setReceiptOrderId] = useState(null);
  const [voidItemTarget, setVoidItemTarget] = useState(null);

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

  const loadShift = useCallback(async (bId) => {
    if (!bId) return;
    try {
      const res = await api.getCurrentPosShift(bId);
      setShift(res.shift);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    Promise.all([api.getBranches(), api.getMenu({ available_only: 'true' })]).then(([bRes, mRes]) => {
      setBranches(bRes.branches);
      setMenuItems(mRes.items);
      if (bRes.branches.length > 0) setBranchId(bRes.branches[0].id);
    });
  }, []);

  // Adaptive polling — tabs list + shift
  usePolling(() => {
    loadTabs(branchId);
    loadShift(branchId);
  }, 10000, { enabled: !!branchId });

  // Adaptive polling — selected tab detail
  usePolling(() => loadDetail(selectedId), 8000, { enabled: !!selectedId });

  // SSE real-time push for POS tab updates
  useEvents(`pos:${branchId}`, () => { loadTabs(branchId); if (selectedId) loadDetail(selectedId); }, 10000, { enabled: !!branchId });

  // POS keyboard shortcuts
  useKeyboardShortcuts([
    { key: 'n', callback: () => setShowNewTab(true) },
    { key: 'Enter', ctrl: true, callback: () => sendRound(), when: 'always' },
    { key: 'h', ctrl: true, callback: () => { if (selectedId) handleHold(); } },
    { key: 'Escape', callback: () => { if (selectedId) selectTab(null); } },
  ]);

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
    const ok = await confirmAction('Void this tab?', 'This cannot be undone.');
    if (!ok) return;
    try {
      await api.voidPosTab(selectedId);
      setSelectedId(null);
      loadTabs(branchId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function confirmVoidItem() {
    if (!voidItemTarget) return;
    try {
      await api.voidPosTabItem(voidItemTarget.tabId, { order_item_id: voidItemTarget.itemId, reason: voidItemTarget.reason });
      loadDetail(selectedId);
      setVoidItemTarget(null);
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleHold() {
    try {
      await api.holdPosTab(selectedId);
      setSelectedId(null);
      loadTabs(branchId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleResume(id) {
    try {
      await api.resumePosTab(id);
      await loadTabs(branchId);
      selectTab(id);
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
  const activeTabs = tabs.filter((t) => t.status === 'open');
  const parkedTabs = tabs.filter((t) => t.status === 'held');

  return (
    <div className="flex h-[calc(100vh-3rem)] gap-6">
      {/* ── Floor view ── */}
      <div className="flex w-80 shrink-0 flex-col">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">POS</h1>
          <div className="flex items-center gap-1">
            {canDiscount && branchId && (
              <button onClick={() => setShowTaxSettings(true)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100" title="Tax settings">
                <Settings className="h-4 w-4" />
              </button>
            )}
            <button onClick={() => setShowNewTab(true)} className="btn-primary text-sm"><Plus className="h-4 w-4" /> New Tab</button>
          </div>
        </div>

        {branchId && <ShiftBar branchId={branchId} shift={shift} onChange={() => loadShift(branchId)} />}

        {branches.length > 1 && (
          <select className="input mb-3" value={branchId} onChange={(e) => { setBranchId(e.target.value); setSelectedId(null); }}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}

        <div className="flex-1 space-y-5 overflow-y-auto">
          <div>
            {activeTabs.length === 0 && <p className="mt-4 text-center text-sm text-gray-400">No open tabs</p>}
            <div className="space-y-2">
              {activeTabs.map((tab) => (
                <TabCard key={tab.id} tab={tab} selected={selectedId === tab.id} onClick={() => selectTab(tab.id)} />
              ))}
            </div>
          </div>

          {parkedTabs.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Parked</p>
              <div className="space-y-2">
                {parkedTabs.map((tab) => (
                  <div key={tab.id} className="flex items-center justify-between rounded-xl border border-dashed border-gray-300 bg-gray-50 p-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-700">
                        {TYPE_LABEL[tab.order_type]}{tab.table_number ? ` · Table ${tab.table_number}` : ''}
                      </p>
                      <p className="text-xs text-gray-400">{tab.round_count} round{tab.round_count !== '1' ? 's' : ''} · Rs. {Number(tab.running_total).toLocaleString()}</p>
                    </div>
                    <button onClick={() => handleResume(tab.id)} className="btn-secondary text-xs"><Play className="h-3 w-3" /> Resume</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Tab detail ── */}
      <div className="flex-1 overflow-y-auto">
        {!detail ? (
          <div className="flex h-full items-center justify-center text-gray-400">Select or open a tab</div>
        ) : (
          <TabDetail
            detail={detail}
            branchId={branchId}
            cart={cart}
            grouped={grouped}
            cartTotal={cartTotal}
            sending={sending}
            error={error}
            canDiscount={canDiscount}
            canRefund={canRefund}
            onAddToCart={addToCart}
            onChangeQty={changeQty}
            onSendRound={sendRound}
            onVoid={handleVoid}
            onHold={handleHold}
            onDiscounted={() => loadDetail(selectedId)}
            onChanged={() => loadDetail(selectedId)}
            onSettled={(orderId) => { setSelectedId(null); loadTabs(branchId); setReceiptOrderId(orderId); }}
            onShowVoidModal={setVoidItemTarget}
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
      {showTaxSettings && <TaxSettingsModal branchId={branchId} onClose={() => setShowTaxSettings(false)} />}
      {receiptOrderId && <ReceiptModal orderId={receiptOrderId} canRefund={canRefund} onClose={() => setReceiptOrderId(null)} />}

      {/* Void item reason modal */}
      <Modal open={!!voidItemTarget} onClose={() => setVoidItemTarget(null)} title="Void Item" size="sm" confirmLabel="Void Item" onConfirm={confirmVoidItem} variant="danger">
        <p className="mb-2 text-sm text-gray-600">Enter the reason for voiding this item:</p>
        <textarea
          className="input min-h-[80px]"
          placeholder="Reason for voiding…"
          value={voidItemTarget?.reason || ''}
          onChange={(e) => setVoidItemTarget({ ...voidItemTarget, reason: e.target.value })}
          autoFocus
        />
      </Modal>
    </div>
  );
}

function TabCard({ tab, selected, onClick }) {
  const Icon = TYPE_ICON[tab.order_type];
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-xl border p-3 text-left transition-colors ${selected ? 'border-brand-500 bg-brand-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}
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
}

function ShiftBar({ branchId, shift, onChange }) {
  const [showOpen, setShowOpen] = useState(false);
  const [showClose, setShowClose] = useState(false);

  if (!shift) {
    return (
      <>
        <button
          onClick={() => setShowOpen(true)}
          className="mb-3 flex items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 py-2 text-sm text-gray-500 hover:border-brand-400 hover:text-brand-600"
        >
          <Wallet className="h-4 w-4" /> Open shift
        </button>
        {showOpen && <OpenShiftModal branchId={branchId} onClose={() => setShowOpen(false)} onOpened={() => { setShowOpen(false); onChange(); }} />}
      </>
    );
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between rounded-lg bg-brand-50 px-3 py-2 text-xs">
        <span className="font-medium text-brand-700">
          Shift open · float Rs. {Number(shift.opening_cash_float).toLocaleString()} · since {new Date(shift.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
        <button onClick={() => setShowClose(true)} className="shrink-0 font-medium text-brand-700 underline">Close</button>
      </div>
      {showClose && <CloseShiftModal shift={shift} onClose={() => setShowClose(false)} onClosed={() => { setShowClose(false); onChange(); }} />}
    </>
  );
}

function OpenShiftModal({ branchId, onClose, onOpened }) {
  const [floatAmount, setFloatAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleOpen() {
    setSaving(true);
    setError('');
    try {
      await api.openPosShift({ branch_id: branchId, opening_cash_float: Number(floatAmount) || 0 });
      onOpened();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={true} onClose={onClose} title="Open Shift" size="sm">
      <label className="mb-1 block text-xs font-medium text-gray-600">Opening cash float (Rs.)</label>
      <input type="number" min="0" className="input mb-4" value={floatAmount} onChange={(e) => setFloatAmount(e.target.value)} autoFocus />
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={handleOpen} disabled={saving} className="btn-primary">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Open Shift'}
        </button>
      </div>
    </Modal>
  );
}

function CloseShiftModal({ shift, onClose, onClosed }) {
  const [counted, setCounted] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { shift, report }

  async function handleClose() {
    setSaving(true);
    setError('');
    try {
      const res = await api.closePosShift(shift.id, Number(counted) || 0);
      const reportRes = await api.getPosZReport(shift.id);
      setResult({ shift: res.shift, report: reportRes.report });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (result) {
    const { shift: closed, report } = result;
    const variance = Number(closed.variance);
    return (
      <Modal open={true} onClose={onClosed} title="Z-Report" size="md">
        <p className="mb-4 text-xs text-gray-500">Shift closed {new Date(closed.closed_at).toLocaleString()}</p>

        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">By payment method</p>
        <div className="mb-4 space-y-1 text-sm">
          {report.sales_by_method.length === 0 && <p className="text-gray-400">No sales this shift</p>}
          {report.sales_by_method.map((m) => (
            <div key={m.method} className="flex justify-between"><span className="text-gray-500">{METHOD_LABEL[m.method] || m.method}</span><span>Rs. {m.total.toLocaleString()}</span></div>
          ))}
        </div>

        {report.sales_by_category.length > 0 && (
          <>
            <p className="mb-1 border-t border-gray-100 pt-3 text-xs font-semibold uppercase tracking-wide text-gray-400">By category</p>
            <div className="mb-4 space-y-1 text-sm text-gray-600">
              {report.sales_by_category.map((c) => (
                <div key={c.category} className="flex justify-between"><span>{c.category}</span><span>Rs. {c.total.toLocaleString()}</span></div>
              ))}
            </div>
          </>
        )}

        <div className="mb-4 space-y-1 border-t border-gray-100 pt-3 text-sm text-gray-600">
          <div className="flex justify-between"><span>Discounts given</span><span>-Rs. {report.discount_total.toLocaleString()}</span></div>
          <div className="flex justify-between"><span>Voids ({report.voids.count})</span><span>Rs. {report.voids.total.toLocaleString()}</span></div>
          <div className="flex justify-between"><span>Refunds ({report.refunds.count})</span><span>Rs. {report.refunds.total.toLocaleString()}</span></div>
        </div>

        <div className="space-y-1 border-t border-gray-100 pt-3 text-sm">
          <div className="flex justify-between"><span className="text-gray-500">Opening float</span><span>Rs. {Number(closed.opening_cash_float).toLocaleString()}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Expected cash</span><span>Rs. {Number(closed.closing_cash_expected).toLocaleString()}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Counted cash</span><span>Rs. {Number(closed.closing_cash_counted).toLocaleString()}</span></div>
          <div className={`flex justify-between font-bold ${variance === 0 ? 'text-gray-900' : variance > 0 ? 'text-green-600' : 'text-red-600'}`}>
            <span>Variance</span><span>{variance > 0 ? '+' : ''}Rs. {variance.toLocaleString()}</span>
          </div>
        </div>

        <button onClick={onClosed} className="btn-primary mt-4 w-full justify-center">Done</button>
      </Modal>
    );
  }

  return (
    <Modal open={true} onClose={onClose} title="Close Shift" size="sm">
      <label className="mb-1 block text-xs font-medium text-gray-600">Counted cash in drawer (Rs.)</label>
      <input type="number" min="0" className="input mb-4" value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus />
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={handleClose} disabled={saving} className="btn-primary">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Close & View Z-Report'}
        </button>
      </div>
    </Modal>
  );
}

function TaxSettingsModal({ branchId, onClose }) {
  const [config, setConfig] = useState(null);
  const [authority, setAuthority] = useState('NONE');
  const [rate, setRate] = useState('0');
  const [regNumber, setRegNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getTaxConfig(branchId).then((res) => {
      setConfig(res.tax_config);
      setAuthority(res.tax_config.tax_authority);
      setRate(String(res.tax_config.tax_rate));
      setRegNumber(res.tax_config.tax_registration_number || '');
    });
  }, [branchId]);

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      await api.setTaxConfig(branchId, { tax_authority: authority, tax_rate: Number(rate) || 0, tax_registration_number: regNumber || undefined });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={true} onClose={onClose} title="Tax Settings">
      {!config ? <Loader2 className="h-5 w-5 animate-spin text-gray-400" /> : (
        <>
          <label className="mb-1 block text-xs font-medium text-gray-600">Tax authority</label>
          <select className="input mb-3" value={authority} onChange={(e) => setAuthority(e.target.value)}>
            <option value="NONE">Not registered / no tax</option>
            <option value="PRA">PRA — Punjab</option>
            <option value="SRB">SRB — Sindh</option>
            <option value="KPRA">KPRA — Khyber Pakhtunkhwa</option>
            <option value="BRA">BRA — Balochistan</option>
          </select>
          <label className="mb-1 block text-xs font-medium text-gray-600">Tax rate (%)</label>
          <input type="number" min="0" max="100" step="0.01" className="input mb-3" value={rate} onChange={(e) => setRate(e.target.value)} />
          <label className="mb-1 block text-xs font-medium text-gray-600">Registration number (NTN/STRN, optional)</label>
          <input className="input mb-4" value={regNumber} onChange={(e) => setRegNumber(e.target.value)} placeholder="e.g. 1234567-8" />
          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function TabDetail({ detail, branchId, cart, grouped, cartTotal, sending, error, canDiscount, canRefund, onAddToCart, onChangeQty, onSendRound, onVoid, onHold, onDiscounted, onChanged, onSettled, onShowVoidModal }) {
  const { tab, orders, subtotal } = detail;
  const [discountAmount, setDiscountAmount] = useState(tab.discount_amount > 0 ? String(tab.discount_amount) : '');
  const [discountReason, setDiscountReason] = useState(tab.discount_reason || '');
  const [showSettle, setShowSettle] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);

  const netTotal = Math.max(0, subtotal - (parseFloat(tab.discount_amount) || 0));

  async function handleApplyDiscount() {
    try {
      await api.applyPosTabDiscount(tab.id, { discount_amount: Number(discountAmount) || 0, discount_reason: discountReason || undefined });
      onDiscounted();
    } catch (err) {
      toast.error(err.message);
    }
  }

  function handleVoidItem(orderItemId) {
    onShowVoidModal({ tabId: tab.id, itemId: orderItemId, reason: '' });
  }

  return (
    <div className="space-y-4">
      <div className="card flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            {tab.order_type === 'dine_in' ? `Table ${tab.table_number}` : tab.order_type === 'phone' ? 'Phone Order' : 'Counter Order'}
            {tab.status === 'held' && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Parked</span>}
          </h2>
          {tab.customer_name && <p className="text-sm text-gray-500">{tab.customer_name} {tab.customer_phone && `· ${tab.customer_phone}`}</p>}
        </div>
        <div className="flex items-center gap-1">
          {tab.order_type === 'dine_in' && (
            <button onClick={() => setShowTransfer(true)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100" title="Transfer table">
              <ArrowRightLeft className="h-4 w-4" />
            </button>
          )}
          {tab.status === 'open' && (
            <button onClick={onHold} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100" title="Park this tab">
              <Pause className="h-4 w-4" />
            </button>
          )}
          <button onClick={onVoid} className="rounded-lg p-2 text-red-500 hover:bg-red-50" title="Void tab"><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>

      {/* Rounds already sent */}
      {orders.length > 0 && (
        <div className="card">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">Rounds</h3>
          <div className="space-y-3">
            {orders.map((o, i) => (
              <div key={o.id} className="border-b border-gray-100 pb-3 last:border-0 last:pb-0">
                <p className="mb-1 text-xs font-medium text-gray-400">Round {i + 1} · {new Date(o.created_at).toLocaleTimeString()}</p>
                {o.items.map((item) => (
                  <div key={item.id} className="group flex items-center justify-between text-sm text-gray-700">
                    <span>{item.quantity}x {item.name}</span>
                    <span className="flex items-center gap-2">
                      Rs. {Number(item.total_price).toLocaleString()}
                      {tab.status !== 'settled' && tab.status !== 'voided' && (
                        <button onClick={() => handleVoidItem(item.id)} className="text-gray-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100" title="Void this item">
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </span>
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
        <SettleModal tabId={tab.id} estimatedTotal={netTotal} onClose={() => setShowSettle(false)} onSettled={onSettled} />
      )}
      {showTransfer && (
        <TransferModal tabId={tab.id} branchId={branchId} onClose={() => setShowTransfer(false)} onTransferred={() => { setShowTransfer(false); onChanged(); }} />
      )}
    </div>
  );
}

function SettleModal({ tabId, estimatedTotal, onClose, onSettled }) {
  const [lines, setLines] = useState([{ method: 'cash', amount: String(estimatedTotal) }]);
  const [settling, setSettling] = useState(false);
  const [error, setError] = useState('');

  const paidSum = lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
  const remaining = Math.round((estimatedTotal - paidSum) * 100) / 100;

  function updateLine(i, field, value) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [field]: value } : l)));
  }
  function addLine() {
    setLines((ls) => [...ls, { method: 'card', amount: remaining > 0 ? String(remaining) : '' }]);
  }
  function removeLine(i) {
    setLines((ls) => ls.filter((_, j) => j !== i));
  }

  async function handleSettle() {
    setSettling(true);
    setError('');
    try {
      const payload = lines.length === 1
        ? { payment_method: lines[0].method }
        : { payments: lines.map((l) => ({ method: l.method, amount: Number(l.amount) || 0 })) };
      const res = await api.settlePosTab(tabId, payload);
      onSettled(res.primary_order_id);
    } catch (err) {
      setError(err.message);
    } finally {
      setSettling(false);
    }
  }

  return (
    <Modal open={true} onClose={onClose} title="Settle Bill">
      <p className="mb-4 text-2xl font-bold text-gray-900">Rs. {estimatedTotal.toLocaleString()}</p>

      <div className="mb-3 space-y-2">
        {lines.map((line, i) => (
          <div key={i} className="flex items-center gap-2">
            <select className="input" value={line.method} onChange={(e) => updateLine(i, 'method', e.target.value)}>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="jazzcash">JazzCash</option>
              <option value="easypaisa">EasyPaisa</option>
            </select>
            <input type="number" min="0" className="input" placeholder="Amount" value={line.amount} onChange={(e) => updateLine(i, 'amount', e.target.value)} />
            {lines.length > 1 && (
              <button onClick={() => removeLine(i)} className="shrink-0 text-gray-300 hover:text-red-500"><X className="h-4 w-4" /></button>
            )}
          </div>
        ))}
      </div>

      <button onClick={addLine} className="mb-4 text-xs font-medium text-brand-600 hover:underline">+ Split across another method</button>

      {lines.length > 1 && (
        <p className={`mb-3 text-sm ${Math.abs(remaining) < 1 ? 'text-green-600' : 'text-gray-500'}`}>
          {Math.abs(remaining) < 1 ? 'Fully covered' : remaining > 0 ? `Rs. ${remaining.toLocaleString()} remaining` : `Rs. ${Math.abs(remaining).toLocaleString()} over`}
        </p>
      )}

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={handleSettle} disabled={settling} className="btn-primary">
          {settling ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm & Close Tab'}
        </button>
      </div>
    </Modal>
  );
}

function TransferModal({ tabId, branchId, onClose, onTransferred }) {
  const [tables, setTables] = useState([]);
  const [tableId, setTableId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api.getTables(branchId).then((res) => setTables(res.tables)); }, [branchId]);

  async function handleTransfer() {
    if (!tableId) { setError('Select a table'); return; }
    setSaving(true);
    setError('');
    try {
      await api.transferPosTab(tabId, tableId);
      onTransferred();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={true} onClose={onClose} title="Transfer Table" size="sm">
      <select className="input mb-4" value={tableId} onChange={(e) => setTableId(e.target.value)}>
        <option value="">Select a table…</option>
        {tables.map((t) => <option key={t.id} value={t.id}>Table {t.table_number}{t.open_session_id ? ' (occupied)' : ''}</option>)}
      </select>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={handleTransfer} disabled={saving} className="btn-primary">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Move Table'}
        </button>
      </div>
    </Modal>
  );
}

function ReceiptModal({ orderId, canRefund, onClose }) {
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState('');
  const [showRefund, setShowRefund] = useState(false);

  useEffect(() => {
    api.getPosReceipt(orderId).then((res) => setReceipt(res.receipt)).catch((err) => setError(err.message));
  }, [orderId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:static print:bg-white print:p-0" onClick={onClose}>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .pos-receipt, .pos-receipt * { visibility: visible; }
          .pos-receipt { position: absolute; top: 0; left: 0; width: 80mm; font-size: 11px; }
        }
      `}</style>
      <div className="max-h-[90vh] w-80 overflow-y-auto rounded-xl bg-white p-6 shadow-xl print:h-auto print:max-h-none print:w-full print:rounded-none print:p-2 print:shadow-none" onClick={(e) => e.stopPropagation()}>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!receipt ? (
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        ) : (
          <div className="pos-receipt font-mono text-xs text-gray-800">
            <div className="mb-3 text-center">
              <p className="text-sm font-bold">{receipt.branch.name}</p>
              {receipt.branch.address && <p>{receipt.branch.address}</p>}
              {receipt.branch.phone && <p>{receipt.branch.phone}</p>}
              {receipt.tax.registration_number && <p>{receipt.tax.authority} Reg# {receipt.tax.registration_number}</p>}
            </div>
            <div className="mb-2 border-t border-dashed border-gray-400 pt-2">
              <p>Order #{receipt.order_number}</p>
              <p>{new Date(receipt.created_at).toLocaleString()}</p>
            </div>
            <div className="mb-2 space-y-0.5 border-t border-dashed border-gray-400 pt-2">
              {receipt.items.map((item, i) => (
                <div key={i} className="flex justify-between">
                  <span>{item.quantity}x {item.name}</span>
                  <span>{Number(item.total_price).toLocaleString()}</span>
                </div>
              ))}
            </div>
            <div className="space-y-0.5 border-t border-dashed border-gray-400 pt-2">
              <div className="flex justify-between"><span>Subtotal</span><span>{receipt.subtotal.toLocaleString()}</span></div>
              {receipt.discount > 0 && <div className="flex justify-between"><span>Discount</span><span>-{receipt.discount.toLocaleString()}</span></div>}
              <div className="flex justify-between"><span>Tax{receipt.tax.authority !== 'NONE' ? ` (${receipt.tax.authority})` : ''}</span><span>{receipt.tax_amount.toLocaleString()}</span></div>
              <div className="flex justify-between text-sm font-bold"><span>TOTAL</span><span>Rs. {receipt.total.toLocaleString()}</span></div>
            </div>
            <div className="mt-2 space-y-0.5 border-t border-dashed border-gray-400 pt-2">
              {receipt.payments.map((p, i) => (
                <div key={i} className="flex justify-between"><span>{METHOD_LABEL[p.method] || p.method}</span><span>{p.amount.toLocaleString()}</span></div>
              ))}
            </div>
            <p className="mt-3 text-center text-[10px]">Thank you for dining with us!</p>
          </div>
        )}

        <div className="mt-4 flex gap-2 print:hidden">
          <button onClick={() => window.print()} className="btn-secondary flex-1 justify-center"><Printer className="h-4 w-4" /> Print</button>
          {canRefund && receipt && (
            <button onClick={() => setShowRefund(true)} className="btn-secondary flex-1 justify-center"><RotateCcw className="h-4 w-4" /> Refund</button>
          )}
        </div>
        <button onClick={onClose} className="btn-primary mt-2 w-full justify-center print:hidden">Done</button>
      </div>

      {showRefund && (
        <RefundModal orderId={orderId} maxAmount={receipt?.total || 0} onClose={() => setShowRefund(false)} onRefunded={() => setShowRefund(false)} />
      )}
    </div>
  );
}

function RefundModal({ orderId, maxAmount, onClose, onRefunded }) {
  const [amount, setAmount] = useState(String(maxAmount));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function handleRefund() {
    if (!reason.trim()) { setError('A reason is required'); return; }
    setSaving(true);
    setError('');
    try {
      await api.refundPosOrder(orderId, { amount: Number(amount) || 0, reason });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={true} onClose={onClose} title={done ? 'Refund recorded' : 'Refund'} size="sm" hideCloseButton={done}>
      {done ? (
        <>
          <p className="mb-4 text-sm text-gray-500">Rs. {(Number(amount) || 0).toLocaleString()} logged with an audit trail entry.</p>
          <button onClick={onRefunded} className="btn-primary w-full justify-center">Done</button>
        </>
      ) : (
        <>
          <label className="mb-1 block text-xs font-medium text-gray-600">Amount (Rs.)</label>
          <input type="number" min="0" max={maxAmount} className="input mb-3" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <label className="mb-1 block text-xs font-medium text-gray-600">Reason</label>
          <input className="input mb-4" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. customer complaint" />
          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button onClick={handleRefund} disabled={saving} className="btn-primary">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm Refund'}
            </button>
          </div>
        </>
      )}
    </Modal>
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
    <Modal open={true} onClose={onClose} title="New Tab">
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
    </Modal>
  );
}
