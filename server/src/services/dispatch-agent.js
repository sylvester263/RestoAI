/**
 * Smart Rider Dispatch Agent (impl-16) — a lightweight reasoning layer over
 * impl-05's rider system. No GPS/location data exists, so this works with
 * load (active-assignment count) and freshness (most recently free) only —
 * do not attempt real distance-based routing, per impl-05's explicit scope.
 */
import { query } from '../db/pool.js';
import { generateAgentText } from './ai-agent.js';
import { createRiderAssignment } from '../routes/orders.js';

class DispatchError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function getCandidates(tenantId, branchId) {
  const res = await query(
    `SELECT r.id, r.name,
       COUNT(ra.id) FILTER (WHERE ra.delivered_at IS NULL) as active_count,
       MAX(ra.delivered_at) as last_delivered_at
     FROM riders r
     LEFT JOIN rider_assignments ra ON ra.rider_id = r.id
     WHERE r.tenant_id = $1 AND r.branch_id = $2 AND r.status = 'active'
     GROUP BY r.id
     ORDER BY active_count ASC, last_delivered_at DESC NULLS LAST, r.created_at ASC`,
    [tenantId, branchId],
  );
  return res.rows.map((r) => ({
    rider_id: r.id,
    name: r.name,
    active_deliveries: parseInt(r.active_count, 10),
    last_delivered_at: r.last_delivered_at,
  }));
}

/**
 * Computes (but does not commit) a rider suggestion for an order.
 * Returns null if the order has no available riders for its branch.
 */
export async function suggestRider(orderId, tenantId) {
  const orderRes = await query(
    'SELECT id, branch_id FROM orders WHERE id = $1 AND tenant_id = $2',
    [orderId, tenantId],
  );
  const order = orderRes.rows[0];
  if (!order) throw new DispatchError(404, 'Order not found');

  const candidates = await getCandidates(tenantId, order.branch_id);
  if (candidates.length === 0) return null;

  const picked = candidates[0];
  const others = candidates.slice(1);

  let reasoning;
  try {
    reasoning = await generateAgentText(
      'You are a delivery dispatcher explaining, in 1-2 plain sentences, why you picked a specific rider for ' +
        'a delivery. Reference only the numbers given — never invent data.',
      JSON.stringify({ picked, other_candidates: others }),
    );
  } catch (err) {
    console.error('[dispatch-agent] reasoning generation failed, using fallback:', err.message);
    reasoning =
      others.length > 0
        ? `${picked.name} has the fewest active deliveries (${picked.active_deliveries}) among ${candidates.length} available riders.`
        : `${picked.name} is the only available rider for this branch right now.`;
  }

  return { rider: { id: picked.rider_id, name: picked.name }, reasoning, candidates };
}

async function logDispatch(tenantId, orderId, suggestion, autoAssigned) {
  await query(
    `INSERT INTO agent_dispatch_log (tenant_id, order_id, rider_id, reasoning, candidates_considered, auto_assigned)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tenantId, orderId, suggestion.rider.id, suggestion.reasoning, JSON.stringify(suggestion.candidates), autoAssigned],
  );
}

/** Preview a suggestion for staff review, logging it as not (yet) committed. */
export async function previewSuggestion(orderId, tenantId) {
  const suggestion = await suggestRider(orderId, tenantId);
  if (!suggestion) return null;
  await logDispatch(tenantId, orderId, suggestion, false);
  return suggestion;
}

/** Computes a suggestion and immediately commits it as a real assignment. */
export async function autoAssign(orderId, tenantId) {
  const suggestion = await suggestRider(orderId, tenantId);
  if (!suggestion) return null;
  const assignment = await createRiderAssignment(tenantId, orderId, suggestion.rider.id);
  await logDispatch(tenantId, orderId, suggestion, true);
  return { assignment, ...suggestion };
}

/**
 * Hook called from fireStatusChangeSideEffects when a delivery order is
 * confirmed. Only acts if this tenant has opted into full auto-assign mode
 * and the order doesn't already have a rider.
 */
export async function maybeAutoAssign(tenantId, order) {
  const tenantRes = await query('SELECT agent_dispatch_mode FROM tenants WHERE id = $1', [tenantId]);
  if (tenantRes.rows[0]?.agent_dispatch_mode !== 'auto') return;

  const existing = await query('SELECT id FROM rider_assignments WHERE order_id = $1', [order.id]);
  if (existing.rows.length > 0) return;

  await autoAssign(order.id, tenantId);
}

export { DispatchError };
