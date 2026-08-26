# RestoAI — Pending Feature Implementation Index

**Purpose:** This file indexes every remaining feature implementation file in this batch. Each linked file is a complete, standalone build spec — read `PROJECT-MASTER.md` first for system context (architecture, existing tables, security patterns already established), then work through these files in the recommended order below.

**Ground rules for every file in this batch** (do not repeat per-file, apply to all):
- Every new table gets `tenant_id` (directly or via join), enforced in code — never trust client input for tenant scoping. This is non-negotiable given the security audit already done on this codebase.
- Every new endpoint follows existing patterns: Zod validation, parameterized queries, `authorize()` role gates where relevant, rate limiting on any AI-calling or public-facing endpoint.
- Reuse existing shared services (`orders.js`, `ai-agent.js`, `whatsapp.js`) rather than duplicating logic — extend them, don't fork them.
- After implementing each file, report back: which parts were built, which endpoints/flows were verified live (not just code review), and any deviation from the spec because actual file/table structure differed from what's assumed here.

---

## Build Order & Dependencies

| # | File | Depends on | Est. relative effort |
|---|---|---|---|
| 1 | `impl-01-payments.md` | Existing `orders`/`payments`-adjacent flow (COD) | Medium |
| 2 | `impl-02-dinein-qr.md` | None (independent of payments, but pairs well with it for prepaid dine-in) | Medium |
| 3 | `impl-03-loyalty-reviews-notifications.md` | Orders must exist (they do) | Medium |
| 4 | `impl-04-pos-system.md` | Dine-in table sessions (#2) for dine-in POS mode | Large |
| 5 | `impl-05-riders-delivery.md` | Orders (exists) | Medium |
| 6 | `impl-06-reservations.md` | None | Small-Medium |
| 7 | `impl-07-broadcasts-marketing.md` | Existing WhatsApp send capability (exists) | Small-Medium |
| 8 | `impl-08-inventory.md` | Menu items (exist) | Large |
| 9 | `impl-09-token-menu-boards.md` | Orders (exists) | Small |
| 10 | `impl-10-crm-rbac.md` | Customers (exist), Orders (exist) | Medium |

**Reality check, stated once:** items 4, 5, 8, and 10 are substantial builds — each is comparable in scope to the entire customer-app Phase 1-2 work already shipped. If the Sept 4 deadline still applies, treat 1-3 and 6-7 as realistic to attempt, and 4/5/8/10 as what you hand Claude Code to work on in parallel/afterward, not sequentially before the demo. This is stated once here, not repeated per file — proceed as instructed.

---

## Files in this batch
1. Payments (JazzCash/EasyPaisa/Card gateway)
2. Dine-in QR ordering + table sessions + bill splitting
3. Loyalty, reviews, push notifications, in-app AI assistant widget
4. Multi-branch POS (counter + dine-in, split tabs, settle bills)
5. Riders/delivery management + cash reconciliation
6. Reservations & table booking
7. WhatsApp broadcast/marketing campaigns
8. Inventory management (recipes, suppliers, purchase orders)
9. Order-ready token board + digital menu board (in-store displays)
10. Customer CRM & segments + granular staff permissions (RBAC)
