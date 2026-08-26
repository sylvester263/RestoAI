# Implementation 09 — Order-Ready Token Board & Digital Menu Board

## Goal
Two lightweight, always-on-screen displays for in-store use: a token board showing "ready for pickup" order numbers (no need for staff to call out names), and a digital menu board that mirrors the live menu (prices, availability) on an in-store screen.

## Data Model
No new tables required. Both features are read-only display surfaces over existing data (`orders`, `menu_items`). Add a short numeric/alphanumeric `token_number` to `orders` if one doesn't already exist (check existing schema first — if orders have a human-friendly reference already, reuse it rather than adding a duplicate field).

If not present, add via migration:
```sql
ALTER TABLE orders ADD COLUMN token_number VARCHAR(10);
```
Generate a simple sequential or short-random token per order at creation time (e.g. per-branch daily sequence like "A12", resetting each day) — implement in the shared `orders.js` creation logic.

## API Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/branches/:id/token-board` | GET | Public (display-only, no sensitive data) | Orders currently in `ready` status, token numbers only |
| `/api/branches/:id/menu-board` | GET | Public | Live menu (items, prices, availability) for display |

Both are intentionally public/unauthenticated since they're meant to run on an unattended in-store screen — but return **only** what's needed for display (token numbers and status, or menu data) and nothing else (no customer names/phones/order details on the token board — pure token number + status, since this screen is visible to everyone in the restaurant).

## Step-by-Step Implementation

1. **Migration (if needed):** Add `orders.token_number`, generate on order creation.
2. **Backend — extend `orders.js` route or add a small new `display.js` route:**
   - `GET /branches/:id/token-board` — return orders for that branch with status `ready` (or whatever status represents "ready for pickup" in the existing state machine — confirm exact status name against current schema), each with just `token_number` and how long it's been waiting. No auth required, but rate-limit lightly since it's public (prevent scraping/abuse even though the data itself is low-sensitivity).
   - `GET /branches/:id/menu-board` — return the same data the public menu already exposes (reuse the existing public menu endpoint's query logic rather than duplicating it), formatted for a large-screen display rather than a mobile browsing UI.
3. **Frontend — new standalone display pages (not part of the normal admin nav):**
   - `client/src/pages/display/TokenBoard.jsx` — large-text, high-contrast layout showing token numbers grouped as "Ready for Pickup." Poll `/token-board` every few seconds (reuse the existing Kitchen display's polling pattern). Design for a TV/monitor, not a phone — large fonts, minimal chrome, auto-refreshing, no navigation UI needed since this runs unattended.
   - `client/src/pages/display/MenuBoard.jsx` — similarly large-format, showing categories/items/prices/Urdu names, auto-refreshing on a longer interval (menu changes far less often than order status — every 30-60s is plenty, no need for the same frequency as the token board).
   - Both pages should be reachable via a direct URL (e.g. `/display/token-board/:branchId`, `/display/menu-board/:branchId`) intended to be opened once on a dedicated screen and left running — not something a staff member navigates to repeatedly.
4. **Sold-out flagging on menu board:** Reuse the existing `menu_items.availability` flag (already used elsewhere) to show unavailable items grayed out or removed on the menu board, so it stays accurate automatically as staff 86 items during service — no separate sync mechanism needed since it reads live data.

## Verification Steps
1. Advance an order to "ready" status, confirm its token number appears on the token board within the polling interval, and disappears once the order moves past ready (picked up/completed/delivered).
2. Confirm the token board shows no customer-identifying information — token number and wait time only.
3. Mark a menu item unavailable in the admin Menu page, confirm it reflects on the menu board within its refresh interval.
4. Load both display pages on a large screen/TV browser and confirm layout is legible at a distance (large fonts, high contrast) — this is a visual QA step, not just a functional one.
5. Confirm both endpoints are branch-scoped correctly — a branch's token/menu board never shows another branch's data.

## Explicitly out of scope for this file
- Sound alerts on the token board (that's already built for Kitchen display internally — this is customer-facing, sound may not be desired in a dining area, treat as optional/configurable if requested later)
- Multi-branch board rotation (a single screen cycling through multiple branches) — one board = one branch for this pass
