# Implementation 16 — Smart Rider Dispatch Agent

## Goal
Replace the manual "assign to rider" staff click with an agent that reasons over live rider load/status and auto-assigns delivery orders, logging its reasoning — upgrading the base rider system from a static "fewest active assignments" heuristic into something that behaves like a dispatcher, not just a database lookup.

## Dependency — hard blocker
Requires `impl-05-riders-delivery.md` to be built first (the `riders`/`rider_assignments` tables and base assignment endpoints). **Do not start this file until impl-05 is confirmed built** — this is a reasoning layer on top of that system, not a replacement for it.

## Data Model — New Table

```sql
CREATE TABLE agent_dispatch_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  order_id UUID NOT NULL REFERENCES orders(id),
  rider_id UUID NOT NULL REFERENCES riders(id),
  reasoning TEXT NOT NULL, -- the agent's stated justification, for transparency/debugging
  candidates_considered JSONB, -- snapshot of the other riders it evaluated and why they weren't picked
  auto_assigned BOOLEAN DEFAULT true, -- false if a human overrode the suggestion
  created_at TIMESTAMPTZ DEFAULT now()
);
```

## API Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/agents/dispatch/suggest/:orderId` | GET | Authenticated (staff) | Get the agent's rider suggestion for a specific order, without auto-assigning (for a "confirm suggestion" UX) |
| `/api/agents/dispatch/auto-assign` | POST | Internal/triggered on new delivery order | Automatically assign the best-fit rider |

## Step-by-Step Implementation

1. **Migration:** Add `agent_dispatch_log`.
2. **Service — `server/src/services/dispatch-agent.js` (new):**
   - `getAvailableRiders(branchId)` — query `riders` where `status='active'` for the branch, joined with a count of their currently-open (`picked_up_at IS NULL OR delivered_at IS NULL`) `rider_assignments`.
   - `suggestRider(orderId)` — gather the order's delivery address, and for each available rider: current active-order count, and (if any location data exists — likely not, per impl-05's explicit scope, which excludes real GPS tracking) fall back to the existing "fewest active assignments" heuristic as the primary factor. Use Qwen to weigh this into a short natural-language justification rather than just picking the raw minimum — e.g. if two riders are tied on load, the agent can factor in which one most recently completed a delivery (freshness) as a tiebreaker, and explain its choice in plain language. This is intentionally a lightweight reasoning layer, not a routing/logistics optimization system — do not attempt real distance-based routing without actual GPS data, which doesn't exist in this codebase (per impl-05's explicit scope).
   - `autoAssign(orderId)` — calls `suggestRider`, creates the `rider_assignments` row (reusing impl-05's existing assignment logic, don't duplicate it), logs the reasoning to `agent_dispatch_log`.
3. **Route — `server/src/routes/agents.js` (extend):**
   - `GET /dispatch/suggest/:orderId` — returns the suggestion + reasoning without committing it, for a UI that shows staff "the agent suggests Rider X because Y — confirm or pick manually."
   - `POST /dispatch/auto-assign` — triggered automatically when an order transitions to a state that needs a rider (hook into the existing order-status-change logic, same pattern as WhatsApp/push notifications already fire on status change) — no staff action required at all in the default auto-assign mode.
4. **Owner control:** Same principle as `impl-15` — auto-assignment is a real operational decision an owner may want to review rather than fully delegate. Offer both modes: fully automatic (fires on order confirmation) and suggest-only (staff sees the suggestion in the existing riders/orders UI and clicks to confirm). Make this a per-tenant toggle, default to suggest-only until an owner explicitly trusts it enough to enable full auto-assign.
5. **Frontend — extend the Riders admin UI (built as part of impl-05):** show the agent's suggestion inline when assigning a rider manually ("Agent suggests: Rider X — 1 active delivery, most recently free"), and a small reasoning log/history view for transparency.

## Verification Steps
1. With 3+ riders at varying load levels, request a suggestion for a test delivery order, confirm the agent picks a reasonable candidate and the logged reasoning actually reflects real data (not a generic templated string).
2. Confirm the tiebreaker logic behaves sensibly when two riders have identical active-order counts.
3. Test auto-assign mode: place a delivery order, confirm a rider is assigned automatically without any staff click, and the assignment appears correctly in the existing Riders/Orders admin views.
4. Test suggest-only mode: confirm the suggestion appears but no assignment is created until staff confirms.
5. Confirm the per-tenant toggle correctly switches between the two modes.

## Explicitly out of scope for this file
- Real GPS-based distance/routing optimization (no location tracking infrastructure exists — this agent works with load/freshness heuristics only, per impl-05's explicit scope)
- Multi-order batching for one rider (assign one rider per order only, for this pass)
