# Implementation 21 — Fraud/Abuse Detection Agent

## Goal
Flag suspicious patterns for staff review — repeated order-then-cancel from the same phone number, coupon abuse across multiple fake identities, unusual review patterns — without auto-blocking anyone (false positives in fraud detection are costly to a small restaurant's real customer relationships, so this agent flags for human judgment, it never takes action itself).

## Dependency
Partial — the coupon-abuse checks depend on `impl-12-coupons-discounts.md` (currently confirmed 0% built). The order-pattern and review-pattern checks depend only on existing `orders`/`reviews` tables and can be built independently. Build the order/review checks first; add coupon-abuse checks once `impl-12` exists.

## Data Model — New Table

```sql
CREATE TABLE agent_abuse_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  flag_type VARCHAR(30) NOT NULL, -- 'repeat_cancel', 'coupon_abuse', 'review_pattern', 'rapid_reorder'
  customer_id UUID REFERENCES customers(id),
  description TEXT NOT NULL,
  evidence JSONB NOT NULL, -- the actual order/review IDs and pattern data behind the flag
  severity VARCHAR(10) NOT NULL CHECK (severity IN ('low','medium','high')),
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','confirmed','false_positive')),
  detected_at TIMESTAMPTZ DEFAULT now()
);
```

## API Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/agents/abuse-detection/run` | POST | Internal/cron-triggered | Scan for suspicious patterns |
| `/api/agents/abuse-detection/flags` | GET | Authenticated (owner/manager) | List flags for review |
| `/api/agents/abuse-detection/flags/:id/status` | PUT | Authenticated | Mark reviewed/confirmed/false_positive |

## Step-by-Step Implementation

1. **Migration:** Add `agent_abuse_flags`.
2. **Service — `server/src/services/abuse-detection-agent.js` (new):**
   - `checkRepeatCancellation(tenantId, lookbackDays)` — find customers (by phone number, since that's the identity anchor in this stateless-customer system) with an unusually high ratio of cancelled/never-completed orders to total orders within the window (e.g. 3+ cancellations in a short period) — flag `repeat_cancel`.
   - `checkRapidReorderAbuse(tenantId)` — find implausibly rapid repeat orders that might indicate someone testing stolen payment info or gaming a promotion (e.g. many orders in a very short window from the same phone, especially if several are cancelled) — flag `rapid_reorder`.
   - `checkCouponAbuse(tenantId)` — (only once `impl-12` exists) look for patterns like many different-looking customer records redeeming the exact same coupon in a short window from a similar pattern (can't do device/IP fingerprinting without infrastructure that doesn't exist here — keep this simple: flag unusually high redemption velocity on a single coupon relative to its expected usage, for staff to look into, not a definitive fraud claim).
   - `checkReviewPatterns(tenantId)` — (only once reviews exist, per impl-03, already built) flag unusual review clustering — e.g. many 1-star reviews in a short window that might indicate a coordinated issue worth investigating, or many 5-star reviews from accounts with no verified order history if that becomes checkable.
   - Use Qwen only for the flag's human-readable `description` — pattern *detection* should be deterministic threshold-based code (same principle as impl-18/impl-20), not AI-guessed, since false accusations of fraud are reputationally costly.
   - `runAbuseScan(tenantId)` — runs all applicable checks (skip coupon-abuse if impl-12 doesn't exist yet), inserts flags, avoiding duplicates for already-flagged, still-open patterns.
3. **Route — `server/src/routes/agents.js` (extend):** standard cron-triggered run + owner-facing list/status-update, same shape as prior agents.
4. **Frontend — new admin section or extend an existing relevant page:** flag list with severity, evidence detail (the actual orders/reviews behind the flag, so staff can verify rather than just trust the label), and review actions.
5. **Critical constraint — no automatic action:** this agent must never cancel an order, block a customer, revoke a coupon, or take any consequential action on its own. It surfaces evidence for a human to judge. This is a stricter version of the "no silent auto-action" principle already applied to impl-19 (replenishment) — here the cost of a false positive (wrongly flagging a genuine customer) is reputational, not just financial, so the human-in-the-loop requirement is non-negotiable, not just a cautious default.

## Verification Steps
1. Simulate a customer with several cancelled orders in a short window, run the agent, confirm a `repeat_cancel` flag is generated with accurate supporting evidence (real order IDs, real counts).
2. Confirm a customer with a normal order/cancellation ratio does NOT get flagged.
3. Once coupons exist: simulate unusually high redemption velocity on one coupon, confirm a `coupon_abuse` flag is generated.
4. Confirm the agent never modifies, cancels, or blocks anything — only inserts flags for human review (verify by checking no order/customer/coupon records are altered by running the scan).
5. Confirm flag descriptions reference real, checkable evidence, not vague accusations.

## Explicitly out of scope for this file
- Any automatic consequence (blocking, cancelling, revoking) — detection and flagging only, always
- Payment fraud detection at the gateway level (out of scope entirely until impl-01's actual gateway integration exists, and even then this would likely be the gateway provider's own fraud tooling, not something to rebuild here)
