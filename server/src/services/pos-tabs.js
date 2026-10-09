/**
 * POS bill operations shared by the online POS routes (routes/pos.js) and the
 * offline sync endpoint (routes/pos-offline.js) — impl-33 Part 4.
 *
 * Every operation takes an optional clientRequestId (a UUID the device made
 * up when the cashier pressed the button). It is unique per tenant, so a
 * replay — a retry after a dropped connection, or the offline outbox syncing
 * twice — returns the original result instead of creating a second tab,
 * order or payment.
 *
 * `offline: true` marks a replay of something the cashier did while the
 * device had no connection. The rules are different in three ways:
 *  - only cash settlement (cards/wallets need a live confirmation);
 *  - items are priced from the price the customer was charged when that price
 *    really was on the menu during the offline window, otherwise re-priced at
 *    the current price — the client's totals are never used either way;
 *  - things the server can't accept automatically (shift already closed, a
 *    bill number outside this device's block…) throw SyncReview, which the
 *    sync route turns into a manager-review item instead of an error.
 */
import { query, withTransaction } from '../db/pool.js';
import { getOrCreateCustomer, resolveOrderItems, calculatePricing, createOrder, OrderError } from './orders.js';
import { getTaxConfig, computeSettlement, findOpenShift } from './pos-billing.js';

export class PosError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Offline action the server won't apply on its own; goes to manager review. */
export class SyncReview extends Error {
  constructor(reason, message) {
    super(message || reason);
    this.reason = reason;
  }
}

export const SHIFT_REQUIRED_MESSAGE = 'Open a shift to start selling.';
const OFFLINE_WINDOW_DAYS = 7;

function isUniqueViolation(err, constraint) {
  return err?.code === '23505' && (!constraint || err.constraint === constraint);
}

/**
 * Clamp a device-reported action time into [floor, now] so a bill keeps the
 * time it was rung up (for the right business day) without letting a device
 * backdate or future-date sales arbitrarily.
 */
export function clampActionTime(clientTime, floor) {
  const now = Date.now();
  const t = clientTime ? Date.parse(clientTime) : NaN;
  if (Number.isNaN(t)) return null;
  const min = floor ? new Date(floor).getTime() : now - OFFLINE_WINDOW_DAYS * 86400000;
  return new Date(Math.min(now, Math.max(min, t))).toISOString();
}

async function addTabFlags(tabId, flags) {
  if (!flags || flags.length === 0) return;
  await query(
    `UPDATE pos_tabs SET sync_flags = ARRAY(SELECT DISTINCT unnest(sync_flags || $2::text[])) WHERE id = $1`,
    [tabId, flags],
  );
}

export async function loadTabById(tenantId, tabId) {
  const res = await query(
    `SELECT pt.*, rt.table_number
     FROM pos_tabs pt
     LEFT JOIN table_sessions ts ON ts.id = pt.table_session_id
     LEFT JOIN restaurant_tables rt ON rt.id = ts.table_id
     WHERE pt.id = $1 AND pt.tenant_id = $2`,
    [tabId, tenantId],
  );
  return res.rows[0] || null;
}

export async function loadTabByClientId(tenantId, clientRequestId) {
  const res = await query('SELECT id FROM pos_tabs WHERE tenant_id = $1 AND client_request_id = $2', [tenantId, clientRequestId]);
  return res.rows[0] ? loadTabById(tenantId, res.rows[0].id) : null;
}

// ── Bill numbers ──

/** true if billNumber lies in a block leased to this device for this branch. */
export async function billNumberLeased({ tenantId, branchId, deviceId, billNumber }) {
  const res = await query(
    `SELECT 1 FROM pos_bill_blocks
     WHERE tenant_id = $1 AND branch_id = $2 AND device_id = $3 AND $4::bigint BETWEEN range_start AND range_end`,
    [tenantId, branchId, deviceId, billNumber],
  );
  return res.rows.length > 0;
}

// ── Open a tab ──

/**
 * @returns {{ tab, replay: boolean }}
 */
