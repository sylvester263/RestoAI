/**
 * Inventory Replenishment Agent (impl-19) — watches stock vs. sales
 * velocity and drafts purchase-order suggestions before a stockout, using
 * the recipe-based depletion data impl-08 establishes. Never auto-orders:
 * every suggestion requires an explicit human approval step before it
 * becomes a real purchase order — a stricter rule than impl-15/16's
 * owner-toggle model, because this commits real money.
 */
import { query } from '../db/pool.js';
import { generateAgentText } from './ai-agent.js';

const STOCKOUT_BUFFER_DAYS = 3; // suggest once we're within this many days of running out
const REORDER_COVERAGE_DAYS = 10; // suggested quantity covers this many days of typical usage
const VELOCITY_LOOKBACK_DAYS = 7;

/** Average daily consumption of an ingredient, reconstructed from recipe usage in real orders. */
export async function computeVelocity(tenantId, ingredientId, lookbackDays = VELOCITY_LOOKBACK_DAYS) {
  const result = await query(
    `SELECT COALESCE(SUM(oi.quantity * r.quantity_required), 0) as consumed
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN recipes r ON r.menu_item_id = oi.menu_item_id AND r.ingredient_id = $1
     WHERE o.tenant_id = $2 AND o.status != 'cancelled' AND o.created_at >= NOW() - ($3 || ' days')::interval`,
    [ingredientId, tenantId, lookbackDays],
  );
  return parseFloat(result.rows[0].consumed) / lookbackDays;
}

/** Returns { suggested_quantity, reasoning } or null if this ingredient doesn't need reordering yet. */
export async function suggestReplenishment(tenantId, ingredient) {
  const velocity = await computeVelocity(tenantId, ingredient.id);
  if (velocity <= 0) return null; // no recent usage — nothing to reason about

  const currentStock = parseFloat(ingredient.current_stock);
  const daysUntilStockout = currentStock / velocity;
  if (daysUntilStockout > STOCKOUT_BUFFER_DAYS) return null;

  const suggestedQuantity = Math.round((velocity * REORDER_COVERAGE_DAYS - currentStock) * 1000) / 1000;
  if (suggestedQuantity <= 0) return null;

  const facts = {
    ingredient: ingredient.name,
    unit: ingredient.unit,
    current_stock: currentStock,
    daily_velocity: Math.round(velocity * 100) / 100,
    days_until_stockout: Math.round(daysUntilStockout * 10) / 10,
    suggested_quantity: suggestedQuantity,
  };

  let reasoning;
  try {
    reasoning = await generateAgentText(
      'You are an inventory assistant. Explain a reorder suggestion in 1-2 clear sentences for a restaurant ' +
        'owner, referencing only the numbers given — never invent data.',
      JSON.stringify(facts),
    );
  } catch (err) {
    console.error('[replenishment-agent] reasoning generation failed, using fallback:', err.message);
    reasoning =
      `${facts.ingredient} usage has averaged ${facts.daily_velocity}${facts.unit}/day recently; at ` +
      `${facts.current_stock}${facts.unit} remaining, you'll run out in about ${facts.days_until_stockout} days — ` +
      `suggesting a ${facts.suggested_quantity}${facts.unit} order.`;
  }

  return { suggested_quantity: suggestedQuantity, reasoning };
}

export async function runReplenishmentScan(tenantId) {
  const ingredientsRes = await query('SELECT * FROM ingredients WHERE tenant_id = $1', [tenantId]);

  let created = 0;
  for (const ingredient of ingredientsRes.rows) {
    const existing = await query(
      `SELECT id FROM agent_replenishment_suggestions WHERE tenant_id = $1 AND ingredient_id = $2 AND status = 'pending'`,
      [tenantId, ingredient.id],
    );
    if (existing.rows.length > 0) continue;

    const suggestion = await suggestReplenishment(tenantId, ingredient);
    if (!suggestion) continue;

    try {
      await query(
        `INSERT INTO agent_replenishment_suggestions (tenant_id, ingredient_id, suggested_quantity, reasoning)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, ingredient.id, suggestion.suggested_quantity, suggestion.reasoning],
      );
      created++;
    } catch (err) {
      // 23505 = unique_violation on idx_replenishment_dedup — a concurrent
      // run already suggested this; the SELECT above is only a fast path,
      // the DB constraint is the real guarantee.
      if (err.code !== '23505') throw err;
    }
  }
  return created;
}
