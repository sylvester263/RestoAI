# Implementation 32 — Bank Transfer Payments & Verification

## Goal
Since a payment gateway isn't being integrated yet, this gives restaurant owners a real way to subscribe and pay today — submit a bank transfer with proof, and have it verified by a human on the super admin side — while giving the super admin panel real financial-operations capability it currently lacks. This directly extends `impl-29` (which deliberately scoped payment handling out) and `impl-22` v2 (whose pricing section this spec makes actionable rather than just informational).

## Part 1 — The plan structure this needs to support

Per the latest pricing decision, a tenant's subscription now has **two independent dimensions**, not one:
1. **Branch tier** — Starter (flat) / Growth (per-branch) / Enterprise (custom)
2. **AI Agent Pack** — on or off. Included free at Growth and above; a genuine optional add-on at Starter.

The core WhatsApp AI ordering agent is never gated — it's included at every tier regardless of Agent Pack status. Only the other 9 agents (win-back, reconciliation, replenishment, menu insight, abuse detection, customer support, owner's assistant, daily briefing, rider dispatch, ETA) are controlled by the Agent Pack flag.

## Part 2 — Data Model

```sql
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ai_agent_pack_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE payment_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  claimed_plan VARCHAR(50) NOT NULL, -- 'starter','growth','enterprise'
  claimed_branch_count INTEGER,
  claimed_agent_pack BOOLEAN NOT NULL DEFAULT false,
  claimed_amount NUMERIC(10,2) NOT NULL,
  bank_reference_number VARCHAR(100) NOT NULL, -- what the owner enters as proof
  receipt_image_url TEXT, -- optional uploaded screenshot of the transfer
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by UUID REFERENCES super_admins(id),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  submitted_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_payment_submissions_status ON payment_submissions(status);
CREATE INDEX idx_payment_submissions_tenant ON payment_submissions(tenant_id);
```

## Part 3 — Owner-Facing Flow (new, in the signup and/or account settings)

1. **Plan selection.** Owner picks a branch tier and toggles the AI Agent Pack (only shown as a real choice at Starter — pre-checked and non-optional at Growth/Enterprise, matching the "included free" decision). The page computes and displays the real monthly amount.
2. **Bank transfer instructions.** Show RestoAI's actual bank account details (account title, number, bank name — real values to be supplied, not placeholder) and the exact amount to transfer.
3. **Submission form.** Owner enters the bank reference/transaction number from their transfer, and optionally uploads a screenshot of the transfer receipt. Submitting creates a `payment_submissions` row with `status='pending'`.
4. **Pending state.** The owner's account shows "Payment pending verification" — not yet active, not blocked from browsing the admin UI, but agent/premium features stay off until approved. Set a reasonable trial/grace window if one is desired (not required for this pass — flag as a decision point, don't build a specific grace period without confirming the number).
5. **Confirmation on approval/rejection.** Send a WhatsApp message to the owner (reusing the existing send pipeline) when their submission is reviewed — approved with a welcome/active confirmation, or rejected with the stated reason and an easy way to resubmit.

## Part 4 — Super Admin Side (the "make it more powerful" piece)

This is the core new super-admin capability, added to `impl-29`'s existing panel:

### New page: Payment Verification Queue
- Default landing view alongside the existing expiring-subscriptions dashboard (both are "needs attention now" views — consider a combined "Needs Action" summary at the very top of the super admin home showing counts of both).
- Lists every `pending` submission: tenant name, claimed plan + branch count + Agent Pack status, claimed amount, bank reference number, receipt image (viewable inline), submitted timestamp.
- **Approve action:** sets `payment_submissions.status='approved'`, `reviewed_by`, `reviewed_at`; updates the tenant's `subscription_status='active'`, `subscription_plan`, `ai_agent_pack_enabled`, and `subscription_period_end` (extend by one billing period from now, or from the current period end if renewing early). All of this in one transaction, not separate manual steps.
- **Reject action:** requires a reason (mandatory text field, same discipline as every other manual action in `impl-29`), sets status and reason, leaves the tenant's subscription state untouched (still pending/inactive) rather than actively suspending — a rejected submission isn't automatically a suspension, since the owner may just need to fix and resubmit.
- Every action logs to the existing `super_admin_audit_log`, same pattern as every other action in this panel — this is not a separate code path, it reuses the audit middleware already built.

