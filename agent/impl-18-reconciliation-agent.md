# Implementation 18 — Order/Cash Reconciliation Agent

## Goal
Automatically cross-check orders against payment records and rider cash-collection records, flagging anomalies (an order marked delivered with no matching payment, a COD amount that doesn't match the order total, etc.) so discrepancies surface proactively instead of being discovered during a manual audit.

## Dependency — hard blocker
Requires both `impl-01` (payments — the `payments` table, currently 45% built, COD portion exists) and `impl-05` (riders/cash reconciliation — the `rider_assignments`/`cash_reconciliations` tables). **Do not start this file until both exist.** This agent is a cross-checking layer over data that must already be flowing correctly.

## Data Model — New Table

```sql
CREATE TABLE agent_reconciliation_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  order_id UUID REFERENCES orders(id),
  flag_type VARCHAR(50) NOT NULL, -- e.g. 'missing_payment', 'amount_mismatch', 'unreconciled_cash'
  description TEXT NOT NULL,
  severity VARCHAR(10) NOT NULL CHECK (severity IN ('low','medium','high')),
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','resolved','dismissed')),
  detected_at TIMESTAMPTZ DEFAULT now(),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ
);
CREATE INDEX idx_reconciliation_flags_tenant ON agent_reconciliation_flags(tenant_id);
```

## API Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/agents/reconciliation/run` | POST | Internal/cron-triggered | Run the cross-check across a tenant's recent orders |
| `/api/agents/reconciliation/flags` | GET | Authenticated (owner/manager) | List open flags for review |
| `/api/agents/reconciliation/flags/:id/status` | PUT | Authenticated (owner/manager) | Mark a flag reviewed/resolved/dismissed |

## Step-by-Step Implementation

1. **Migration:** Add `agent_reconciliation_flags`.
2. **Service — `server/src/services/reconciliation-agent.js` (new):**
   - `checkOrder(order)` — for a single delivered/completed order, verify: a `payments` row exists at all (flag `missing_payment` if not); the `payments.amount` matches the order's actual total (flag `amount_mismatch` if not, within a small rounding tolerance); for delivery orders assigned to a rider, that `rider_assignments.cash_collected` is populated and matches the order total for COD orders (flag `unreconciled_cash` if not, once the rider has marked it delivered).
   - `runReconciliation(tenantId, sinceDate)` — pull recently-completed orders (e.g. last 24-48 hours, or since the last successful run — track this similarly to the daily briefing agent's idempotency approach) and run `checkOrder` on each, inserting flags for anything found. Avoid re-flagging the same issue on every run — check for an existing open flag on the same order/type before inserting a duplicate.
   - Use Qwen only for the flag's human-readable `description` (turning the raw mismatch into a clear sentence an owner can understand) — the actual detection logic should be deterministic code (amount comparisons, existence checks), not AI-inferred, since financial discrepancy detection needs to be reliable and auditable, not probabilistic.
3. **Route — `server/src/routes/agents.js` (extend):**
   - `POST /reconciliation/run` — cron-secret-protected, same pattern as impl-14/15. Loop over tenants, run `runReconciliation` for each, same per-tenant error isolation.
   - `GET /flags` — tenant-scoped list of open (and optionally all) flags, sorted by severity/recency.
   - `PUT /flags/:id/status` — staff marks a flag reviewed/resolved/dismissed, recording who and when.
4. **Frontend — new admin page or a tab on an existing relevant page (e.g. within Orders or a new Reconciliation view):** list of flags with severity indicators, order links, and status-update actions.
5. **Scheduling:** Daily cron run, similar to `impl-14`/`impl-15`'s pattern, likely running after end-of-day so a full day's orders have settled.

## Verification Steps
1. Create a test order marked `delivered` with no corresponding `payments` row, run the agent, confirm a `missing_payment` flag is created.
2. Create a payment record with an amount that doesn't match its order's total, run the agent, confirm an `amount_mismatch` flag is created with the correct discrepancy noted.
3. Run the agent twice against the same unresolved issue, confirm it does NOT create a duplicate flag for the same order/type.
4. Mark a flag `resolved`, confirm it no longer appears in the default open-flags view but is still queryable in history.
5. Confirm flag descriptions are clear, specific sentences (not generic templated text) referencing the actual order/amounts involved.

## Explicitly out of scope for this file
- Automatic correction of discrepancies (this agent flags for human review, it does not alter payment/order records itself)
- Fraud scoring or pattern-based abuse detection across multiple orders (see `impl-20` for that concern — this agent is single-order reconciliation only)
