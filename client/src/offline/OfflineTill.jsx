/**
 * The till while offline or in a PIN session (impl-33 Part 4).
 *
 * Allowed: open a bill, add items, take CASH, print/reprint the receipt.
 * Not here (need a connection and a full sign-in): card/wallet payments,
 * discounts, voids, refunds, menu edits, shift open/close, staff, WhatsApp/AI.
 * The server enforces the same list; this screen just doesn't offer them.
 *
 * Everything is written to IndexedDB first (bill + outbox in one transaction)
 * and synced in order when the connection is back.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Minus, Printer, Banknote, Lock, X, Receipt as ReceiptIcon, UtensilsCrossed, Phone } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/ui/Modal';
import { toast } from '../components/ui/toast';
import OfflineBanner from './OfflineBanner';
import InstallBanner from '../components/InstallBanner';
import BillsList from './BillsList';
import {
  getActiveBranch, getSnapshot, getShift, getDeviceId, getBlocks, remainingNumbers,
  openBill, addRound, settleCash, listBills, billTotals,
} from './store';
import useOfflineStatus, { notifyOutboxChanged } from './useOfflineStatus';
import { syncNow } from './sync';

const TYPE_LABEL = { counter: 'Counter', dine_in: 'Dine-in', phone: 'Phone' };
const rs = (n) => `Rs. ${Number(n || 0).toLocaleString('en-PK')}`;

export default function OfflineTill({ online }) {
  const { user, tenant, logout } = useAuth();
  const navigate = useNavigate();
  const [ready, setReady] = useState(null); // null = loading, { ok, problem?, snap, shift, deviceId, remaining }
  const [bills, setBills] = useState([]);
  const [selected, setSelected] = useState(null);
  const [cart, setCart] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [showCash, setShowCash] = useState(false);
  const [receiptBill, setReceiptBill] = useState(null);

  const load = useCallback(async () => {
    const branchId = await getActiveBranch();
    const snap = branchId ? await getSnapshot(branchId) : null;
    if (!snap) return setReady({ ok: false, problem: 'This device has no menu saved yet. Open the POS once while online so it can prepare for offline use.' });
    const [shift, deviceId, blocks, list] = await Promise.all([getShift(user.id, branchId), getDeviceId(), getBlocks(branchId), listBills(branchId)]);
    setBills(list);
    const remaining = remainingNumbers(blocks);
    if (!shift || shift.status !== 'open') return setReady({ ok: false, snap, problem: `${user.name} has no open shift saved on this device. Shifts can only be opened online — open one while connected, then you can keep selling offline.` });
    if (remaining <= 0) return setReady({ ok: false, snap, problem: 'This device has used all its bill numbers. Reconnect so it can get a new block.' });
    setReady({ ok: true, snap, shift, deviceId, remaining, branchId });
    return null;
  }, [user.id, user.name]);

  useEffect(() => { load(); }, [load]);
  // Re-read bills when a sync changes their status (banner and list agree).
  const { syncing, pending } = useOfflineStatus();
  useEffect(() => { if (!syncing) load(); }, [syncing, pending, load]);

  const selectedBill = bills.find((b) => b.cid === selected) || null;
  const taxRate = ready?.snap?.tax?.rate || 0;
  const grouped = useMemo(() => {
    const out = {};
    for (const item of ready?.snap?.items || []) (out[item.category_name || 'Menu'] = out[item.category_name || 'Menu'] || []).push(item);
    return out;
  }, [ready?.snap]);

  async function afterWrite(bill) {
    notifyOutboxChanged();
    await load();
    if (bill) setSelected(bill.cid);
    if (online) syncNow();
  }

  async function handleOpen(form) {
    try {
      const bill = await openBill({
        user, branchId: ready.branchId, deviceId: ready.deviceId, snapshotAt: ready.snap.snapshot_at,
        orderType: form.orderType, table: form.table, customerName: form.customerName, customerPhone: form.customerPhone,
      });
      setShowNew(false);
      setCart([]);
      await afterWrite(bill);
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function sendRound() {
    if (!selectedBill || cart.length === 0) return;
    try {
      const bill = await addRound({ bill: selectedBill, user, deviceId: ready.deviceId, snapshotAt: ready.snap.snapshot_at, lines: cart });
      setCart([]);
      await afterWrite(bill);
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function takeCash(cashReceived) {
    try {
      const { total } = billTotals(selectedBill, taxRate);
      const bill = await settleCash({ bill: selectedBill, user, deviceId: ready.deviceId, snapshotAt: ready.snap.snapshot_at, total, cashReceived });
      setShowCash(false);
      setSelected(null);
      await afterWrite(null);
      setReceiptBill(bill);
    } catch (err) {
      toast.error(err.message);
    }
  }

  function addToCart(item) {
    if (!item.is_available) return;
    setCart((c) => {
      const existing = c.find((l) => l.menu_item_id === item.id);
      if (existing) return c.map((l) => (l.menu_item_id === item.id ? { ...l, quantity: Math.min(50, l.quantity + 1) } : l));
      return [...c, { menu_item_id: item.id, name: item.name, price: Number(item.price), quantity: 1 }];
    });
  }
  const changeQty = (id, d) => setCart((c) => c.map((l) => (l.menu_item_id === id ? { ...l, quantity: l.quantity + d } : l)).filter((l) => l.quantity > 0));

  function lock() {
    logout();
    navigate('/login?pin=1');
  }

  if (!ready) return <div className="p-6 text-sm text-[var(--text-secondary)]">Loading offline till…</div>;

  const openBills = bills.filter((b) => b.status === 'open');
  const cartTotal = cart.reduce((s, l) => s + l.price * l.quantity, 0);

  return (
    <div data-testid="offline-till">
      <OfflineBanner />
      <InstallBanner variant="inline" />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-[var(--text-primary)]">POS {online ? '' : '(offline)'}</h1>
        <span className="text-sm text-[var(--text-secondary)]">{user.name}{user.offline_session ? ' · PIN session' : ''} · {tenant?.name}</span>
        {ready.ok && <span className="text-xs text-[var(--text-tertiary)]">{ready.remaining} bill numbers left on this device</span>}
        <div className="ml-auto flex gap-2">
          {ready.ok && <button type="button" onClick={() => setShowNew(true)} className="btn-primary text-sm" data-testid="new-bill"><Plus className="h-4 w-4" /> New bill</button>}
          <button type="button" onClick={lock} className="btn-secondary text-sm"><Lock className="h-4 w-4" /> Lock / switch</button>
        </div>
      </div>
      <p className="mb-4 text-xs text-[var(--text-tertiary)]">
        Offline you can open bills, add items, take cash and print receipts. Card and wallet payments, discounts, voids, refunds and shift close need a connection and a full sign-in.
      </p>

      {!ready.ok ? (
        <div className="card text-sm text-[var(--text-secondary)]">{ready.problem}</div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <div className="space-y-2">
            {openBills.length === 0 && <p className="text-sm text-[var(--text-tertiary)]">No open bills</p>}
            {openBills.map((b) => {
              const t = billTotals(b, taxRate);
              return (
                <button key={b.cid} type="button" onClick={() => { setSelected(b.cid); setCart([]); }} data-testid="open-bill"
                  className={`w-full rounded-xl border p-3 text-left ${selected === b.cid ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-[var(--border)] bg-[var(--surface-2)]'}`}>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Bill #{b.bill_number} · {TYPE_LABEL[b.order_type]}{b.table_number ? ` · Table ${b.table_number}` : ''}</p>
                  <p className="text-xs text-[var(--text-secondary)]">{b.rounds.length} round{b.rounds.length === 1 ? '' : 's'} · {rs(t.total)}</p>
                </button>
              );
            })}
          </div>

          <div>
            {!selectedBill ? (
              <div className="flex h-40 items-center justify-center text-sm text-[var(--text-tertiary)]">Select or open a bill</div>
            ) : (
              <div className="space-y-4">
                <div className="card !p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="font-semibold text-[var(--text-primary)]">Bill #{selectedBill.bill_number}</p>
                    <button type="button" onClick={() => setSelected(null)} aria-label="Close bill"><X className="h-4 w-4" /></button>
                  </div>
                  {selectedBill.rounds.map((r, i) => (
                    <div key={r.crid} className="mb-1 text-sm">
                      <p className="text-xs text-[var(--text-tertiary)]">Round {i + 1}</p>
                      {r.items.map((l) => (
                        <div key={l.menu_item_id} className="flex justify-between"><span>{l.quantity} × {l.name}</span><span>{rs(l.price * l.quantity)}</span></div>
                      ))}
                    </div>
                  ))}
                  {(() => {
                    const t = billTotals(selectedBill, taxRate);
                    return (
                      <div className="mt-2 border-t border-[var(--border-light)] pt-2 text-sm">
                        {t.tax > 0 && <div className="flex justify-between text-[var(--text-secondary)]"><span>Tax ({taxRate}%)</span><span>{rs(t.tax)}</span></div>}
                        <div className="flex justify-between font-bold"><span>Total</span><span data-testid="bill-total">{rs(t.total)}</span></div>
                      </div>
                    );
                  })()}
                  <button type="button" disabled={selectedBill.rounds.length === 0} onClick={() => setShowCash(true)} data-testid="take-cash"
                    className="btn-primary mt-3 w-full justify-center disabled:opacity-50"><Banknote className="h-4 w-4" /> Take cash</button>
                </div>

                {cart.length > 0 && (
                  <div className="card !p-4">
                    <p className="mb-2 text-sm font-semibold">New round</p>
                    {cart.map((l) => (
                      <div key={l.menu_item_id} className="flex items-center justify-between py-1 text-sm">
                        <span>{l.name}</span>
                        <span className="flex items-center gap-2">
                          <button type="button" onClick={() => changeQty(l.menu_item_id, -1)} aria-label="Less"><Minus className="h-3 w-3" /></button>
                          {l.quantity}
                          <button type="button" onClick={() => changeQty(l.menu_item_id, 1)} aria-label="More"><Plus className="h-3 w-3" /></button>
                          <span className="w-20 text-right">{rs(l.price * l.quantity)}</span>
                        </span>
                      </div>
                    ))}
                    <button type="button" onClick={sendRound} className="btn-primary mt-2 w-full justify-center" data-testid="send-round">Add {rs(cartTotal)} to bill</button>
                  </div>
                )}

                {Object.entries(grouped).map(([cat, items]) => (
                  <div key={cat}>
                    <p className="mb-1 text-xs font-semibold uppercase text-[var(--text-tertiary)]">{cat}</p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                      {items.map((item) => (
                        <button key={item.id} type="button" disabled={!item.is_available} onClick={() => addToCart(item)} data-testid="menu-item"
                          className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2 text-left text-sm disabled:opacity-40">
                          <span className="block font-medium text-[var(--text-primary)]">{item.name}</span>
                          <span className="text-xs text-[var(--text-secondary)]">{item.is_available ? rs(item.price) : 'Sold out'}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-8">
        <BillsList bills={bills.filter((b) => b.status === 'settled')} taxRate={taxRate} onReprint={setReceiptBill} />
      </div>

      {showNew && <NewBillModal tables={ready.snap?.tables || []} onClose={() => setShowNew(false)} onOpen={handleOpen} />}
      {showCash && selectedBill && <CashModal total={billTotals(selectedBill, taxRate).total} onClose={() => setShowCash(false)} onConfirm={takeCash} />}
      {receiptBill && <LocalReceipt bill={receiptBill} snap={ready.snap} tenant={tenant} taxRate={taxRate} onClose={() => setReceiptBill(null)} />}
    </div>
  );
}

function NewBillModal({ tables, onClose, onOpen }) {
  const [orderType, setOrderType] = useState('counter');
  const [tableId, setTableId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const icons = { counter: ReceiptIcon, dine_in: UtensilsCrossed, phone: Phone };
  return (
    <Modal open onClose={onClose} title="New bill" size="sm">
      <div className="mb-3 grid grid-cols-3 gap-2">
        {Object.keys(TYPE_LABEL).map((t) => {
          const Icon = icons[t];
          return (
            <button key={t} type="button" onClick={() => setOrderType(t)}
              className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-xs ${orderType === t ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-[var(--border)]'}`}>
              <Icon className="h-4 w-4" />{TYPE_LABEL[t]}
            </button>
          );
        })}
      </div>
      {orderType === 'dine_in' && (
        <select className="input mb-3" value={tableId} onChange={(e) => setTableId(e.target.value)}>
          <option value="">Choose a table</option>
          {tables.map((t) => <option key={t.id} value={t.id}>Table {t.table_number}</option>)}
        </select>
      )}
      <input className="input mb-2" placeholder="Customer name (optional)" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
      <input className="input mb-3" placeholder="Customer phone (optional)" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
      <button type="button" className="btn-primary w-full justify-center" data-testid="open-bill-confirm"
        disabled={orderType === 'dine_in' && !tableId}
        onClick={() => onOpen({ orderType, table: tables.find((t) => t.id === tableId) || null, customerName: customerName.trim(), customerPhone: customerPhone.trim() })}>
        Open bill
      </button>
    </Modal>
  );
}

function CashModal({ total, onClose, onConfirm }) {
  const [received, setReceived] = useState('');
  const change = received === '' ? null : Number(received) - total;
  return (
    <Modal open onClose={onClose} title="Take cash" size="sm">
      <p className="mb-3 text-2xl font-bold">{rs(total)}</p>
      <input className="input mb-2" type="number" inputMode="numeric" placeholder="Cash received (optional)" value={received} onChange={(e) => setReceived(e.target.value)} />
      {change != null && <p className={`mb-3 text-sm ${change < 0 ? 'text-red-600' : 'text-[var(--text-secondary)]'}`}>{change < 0 ? `Short by ${rs(-change)}` : `Change: ${rs(change)}`}</p>}
      <button type="button" className="btn-primary w-full justify-center" data-testid="confirm-cash" disabled={change != null && change < 0}
        onClick={() => onConfirm(received === '' ? null : Number(received))}>
        Paid in cash
      </button>
    </Modal>
  );
}

export function LocalReceipt({ bill, snap, tenant, taxRate, onClose }) {
  const t = billTotals(bill, taxRate);
  const lines = bill.rounds.flatMap((r) => r.items);
  return (
    <Modal open onClose={onClose} title="Receipt" size="sm">
      <div className="rounded-lg bg-white p-4 font-mono text-xs text-gray-900" data-testid="local-receipt">
        <div className="text-center">
          <p className="text-sm font-bold">{tenant?.name}</p>
          {snap?.branch?.name && <p>{snap.branch.name}</p>}
          {snap?.tax?.registration_number && <p>{snap.tax.authority} Reg# {snap.tax.registration_number}</p>}
        </div>
        <div className="mt-2 border-t border-dashed border-gray-400 pt-2">
          <p>Bill #{bill.bill_number}</p>
          <p>{new Date(bill.settled_at || bill.created_at).toLocaleString()}</p>
        </div>
        <div className="mt-2 space-y-0.5 border-t border-dashed border-gray-400 pt-2">
          {lines.map((l, i) => (
            <div key={i} className="flex justify-between"><span>{l.quantity} × {l.name}</span><span>{(l.price * l.quantity).toLocaleString()}</span></div>
          ))}
        </div>
        <div className="mt-2 space-y-0.5 border-t border-dashed border-gray-400 pt-2">
          <div className="flex justify-between"><span>Subtotal</span><span>{t.subtotal.toLocaleString()}</span></div>
          {t.tax > 0 && <div className="flex justify-between"><span>Tax</span><span>{t.tax.toLocaleString()}</span></div>}
          <div className="flex justify-between text-sm font-bold"><span>TOTAL</span><span>Rs. {(bill.server_total ?? t.total).toLocaleString()}</span></div>
          <div className="flex justify-between"><span>Cash</span><span>{(bill.cash_received ?? bill.total ?? t.total).toLocaleString()}</span></div>
        </div>
        {bill.sync !== 'synced' && <p className="mt-3 text-center text-[10px]">Recorded offline — tax invoice number follows once synced.</p>}
        <p className="mt-2 text-center text-[10px]">Thank you for dining with us!</p>
      </div>
      <div className="mt-4 flex gap-2 print:hidden">
        <button type="button" onClick={() => window.print()} className="btn-secondary flex-1 justify-center"><Printer className="h-4 w-4" /> Print</button>
        <button type="button" onClick={onClose} className="btn-primary flex-1 justify-center">Done</button>
      </div>
    </Modal>
  );
}
