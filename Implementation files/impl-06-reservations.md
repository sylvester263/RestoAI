# Implementation 06 — Reservations & Table Booking

## Goal
Let customers book a table in advance (via the public app or WhatsApp) and let staff view/manage the day's reservations alongside walk-ins.

## Data Model — New Table

```sql
CREATE TABLE reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  customer_name VARCHAR(100) NOT NULL,
  customer_phone VARCHAR(20) NOT NULL,
  party_size SMALLINT NOT NULL,
  reserved_for TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','seated','completed','cancelled','no_show')),
  notes TEXT,
  table_session_id UUID REFERENCES table_sessions(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_reservations_branch_time ON reservations(branch_id, reserved_for);
```

`table_session_id` links a reservation to the eventual dine-in session once the party is seated (nullable until then) — depends on `table_sessions` from `impl-02-dinein-qr.md`; if that hasn't been built yet, make this column nullable and add it as a follow-up migration once dine-in exists, rather than blocking reservations on it.

## API Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/public/:tenantSlug/reservations` | POST | Public | Customer books a table |
| `/api/branches/:id/reservations` | GET | Authenticated (staff) | Day view of reservations for a branch |
| `/api/reservations/:id/status` | PUT | Authenticated (staff) | Update status (seated/completed/cancelled/no_show) |

## Step-by-Step Implementation

1. **Migration:** Add `reservations` table.
2. **Backend — `server/src/routes/reservations.js` (new):**
   - `POST /public/:tenantSlug/reservations` — resolve tenant by slug (never trust client-supplied tenant_id, same pattern as the public menu/order routes), validate `party_size`/`reserved_for` are sensible (e.g. reserved_for is in the future, party_size within a reasonable branch capacity if that's tracked — otherwise just a positive integer), create the reservation with `status='confirmed'`. Send a WhatsApp confirmation to the customer using the existing WhatsApp send capability.
   - `GET /branches/:id/reservations?date=...` — day view, sorted by `reserved_for`, for staff to see at a glance.
   - `PUT /reservations/:id/status` — staff updates status as the day progresses (e.g. `seated` when the party arrives).
3. **Frontend — public booking form:** New page `client/src/pages/public/Reservation.jsx` (or a section within the existing public tenant landing) — simple form: name, phone, party size, date/time picker, optional notes. On submit, show a confirmation screen.
4. **Frontend — admin "day view":** New admin page or a tab within Branches — a simple time-sorted list of the day's reservations with status-update actions, and a way to page to other dates.
5. **WhatsApp integration (optional but recommended given existing infrastructure):** Extend the Qwen agent's intent classification (already distinguishing order vs. recommendation) to recognize a reservation-booking intent conversationally ("book a table for 4 tonight at 8") — reuse the same structured-output/function-calling approach already proven for orders, rather than building a separate parser.
6. **Rate limiting:** Apply the same rate-limiting pattern to the public reservation endpoint (prevent spam bookings) as used elsewhere for public-facing endpoints.

## Verification Steps
1. Submit a reservation via the public form, confirm it appears correctly in the staff day view, and confirm a WhatsApp confirmation is sent.
2. Update a reservation's status through its lifecycle (confirmed → seated → completed), confirm each transition persists correctly.
3. Attempt to book a reservation for a past date/time — confirm it's rejected.
4. If WhatsApp conversational booking was built: send "book a table for 4 tonight at 8" and confirm it's correctly classified as a reservation intent (not an order or recommendation) and creates the reservation.
5. Confirm reservations are correctly tenant/branch-scoped — a reservation for one branch never appears in another branch's day view.

## Explicitly out of scope for this file
- Table capacity/availability enforcement (e.g. preventing double-booking a specific table) — this version tracks reservations as a list, not a capacity-constrained calendar; add capacity logic as a follow-up if needed
- Automated reminder messages before the reservation time
