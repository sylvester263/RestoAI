# Implementation 04 — Multi-Branch POS (Counter + Dine-in, Split Tabs, Settle Bills)

## Goal
Give staff a counter/POS interface to take walk-in and phone orders directly (not through WhatsApp or the public app), handle dine-in orders with tab management, apply discounts, and settle bills — a third order-entry channel alongside WhatsApp and the public web app, all feeding the same Kitchen display and Insights.

## Dependency
Requires `table_sessions` from `impl-02-dinein-qr.md` for the dine-in half of POS (a staff-entered dine-in order should be able to attach to an existing table session opened by a customer QR scan, or open one itself for walk-ins who didn't scan).

## Data Model — New Table

```sql
CREATE TABLE pos_tabs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  table_session_id UUID REFERENCES table_sessions(id),
  order_type VARCHAR(20) NOT NULL CHECK (order_type IN ('counter','dine_in','phone')),
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','settled','voided')),
  opened_by UUID REFERENCES users(id),
  discount_amount NUMERIC(10,2) DEFAULT 0,
  discount_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  settled_at TIMESTAMPTZ
);
CREATE INDEX idx_pos_tabs_branch ON pos_tabs(branch_id);
```

`orders` created via POS link to a `pos_tabs.id` the same way dine-in orders link to `table_sessions.id` — add a nullable `pos_tab_id UUID REFERENCES pos_tabs(id)` column to `orders` via migration. `channel` on `orders` (already used to distinguish `web` from WhatsApp per the customer app build) gets a new value `pos`.

## API Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/pos/tabs` | POST | Authenticated (staff, branch-scoped) | Open a new tab (counter/dine-in/phone) |
| `/api/pos/tabs/:id/items` | POST | Authenticated | Add items to an open tab |
| `/api/pos/tabs/:id/discount` | POST | Authenticated (role-gated — see RBAC note) | Apply a discount to a tab |
| `/api/pos/tabs/:id/settle` | POST | Authenticated | Settle/close a tab, create the final order + payment record |
| `/api/pos/tabs` | GET | Authenticated | List open tabs for the branch (the POS "floor view") |

## Step-by-Step Implementation

1. **Migrations:** Add `pos_tabs` table, `orders.pos_tab_id` column, extend `orders.channel` CHECK constraint to include `'pos'`.
2. **Backend — `server/src/routes/pos.js` (new):**
   - `POST /tabs` — staff opens a tab; for `dine_in` type, either attach to an existing open `table_sessions` row (if the table already has a customer-scanned session) or create one; for `counter`/`phone`, no table session needed.
   - `POST /tabs/:id/items` — add menu items to the tab (builds toward the eventual order — store as an in-progress cart-like structure, or create the `orders`/`order_items` rows immediately with a "tab open" status and allow appending; pick whichever matches how `orders.js`'s existing order-creation function is structured, to reuse it rather than fork it).
   - `POST /tabs/:id/discount` — apply a flat or percentage discount; require an `authorize()` role check (managers/owners only, not general cashier staff — this ties into `impl-10-crm-rbac.md`'s granular permissions; if that hasn't been built yet, gate on the existing owner/manager roles as an interim).
   - `POST /tabs/:id/settle` — finalize: compute total (items - discount), create/finalize the `orders` row (`channel='pos'`), create a `payments` row (reuse `impl-01-payments.md`'s table — POS settlement is a payment method selection too: cash/card/JazzCash/EasyPaisa at the counter), mark `pos_tabs.status='settled'`.
3. **Frontend — new admin section `client/src/pages/pos/POS.jsx`:**
   - A touch-friendly "floor view": list of open tabs (counter/dine-in/phone), each showing running total and elapsed time.
   - Tab detail view: add items (search/browse menu, same data as `PublicMenu.jsx` but staff-facing), apply discount, settle with payment method selection.
   - Keep this visually distinct from the existing Orders/Kitchen pages — POS is an active work surface for staff during a shift, not a reporting view.
4. **Kitchen integration:** POS-created orders must appear in the existing Kitchen display exactly like WhatsApp/web orders — no special-casing in `Kitchen.jsx` beyond what's needed to show `channel='pos'` if you want to visually distinguish order source (optional, low priority).
5. **Reporting:** Ensure Insights (`insights.js`) correctly includes `channel='pos'` orders in revenue/order-count aggregates — audit any hardcoded channel filters and generalize them.

## Verification Steps
1. Open a counter tab, add items, settle with cash — confirm an `orders` row (`channel='pos'`) and a `payments` row (`method` reflecting what was selected at settlement) are created correctly.
2. Open a dine-in tab attached to an existing table session (created via customer QR scan) — confirm both the customer's app view and the POS tab reflect the same session/orders.
3. Apply a discount as a manager-role account — confirm it's applied correctly to the settled total. Attempt the same as a lower-privilege staff account (if RBAC from impl-10 exists) — confirm it's rejected.
4. Confirm POS-created orders appear in Kitchen display identically to other channels.
5. Confirm Insights dashboard revenue totals correctly include POS-channel orders alongside WhatsApp/web.

## Explicitly out of scope for this file
- Hardware integration (receipt printers, cash drawers, card readers) — this spec covers the software/data layer only
- Offline mode (POS working without connectivity) — assume online-only for this build
