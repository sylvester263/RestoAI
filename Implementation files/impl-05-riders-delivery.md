# Implementation 05 — Riders, Delivery Tracking & Cash Reconciliation

## Goal
Let staff assign a delivery order to a rider, track delivery status, and reconcile cash-on-delivery collections per rider at end of shift.

## Data Model — New Tables

```sql
CREATE TABLE riders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_riders_branch ON riders(branch_id);

CREATE TABLE rider_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  order_id UUID NOT NULL REFERENCES orders(id) UNIQUE,
  rider_id UUID NOT NULL REFERENCES riders(id),
  assigned_at TIMESTAMPTZ DEFAULT now(),
  picked_up_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  cash_collected NUMERIC(10,2),
  cash_reconciled BOOLEAN DEFAULT false
);
CREATE INDEX idx_rider_assignments_rider ON rider_assignments(rider_id);

CREATE TABLE cash_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  rider_id UUID NOT NULL REFERENCES riders(id),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  total_expected NUMERIC(10,2) NOT NULL,
  total_collected NUMERIC(10,2) NOT NULL,
  variance NUMERIC(10,2) NOT NULL,
  reconciled_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

## API Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/riders` | GET/POST/PUT | Authenticated (owner/manager) | Manage rider roster |
| `/api/riders/:id/assignments` | GET | Authenticated | A rider's current/past deliveries |
| `/api/orders/:id/assign-rider` | POST | Authenticated (staff) | Assign a delivery order to a rider |
| `/api/orders/:id/delivery-status` | POST | Authenticated (staff, or rider if rider-facing view is built) | Update picked_up/delivered timestamps |
| `/api/riders/:id/reconcile` | POST | Authenticated (owner/manager) | Close out cash reconciliation for a rider over a period |

## Step-by-Step Implementation

1. **Migrations:** Add `riders`, `rider_assignments`, `cash_reconciliations` tables.
2. **Backend — `server/src/routes/riders.js` (new):** Standard CRUD for riders, plus:
   - `POST /orders/:id/assign-rider` — creates a `rider_assignments` row linking the order to a rider; suggest "nearest rider" logic can be a simple "riders with the fewest currently-active assignments" heuristic rather than real GPS-based nearest-rider matching (no location tracking infrastructure exists yet — don't build real-time GPS tracking for this pass).
   - `POST /orders/:id/delivery-status` — sets `picked_up_at`/`delivered_at`; on `delivered_at` being set for a COD order, also set `cash_collected` = order total (assume full collection unless told otherwise) and trigger the existing order-status-change flow (WhatsApp/push notification) to fire `delivered`.
   - `POST /riders/:id/reconcile` — for a given date range, sum all `rider_assignments.cash_collected` for that rider where `cash_reconciled=false`, compare against `total_expected` (sum of order totals for COD deliveries in the period), record any `variance`, mark those assignments `cash_reconciled=true`.
3. **Frontend — extend admin:** Add a "Riders" section (new page or a tab within the existing Branches/Orders area): roster management, an assignment view showing unassigned delivery orders with a one-tap "assign to [rider]" action, and a reconciliation view showing per-rider cash-in-hand totals with a "reconcile" action.
4. **Order flow integration:** When an order's `order_type` is delivery (not pickup/dine-in) and status reaches `confirmed`/`preparing`, surface it in the "unassigned deliveries" list for staff to assign a rider — this is a filtered view of existing orders joined against `rider_assignments`, not a new order state machine.
5. **Rider-facing view (optional, lower priority):** If time allows, a minimal rider-facing page (could reuse the phone-gated public pattern — rider logs in via phone number) showing their assigned deliveries and a "mark delivered" action, rather than requiring staff to update status on the rider's behalf. Treat this as a stretch addition, not required for the core feature.

## Verification Steps
1. Create a rider, assign them to a delivery order, confirm the assignment appears correctly linked.
2. Update delivery status through picked_up → delivered, confirm the order's own status updates in sync and the existing WhatsApp/push delivered notification fires.
3. Confirm `cash_collected` is populated for a COD order on delivery.
4. Run reconciliation for a rider over a date range, confirm the expected/collected/variance math is correct against manually-tallied test data.
5. Confirm already-reconciled assignments are excluded from a second reconciliation run for the same period (no double-counting).

## Explicitly out of scope for this file
- Real-time GPS rider tracking
- Rider payroll/commission calculation
