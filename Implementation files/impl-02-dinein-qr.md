# Implementation 02 — Dine-in QR Ordering, Table Sessions & Bill Splitting

## Goal
Let a customer scan a QR code at a physical table, order directly to the kitchen without a waiter, add more items mid-meal, and request/split the bill — all through the existing public ordering app.

## Data Model — New Tables

```sql
CREATE TABLE table_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  table_number VARCHAR(20) NOT NULL,
  qr_code_token VARCHAR(64) UNIQUE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','bill_requested','closed')),
  opened_at TIMESTAMPTZ DEFAULT now(),
  closed_at TIMESTAMPTZ
);
CREATE INDEX idx_table_sessions_tenant ON table_sessions(tenant_id);
CREATE INDEX idx_table_sessions_branch ON table_sessions(branch_id);
CREATE UNIQUE INDEX idx_table_sessions_active ON table_sessions(branch_id, table_number) WHERE status != 'closed';
```

The unique partial index prevents two simultaneously-open sessions on the same physical table.

Extend the existing `orders` table with a nullable `table_session_id UUID REFERENCES table_sessions(id)` column (migration) so dine-in orders link back to their session — this lets one session accumulate multiple order rounds.

## API Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/branches/:id/tables` | GET/POST | Authenticated (owner/manager) | Admin: list/create tables for a branch, generate QR tokens |
| `/api/table-sessions/:qrToken` | GET | Public | Resolve a scanned QR token → open or create a table session, return tenant/branch/menu context |
| `/api/table-sessions/:id/orders` | POST | Public (session-scoped) | Place an order round within an active session |
| `/api/table-sessions/:id/request-bill` | POST | Public (session-scoped) | Customer requests the bill; sets status to `bill_requested` |
| `/api/table-sessions/:id/bill` | GET | Public (session-scoped) | Itemized bill across all order rounds in the session |
| `/api/table-sessions/:id/close` | POST | Authenticated (staff) | Staff closes the session after payment/settlement |

## Step-by-Step Implementation

1. **Migrations:** Add `table_sessions` table and the `orders.table_session_id` column.
2. **Admin — table/QR management:** Extend the existing Branches admin page with a "Tables" section: staff adds table numbers for a branch; on creation, generate a unique `qr_code_token` (random, unguessable string) per table and produce a QR code image encoding a URL like `/table/:qrToken`. Use a QR generation library (e.g. `qrcode` npm package) server-side or client-side — output a downloadable/printable QR image per table.
3. **Public route — QR landing:** `GET /table/:qrToken` (new public route/page) resolves the token to `branch_id`/`tenant_id`, and either opens a new `table_sessions` row (`status='open'`) or joins the existing open session for that table if one already exists (this is what makes multi-phone shared-table ordering work — multiple people scanning the same table's QR join the same session). Land the customer directly in the public menu (`PublicMenu.jsx`) with dine-in context pre-set (no delivery address flow, no payment-first requirement).
4. **Order placement within a session:** Reuse the existing shared `orders.js` service — add support for passing a `table_session_id` so the created order links to the session instead of requiring a delivery address. Multiple orders can be placed against the same open session (each "add more items mid-meal" action is a new order row with the same `table_session_id`).
5. **Kitchen display:** Extend the existing Kitchen view (`Kitchen.jsx`) to show table number for dine-in orders (pull from the linked `table_sessions.table_number`) so kitchen staff know where to send food.
6. **Bill request + itemized bill:** `POST /request-bill` sets session status; `GET /bill` aggregates all orders/order_items linked to the session into a single itemized total (reuse pricing logic already in `orders.js`, don't reimplement).
7. **Bill splitting:** On the bill view, allow the customer(s) to split the total evenly by a number of people, or mark specific order rounds/items as belonging to specific people (simplest version: even split by N; itemized-by-person split can be a stretch goal if time allows — implement even split first).
8. **Session close:** Staff-side action (in admin Orders or a new Tables view) to mark a session `closed` once payment is settled — ties into the Payments implementation (impl-01) if prepaid dine-in is enabled, or is a manual staff action for pay-at-table.
9. **"Call waiter" action:** Simple action button in the dine-in public UI that sends a lightweight notification to staff (could reuse the WhatsApp send capability to notify a staff number, or a simple in-admin-dashboard alert/badge — pick whichever is less build effort given existing infrastructure).

## Verification Steps
1. Generate a table QR from admin, scan/visit the resulting URL, confirm it opens a fresh table session and lands in the correct branch's menu.
2. Place an order through that session, confirm it appears in Kitchen with the correct table number.
3. Visit the same QR URL again from a different browser/session before closing — confirm it joins the *same* open session (not a duplicate), and that a second order round appends to the same session.
4. Request the bill — confirm the itemized total correctly sums all order rounds placed in the session.
5. Test the even-split calculation with at least 2 different "number of people" values.
6. Close the session as staff — confirm a new QR scan on the same table afterward opens a fresh session, not the closed one.
7. Confirm dine-in orders never require a delivery address and are correctly excluded from any "delivery" reporting/filtering that assumes an address exists.

## Explicitly out of scope for this file
- Prepaid-only dine-in enforcement (both pay-at-table and prepaid should remain supported)
- Itemized (non-even) bill splitting — stretch goal only if time allows
