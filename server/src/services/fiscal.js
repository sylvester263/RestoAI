/**
 * Fiscal invoicing seam (impl-33 Part 3) — the one place a settled POS bill
 * is reported to a tax authority. FBR e-invoicing has to go through a
 * licensed integrator (PRAL or equivalent), and Punjab restaurants may fall
 * under PRA instead, so no real provider is built yet: this file defines the
 * contract, the per-bill state on pos_tabs, and the queue/retry around it.
 *
 * A sale is never blocked by fiscal reporting. Settlement commits first;
 * reporting runs afterwards and a failure leaves the bill `failed` for retry.
 *
 * pos_tabs.fiscal_status:
 *   not_required — tenant's fiscal_provider is 'none'
 *   pending      — waiting for (or between) submission attempts
 *   submitted    — provider returned an invoice number (+ QR)
 *   failed       — last attempt failed; retried until MAX_ATTEMPTS
 */
import { waitUntil } from '@vercel/functions';
import { query } from '../db/pool.js';
import { FiscalError } from './fiscal-errors.js';
import * as pra from './fiscal-providers/pra.js';
import * as fbr from './fiscal-providers/fbr.js';
import * as stub from './fiscal-providers/stub.js';

export const MAX_ATTEMPTS = 10;

export { FiscalError };

// One adapter per authority, each exporting submit(bill, config) that resolves
// { invoiceNumber, qrUrl } or throws FiscalError. pra/fbr are placeholders
// that fail with 'not_configured' until each authority's requirements are
// confirmed (see the TODOs in fiscal-providers/).
const PROVIDERS = { pra: pra.submit, fbr: fbr.submit, stub: stub.submit };

export const FISCAL_PROVIDERS = ['none', 'pra', 'fbr', 'stub'];

/**
 * Submit one bill. The single entry point a real integrator plugs into.
 * @param {{ tabId, tenantId, branchId, total, subtotal, tax, discount, items, payments, settledAt, saleTime, issuedOffline }} bill
 *   saleTime is when the customer paid (for an offline sale: the time on the
 *   device, not the sync time); issuedOffline marks bills rung up offline.
 * @param {string} provider
 * @param {object} [config]
 * @returns {Promise<{ invoiceNumber: string, qrUrl: string|null }>}
 * @throws {FiscalError}
 */
export async function submitInvoice(bill, provider, config) {
  const impl = PROVIDERS[provider];
  if (!impl) throw new FiscalError('config', `Unknown fiscal provider: ${provider}`);
  return impl(bill, config);
}

async function loadBill(tabId) {
  const tabRes = await query(
    `SELECT pt.id, pt.tenant_id, pt.branch_id, pt.settled_at, pt.fiscal_status, pt.fiscal_attempts, pt.fiscal_issued_offline,
            t.fiscal_provider, t.fiscal_config
     FROM pos_tabs pt JOIN tenants t ON t.id = pt.tenant_id
     WHERE pt.id = $1 AND pt.status = 'settled'`,
    [tabId],
  );
  const tab = tabRes.rows[0];
  if (!tab) return null;
  const [totalsRes, itemsRes, paymentsRes] = await Promise.all([
    query(
      `SELECT COALESCE(SUM(subtotal), 0) AS subtotal, COALESCE(SUM(discount_amount), 0) AS discount,
              COALESCE(SUM(tax), 0) AS tax, COALESCE(SUM(total), 0) AS total
       FROM orders WHERE pos_tab_id = $1`,
      [tabId],
    ),
    query(
      `SELECT oi.name, oi.quantity, oi.unit_price, oi.total_price
       FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.pos_tab_id = $1`,
      [tabId],
    ),
    query('SELECT method, amount FROM pos_tab_payments WHERE pos_tab_id = $1', [tabId]),
  ]);
  const t = totalsRes.rows[0];
  return {
    tab,
    bill: {
      tabId: tab.id,
      tenantId: tab.tenant_id,
      branchId: tab.branch_id,
      subtotal: parseFloat(t.subtotal),
      discount: parseFloat(t.discount),
      tax: parseFloat(t.tax),
      total: parseFloat(t.total),
      items: itemsRes.rows,
      payments: paymentsRes.rows,
      settledAt: tab.settled_at,
      saleTime: tab.settled_at,
      issuedOffline: !!tab.fiscal_issued_offline,
    },
  };
}

/**
 * Report one settled bill if its tenant needs it. Safe to call repeatedly:
 * an already-submitted bill is left alone, and the attempt counter is
 * claimed with a conditional UPDATE so two concurrent callers can't both
 * submit the same bill.
 */
