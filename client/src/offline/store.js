/**
 * Offline POS data on this device (impl-33 Part 4): device id, menu snapshot,
 * bill-number blocks, cached shifts, and the offline bill + outbox writes.
 *
 * Every till action writes the local bill AND its outbox entry in one
 * IndexedDB transaction, so a crash can never leave a bill without its
 * queued action (or the reverse). The outbox is replayed in `seq` order.
 */
import { tx, get, put, getAll, getMeta, setMeta } from './db';

const uuid = () => crypto.randomUUID();
export const LOW_BILL_NUMBERS = 100;

// ── Device ──
export async function getDeviceId() {
  let id = await getMeta('device_id');
  if (!id) {
    id = uuid();
    await setMeta('device_id', id);
  }
  return id;
}

// ── Snapshot (menu, prices, tables, tax) ──
export async function saveSnapshot(snap) {
  await put('snapshot', { ...snap, branch_id: snap.branch.id, saved_at: new Date().toISOString() });
  await setMeta('active_branch', snap.branch.id);
}
export const getSnapshot = (branchId) => get('snapshot', branchId);
export const getActiveBranch = () => getMeta('active_branch');

// ── Cached shift per person per branch (shift open/close are online-only) ──
export const saveShift = (userId, branchId, shift) => setMeta(`shift:${userId}:${branchId}`, shift || null);
export const getShift = (userId, branchId) => getMeta(`shift:${userId}:${branchId}`);

// ── Bill-number blocks ──
const blocksKey = (branchId) => `bill_blocks:${branchId}`;

/** Add a freshly leased block (server-issued, never reused). */
export async function addBlock(branchId, block) {
  await tx('meta', 'readwrite', async (s, p) => {
    const row = await p(s.meta.get(blocksKey(branchId)));
    const value = row?.value || { ranges: [], next: null };
    if (!value.ranges.some((r) => r.start === block.range_start)) {
      value.ranges.push({ start: block.range_start, end: block.range_end });
      value.ranges.sort((a, b) => a.start - b.start);
    }
    if (value.next == null) value.next = value.ranges[0].start;
    await p(s.meta.put({ key: blocksKey(branchId), value }));
  });
}

export async function getBlocks(branchId) {
  return getMeta(blocksKey(branchId), { ranges: [], next: null });
}

/** Numbers left across every block this device holds for the branch. */
export function remainingNumbers(blocks) {
  if (!blocks?.ranges?.length || blocks.next == null) return 0;
  return blocks.ranges.reduce((n, r) => n + Math.max(0, r.end - Math.max(r.start, blocks.next) + 1), 0);
}

function takeNumber(value) {
  let next = value.next;
  const range = value.ranges.find((r) => next >= r.start && next <= r.end) || value.ranges.find((r) => r.start > next);
  if (!range) return null;
  if (next < range.start) next = range.start;
  value.next = next + 1;
  return next;
}

// ── Local bills + outbox ──

function enqueue(stores, p, action) {
  return p(stores.outbox.add({ ...action, status: 'pending', queued_at: new Date().toISOString() }));
}

/**
 * Open an offline bill: allocates the next bill number from this device's
 * block and queues `open_tab` — all in one transaction.
 */
export async function openBill({ user, branchId, deviceId, snapshotAt, orderType, table, customerName, customerPhone }) {
  const cid = uuid();
  const now = new Date().toISOString();
  return tx(['meta', 'bills', 'outbox'], 'readwrite', async (s, p) => {
    const row = await p(s.meta.get(blocksKey(branchId)));
    const value = row?.value;
    const billNumber = value ? takeNumber(value) : null;
    if (billNumber == null) throw new Error('No bill numbers left on this device. Reconnect to get a new block.');
    await p(s.meta.put({ key: blocksKey(branchId), value }));

    const bill = {
      cid, bill_number: billNumber, branch_id: branchId, order_type: orderType,
      table_id: table?.id || null, table_number: table?.table_number || null,
      customer_name: customerName || null, customer_phone: customerPhone || null,
      user_id: user.id, user_name: user.name, rounds: [], status: 'open',
      created_at: now, flags: [], sync: 'pending',
    };
    await p(s.bills.put(bill));
    await enqueue(s, p, {
      client_request_id: cid, tab_cid: cid, type: 'open_tab', user_id: user.id, device_id: deviceId,
      created_at: now, snapshot_at: snapshotAt,
      payload: {
        order_type: orderType, branch_id: branchId, bill_number: billNumber,
        ...(table && { table_id: table.id }),
        ...(customerName && { customer_name: customerName }),
        ...(customerPhone && { customer_phone: customerPhone }),
      },
    });
    return bill;
  });
}

/** Add a round. `lines` carry the snapshot price the customer is charged. */
export async function addRound({ bill, user, deviceId, snapshotAt, lines }) {
  const crid = uuid();
  const now = new Date().toISOString();
  return tx(['bills', 'outbox'], 'readwrite', async (s, p) => {
    const current = await p(s.bills.get(bill.cid));
    if (!current || current.status !== 'open') throw new Error('This bill is no longer open');
    current.rounds.push({ crid, created_at: now, items: lines });
    current.sync = 'pending';
    await p(s.bills.put(current));
    await enqueue(s, p, {
      client_request_id: crid, tab_cid: bill.cid, type: 'add_items', user_id: user.id, device_id: deviceId,
      created_at: now, snapshot_at: snapshotAt,
      payload: { items: lines.map((l) => ({ menu_item_id: l.menu_item_id, quantity: l.quantity, charged_unit_price: l.price })) },
    });
    return current;
  });
}

/** Cash settle. The total is the device's estimate; the server recomputes it. */
export async function settleCash({ bill, user, deviceId, snapshotAt, total, cashReceived }) {
  const crid = uuid();
  const now = new Date().toISOString();
  return tx(['bills', 'outbox'], 'readwrite', async (s, p) => {
    const current = await p(s.bills.get(bill.cid));
    if (!current || current.status !== 'open') throw new Error('This bill is no longer open');
    if (current.rounds.length === 0) throw new Error('Add at least one item before taking payment');
    Object.assign(current, { status: 'settled', settled_at: now, settle_crid: crid, total, cash_received: cashReceived ?? null, sync: 'pending' });
    await p(s.bills.put(current));
    await enqueue(s, p, {
      client_request_id: crid, tab_cid: bill.cid, type: 'settle', user_id: user.id, device_id: deviceId,
      created_at: now, snapshot_at: snapshotAt,
      payload: { payment_method: 'cash', client_total: total },
    });
    return current;
  });
}

export async function listBills(branchId) {
  const all = await getAll('bills');
  return all.filter((b) => !branchId || b.branch_id === branchId).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Local estimate of a bill's money (server is authoritative after sync). */
export function billTotals(bill, taxRatePercent) {
  const subtotal = bill.rounds.reduce((sum, r) => sum + r.items.reduce((s2, l) => s2 + l.price * l.quantity, 0), 0);
  const tax = Math.round(subtotal * ((taxRatePercent || 0) / 100) * 100) / 100;
  return { subtotal, tax, total: Math.round((subtotal + tax) * 100) / 100 };
}
