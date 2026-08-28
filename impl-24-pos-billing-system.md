# Implementation 24 — Complete POS Billing System (extends impl-04)

## Goal
Extend the already-verified core POS (open tab → add items → settle, confirmed working 2026-08-28) into a genuinely complete restaurant billing system: proper itemized receipts with tax, split-tender payments, void/refund with an audit trail, shift/cash-drawer management with end-of-day reconciliation, hold/park orders, table transfer, receipt branding, and an explicit (not-yet-connected) hook for Pakistan's FBR e-invoicing requirement.

## Dependency
Requires `impl-04-pos-system.md` (confirmed built and verified live 2026-08-28). This file extends `pos_tabs` and its settlement flow — it does not replace them.

## What "complete" means here, scoped honestly
A full commercial POS (Square, Toast, etc.) has years of hardware-integration depth (card readers, cash drawers with physical kick-triggers, network printers). This spec targets **software-complete**: everything a restaurant needs to correctly bill, tax, print, void, refund, and reconcile a day's cash — using a standard receipt printer and existing web hardware APIs where possible, without assuming specialized POS hardware beyond a printer.

## 1. Data Model — New/Extended Tables

```sql
-- Tax configuration — Pakistan restaurant sales tax is PROVINCIAL, not federal
-- (Punjab Revenue Authority, Sindh Revenue Board, KPRA, BRA each set their own rate)
CREATE TABLE tax_config (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  tax_authority VARCHAR(10) NOT NULL, -- 'PRA','SRB','KPRA','BRA', or 'NONE'
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0, -- percentage, e.g. 16.00
  tax_registration_number VARCHAR(50), -- NTN/STRN, printed on receipts
  PRIMARY KEY (branch_id)
);

-- Split-tender payments — one tab can be paid across multiple methods
CREATE TABLE pos_tab_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pos_tab_id UUID NOT NULL REFERENCES pos_tabs(id),
  method VARCHAR(20) NOT NULL CHECK (method IN ('cash','card','jazzcash','easypaisa')),
  amount NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Void/refund audit trail
CREATE TABLE pos_voids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  pos_tab_id UUID REFERENCES pos_tabs(id),
  order_id UUID REFERENCES orders(id), -- for post-settlement refunds
  type VARCHAR(10) NOT NULL CHECK (type IN ('void','refund')),
  amount NUMERIC(10,2) NOT NULL,
  reason TEXT NOT NULL,
  authorized_by UUID NOT NULL REFERENCES users(id), -- requires manager/owner role
  requested_by UUID REFERENCES users(id), -- the cashier who initiated it, if different
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Cash drawer / shift management
CREATE TABLE pos_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  opened_by UUID NOT NULL REFERENCES users(id),
  opening_cash_float NUMERIC(10,2) NOT NULL,
  closed_by UUID REFERENCES users(id),
  closing_cash_counted NUMERIC(10,2),
  closing_cash_expected NUMERIC(10,2), -- computed at close time
  variance NUMERIC(10,2), -- counted - expected
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_at TIMESTAMPTZ DEFAULT now(),
  closed_at TIMESTAMPTZ
);

ALTER TABLE pos_tabs ADD COLUMN pos_shift_id UUID REFERENCES pos_shifts(id);
ALTER TABLE pos_tabs ADD COLUMN status VARCHAR(20) DEFAULT 'open'; -- extend existing enum: add 'held'
```

## 2. API Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/pos/shifts/open` | POST | Authenticated (staff) | Start a shift with an opening cash float |
| `/api/pos/shifts/:id/close` | POST | Authenticated (staff) | Close shift, enter counted cash, compute variance |
| `/api/pos/shifts/:id/z-report` | GET | Authenticated | End-of-day summary: sales by method, category, void/refund totals |
| `/api/pos/tabs/:id/hold` | POST | Authenticated | Park an open tab without settling |
| `/api/pos/tabs/:id/resume` | POST | Authenticated | Resume a held tab |
| `/api/pos/tabs/:id/transfer` | POST | Authenticated | Move a dine-in tab to a different table |
| `/api/pos/tabs/:id/void-item` | POST | Authenticated | Void a line item before settlement (reason required) |
| `/api/pos/orders/:id/refund` | POST | Authenticated (manager/owner) | Full or partial refund after settlement |
| `/api/pos/tabs/:id/settle` | POST (extend existing) | Authenticated | Now accepts an array of `{method, amount}` for split-tender, computes tax, generates a receipt |
| `/api/pos/receipts/:orderId` | GET | Authenticated | Fetch print-ready receipt data (itemized, tax breakdown, branding) |

## 3. Step-by-Step Implementation

### Tax handling
1. **Migration:** Add `tax_config`. Seed a sensible default (or `NONE`/0% until the owner configures it — do not silently assume a tax rate).
2. **Settlement logic (extend `orders.js`/POS settlement):** compute tax as `subtotal_after_discount * tax_rate`, store it as a distinct line (not folded silently into the total) so receipts can show subtotal/tax/total separately, matching how a real Pakistani restaurant bill is expected to look.
3. **Admin UI:** simple settings page (or a section within existing Branches settings) for an owner to set their branch's tax authority and rate — this varies by province and by whether the restaurant is even registered, so make it clearly optional/configurable, never hardcoded to one province's rate.

