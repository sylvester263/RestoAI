/**
 * Full inventory service (impl-08) — recipe-based ingredient depletion,
 * auto-86'ing menu items the kitchen can no longer make, and restoring
 * them once stock is replenished. Called from createOrder (depletion) and
 * the purchase-order receive flow (restoration), always inside the same
 * DB transaction as the write that triggered it.
 */
import { query } from '../db/pool.js';
import { sendReply } from './whatsapp.js';

// ── Recipe editor (menu.js's /:id/recipe routes call these) ──

export async function getRecipe(tenantId, menuItemId) {
  const result = await query(
    `SELECT r.ingredient_id, r.quantity_required, i.name, i.unit
     FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id
     WHERE r.menu_item_id = $1 AND i.tenant_id = $2
     ORDER BY i.name`,
    [menuItemId, tenantId],
  );
  return result.rows;
}

/** Replaces the full recipe for a menu item with the given ingredient list. */
export async function setRecipe(tenantId, menuItemId, ingredients) {
  // Every ingredient must belong to this tenant — never trust a bare id.
  const ids = ingredients.map((i) => i.ingredient_id);
  if (ids.length > 0) {
    const ownedRes = await query(
      'SELECT id FROM ingredients WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
      [tenantId, ids],
    );
    if (ownedRes.rows.length !== new Set(ids).size) {
      const err = new Error('One or more ingredients are invalid for this tenant');
      err.status = 400;
      throw err;
    }
  }

  await query('DELETE FROM recipes WHERE menu_item_id = $1', [menuItemId]);
  for (const item of ingredients) {
    await query(
      'INSERT INTO recipes (menu_item_id, ingredient_id, quantity_required) VALUES ($1, $2, $3)',
      [menuItemId, item.ingredient_id, item.quantity_required],
    );
  }
  return getRecipe(tenantId, menuItemId);
}

// ── Depletion + auto-86 (called from createOrder, inside its transaction) ──

/**
 * Decrements ingredient stock for every recipe ingredient behind the given
 * order items. Returns a Map of ingredient_id -> { before, after (row),
 * name, unit, threshold } so the caller can run auto-86 checks and
 * low-stock alerts against just the ingredients actually touched.
 */
export async function depleteIngredientsForOrder(client, orderItems) {
  const touched = new Map();

  for (const item of orderItems) {
    if (!item.menu_item_id) continue;
    const recipeRes = await client.query(
      'SELECT ingredient_id, quantity_required FROM recipes WHERE menu_item_id = $1',
      [item.menu_item_id],
    );
    for (const r of recipeRes.rows) {
      const amount = parseFloat(r.quantity_required) * item.quantity;
      const existing = touched.get(r.ingredient_id);
      const before = existing ? existing.before : (
        await client.query('SELECT current_stock FROM ingredients WHERE id = $1', [r.ingredient_id])
      ).rows[0]?.current_stock;
      if (before === undefined) continue; // ingredient row missing/deleted — nothing to deplete

      const updated = await client.query(
        `UPDATE ingredients SET current_stock = current_stock - $1 WHERE id = $2
         RETURNING id, tenant_id, name, unit, current_stock, low_stock_threshold`,
        [amount, r.ingredient_id],
      );
      touched.set(r.ingredient_id, { before: parseFloat(before), ...updated.rows[0] });
    }
  }
  return touched;
}

/**
 * For every menu item that uses any of the given ingredients, checks
 * whether it can still be made at least once — if not, marks it
 * unavailable and flags it as auto-disabled. Never touches an item that's
 * already unavailable (including manually-disabled ones).
 */
export async function autoDisableUnmakeableItems(client, tenantId, ingredientIds) {
  if (ingredientIds.length === 0) return [];
  const menuItemsRes = await client.query(
    'SELECT DISTINCT menu_item_id FROM recipes WHERE ingredient_id = ANY($1::uuid[])',
    [ingredientIds],
  );

  const disabled = [];
  for (const { menu_item_id } of menuItemsRes.rows) {
    const shortfallRes = await client.query(
      `SELECT COUNT(*) as insufficient FROM recipes r
       JOIN ingredients i ON i.id = r.ingredient_id
       WHERE r.menu_item_id = $1 AND i.current_stock < r.quantity_required`,
      [menu_item_id],
    );
    if (parseInt(shortfallRes.rows[0].insufficient, 10) > 0) {
      const result = await client.query(
        `UPDATE menu_items SET is_available = false, auto_unavailable = true, updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2 AND is_available = true
         RETURNING id, name`,
        [tenantId, menu_item_id],
      );
      if (result.rows.length > 0) disabled.push(result.rows[0]);
    }
  }
  return disabled;
}

/**
 * For every menu item that uses any of the given ingredients and was
 * auto-disabled (never a manual one), re-enables it if all its recipe
 * ingredients now have enough stock for at least one more order.
 */
export async function restoreAutoDisabledItems(client, tenantId, ingredientIds) {
  if (ingredientIds.length === 0) return [];
  const menuItemsRes = await client.query(
    `SELECT DISTINCT r.menu_item_id FROM recipes r
     JOIN menu_items mi ON mi.id = r.menu_item_id
     WHERE r.ingredient_id = ANY($1::uuid[]) AND mi.auto_unavailable = true`,
    [ingredientIds],
  );

  const restored = [];
  for (const { menu_item_id } of menuItemsRes.rows) {
    const shortfallRes = await client.query(
      `SELECT COUNT(*) as insufficient FROM recipes r
       JOIN ingredients i ON i.id = r.ingredient_id
       WHERE r.menu_item_id = $1 AND i.current_stock < r.quantity_required`,
      [menu_item_id],
    );
    if (parseInt(shortfallRes.rows[0].insufficient, 10) === 0) {
      const result = await client.query(
        `UPDATE menu_items SET is_available = true, auto_unavailable = false, updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2 AND auto_unavailable = true
         RETURNING id, name`,
        [tenantId, menu_item_id],
      );
      if (result.rows.length > 0) restored.push(result.rows[0]);
    }
  }
  return restored;
}

/**
 * Post-commit, best-effort WhatsApp alert for ingredients that just
 * crossed below their low-stock threshold. Never called inside the
 * transaction itself — a notification failure must never roll back a sale.
 */
export async function alertIfCrossedThreshold(tenantId, touchedIngredients) {
  const crossed = [];
  for (const info of touchedIngredients.values()) {
    const threshold = parseFloat(info.low_stock_threshold);
    const afterStock = parseFloat(info.current_stock);
    if (info.before > threshold && afterStock <= threshold) {
      crossed.push(info);
    }
  }
  if (crossed.length === 0) return;

  try {
    const tenantRes = await query('SELECT phone FROM tenants WHERE id = $1', [tenantId]);
    const phone = tenantRes.rows[0]?.phone;
    if (!phone) return;
    const lines = crossed.map((i) => `${i.name}: ${parseFloat(i.current_stock).toFixed(1)}${i.unit} left`).join(', ');
    await sendReply(phone, `⚠️ Low stock alert: ${lines}`);
  } catch (err) {
    console.error('[inventory] low-stock alert failed:', err.message);
  }
}
