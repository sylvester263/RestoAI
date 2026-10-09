/**
 * POS Billing (impl-24, extends impl-04) — provincial tax config, split-tender
 * settlement math, void/refund bookkeeping, shift/Z-report aggregation, and
 * receipt data assembly. Kept separate from services/orders.js because that
 * file is shared with the WhatsApp/web channels, which are out of scope here.
 */
import { query } from '../db/pool.js';

// ── Tax config — unconfigured branches are 'NONE'/0%, never a silent guess ──
export async function getTaxConfig(branchId) {
  const res = await query('SELECT * FROM tax_config WHERE branch_id = $1', [branchId]);
  return res.rows[0] || { branch_id: branchId, tax_authority: 'NONE', tax_rate: 0, tax_registration_number: null };
}

export async function upsertTaxConfig(tenantId, branchId, { tax_authority, tax_rate, tax_registration_number }) {
  const res = await query(
    `INSERT INTO tax_config (branch_id, tenant_id, tax_authority, tax_rate, tax_registration_number, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (branch_id) DO UPDATE SET
       tax_authority = EXCLUDED.tax_authority,
       tax_rate = EXCLUDED.tax_rate,
       tax_registration_number = EXCLUDED.tax_registration_number,
       updated_at = NOW()
     RETURNING *`,
    [branchId, tenantId, tax_authority, tax_rate, tax_registration_number || null],
  );
  return res.rows[0];
}

/**
 * Recomputes a settling tab's bill so tax is charged on the discounted
 * subtotal (subtotal_after_discount * tax_rate), then prorates the result
 * across the tab's underlying order rows exactly the way impl-04 already
 * prorates discount — so SUM(orders.total) still matches the bill total for
 * Insights, and each order's own subtotal/discount_amount/tax/total stay
 * internally consistent (subtotal - discount + tax = total, per row).
 */
export function computeSettlement(orders, discountRequested, taxRatePercent) {
  const subtotal = orders.reduce((sum, o) => sum + parseFloat(o.subtotal), 0);
  const discount = Math.min(Math.max(0, discountRequested) || 0, subtotal);
  const taxableAmount = subtotal - discount;
  const rate = (parseFloat(taxRatePercent) || 0) / 100;
  const tax = Math.round(taxableAmount * rate * 100) / 100;
  const total = Math.round((taxableAmount + tax) * 100) / 100;

  let remainingDiscount = discount;
  let remainingTax = tax;
  const perOrder = [];
  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    const orderSubtotal = parseFloat(order.subtotal);
    const isLast = i === orders.length - 1;
    const share = subtotal > 0 ? orderSubtotal / subtotal : 0;

    const orderDiscount = isLast ? remainingDiscount : Math.min(Math.round(discount * share * 100) / 100, remainingDiscount);
    const orderTax = isLast ? remainingTax : Math.min(Math.round(tax * share * 100) / 100, remainingTax);
    remainingDiscount = Math.max(0, remainingDiscount - orderDiscount);
    remainingTax = Math.max(0, remainingTax - orderTax);

    const orderTotal = Math.max(0, Math.round((orderSubtotal - orderDiscount + orderTax) * 100) / 100);
    perOrder.push({ id: order.id, discount: orderDiscount, tax: orderTax, total: orderTotal });
  }

  return { subtotal, discount, tax, total, perOrder };
}

// ── Shifts ──
export async function findOpenShift(tenantId, branchId, userId) {
  const res = await query(
    `SELECT * FROM pos_shifts WHERE tenant_id = $1 AND branch_id = $2 AND opened_by = $3 AND status = 'open'`,
    [tenantId, branchId, userId],
  );
  return res.rows[0] || null;
}

