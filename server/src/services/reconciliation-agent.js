/**
 * Order/Cash Reconciliation Agent (impl-18) — cross-checks delivered orders
 * against payment and rider cash-collection records, flagging anomalies.
 * Detection is deterministic (amount comparisons, existence checks); Qwen
 * is used only to phrase the flag's human-readable description.
 */
import { query } from '../db/pool.js';
import { generateAgentText } from './ai-agent.js';

const AMOUNT_TOLERANCE = 1; // PKR — absorbs rounding noise, not real discrepancies

/** Runs the deterministic checks for a single order. Returns a list of flags found (may be empty). */
export async function checkOrder(order) {
  const flags = [];

  const paymentRes = await query(
    'SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1',
    [order.id],
  );
  const payment = paymentRes.rows[0];

  if (!payment) {
    flags.push({ flag_type: 'missing_payment', severity: 'high', detail: { order_total: parseFloat(order.total) } });
  } else {
    const diff = Math.abs(parseFloat(payment.amount) - parseFloat(order.total));
    if (diff > AMOUNT_TOLERANCE) {
      flags.push({
        flag_type: 'amount_mismatch',
        severity: 'medium',
        detail: { payment_amount: parseFloat(payment.amount), order_total: parseFloat(order.total), diff },
      });
    }
  }

  if (order.delivery_address && order.payment_method === 'cash') {
    const assignmentRes = await query('SELECT * FROM rider_assignments WHERE order_id = $1', [order.id]);
    const assignment = assignmentRes.rows[0];
    if (assignment && assignment.delivered_at) {
      if (assignment.cash_collected === null) {
        flags.push({ flag_type: 'unreconciled_cash', severity: 'medium', detail: { order_total: parseFloat(order.total) } });
      } else {
        const diff = Math.abs(parseFloat(assignment.cash_collected) - parseFloat(order.total));
        if (diff > AMOUNT_TOLERANCE) {
          flags.push({
            flag_type: 'unreconciled_cash',
            severity: 'high',
            detail: { cash_collected: parseFloat(assignment.cash_collected), order_total: parseFloat(order.total), diff },
          });
        }
      }
    }
  }

  return flags;
}

function fallbackDescription(flag, order) {
  switch (flag.flag_type) {
    case 'missing_payment':
      return `Order #${order.order_number} is marked delivered but has no payment record on file (expected Rs. ${flag.detail.order_total}).`;
    case 'amount_mismatch':
      return `Order #${order.order_number}'s recorded payment (Rs. ${flag.detail.payment_amount}) doesn't match its total (Rs. ${flag.detail.order_total}).`;
    case 'unreconciled_cash':
      return `Order #${order.order_number}'s COD cash collection (Rs. ${flag.detail.cash_collected ?? 'none recorded'}) doesn't match its total (Rs. ${flag.detail.order_total}).`;
    default:
      return `Order #${order.order_number} has a reconciliation issue (${flag.flag_type}).`;
  }
}

/**
 * Scans recently-delivered orders for one tenant, inserting a flag for any
 * new anomaly found. Skips an order/flag_type pair that already has an
 * open flag, so re-running never creates duplicates.
 */
export async function runReconciliation(tenantId, sinceDate) {
  const ordersRes = await query(
    `SELECT * FROM orders WHERE tenant_id = $1 AND status = 'delivered' AND updated_at >= $2`,
    [tenantId, sinceDate],
  );

  let created = 0;
  for (const order of ordersRes.rows) {
    const flags = await checkOrder(order);
    for (const flag of flags) {
      const existing = await query(
        `SELECT id FROM agent_reconciliation_flags WHERE tenant_id = $1 AND order_id = $2 AND flag_type = $3 AND status = 'open'`,
        [tenantId, order.id, flag.flag_type],
      );
      if (existing.rows.length > 0) continue;

      let description;
      try {
        description = await generateAgentText(
          'You are a finance assistant for a restaurant. Turn this payment/order discrepancy into one clear, ' +
            'factual sentence an owner can understand. Reference only the numbers given — never invent data.',
          JSON.stringify({ order_number: order.order_number, flag_type: flag.flag_type, ...flag.detail }),
        );
      } catch (err) {
        console.error('[reconciliation-agent] description generation failed, using fallback:', err.message);
        description = fallbackDescription(flag, order);
      }

      try {
        await query(
          `INSERT INTO agent_reconciliation_flags (tenant_id, order_id, flag_type, description, severity)
           VALUES ($1, $2, $3, $4, $5)`,
          [tenantId, order.id, flag.flag_type, description, flag.severity],
        );
        created++;
      } catch (err) {
        // 23505 = unique_violation on idx_reconciliation_flags_dedup — a
        // concurrent run already flagged this; the SELECT above is only a
        // fast path, the DB constraint is the real guarantee.
        if (err.code !== '23505') throw err;
      }
    }
  }
  return created;
}