export async function openTab({ tenantId, user, data, clientRequestId = null, deviceId = null, billNumber = null, offline = false, actionTime = null }) {
  if (clientRequestId) {
    const existing = await loadTabByClientId(tenantId, clientRequestId);
    if (existing) return { tab: existing, replay: true };
  }

  if (data.order_type === 'dine_in' && !data.table_id) {
    throw new PosError(400, 'table_id is required for a dine-in tab');
  }

  let branchId = data.branch_id || null;
  if (branchId) {
    const branchRes = await query('SELECT id FROM branches WHERE id = $1 AND tenant_id = $2', [branchId, tenantId]);
    if (branchRes.rows.length === 0) throw new PosError(400, 'Invalid branch');
  } else {
    const branchRes = await query('SELECT id FROM branches WHERE tenant_id = $1 ORDER BY created_at LIMIT 1', [tenantId]);
    branchId = branchRes.rows[0]?.id;
  }
  if (!branchId) throw new PosError(400, 'No branch configured for this restaurant');

  // impl-33 Part 0: no selling outside a shift — every tab must land in a
  // cashier's Z-report. Checked before a dine-in table session is created.
  const openShift = await findOpenShift(tenantId, branchId, user.id);
  if (!openShift) {
    if (offline) throw new SyncReview('shift_not_open', 'The cashier\'s shift was not open when this offline bill synced');
    throw new PosError(403, SHIFT_REQUIRED_MESSAGE, 'shift_required');
  }

  if (billNumber != null) {
    if (!deviceId || !(await billNumberLeased({ tenantId, branchId, deviceId, billNumber }))) {
      if (offline) throw new SyncReview('invalid_bill_number', `Bill number ${billNumber} is not in a block leased to this device`);
      throw new PosError(400, 'That bill number was not issued to this device', 'invalid_bill_number');
    }
  }

  let tableSessionId = null;
  if (data.order_type === 'dine_in') {
    const tableRes = await query(
      'SELECT id FROM restaurant_tables WHERE id = $1 AND tenant_id = $2 AND branch_id = $3',
      [data.table_id, tenantId, branchId],
    );
    if (tableRes.rows.length === 0) throw new PosError(400, 'Table not found for this branch');
    const sessionRes = await query(`SELECT id FROM table_sessions WHERE table_id = $1 AND status != 'closed'`, [data.table_id]);
    if (sessionRes.rows.length > 0) {
      tableSessionId = sessionRes.rows[0].id;
    } else {
      const created = await query(
        `INSERT INTO table_sessions (tenant_id, table_id) VALUES ($1, $2) RETURNING id`,
        [tenantId, data.table_id],
      );
      tableSessionId = created.rows[0].id;
    }
  }

  const createdAt = offline ? clampActionTime(actionTime, openShift.opened_at) : null;
  try {
    const result = await query(
      `INSERT INTO pos_tabs (tenant_id, branch_id, table_session_id, order_type, opened_by, customer_name, customer_phone, pos_shift_id,
                             client_request_id, device_id, bill_number, created_offline, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13::timestamptz, NOW())) RETURNING id`,
      [tenantId, branchId, tableSessionId, data.order_type, user.id, data.customer_name || null, data.customer_phone || null,
        openShift.id, clientRequestId, deviceId, billNumber, offline, createdAt],
    );
    return { tab: await loadTabById(tenantId, result.rows[0].id), replay: false };
  } catch (err) {
    if (isUniqueViolation(err, 'uq_pos_tabs_client_request')) {
      return { tab: await loadTabByClientId(tenantId, clientRequestId), replay: true };
    }
    if (isUniqueViolation(err, 'uq_pos_tabs_branch_bill_number')) {
      if (offline) throw new SyncReview('duplicate_bill_number', `Bill number ${billNumber} is already used in this branch`);
      throw new PosError(409, `Bill number ${billNumber} is already used`, 'duplicate_bill_number');
    }
    throw err;
  }
}

// ── Offline pricing ──

