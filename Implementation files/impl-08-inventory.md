# Implementation 08 — Inventory Management (Recipes, Suppliers, Purchase Orders, Auto-Deplete)

## Goal
Track ingredient-level stock, auto-deplete it as orders are placed (recipe-based), manage suppliers and purchase orders, and surface live food-cost margins — the most substantial gap feature versus Bitecast.

## Data Model — New Tables

```sql
CREATE TABLE ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  name VARCHAR(150) NOT NULL,
  unit VARCHAR(20) NOT NULL, -- e.g. 'kg', 'liter', 'piece'
  current_stock NUMERIC(12,3) NOT NULL DEFAULT 0,
  low_stock_threshold NUMERIC(12,3) DEFAULT 0,
  cost_per_unit NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_ingredients_branch ON ingredients(branch_id);

CREATE TABLE recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id UUID NOT NULL REFERENCES menu_items(id),
  ingredient_id UUID NOT NULL REFERENCES ingredients(id),
  quantity_required NUMERIC(12,3) NOT NULL,
  UNIQUE(menu_item_id, ingredient_id)
);

CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name VARCHAR(150) NOT NULL,
  contact_phone VARCHAR(20),
  contact_email VARCHAR(150),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ordered','received','cancelled')),
  ordered_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id),
  ingredient_id UUID NOT NULL REFERENCES ingredients(id),
  quantity NUMERIC(12,3) NOT NULL,
  unit_cost NUMERIC(10,2) NOT NULL
);
```

## API Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/ingredients` | GET/POST/PUT | Authenticated (owner/manager) | Manage ingredient stock records |
| `/api/menu/:id/recipe` | GET/PUT | Authenticated | Define/edit which ingredients + quantities a menu item consumes |
| `/api/suppliers` | GET/POST/PUT | Authenticated | Manage supplier list |
| `/api/purchase-orders` | GET/POST | Authenticated | Create/list purchase orders |
| `/api/purchase-orders/:id/receive` | POST | Authenticated | Mark a PO received, increments ingredient stock |
| `/api/ingredients/low-stock` | GET | Authenticated | Ingredients below their threshold |

## Step-by-Step Implementation

1. **Migrations:** Add all 5 tables above.
2. **Backend — `server/src/routes/inventory.js` (new):** Standard CRUD for ingredients and suppliers. Recipe editing lives under the existing menu routes (`GET/PUT /api/menu/:id/recipe`) since it's conceptually part of a menu item's definition.
3. **Auto-deplete on order:** In the shared order-creation logic (`orders.js`), after an order's items are finalized, for each `order_item`, look up its `recipes` rows and decrement the matching `ingredients.current_stock` by `quantity_required * order_item.quantity`. This must happen atomically with order creation (same DB transaction) so stock and orders never drift out of sync.
4. **Low-stock alerts:** `GET /api/ingredients/low-stock` returns any ingredient where `current_stock <= low_stock_threshold`. Surface this as a visible alert/badge in the admin dashboard (extend the existing Dashboard or Menu page — a small "X ingredients low" indicator). Optionally trigger a WhatsApp alert to the owner using existing send infrastructure when an ingredient crosses its threshold (check this at decrement time in step 3).
5. **Auto-86 menu items:** When an ingredient hits zero (or a menu item's required ingredients are insufficient for even one more order), automatically mark the affected menu item(s) unavailable (reuse the existing `menu_items.availability` flag already used for manual 86'ing) so the WhatsApp agent and public menu stop showing/allowing orders for something the kitchen can't make. Re-enable automatically when stock is replenished via a received purchase order, if the ingredient shortage was the only reason it was marked unavailable (don't override a manually-disabled item).
6. **Purchase orders:** `POST /purchase-orders` creates a draft PO with line items (ingredient + quantity + unit cost) against a supplier. `POST /purchase-orders/:id/receive` marks it received and increments each `ingredients.current_stock` by the ordered quantity, and updates `ingredients.cost_per_unit` to the latest received cost (simple most-recent-cost approach, not weighted-average, for this pass).
7. **Food-cost margin reporting:** Extend the existing Insights dashboard (`insights.js`) with a per-menu-item margin calculation: `price - sum(recipe ingredient quantities * ingredient cost_per_unit)`. Surface this as a new insights view/metric — "food cost %" or "margin per item" — since this is one of the more genuinely valuable owner-facing numbers this feature unlocks.
8. **Frontend:** New admin page `client/src/pages/Inventory.jsx` covering ingredients list (with low-stock highlighting), recipe editor (attach ingredients + quantities to a menu item, likely as an expansion within the existing Menu.jsx edit modal rather than a fully separate page), suppliers list, and purchase order creation/receiving flow.

## Verification Steps
1. Define a recipe for a menu item (e.g. "Chicken Karahi requires 0.5kg chicken, 0.1kg spices"), place an order for it, confirm `ingredients.current_stock` decrements by the correct amount.
2. Deplete an ingredient to below its threshold, confirm it shows in the low-stock view and (if built) triggers a WhatsApp alert.
3. Deplete an ingredient to zero where a menu item depends on it, confirm that menu item is auto-marked unavailable and disappears/grays out on the public menu and WhatsApp ordering.
4. Create and receive a purchase order, confirm stock increments correctly and the affected menu item automatically becomes available again (if it was auto-86'd for that reason).
5. Confirm a manually-disabled menu item does NOT get auto-re-enabled by a stock replenishment (manual override should persist).
6. Check the new food-cost margin metric in Insights against a manually-calculated expected value for at least one menu item.

## Explicitly out of scope for this file
- Weighted-average costing (most-recent-cost only for this pass)
- Waste/spoilage tracking as a separate concern from order-driven depletion
- Multi-unit conversion (e.g. auto-converting grams to kg) — assume consistent units are entered correctly by staff