### New page (or section): Revenue Overview
Now that real payment records exist, a genuinely simple, real view of them is worth having:
- Total active subscriptions by tier (count)
- How many have the Agent Pack enabled
- Total approved payment amount for the current month (a real, if basic, MRR-adjacent number — not a full analytics suite, just the sum of what's actually been verified)
- This is intentionally small — full MRR/churn analytics remain deferred exactly as `impl-29` originally scoped them; this is just "can a platform operator see real money that's come in," which is a different, much smaller thing.

### Tenant detail view — extend to show plan clearly
Since a tenant's plan is now two-dimensional (branch tier + Agent Pack), the existing tenant detail view (from `impl-29`) needs to show both clearly, and allow a super admin to manually toggle `ai_agent_pack_enabled` directly (for support cases — e.g. comping a restaurant the Agent Pack temporarily) separately from the payment-approval flow, with the same mandatory-reason-plus-audit-log discipline as every other manual override in this panel.

## Part 5 — Marketing Page Update (`impl-22`)

- Pricing section rebuilt to show the two-dimensional structure clearly: three tier cards as before, with the AI Agent Pack shown as an explicit add-on line under Starter specifically ("+ Rs. X/month — unlock the full 10-agent automation system"), and "Included" shown under Growth and Enterprise instead of a price.
- The "Start free" / tier CTAs now lead into Part 3's real flow (plan selection → bank transfer instructions → submission), not just a signup form — this is the "complete flow" requested. Carry the selected tier and Agent Pack toggle through from the marketing page into this flow, same principle as the original `impl-22` spec's instruction not to discard tier-selection intent.

## Step-by-Step Implementation
1. Migration: `tenants.ai_agent_pack_enabled`, `payment_submissions` table.
2. Build the owner-facing plan-selection + bank-transfer-instructions + submission form (Part 3).
3. Wire the WhatsApp confirmation messages for approval/rejection.
4. Build the super-admin Payment Verification Queue (Part 4), reusing existing audit-log middleware.
5. Build the small Revenue Overview view.
6. Extend the tenant detail view for the two-dimensional plan display and manual Agent Pack toggle.
7. Update the marketing page's pricing section and CTA flow (Part 5).
8. Gate the 9 non-ordering agents' actual execution on `tenants.ai_agent_pack_enabled` — confirm this check exists wherever agents currently run (likely needs its own small check in each agent's entry point or a shared guard) — the core WhatsApp ordering agent must NOT be gated by this flag anywhere.

## Verification Steps
1. Complete the owner-facing flow end to end: select Starter + Agent Pack on, see the correct computed amount, see real bank details, submit a fake reference number, confirm a `pending` row is created and the owner's UI reflects "pending verification."
2. As super admin, view the Payment Verification Queue, confirm the submission appears with all correct claimed details.
3. Approve it — confirm the tenant's `subscription_status`, `subscription_plan`, `ai_agent_pack_enabled`, and `subscription_period_end` all update correctly in one action, confirm a WhatsApp approval message sends, confirm an audit log entry is created.
4. Submit a second test payment, reject it with a reason — confirm the tenant's subscription stays untouched (not suspended), confirm the rejection message with reason sends, confirm the audit log entry.
5. Confirm the 9 gated agents genuinely don't run for a tenant with `ai_agent_pack_enabled=false`, and genuinely do run once enabled — test at least 2 of the 9 directly (e.g. trigger daily briefing, confirm it's skipped/blocked when disabled).
6. Confirm the core WhatsApp ordering agent works identically regardless of the Agent Pack flag — this must never be gated.
7. Confirm the Revenue Overview shows correct, real totals matching the actual approved submissions in the test data.
8. Confirm the marketing page's pricing section correctly shows the Agent Pack as an add-on line at Starter and "Included" at Growth/Enterprise, and that clicking a tier's CTA carries the selection into the real flow.

## Explicitly out of scope
- Any real payment gateway integration (JazzCash/EasyPaisa/card) — this remains the eventual replacement for this manual flow, not built now
- Full MRR/churn/cohort analytics — Revenue Overview here is intentionally minimal
- Dunning automation / automated payment reminders — still deferred per `impl-29`'s original scope
- Any grace period or trial logic beyond what's explicitly flagged as a decision point in Part 3 — do not invent a specific number without confirmation
