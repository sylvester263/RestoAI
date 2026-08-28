# Implementation 25 — Deeper Branch-Level Analytics

## Goal
Give multi-branch owners real cross-location visibility (side-by-side comparison, drill-down, benchmarking) — and give branch managers a correctly-scoped view of only their own branch. Research validates this as standard practice at scale (Toast's Advanced Restaurant Analytics, Skytab's multi-location BI): side-by-side comparison, drill-down/group-by, and benchmarking against the chain average are the three pillars, not a vague "more charts" ask.

## Dependency and a design reality to confirm first
The 2026-08-27 audit found `permissions.js` currently grants "manager" role **identical permissions to "owner,"** and no `branch_id` filtering exists anywhere in `insights.js` — every query is tenant-wide. This means branch-scoped access isn't a missing filter to bolt on, it's a permission-model decision that hasn't been made yet. **Decide this before writing any query code:** does a manager get hard-locked to their assigned branch's data (cannot see other branches at all), or can they see everything but the UI defaults to their branch (soft scoping)? Recommend hard-locking — a branch manager seeing a sister location's revenue is a real information-boundary an owner would reasonably expect enforced, not just a UI default. This ties directly into `impl-10`'s RBAC work — if that's built, extend its permission model with a `branch_id` scope; if not, this file needs a minimal version of branch-user assignment on its own (see 1.2).

## 1. Data Model

### 1.1 Branch performance is computed from existing data — no new tables needed for the core comparison/drill-down views
Every `orders`, `payments`, `menu_items` row already carries `branch_id` (directly or via join). The work here is query design, not schema design, for most of this feature.

### 1.2 New table — branch access scoping (minimal version, if impl-10's RBAC isn't built yet)
```sql
CREATE TABLE user_branch_access (
  user_id UUID NOT NULL REFERENCES users(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  PRIMARY KEY (user_id, branch_id)
);
```
An owner has implicit access to all branches (no rows needed — check role first). A manager/staff account's visible branches are whatever rows exist here. If `impl-10` is built, this table (or an equivalent) likely already exists as part of its granular permission model — check before creating a duplicate.

### 1.3 Optional — pre-aggregated daily stats (only if live aggregation proves slow at real data volume)
```sql
CREATE TABLE branch_daily_stats (
  branch_id UUID NOT NULL REFERENCES branches(id),
  stat_date DATE NOT NULL,
  order_count INTEGER NOT NULL DEFAULT 0,
  revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  avg_order_value NUMERIC(10,2),
  channel_breakdown JSONB, -- {whatsapp: N, web: N, pos: N, dine_in: N}
  peak_hour SMALLINT,
  PRIMARY KEY (branch_id, stat_date)
);
```
Don't build this in the first pass — start with live queries against `orders`/`payments` directly (simpler, always accurate). Only introduce pre-aggregation if a real performance problem shows up with actual data volume; premature aggregation adds a sync-freshness problem you don't need yet.

## 2. API Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/analytics/branches/compare` | GET | Authenticated, branch-scoped per 1.1's decision | Side-by-side KPIs across all branches the caller can see |
| `/api/analytics/branches/:id` | GET | Authenticated, branch-scoped | Single-branch drill-down: revenue trend, top items, peak hours, channel mix |
| `/api/analytics/branches/:id/benchmark` | GET | Authenticated, branch-scoped | This branch's key metrics vs. the chain-wide average |
| `/api/analytics/branches/:id/staff-performance` | GET | Authenticated (owner/manager) | Per-staff order/sales figures for that branch (ties into POS cashier attribution if `impl-24` shifts are in use) |

## 3. Step-by-Step Implementation

1. **Resolve the branch-scoping decision (Section 1's dependency) before writing queries.** Add `req.user.branchAccess` (an array of branch_ids, or a flag meaning "all") to the auth middleware, computed from `user_branch_access` (or impl-10's equivalent) at login/token-verification time — every query below filters by this, never by a client-supplied branch_id alone.
2. **`GET /branches/compare`:** for each branch the caller can see, compute: revenue (period-selectable — today/week/month), order count, average order value, channel breakdown (WhatsApp/web/POS/dine-in — reuse the `channel` field already on `orders`), and delivery-vs-pickup-vs-dine-in split. Return as a flat comparable array the frontend can render as a table or bar chart — this is the "side-by-side" view research confirms is the most-used multi-location report type.
3. **`GET /branches/:id`:** single-branch deep dive — revenue trend over the selected period (daily buckets for charting), top-selling items (reuse existing menu/order-item join logic, don't duplicate it), peak order hours (group by hour-of-day), channel mix. This is functionally the existing tenant-wide Insights dashboard, scoped to one branch — reuse as much of that query logic as possible rather than writing parallel queries from scratch.
4. **`GET /branches/:id/benchmark`:** compute the same core metrics (revenue, AOV, order count) for every branch the tenant has, then express the requested branch's numbers as "+12% vs. chain average" or "-8% vs. chain average" — this single comparative framing is what research flagged as the actually-actionable output (a raw number means less to an owner than "this branch underperforms the others by X%").
5. **`GET /branches/:id/staff-performance`:** if POS shifts (`impl-24`) are in use, attribute sales to the staff member who processed them (`pos_tabs.opened_by` / `pos_shifts.opened_by`) — total sales, order count, average ticket size per staff member for the period. This is a real, requested capability from the research (MenuSifu specifically calls out staff attendance/performance as a multi-branch metric) but is naturally gated behind POS actually being in active use at a branch — for a branch with no POS activity (WhatsApp/web-only), there's no staff attribution to show, and the endpoint should say so clearly rather than return empty/confusing data.
6. **Frontend — extend the existing Insights/Dashboard page, don't build a parallel app section:** add a branch selector/comparison toggle to the existing dashboard. For an owner: default view is the multi-branch comparison table; clicking a branch drills into its single-branch view. For a manager whose access is locked to one branch: skip the comparison view entirely, land directly on their branch's drill-down (the comparison UI has nothing to show them if they can only see one branch anyway).
7. **Charts:** revenue trend as a line chart, branch comparison as a bar chart, channel mix as a simple breakdown (bar or stacked, not necessarily a pie chart) — match whatever charting library the existing Insights dashboard already uses, don't introduce a second one.

## Verification Steps
1. As an owner, call `/branches/compare`, confirm all branches appear with correct, independently-verifiable numbers (cross-check one branch's total against a manual sum of its orders for the period).
2. As a manager scoped to one branch (via `user_branch_access` or impl-10's equivalent), call the same endpoint, confirm only their branch's data is visible — attempting to request another branch's `:id` drill-down directly should be rejected, not just hidden in the UI.
3. Confirm the benchmark endpoint's percentage comparison is arithmetically correct against manually-computed chain averages.
4. If staff performance is tested: confirm a cashier's attributed sales match their actual processed POS transactions for the period.
5. Confirm a branch with zero POS activity returns a clear "no data" state for staff-performance, not an error or empty confusing table.
6. Confirm switching the time period (today/week/month) recomputes all figures correctly, not just the display labels.

## Explicitly out of scope for this file
- Predictive/forecasting analytics (trend projection, demand forecasting) — this is descriptive/comparative reporting only, not prediction
- Cross-tenant benchmarking (comparing against other RestoAI tenants, like Toast's aggregated-anonymized benchmarking) — single-tenant, cross-branch only
- Pre-aggregated stats table (Section 1.3) unless live-query performance genuinely requires it
