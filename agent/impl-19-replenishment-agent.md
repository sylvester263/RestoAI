# Implementation 19 — Inventory Replenishment Agent

## Goal
Once real inventory tracking exists (recipes, ingredient depletion, suppliers), automatically watch stock levels against sales velocity and draft purchase orders before a stockout happens — rather than an owner discovering they're out of chicken mid-shift.

## Dependency — hard blocker
Requires the **full** `impl-08-inventory.md` build (recipe-based auto-deplete, suppliers, purchase orders) — confirmed only 25% built as of the 2026-08-27 audit (basic stock tracker only, no recipes/suppliers/POs). **This agent cannot be built until impl-08's remaining 75% is complete.** Do not attempt a partial version against the current basic tracker — there's no recipe/depletion data for it to reason over yet.

## Data Model — New Table

```sql
CREATE TABLE agent_replenishment_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  ingredient_id UUID NOT NULL REFERENCES ingredients(id),
  suggested_quantity NUMERIC(12,3) NOT NULL,
  reasoning TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','dismissed','ordered')),
  purchase_order_id UUID REFERENCES purchase_orders(id), -- populated once approved and converted
  created_at TIMESTAMPTZ DEFAULT now()
);
```

## API Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/agents/replenishment/run` | POST | Internal/cron-triggered | Scan ingredient stock/velocity, generate suggestions |
| `/api/agents/replenishment/suggestions` | GET | Authenticated (owner/manager) | List pending suggestions |
| `/api/agents/replenishment/suggestions/:id/approve` | POST | Authenticated (owner/manager) | Convert a suggestion into a real purchase order |

## Step-by-Step Implementation

1. **Migration:** Add `agent_replenishment_suggestions`.
2. **Service — `server/src/services/replenishment-agent.js` (new):**
   - `computeVelocity(ingredientId, lookbackDays)` — sum how much of an ingredient was consumed (via the recipe-based auto-deplete logging that `impl-08` establishes) over the lookback window, to get an average daily usage rate.
   - `suggestReplenishment(ingredientId)` — given current stock, `low_stock_threshold`, and computed velocity, estimate days-until-stockout. If that falls under a configurable buffer (e.g. 3 days), suggest a purchase quantity (e.g. enough for 7-14 days of typical usage, rounded to sensible supplier order quantities if that data exists). Use Qwen to phrase the reasoning clearly ("Chicken usage has averaged 12kg/day this week; at 8kg remaining, you'll run out in under a day — suggesting a 40kg order from [supplier]").
   - `runReplenishmentScan(tenantId)` — loop over the tenant's ingredients, call `suggestReplenishment` for any that need it, insert into `agent_replenishment_suggestions` (avoid duplicate open suggestions for the same ingredient — check for an existing pending one first).
3. **Route — `server/src/routes/agents.js` (extend):**
   - `POST /replenishment/run` — cron-secret-protected, same pattern as prior agents.
   - `GET /suggestions` — tenant-scoped list.
   - `POST /suggestions/:id/approve` — converts the suggestion into an actual draft `purchase_orders`/`purchase_order_items` row (reusing `impl-08`'s existing PO creation logic, not duplicating it), linking back via `purchase_order_id`, marking the suggestion `approved`.
4. **Frontend — extend the Inventory admin page (built as part of impl-08):** a "Suggested Reorders" panel showing pending suggestions with one-click approve (which pre-fills a draft PO for the owner to review/send, rather than auto-ordering without any human step — see owner-control note below).
5. **Owner control:** This agent should default to **suggest-only, never auto-order** — creating a real purchase commitment (money, supplier relationship) is a meaningfully different risk level than a WhatsApp message (impl-15) or a rider assignment (impl-16). Do not build an "auto-approve" mode for this agent in this pass; every suggestion requires an explicit human approval step before becoming a real PO.

## Verification Steps
1. Simulate an ingredient depleting toward its threshold (via test orders that trigger auto-deplete, per impl-08), run the agent, confirm a sensible suggestion is generated with a reasonable quantity and a clear, accurate reasoning statement.
2. Confirm an ingredient with ample stock relative to its velocity does NOT generate a suggestion.
3. Run the scan twice without approving the first suggestion, confirm no duplicate pending suggestion is created for the same ingredient.
4. Approve a suggestion, confirm it correctly creates a draft purchase order via the existing impl-08 PO flow, and the suggestion's status updates to `approved`.
5. Confirm no path in this implementation auto-creates a purchase order without an explicit approval action.

## Explicitly out of scope for this file
- Automatic PO sending to suppliers without human approval (approval creates a draft only; sending remains a manual `impl-08` action)
- Multi-supplier price comparison/optimization (uses whatever supplier is already associated with the ingredient in impl-08's data)
