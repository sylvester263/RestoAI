/**
 * Menu/Pricing Insight Agent (impl-20) — classifies menu items by sales
 * velocity and food-cost margin to proactively surface recommendations.
 * Classification is deterministic threshold-based code, same principle as
 * impl-18's reconciliation agent; Qwen only phrases the recommendation.
 */
import { query } from '../db/pool.js';
import { generateAgentText } from './ai-agent.js';

const PERIOD_DAYS = 14;
const VELOCITY_HIGH = 10; // units sold over the period
const VELOCITY_LOW = 2;
const MARGIN_HEALTHY_PCT = 40;
const MARGIN_LOW_PCT = 15;

export async function computeItemMetrics(tenantId, menuItemId, periodDays = PERIOD_DAYS) {
  const salesRes = await query(
    `SELECT COALESCE(SUM(oi.quantity), 0) as units_sold, COALESCE(SUM(oi.total_price), 0) as revenue
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE o.tenant_id = $1 AND oi.menu_item_id = $2 AND o.status != 'cancelled'
       AND o.created_at >= NOW() - ($3 || ' days')::interval`,
    [tenantId, menuItemId, periodDays],
  );
  const unitsSold = parseFloat(salesRes.rows[0].units_sold);
  const revenue = parseFloat(salesRes.rows[0].revenue);

  const itemRes = await query('SELECT price FROM menu_items WHERE id = $1', [menuItemId]);
  const price = parseFloat(itemRes.rows[0]?.price || 0);

  const recipeRes = await query(
    `SELECT COALESCE(SUM(r.quantity_required * i.cost_per_unit), 0) as unit_cost, COUNT(*) as ingredient_count
     FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id
     WHERE r.menu_item_id = $1`,
    [menuItemId],
  );
  const hasRecipe = parseInt(recipeRes.rows[0].ingredient_count, 10) > 0;
  const unitCost = parseFloat(recipeRes.rows[0].unit_cost);
  const margin = hasRecipe ? price - unitCost : null;
  const marginPct = hasRecipe && price > 0 ? Math.round((margin / price) * 1000) / 10 : null;

  return { units_sold: unitsSold, revenue, price, unit_cost: hasRecipe ? unitCost : null, margin, margin_pct: marginPct, has_recipe: hasRecipe, period_days: periodDays };
}

/** Deterministic, threshold-based — never AI-guessed (see file header). */
export function classifyItem(metrics) {
  const { units_sold, margin_pct, has_recipe } = metrics;
  const highVelocity = units_sold >= VELOCITY_HIGH;
  const lowVelocity = units_sold <= VELOCITY_LOW;

  if (has_recipe && margin_pct !== null) {
    if (highVelocity && margin_pct >= MARGIN_HEALTHY_PCT) return 'feature_candidate';
    if (highVelocity && margin_pct < MARGIN_LOW_PCT) return 'pricing_review';
    if (lowVelocity) return 'low_velocity';
    if (margin_pct < MARGIN_LOW_PCT) return 'low_margin';
    return null;
  }
  // No recipe/cost data yet — velocity-only signal.
  if (lowVelocity) return 'low_velocity';
  return null;
}

function fallbackRecommendation(insightType, name, metrics) {
  switch (insightType) {
    case 'feature_candidate':
      return `${name} sells well (${metrics.units_sold} units in ${metrics.period_days} days) and carries a healthy ${metrics.margin_pct}% margin — consider featuring it more prominently.`;
    case 'pricing_review':
      return `${name} sells well (${metrics.units_sold} units) but its margin is only ${metrics.margin_pct}% — worth reviewing its price or recipe cost.`;
    case 'low_velocity':
      return `${name} only sold ${metrics.units_sold} units in the last ${metrics.period_days} days — consider promoting it or reconsidering its place on the menu.`;
    case 'low_margin':
      return `${name} sells at a normal pace but its margin is thin (${metrics.margin_pct}%) — worth a pricing or cost review.`;
    default:
      return `${name} has a notable pattern worth reviewing.`;
  }
}

export async function runMenuInsightScan(tenantId, periodDays = PERIOD_DAYS) {
  const itemsRes = await query('SELECT id, name FROM menu_items WHERE tenant_id = $1', [tenantId]);

  let created = 0;
  for (const item of itemsRes.rows) {
    const metrics = await computeItemMetrics(tenantId, item.id, periodDays);
    const insightType = classifyItem(metrics);
    if (!insightType) continue;

    const existing = await query(
      `SELECT id FROM agent_menu_insights WHERE tenant_id = $1 AND menu_item_id = $2 AND insight_type = $3 AND status = 'new'`,
      [tenantId, item.id, insightType],
    );
    if (existing.rows.length > 0) continue;

    let recommendation;
    try {
      recommendation = await generateAgentText(
        'You are a menu-strategy assistant for a restaurant. Turn this classified metric into one clear, ' +
          'specific recommendation sentence. Reference only the numbers given — never invent data.',
        JSON.stringify({ menu_item: item.name, insight_type: insightType, ...metrics }),
      );
    } catch (err) {
      console.error('[menu-insight-agent] recommendation generation failed, using fallback:', err.message);
      recommendation = fallbackRecommendation(insightType, item.name, metrics);
    }

    try {
      await query(
        `INSERT INTO agent_menu_insights (tenant_id, menu_item_id, insight_type, recommendation, supporting_data)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, item.id, insightType, recommendation, JSON.stringify(metrics)],
      );
      created++;
    } catch (err) {
      // 23505 = unique_violation on idx_menu_insights_dedup — a concurrent
      // scan run already inserted this exact finding; the DB constraint is
      // the real guarantee, the SELECT above is just a cheap fast path.
      if (err.code !== '23505') throw err;
    }
  }
  return created;
}
