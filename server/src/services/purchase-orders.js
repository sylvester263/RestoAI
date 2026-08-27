/**
 * Purchase order lifecycle (impl-08) — shared between the admin
 * routes/purchase-orders.js and the replenishment agent's approve action,
 * so PO creation exists in exactly one place (impl-19's own instruction).
 */
import { withTransaction } from '../db/pool.js';
import { restoreAutoDisabledItems } from './inventory.js';

/** Creates a draft PO with line items against a supplier. */
export async function createDraftPurchaseOrder(tenantId, branchId, supplierId, items) {
  return withTransaction(async (client) => {
    const poRes = await client.query(
      `INSERT INTO purchase_orders (tenant_id, branch_id, supplier_id) VALUES ($1, $2, $3) RETURNING *`,
      [tenantId, branchId, supplierId],
    );
    const po = poRes.rows[0];

    for (const item of items) {
      await client.query(
        `INSERT INTO purchase_order_items (purchase_order_id, ingredient_id, quantity, unit_cost)
         VALUES ($1, $2, $3, $4)`,
        [po.id, item.ingredient_id, item.quantity, item.unit_cost],
      );
    }
    return po;
  });
}

/**
 * Marks a PO received: increments ingredient stock by the ordered
 * quantity, updates cost_per_unit to the latest received cost (simple
 * most-recent-cost, no weighted average for this pass), and re-enables
 * any menu item that was auto-86'd purely for lack of these ingredients.
 */
export async function receivePurchaseOrder(tenantId, poId) {
  return withTransaction(async (client) => {
    const poRes = await client.query(
      `SELECT * FROM purchase_orders WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [poId, tenantId],
    );
    const po = poRes.rows[0];
    if (!po) {
      const err = new Error('Purchase order not found');
      err.status = 404;
      throw err;
    }
    if (po.status === 'received' || po.status === 'cancelled') {
      const err = new Error(`This purchase order is already ${po.status}`);
      err.status = 400;
      throw err;
    }

    const itemsRes = await client.query(
      'SELECT ingredient_id, quantity, unit_cost FROM purchase_order_items WHERE purchase_order_id = $1',
      [poId],
    );

    const ingredientIds = [];
    for (const item of itemsRes.rows) {
      await client.query(
        `UPDATE ingredients SET current_stock = current_stock + $1, cost_per_unit = $2 WHERE id = $3 AND tenant_id = $4`,
        [item.quantity, item.unit_cost, item.ingredient_id, tenantId],
      );
      ingredientIds.push(item.ingredient_id);
    }

    const restored = await restoreAutoDisabledItems(client, tenantId, ingredientIds);

    const updatedRes = await client.query(
      `UPDATE purchase_orders SET status = 'received', received_at = NOW() WHERE id = $1 RETURNING *`,
      [poId],
    );
    return { purchase_order: updatedRes.rows[0], restored_menu_items: restored };
  });
}