export async function processFiscalForTab(tabId) {
  const loaded = await loadBill(tabId);
  if (!loaded) return null;
  const { tab, bill } = loaded;

  if (!tab.fiscal_provider || tab.fiscal_provider === 'none') {
    await query(`UPDATE pos_tabs SET fiscal_status = 'not_required' WHERE id = $1 AND fiscal_status IS NULL`, [tabId]);
    return 'not_required';
  }
  if (tab.fiscal_status === 'submitted') return 'submitted';

  const claim = await query(
    `UPDATE pos_tabs SET fiscal_status = 'pending', fiscal_attempts = fiscal_attempts + 1, fiscal_last_attempt_at = NOW()
     WHERE id = $1 AND COALESCE(fiscal_status, 'pending') IN ('pending', 'failed') AND fiscal_attempts = $2
     RETURNING fiscal_attempts`,
    [tabId, tab.fiscal_attempts],
  );
  if (claim.rows.length === 0) return null; // someone else is on it

  try {
    const { invoiceNumber, qrUrl } = await submitInvoice(bill, tab.fiscal_provider, tab.fiscal_config);
    await query(
      `UPDATE pos_tabs SET fiscal_status = 'submitted', fiscal_invoice_number = $2, fiscal_qr_code_url = $3, fiscal_error = NULL
       WHERE id = $1`,
      [tabId, invoiceNumber, qrUrl || null],
    );
    return 'submitted';
  } catch (err) {
    const kind = err instanceof FiscalError ? err.kind : 'unavailable';
    // A rejection (bad data) won't succeed on retry — park it at the cap so
    // it shows as failed for a person to look at instead of looping.
    // Not configured: give the attempt back, so once the provider is set up
    // these bills still go through instead of having used up their retries.
    await query(
      `UPDATE pos_tabs SET fiscal_status = 'failed', fiscal_error = $2,
              fiscal_attempts = CASE WHEN $3 THEN GREATEST(fiscal_attempts, $4)
                                     WHEN $5 THEN GREATEST(fiscal_attempts - 1, 0)
                                     ELSE fiscal_attempts END
       WHERE id = $1`,
      [tabId, String(err.message).slice(0, 500), kind === 'rejected', MAX_ATTEMPTS, kind === 'not_configured'],
    );
    console.error(`[fiscal] tab ${tabId} submission failed (${kind}):`, err.message);
    return 'failed';
  }
}

/**
 * Retry queued/failed bills, oldest first. Called opportunistically after
 * each settlement (scoped to that tenant) and by the cron route (all tenants).
 */
export async function retryPendingFiscal({ tenantId = null, limit = 20 } = {}) {
  const res = await query(
    `SELECT pt.id FROM pos_tabs pt JOIN tenants t ON t.id = pt.tenant_id
     WHERE pt.status = 'settled' AND pt.fiscal_status IN ('pending', 'failed')
       AND pt.fiscal_attempts < $1 AND t.fiscal_provider <> 'none'
       AND ($2::uuid IS NULL OR pt.tenant_id = $2)
       AND (pt.fiscal_last_attempt_at IS NULL OR pt.fiscal_last_attempt_at < NOW() - INTERVAL '2 minutes')
     ORDER BY pt.settled_at
     LIMIT $3`,
    [MAX_ATTEMPTS, tenantId, limit],
  );
  const results = { submitted: 0, failed: 0 };
  for (const row of res.rows) {
    const outcome = await processFiscalForTab(row.id);
    if (outcome === 'submitted') results.submitted++;
    else if (outcome === 'failed') results.failed++;
  }
  return results;
}

/**
 * Fiscal reporting after the HTTP response — never blocks or undoes a sale.
 * Also sweeps this tenant's earlier failures while we're here.
 */
export function scheduleFiscal(tab, tenantId) {
  if (tab?.fiscal_status !== 'pending' && tab?.fiscal_status !== 'failed') return;
  waitUntil(
    processFiscalForTab(tab.id)
      .then(() => retryPendingFiscal({ tenantId, limit: 5 }))
      .catch((err) => console.error('[fiscal] post-settle processing failed:', err.message)),
  );
}

// FBR's reporting deadline is understood to be 24 hours from the sale (to be
// confirmed with the integrator); PRA's is unconfirmed. Warn at half of that.
export const FISCAL_WARN_AFTER_HOURS = 12;

/**
 * Bills of one tenant whose tax invoice is still pending or has failed, oldest
 * first, with their age measured from the sale (for an offline sale, the time
 * on the device — not when it synced).
 */
export async function listFiscalQueue(tenantId) {
  const [tenantRes, rows] = await Promise.all([
    query('SELECT fiscal_provider FROM tenants WHERE id = $1', [tenantId]),
    query(
      `SELECT pt.id AS tab_id, pt.bill_number, pt.settled_at, pt.fiscal_status, pt.fiscal_attempts, pt.fiscal_error,
              pt.fiscal_issued_offline, pt.fiscal_last_attempt_at, b.name AS branch_name,
              (SELECT o.id FROM orders o WHERE o.pos_tab_id = pt.id ORDER BY o.created_at LIMIT 1) AS primary_order_id,
              (SELECT COALESCE(SUM(o.total), 0) FROM orders o WHERE o.pos_tab_id = pt.id) AS total,
              EXTRACT(EPOCH FROM (NOW() - pt.settled_at)) / 3600 AS age_hours
       FROM pos_tabs pt JOIN branches b ON b.id = pt.branch_id
       WHERE pt.tenant_id = $1 AND pt.status = 'settled' AND pt.fiscal_status IN ('pending', 'failed')
       ORDER BY pt.settled_at`,
      [tenantId],
    ),
  ]);
  return {
    provider: tenantRes.rows[0]?.fiscal_provider || 'none',
    warn_after_hours: FISCAL_WARN_AFTER_HOURS,
    items: rows.rows.map((r) => {
      const age = Math.round(parseFloat(r.age_hours) * 10) / 10;
      return {
        tab_id: r.tab_id,
        bill_number: r.bill_number == null ? null : Number(r.bill_number),
        branch_name: r.branch_name,
        primary_order_id: r.primary_order_id,
        total: parseFloat(r.total),
        sale_time: r.settled_at,
        age_hours: age,
        warning: age >= FISCAL_WARN_AFTER_HOURS,
        status: r.fiscal_status,
        attempts: r.fiscal_attempts,
        last_attempt_at: r.fiscal_last_attempt_at,
        error: r.fiscal_error,
        issued_offline: r.fiscal_issued_offline,
      };
    }),
  };
}