/**
 * Price an offline round. For each line the device sends the unit price it
 * charged (from its menu snapshot). That price is kept only if it really was
 * this item's price at some point since `snapshotAt` (current price, or a
 * price-history row that was still valid then). Otherwise the line is
 * re-priced at the current price. Unavailable items are kept — the food was
 * already served — and flagged.
 * @returns {{ items, flags: string[] }}
 */
export async function resolveOfflineItems(tenantId, cartItems, snapshotAt) {
  if (!Array.isArray(cartItems) || cartItems.length === 0) throw new OrderError(400, 'Cart is empty');
  const ids = cartItems.map((i) => i.menu_item_id);
  const [itemsRes, historyRes] = await Promise.all([
    query('SELECT id, name, price, is_available FROM menu_items WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [tenantId, ids]),
    query(
      `SELECT menu_item_id, price FROM menu_item_price_history
       WHERE tenant_id = $1 AND menu_item_id = ANY($2::uuid[]) AND valid_to >= $3::timestamptz`,
      [tenantId, ids, snapshotAt],
    ),
  ]);
  const byId = new Map(itemsRes.rows.map((r) => [r.id, r]));
  const validPrices = new Map();
  for (const row of historyRes.rows) {
    (validPrices.get(row.menu_item_id) || validPrices.set(row.menu_item_id, new Set()).get(row.menu_item_id)).add(Number(row.price).toFixed(2));
  }

  const flags = new Set();
  const items = [];
  for (const line of cartItems) {
    const menuItem = byId.get(line.menu_item_id);
    if (!menuItem) throw new SyncReview('item_not_found', 'An item on this offline bill is no longer on the menu');
    const quantity = Math.max(1, Math.min(50, Math.trunc(line.quantity) || 1));
    const current = parseFloat(menuItem.price);
    const charged = line.charged_unit_price == null ? null : Number(line.charged_unit_price);
    let unitPrice = current;
    if (charged != null && Number.isFinite(charged) && charged.toFixed(2) !== current.toFixed(2)) {
      if (validPrices.get(menuItem.id)?.has(charged.toFixed(2))) {
        unitPrice = charged; // genuinely the price on the menu when it was sold
        flags.add('price_changed_offline');
      } else {
        flags.add('repriced_at_sync'); // not a price this item ever had in the window
      }
    }
    if (!menuItem.is_available) flags.add('availability_changed_offline');
    items.push({ menu_item_id: menuItem.id, name: menuItem.name, quantity, unit_price: unitPrice, total_price: Math.round(unitPrice * quantity * 100) / 100 });
  }
  return { items, flags: [...flags] };
}

// ── Add a round ──

/** @returns {{ order, replay: boolean, flags: string[] }} */
export async function addItems({ tenantId, user, tab, items, notes, clientRequestId = null, offline = false, snapshotAt = null, actionTime = null }) {
  if (clientRequestId) {
    const existing = await query('SELECT * FROM orders WHERE tenant_id = $1 AND client_request_id = $2', [tenantId, clientRequestId]);
    if (existing.rows[0]) return { order: existing.rows[0], replay: true, flags: [] };
  }
  if (tab.status !== 'open') {
    if (offline) throw new SyncReview('tab_not_open', `The bill was already ${tab.status} when this offline round synced`);
    throw new PosError(400, `This tab is already ${tab.status}`);
  }
  // The person adding items must be on shift (a held tab resumed by another
  // cashier is fine, as long as that cashier has opened their own shift).
  const shift = await findOpenShift(tenantId, tab.branch_id, user.id);
  if (!shift) {
    if (offline) throw new SyncReview('shift_not_open', 'The cashier\'s shift was not open when this offline round synced');
    throw new PosError(403, SHIFT_REQUIRED_MESSAGE, 'shift_required');
  }

  let resolved;
  let flags = [];
  if (offline) {
    const windowStart = new Date(Date.now() - OFFLINE_WINDOW_DAYS * 86400000).toISOString();
    const since = snapshotAt && Date.parse(snapshotAt) > Date.parse(windowStart) ? snapshotAt : windowStart;
    ({ items: resolved, flags } = await resolveOfflineItems(tenantId, items, since));
  } else {
    resolved = await resolveOrderItems(tenantId, items);
  }

  const taxConfig = await getTaxConfig(tab.branch_id);
  const pricing = calculatePricing(resolved, { deliveryFee: 0, taxRate: (parseFloat(taxConfig.tax_rate) || 0) / 100 });
  const customer = tab.customer_phone
    ? await getOrCreateCustomer(tab.tenant_id, tab.customer_phone, { name: tab.customer_name })
    : { id: null };

  let order;
  try {
    order = await createOrder({
      tenantId: tab.tenant_id,
      customer,
      items: resolved,
      pricing,
      deliveryAddress: null,
      paymentMethod: null, // chosen once, at settlement
      channel: 'pos',
      notes,
      branchId: tab.branch_id,
      tableSessionId: tab.table_session_id,
      posTabId: tab.id,
      clientRequestId,
      createdAt: offline ? clampActionTime(actionTime, shift.opened_at) : null,
    });
  } catch (err) {
    if (isUniqueViolation(err, 'uq_orders_client_request')) {
      const existing = await query('SELECT * FROM orders WHERE tenant_id = $1 AND client_request_id = $2', [tenantId, clientRequestId]);
      return { order: existing.rows[0], replay: true, flags: [] };
    }
    throw err;
  }
  await addTabFlags(tab.id, flags);
  return { order, replay: false, flags };
}

// ── Settle ──

async function settledResult(client, tab) {
  const ordersRes = await client.query(
    `SELECT id, subtotal, discount_amount, tax, total FROM orders WHERE pos_tab_id = $1 ORDER BY created_at`,
    [tab.id],
  );
  const sum = (k) => Math.round(ordersRes.rows.reduce((s, o) => s + parseFloat(o[k]), 0) * 100) / 100;
  return {
    tab,
    total: sum('total'),
    subtotal: sum('subtotal'),
    discount: sum('discount_amount'),
    tax: sum('tax'),
    primary_order_id: ordersRes.rows[0]?.id || null,
  };
}

/**
 * Finalizes payment across every round already placed against this tab.
 * impl-24: tax is recomputed here on the post-discount subtotal (provincial
 * tax_config rate), and both discount and tax are prorated across the
 * underlying order rows — so SUM(orders.total) still matches the bill total
 * for Insights, and each order row stays internally consistent.
 * Accepts either a single `payment_method` (full amount) or a `payments`
 * array for split-tender; a split's amounts must sum to the total.
 * @returns {{ result, replay: boolean }}
 */
// issuedOffline: only the offline sync sets it (a PIN session that is online
// follows offline payment rules but is not an offline-issued sale).
export async function settleTab({ tenantId, tabId, data, clientRequestId = null, offline = false, issuedOffline = false, actionTime = null }) {
  const paymentLinesRequested = data.payments || [{ method: data.payment_method, amount: null }];
  if (offline && paymentLinesRequested.some((p) => p.method !== 'cash')) {
    throw new PosError(400, 'Only cash can be taken while offline — card and wallet payments need a live connection.', 'offline_cash_only');
  }

  return withTransaction(async (client) => {
    const tabRes = await client.query(
      `SELECT * FROM pos_tabs WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [tabId, tenantId],
    );
    const tab = tabRes.rows[0];
    if (!tab) throw new PosError(404, 'Tab not found');

    // Replay of the settle that already happened — same answer, no new payment.
    if (clientRequestId && tab.settle_request_id === clientRequestId) {
      return { result: await settledResult(client, tab), replay: true };
    }
    if (tab.status !== 'open' && tab.status !== 'held') {
      if (offline) throw new SyncReview('tab_not_open', `The bill was already ${tab.status} when this offline payment synced`);
      throw new PosError(400, `This tab is already ${tab.status}`);
    }

    const ordersRes = await client.query(
      `SELECT id, subtotal, tax, total FROM orders WHERE pos_tab_id = $1 ORDER BY created_at FOR UPDATE`,
      [tab.id],
    );
    if (ordersRes.rows.length === 0) throw new PosError(400, 'Add at least one item before settling');

    const taxConfig = await getTaxConfig(tab.branch_id);
    const settlement = computeSettlement(ordersRes.rows, parseFloat(tab.discount_amount) || 0, taxConfig.tax_rate);

    for (const line of settlement.perOrder) {
      await client.query(
        'UPDATE orders SET discount_amount = $2, tax = $3, total = $4, updated_at = NOW() WHERE id = $1',
        [line.id, line.discount, line.tax, line.total],
      );
    }

    // Offline: the cash taken is the server's total. The device's own total is
    // never trusted; a mismatch (e.g. re-pricing at sync) is flagged instead.
    const paymentLines = offline
      ? [{ method: 'cash', amount: settlement.total }]
      : data.payments || [{ method: data.payment_method, amount: settlement.total }];
    const paidSum = Math.round(paymentLines.reduce((sum, p) => sum + p.amount, 0) * 100) / 100;
    if (!offline && Math.abs(paidSum - settlement.total) > 1) {
      throw new PosError(400, `Payment total (Rs. ${paidSum}) doesn't match the bill total (Rs. ${settlement.total})`);
    }
    const flags = [];
    if (offline && data.client_total != null && Math.abs(Number(data.client_total) - settlement.total) > 1) {
      flags.push('total_differs_from_device');
    }

    for (const line of paymentLines) {
      await client.query(
        `INSERT INTO pos_tab_payments (pos_tab_id, method, amount) VALUES ($1, $2, $3)`,
        [tab.id, line.method, line.amount],
      );
    }

    // Aggregate `payments` row — existing reporting reads this table across
    // every channel. Primary method is the split's first line; amount is
    // the full settled total. pos_tab_payments is the granular record.
    const primaryMethod = paymentLines[0].method === 'cash' ? 'cod' : paymentLines[0].method;
    await client.query(
      `INSERT INTO payments (tenant_id, order_id, method, status, amount)
       VALUES ($1, $2, $3, 'paid', $4)`,
      [tab.tenant_id, ordersRes.rows[0].id, primaryMethod, settlement.total],
    );

    // impl-33: queue the bill for fiscal reporting in the same commit, so
    // a crash after settling still leaves it findable by the retry sweep.
    const settledAt = issuedOffline ? clampActionTime(actionTime, tab.created_at) : null;
    const updatedTab = await client.query(
      `UPDATE pos_tabs SET status = 'settled', settled_at = COALESCE($3::timestamptz, NOW()), settle_request_id = $4,
              fiscal_issued_offline = $6,
              sync_flags = ARRAY(SELECT DISTINCT unnest(sync_flags || $5::text[])),
              fiscal_status = CASE WHEN (SELECT fiscal_provider FROM tenants WHERE id = $2) = 'none' THEN 'not_required' ELSE 'pending' END
       WHERE id = $1 RETURNING *`,
      [tab.id, tab.tenant_id, settledAt, clientRequestId, flags, issuedOffline],
    );

    return {
      result: {
        tab: updatedTab.rows[0],
        total: settlement.total,
        subtotal: settlement.subtotal,
        discount: settlement.discount,
        tax: settlement.tax,
        primary_order_id: ordersRes.rows[0].id,
      },
      replay: false,
    };
  }).catch(async (err) => {
    // Two replays of the same settle racing: the loser hits the unique index
    // after the winner committed — answer with the winner's result.
    if (clientRequestId && isUniqueViolation(err, 'uq_pos_tabs_settle_request')) {
      return withTransaction(async (client) => {
        const tabRes = await client.query('SELECT * FROM pos_tabs WHERE tenant_id = $1 AND settle_request_id = $2', [tenantId, clientRequestId]);
        return { result: await settledResult(client, tabRes.rows[0]), replay: true };
      });
    }
    throw err;
  });
}