export async function buildZReport(tenantId, shiftId) {
  const shiftRes = await query('SELECT * FROM pos_shifts WHERE id = $1 AND tenant_id = $2', [shiftId, tenantId]);
  const shift = shiftRes.rows[0];
  if (!shift) return null;

  const [byMethod, byCategory, discountRes, voidsRes, refundsRes] = await Promise.all([
    query(
      `SELECT tp.method, COALESCE(SUM(tp.amount), 0) as total
       FROM pos_tab_payments tp JOIN pos_tabs t ON t.id = tp.pos_tab_id
       WHERE t.pos_shift_id = $1 GROUP BY tp.method`,
      [shiftId],
    ),
    query(
      `SELECT COALESCE(mc.name, 'Uncategorized') as category, COALESCE(SUM(oi.total_price), 0) as total
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN pos_tabs t ON t.id = o.pos_tab_id
       LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
       LEFT JOIN menu_categories mc ON mc.id = mi.category_id
       WHERE t.pos_shift_id = $1
       GROUP BY mc.name`,
      [shiftId],
    ),
    query(
      `SELECT COALESCE(SUM(discount_amount), 0) as total FROM pos_tabs WHERE pos_shift_id = $1 AND status = 'settled'`,
      [shiftId],
    ),
    query(
      `SELECT COALESCE(SUM(v.amount), 0) as total, COUNT(*) as count FROM pos_voids v
       JOIN pos_tabs t ON t.id = v.pos_tab_id WHERE t.pos_shift_id = $1 AND v.type = 'void'`,
      [shiftId],
    ),
    query(
      `SELECT COALESCE(SUM(v.amount), 0) as total, COUNT(*) as count,
              COALESCE(SUM(v.amount) FILTER (WHERE v.method = 'cash'), 0) as cash_total
       FROM pos_voids v JOIN pos_tabs t ON t.id = v.pos_tab_id
       WHERE t.pos_shift_id = $1 AND v.type = 'refund'`,
      [shiftId],
    ),
  ]);

  const cashSales = parseFloat(byMethod.rows.find((r) => r.method === 'cash')?.total || 0);
  const cashRefunds = parseFloat(refundsRes.rows[0].cash_total || 0);
  const closingCashExpected = shift.status === 'closed'
    ? parseFloat(shift.closing_cash_expected)
    : parseFloat(shift.opening_cash_float) + cashSales - cashRefunds;

  return {
    shift,
    sales_by_method: byMethod.rows.map((r) => ({ method: r.method, total: parseFloat(r.total) })),
    sales_by_category: byCategory.rows.map((r) => ({ category: r.category, total: parseFloat(r.total) })),
    discount_total: parseFloat(discountRes.rows[0].total),
    voids: { total: parseFloat(voidsRes.rows[0].total), count: parseInt(voidsRes.rows[0].count, 10) },
    refunds: { total: parseFloat(refundsRes.rows[0].total), count: parseInt(refundsRes.rows[0].count, 10) },
    closing_cash_expected: closingCashExpected,
    // impl-33: offline sales still unsynced when a manager overrode the close
    unsynced_at_close: shift.unsynced_at_close ?? null,
    unsynced_override_reason: shift.unsynced_override_reason ?? null,
  };
}

// ── Receipts ──
// A POS bill (tab) is one receipt even though each "add items" round is its
// own order row: items, subtotal, discount, tax and total are summed across
// every round of the tab. Before impl-33 only the requested order (usually
// the first round) was printed, so multi-round bills under-printed.
export async function buildReceiptData(tenantId, orderId) {
  const orderRes = await query(
    `SELECT o.*, b.name as branch_name, b.address as branch_address, b.phone as branch_phone,
            pt.fiscal_invoice_number, pt.fiscal_qr_code_url, pt.fiscal_status,
            pt.bill_number, pt.sync_flags
     FROM orders o
     JOIN branches b ON b.id = o.branch_id
     LEFT JOIN pos_tabs pt ON pt.id = o.pos_tab_id
     WHERE o.id = $1 AND o.tenant_id = $2`,
    [orderId, tenantId],
  );
  const order = orderRes.rows[0];
  if (!order) return null;

  const tabId = order.pos_tab_id;
  const [itemsRes, totalsRes, taxConfig, tabPaymentsRes] = await Promise.all([
    tabId
      ? query(
        `SELECT oi.name, oi.quantity, oi.unit_price, oi.total_price
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE o.pos_tab_id = $1 AND o.tenant_id = $2
         ORDER BY o.created_at, oi.id`,
        [tabId, tenantId],
      )
      : query('SELECT name, quantity, unit_price, total_price FROM order_items WHERE order_id = $1', [orderId]),
    tabId
      ? query(
        `SELECT SUM(subtotal) AS subtotal, SUM(discount_amount) AS discount, SUM(tax) AS tax, SUM(total) AS total,
                MIN(created_at) AS created_at
         FROM orders WHERE pos_tab_id = $1 AND tenant_id = $2`,
        [tabId, tenantId],
      )
      : Promise.resolve({ rows: [{ subtotal: order.subtotal, discount: order.discount_amount, tax: order.tax, total: order.total, created_at: order.created_at }] }),
    getTaxConfig(order.branch_id),
    tabId
      ? query('SELECT method, amount FROM pos_tab_payments WHERE pos_tab_id = $1 ORDER BY created_at', [tabId])
      : Promise.resolve({ rows: [] }),
  ]);
  const totals = totalsRes.rows[0];

  return {
    order_number: order.order_number,
    bill_number: order.bill_number ?? null,
    created_at: totals.created_at,
    branch: { name: order.branch_name, address: order.branch_address, phone: order.branch_phone },
    tax: { authority: taxConfig.tax_authority, registration_number: taxConfig.tax_registration_number },
    items: itemsRes.rows,
    subtotal: parseFloat(totals.subtotal),
    discount: parseFloat(totals.discount),
    tax_amount: parseFloat(totals.tax),
    total: parseFloat(totals.total),
    payments: tabPaymentsRes.rows.length > 0
      ? tabPaymentsRes.rows.map((p) => ({ method: p.method, amount: parseFloat(p.amount) }))
      : [{ method: order.payment_method, amount: parseFloat(order.total) }],
    fbr_invoice_number: order.fbr_invoice_number,
    fbr_qr_code_url: order.fbr_qr_code_url,
    // impl-33: printed only when present; nothing changes for fiscal_provider 'none'
    fiscal_invoice_number: order.fiscal_invoice_number || null,
    fiscal_qr_code_url: order.fiscal_qr_code_url || null,
    fiscal_status: order.fiscal_status || null,
    sync_flags: order.sync_flags || [],
  };
}
