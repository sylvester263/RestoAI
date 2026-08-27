/**
 * ETA Agent (impl-17) — replaces the static "~30 min" estimate with a
 * dynamic one computed from the live kitchen queue. No stored state: the
 * estimate is recomputed on every call since queue depth changes constantly.
 */
import { query } from '../db/pool.js';
import config from '../config.js';

/**
 * @param {string} branchId
 * @param {string} orderId - excluded from its own queue-ahead count
 */
export async function estimateReadyTime(branchId, orderId) {
  const queueRes = await query(
    `SELECT COUNT(*) FROM orders WHERE branch_id = $1 AND status IN ('confirmed', 'preparing') AND id != $2`,
    [branchId, orderId],
  );
  const queueAhead = parseInt(queueRes.rows[0].count, 10);

  const itemsRes = await query(
    `SELECT COALESCE(SUM(quantity), 0) as item_count FROM order_items WHERE order_id = $1`,
    [orderId],
  );
  const itemCount = parseInt(itemsRes.rows[0].item_count, 10) || 1;

  const extraMinutes =
    queueAhead * config.timing.perOrderQueueDelayMin +
    Math.max(0, itemCount - 1) * config.timing.perItemDelayMin;

  const minMinutes = config.timing.estimatedPrepMin + extraMinutes;
  const maxMinutes = config.timing.estimatedPrepMax + extraMinutes;

  return {
    estimated_minutes_min: minMinutes,
    estimated_minutes_max: maxMinutes,
    estimated_ready_at: new Date(Date.now() + maxMinutes * 60000).toISOString(),
    queue_ahead: queueAhead,
  };
}