### Split-tender payments
4. **Migration:** Add `pos_tab_payments`.
5. **Settle endpoint (extend existing):** accept an array of payments instead of a single method; validate the sum equals the tab total (within rounding tolerance) before committing; insert one `pos_tab_payments` row per method, and still create the existing `payments` table row for the order (sum of the split, method recorded as the primary/first for backward compatibility with existing payment reporting — or extend the `payments` table's reporting queries to be aware of `pos_tab_payments` for POS-channel orders specifically).
6. **POS UI (`POS.jsx`, extend):** settlement screen supports adding multiple payment lines (e.g. "Rs. 1000 cash + Rs. 500 card") with a running "remaining balance" indicator until it reaches zero.

### Void/refund with audit trail
7. **Migration:** Add `pos_voids`.
8. **Void endpoint:** removes/zeroes a line item on an unsettled tab, requires a reason, logs to `pos_voids` with `type='void'`. Apply the same RBAC pattern already proven for discounts (impl-04's `discounts.apply` permission check) — voiding should require the same or a comparably gated permission, not be open to every cashier by default.
9. **Refund endpoint:** for a settled order, create a `pos_voids` row with `type='refund'`, `authorized_by` must be manager/owner role (hard requirement, not just a permission flag — refunds are money leaving the business, treat this at least as strictly as the existing discount gate), update the linked `payments` row status, and if a payment gateway is ever connected (currently COD-only per `PROJECT-MASTER.md`), this is where an actual gateway refund call would go — for now, record the refund as a bookkeeping entry only, since there's no live gateway to call.
10. **POS/Orders UI:** show void/refund history per order, with reason and who authorized it, so this is auditable by the owner later.

### Shift / cash drawer management
11. **Migration:** Add `pos_shifts`, link `pos_tabs.pos_shift_id`.
12. **Open shift:** cashier enters an opening cash float at the start of a shift; every subsequent POS tab created during that session links to the open shift.
13. **Close shift + Z-report:** cashier enters counted cash; the system computes `closing_cash_expected` (opening float + cash-method sales from `pos_tab_payments` during the shift, minus any cash refunds), computes `variance`, and generates a Z-report: total sales by payment method, by category, discount total, void/refund total, and the cash variance — surfaced as a printable/viewable summary, not just a database row.
14. **POS UI:** a clear "shift" indicator always visible while using POS (who's on shift, since when), with open/close actions gated appropriately (any staff can open/close their own shift; an owner/manager view can see all shifts across the branch).

### Hold/park orders, table transfer
15. **Hold/resume:** a tab can be marked `status='held'` instead of proceeding to settlement (e.g. customer stepped away) — held tabs appear in a distinct "Parked" section of the POS UI, resumable by any staff member on the current shift.
16. **Table transfer:** for dine-in tabs, allow moving `table_session_id` to a different table (e.g. a party asks to move) — update the link, keep all existing order history attached to the same session.

### Receipts
17. **Receipt data endpoint:** `GET /api/pos/receipts/:orderId` returns everything needed to render/print a receipt: restaurant name/branch address/tax registration number (from `tax_config`), itemized lines, subtotal, discount, tax breakdown, total, payment method(s), a short branded footer message, and — if `impl-11`'s landing page or `impl-12`'s coupon system are in play — a QR code linking to a review/feedback page as a nice-to-have addition.
18. **Printing:** implement browser-native printing (`window.print()` with a dedicated print stylesheet formatted for common thermal receipt widths, e.g. 80mm) as the baseline — this works with any printer the OS can print to, no special hardware integration needed. If actual ESC/POS thermal printer support (direct ticket printing via USB/Bluetooth/network without the OS print dialog) is wanted later, that's a distinct, more hardware-specific effort — scope it separately if pursued, don't block this pass on it.

### FBR e-invoicing — hook only, not implementation
19. **Do not attempt to build a direct FBR integration.** Pakistani law requires this integration to go through a licensed integrator (PRAL or another FBR-licensed software integrator) — building your own connection would not be legally compliant even if technically possible. Instead: design the receipt/invoice data model (already covered by step 17) to be **complete enough to hand to a licensed integrator's API later** (itemized lines, tax breakdown, tax registration number, timestamp, unique invoice number) — add an `fbr_invoice_number` and `fbr_qr_code_url` nullable column to the relevant order/receipt table now, left unpopulated, so the schema doesn't need a breaking change whenever an actual integrator partnership happens. Flag this clearly as a pitch-worthy roadmap item ("FBR-compliant e-invoicing, pending a licensed integrator partnership") — it's a genuine, current, checkable regulatory fact, not a vague future promise.

## Verification Steps
1. Configure a branch's tax rate, settle a tab, confirm the receipt shows subtotal/discount/tax/total as distinct, correctly computed lines.
2. Settle a tab with a split payment (part cash, part card), confirm the sum validation rejects a mismatched total and accepts a correct one, and both `pos_tab_payments` rows are created correctly.
3. Void a line item before settlement as a permitted role, confirm it's removed from the total and logged with a reason; attempt the same as a non-permitted role, confirm it's rejected.
4. Refund a settled order as a manager/owner, confirm the audit trail records who authorized it and why; attempt the same as a lower-privilege account, confirm it's rejected.
5. Open a shift with a cash float, run several cash and card sales, close the shift, confirm the Z-report's expected-cash calculation matches a manually-tallied total, and that entering a different counted amount produces the correct variance.
6. Hold a tab, confirm it disappears from the active tab list and appears in "Parked," resume it, confirm all previously-added items are intact.
7. Transfer a dine-in tab to a different table, confirm order history stays attached to the same session and Kitchen display reflects the new table number.
8. Print a receipt (browser print dialog), confirm the layout is legible at an 80mm-equivalent width and includes all required fields (branch name, tax registration number if configured, itemized lines, totals, payment method).

## Explicitly out of scope for this file
- Actual FBR e-invoicing API integration (requires a licensed integrator partnership — schema hook only, per step 19)
- Direct ESC/POS thermal printer protocol support (browser print dialog only for this pass)
- Physical cash drawer hardware triggering (no drawer-kick hardware integration — this is software-side shift tracking only)
- Multi-currency (not needed, Pakistan-only per existing project scope)
