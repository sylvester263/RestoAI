# Implementation 15 — Customer Win-Back Agent

## Goal
Automatically detect customers who've gone quiet (no order in N days), draft a personalized WhatsApp message with a suggested incentive, and send it — without staff having to notice the drop-off themselves or manually build a campaign.

## Dependency
Broadcasts (`impl-07`, built) for the send mechanism. Coupons (`impl-12`) for the incentive — if coupons aren't built yet, this agent can still run with a plain-text offer message (e.g. "come back and get 10% off" honored manually at checkout by staff) as a fallback, see Section 3.

## Data Model — New Table

```sql
CREATE TABLE agent_winback_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  triggered_at TIMESTAMPTZ DEFAULT now(),
  days_since_last_order INTEGER NOT NULL,
  message_sent TEXT NOT NULL,
  coupon_id UUID REFERENCES coupons(id), -- nullable if impl-12 isn't built yet
  UNIQUE(tenant_id, customer_id, triggered_at) -- see note below on re-trigger cadence
);
```

Rethink the uniqueness constraint once the re-trigger cadence is decided (Section 3, step 3) — the goal is preventing the same customer from getting win-back messages every single day once they cross the threshold, not preventing ever re-triggering them.

## API Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/agents/winback/run` | POST | Internal/cron-triggered (same pattern as `impl-14`) | Scan for lapsed customers across all tenants and send win-back messages |
| `/api/agents/winback/preview` | GET | Authenticated (owner/manager) | Owner-facing: see which customers would be targeted right now, before/without auto-sending — useful for trust and for manual review |

## Step-by-Step Implementation

1. **Migration:** Add `agent_winback_log`.
2. **Service — `server/src/services/winback-agent.js` (new):**
   - `findLapsedCustomers(tenantId, thresholdDays)` — query customers whose most recent order is older than `thresholdDays` (default e.g. 20, make it configurable per tenant if a simple settings mechanism exists, otherwise hardcode a sensible default) and who have NOT already received a win-back message in the last `thresholdDays` (avoid re-spamming someone every single cron run once they cross the line).
   - `craftWinbackMessage(customer, tenant)` — use Qwen (reuse the existing `ai-agent.js` client, don't build a separate integration) to generate a short, warm, personalized message referencing the customer's name and, if available, their most-ordered item ("We miss you, Ahmed! Haven't seen you since your last Chicken Karahi order — come back this week and get 10% off with code WELCOME10"). If coupons (`impl-12`) exist, generate a real coupon via that system's creation logic (scoped to that one customer via `usage_limit_per_customer=1`, a short expiry, e.g. 7 days) and reference its actual code. If coupons don't exist yet, generate the message without a real code — a plain "ask staff for a returning-customer discount" framing — and flag this fallback clearly in the log.
   - `sendWinbackToCustomer(tenantId, customer)` — orchestrates the above, sends via the existing WhatsApp send function, logs to `agent_winback_log`.
3. **Route — `server/src/routes/agents.js` (extend from impl-14):**
   - `POST /winback/run` — same cron-secret auth pattern as the daily briefing agent. Loop over all tenants, for each call `findLapsedCustomers` then `sendWinbackToCustomer` for each result, same per-tenant/per-customer error isolation as impl-14 (one failure never blocks the rest).
   - `GET /winback/preview` — owner-facing, calls `findLapsedCustomers` only (no sending), returns the list so an owner can see who *would* be targeted — this builds trust in the automation before/instead of blind auto-sending, and could be the safer default to ship first (preview-only) with auto-send as a toggle the owner explicitly enables.
4. **Owner control:** Add a simple on/off toggle for this agent per tenant (a boolean column on `tenants` or a small settings table, whichever fits existing patterns) — auto-messaging a restaurant's customers on their behalf is exactly the kind of automation an owner should be able to disable, not something forced on silently.
5. **Scheduling:** Same Vercel Cron approach as `impl-14`, likely a less frequent cadence (e.g. weekly rather than daily, since lapsed-customer status doesn't change hour to hour) — confirm a sensible interval rather than reusing the daily briefing's schedule by default.

## Verification Steps
1. Seed/create a test customer whose last order is older than the threshold, run the agent, confirm they receive a personalized message (or it appears correctly in `winback/preview` if running preview-only mode).
2. Confirm a customer who ordered recently (within the threshold) is NOT targeted.
3. Confirm a customer already win-back-messaged within the cooldown window is NOT messaged again on a second run.
4. If coupons exist: confirm the generated coupon code actually works at checkout (single-use, correct discount, correct expiry) — this must be a real, functional code, not just text claiming a discount that doesn't actually apply.
5. Confirm the per-tenant/per-customer toggle correctly excludes an opted-out tenant's customers entirely.
6. Confirm one customer's message-generation failure (e.g. malformed phone number) doesn't block the rest of that tenant's batch, or other tenants.

## Explicitly out of scope for this file
- Multi-tiered win-back strategies (different message/offer at 20 days vs. 60 days) — single threshold for this pass
- A/B testing message variants
