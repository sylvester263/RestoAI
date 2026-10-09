# Implementation 33 — POS-Only Plan, Module Gating, Offline Mode (Level 1) & FBR Hook

Status: **spec, not built.** Written 2026-10-09. Items marked **DECISION** need the founder's call; items marked **CONFIRM** are facts that must be verified before building.

## Why
About 20 restaurants asked for a POS only. Local competitor POS pricing is about Rs. 3,000/month (founder floated Rs. 2,500). The existing multi-tenant stack can serve this without a fork, by adding a server-enforced module layer (the same idea as `impl-32`'s Agent Pack flag, generalized).

## Part 0 — Fix four POS bugs first (blocking for a POS-only product)
A POS-only buyer sees nothing else, so these defects become the whole product.
1. **Items can be added with no shift open.** Server must reject `POST /api/pos/tabs/:id/items` and tab-open when the branch has no open shift (403 with a clear message). UI shows "Open a shift to start selling."
2. **Settle window stays open behind the receipt.** After a successful settle, close the settle modal, then show the receipt.
3. **Staff dashboard shows "Failed to load dashboard."** Staff role must get a staff-appropriate dashboard (or a redirect to POS) and no failing owner-only calls. Staff opening Coupons should see a "no permission" message, not "No coupons yet."
4. **No staff list or removal.** The Staff page lists only invites. Add: list of existing staff accounts, deactivate/remove, reset PIN. Deactivation must invalidate that user's tokens server-side.

Verify each with a staff-role login, not only owner.

## Part 1 — Module gating (`tenant_modules`)

```sql
CREATE TABLE tenant_modules (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  module VARCHAR(40) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (tenant_id, module)
);
```

Modules: `pos`, `kitchen`, `menu`, `whatsapp_ordering`, `delivery_riders`, `reservations`, `inventory`, `loyalty_crm`, `insights`, `ai_agents`, `website_builder`.

Plan presets (applied on tenant create or plan change; super admin can override per tenant):
- **POS Only:** `pos`, `kitchen`, `menu`, basic reports. Everything else off.
- **Starter / Growth / Enterprise:** existing tiers, all modules per current plan rules; `ai_agents` follows the Agent Pack flag from `impl-32`.

Enforcement (server-side only; the UI hiding items is cosmetic):
- `requireModule('name')` middleware, mounted **after** `authenticate` and the suspension check on every route belonging to a module. Disabled module returns 403 `{ error: 'module_disabled', module }`.
- `tenant_id` comes from the JWT, never from the request. Module state is read server-side per request, with a short in-memory cache (30–60 s) invalidated on super-admin change.
- Scheduled agents and cron jobs skip tenants where the module is off, and the WhatsApp webhook ignores a gated tenant's ordering flow cleanly (no crash, no billing of AI tokens).
- Super admin gets a per-tenant module toggle UI and an audit-log entry on each change (reuse `impl-29` audit middleware).
- Client reads `GET /api/me/modules` to render nav; unknown or failed response defaults to hiding gated items, not showing them.

Upgrade path: switching POS Only to Starter just flips presets. No data migration.

## Part 2 — Pricing (recommendation, **DECISION**)
- POS Only: **Rs. 3,000/month list, Rs. 2,500/month launch price** (first-year or first-N-customers; set an end condition so launch pricing does not become permanent).
- Per branch? **DECISION:** recommend per branch, same as other tiers.
- Margin note: infrastructure cost per POS-only tenant is small and mostly fixed, but support time is not modeled. At Rs. 2,500, treat it as a funnel into Starter, not a profit line. Re-run `RestoAI-Unit-Economics.xlsx` with a POS-only tenant row before committing. All figures are estimates.
- Payment via the `impl-32` bank-transfer flow. Add the plan to that flow and to the marketing page pricing.

## Part 3 — FBR e-invoicing hook
**CONFIRM with founder:** "integration with the API" is assumed to mean FBR e-invoicing. If it means an open third-party API for developers, that is out of scope here (see bottom).

- Pakistani POS buyers will ask about FBR. Integration must go through a licensed integrator (PRAL). **CONFIRM** current integrator requirements, fees, and which restaurants are obliged (province/sales-tax regime differs: FBR vs Punjab Revenue Authority for restaurants).
- Build only the seam now, not the integration:
  - Single interface `submitInvoice(bill)` in `server/src/services/fiscal.js`, returning `{ invoiceNumber, qrUrl }` or a typed failure.
  - Columns on settled bills/orders: `fiscal_invoice_number`, `fiscal_qr_code_url`, `fiscal_status` (`not_required|pending|submitted|failed`), `fiscal_error`.
  - Per-tenant setting `fiscal_provider` (`none` default). Receipt template prints the invoice number and QR when present.
  - Failed submissions queue and retry; the sale is never blocked by a fiscal outage.

## Part 4 — Offline mode, Level 1
Level 1 means the POS keeps selling when the internet drops, then syncs. Level 2 (local server in the restaurant) is a separate, months-long project and is **not** in this spec.

Design:
1. **PWA:** service worker caches the POS shell, menu, prices, and table list. Installable on tablet/phone/PC.
2. **Local menu snapshot:** menu and prices refreshed on each online session and every few minutes while online. Show "menu last updated" in the offline banner.
3. **IndexedDB outbox:** every offline sale (open tab, add items, settle, void request) is written as a queued action with a client-generated UUID.
4. **Idempotent server endpoints:** settle/create accept a client UUID (`client_request_id`, unique per tenant). A replay returns the original result and never creates a duplicate order or payment. Use `FOR UPDATE` locking on tab state during settle.
5. **Per-device bill-number ranges:** the server hands each device a block of bill numbers (for example 500 at a time) on login/sync, so offline bills never collide. Show the device range in settings. Gaps are expected and must be documented for audit.
6. **Offline login:** after one successful online login on a device, allow a PIN unlock offline (PIN hash stored locally, rate-limited with lockout). Offline sessions can only do the allowed actions below. Tokens are re-validated at sync; a deactivated staff member's queued actions are flagged, not silently accepted.
7. **Allowed offline actions (**DECISION** to confirm):** open tab, add items, settle cash, print/reprint receipt. **Blocked offline:** discounts above a threshold, voids and refunds without a manager PIN (verify the manager PIN locally against a cached hash, flag for review at sync), card/wallet confirmations, WhatsApp/AI features, menu edits, shift close.
8. **Visible state:** a persistent banner "Offline — N sales waiting to sync", turning to "Syncing…" and then "All synced." Never silent. Per-item sync status in the bills list.
9. **Conflict handling:** if a menu item price or availability changed while offline, keep the price the customer was charged, flag the bill as "price changed while offline." Duplicate or late data is flagged for manager review, never auto-merged.
10. **Shift reconciliation:** shift close requires all queued items synced, or an explicit manager override that records the unsynced count.

Security: the local IndexedDB holds menu data and queued sales only. No tokens with owner or admin scope are ever persisted. Queued payloads are validated and re-priced server-side at sync; the client total is never trusted.

## Part 5 — Printer and cash drawer (investigate before promising)
- **CONFIRM** with the 20 interested restaurants which thermal printers they own (58mm/80mm, USB/Bluetooth/LAN).
- Browser options to evaluate: Web Serial/WebUSB/Web Bluetooth with ESC/POS (works in Chrome/Edge, not Safari/iOS), browser print dialog with a receipt-sized CSS layout (works everywhere, slower, no auto-cut), or a small local print helper.
- Cash drawer usually opens via the printer's RJ11 kick pulse (ESC/POS command), so printer support largely decides drawer support.
- Deliverable of this part: a short findings note and one working printer path, not a hardware matrix.

## Verification
1. Create a POS Only tenant. Confirm every non-POS route returns 403 `module_disabled` with a valid token, and that changing the `tenant_id` in a request does nothing.
2. Confirm agents/cron skip the tenant (check logs in the 03:00–05:59 UTC window) and that WhatsApp webhook traffic for it fails closed.
3. Flip the plan to Starter and confirm modules appear without data loss.
4. Part 0: each bug reproduced before, gone after, tested as staff and as owner.
5. Offline: go offline, make 5 sales, restart the browser, reconnect. Expect 5 orders, no duplicates, no bill-number collisions, correct totals. Kill the connection mid-sync and retry; expect still no duplicates.
6. Offline PIN: wrong PIN lockout works; a deactivated staff member's queued sales are flagged.
7. Fiscal seam: with `fiscal_provider=none`, receipts unchanged; with a stub provider, invoice number and QR print and failures retry without blocking a sale.
8. Use a dedicated dev database for all of this. Do not test against production.

## Out of scope
- Level 2 offline (local server in the restaurant)
- The actual FBR/PRAL integration (only the seam above)
- A payment gateway
- An open third-party developer API
- Native Android/iOS apps
- Add-branch UI (still missing; needed before multi-branch POS buyers)

## Open items summary
| Item | Type |
|---|---|
| "The API" means FBR e-invoicing? | CONFIRM |
| POS Only price, per-branch basis, end of launch price | DECISION |
| Which actions are allowed offline | DECISION |
| FBR/PRA obligations and PRAL integrator terms | CONFIRM |
| Printer models used by the 20 restaurants | CONFIRM |
