# Implementation 28 — Owner WhatsApp Business Assistant

## Goal
Let the restaurant owner text their own WhatsApp number and ask anything about their business — sales, inventory, what needs attention, how a branch is doing — and get a real, data-grounded answer, any time, not just via a scheduled daily briefing or an in-dashboard widget. This is the natural extension of `impl-14`'s one-way daily briefing into a full two-way conversational assistant, and it makes the product's WhatsApp-first identity apply to the owner's own experience of running the business, not just customer ordering.

## Dependency
Reuses `ai-agent.js`'s `generateInsights` (the same engine behind `POST /api/insights/query`), the existing WhatsApp send/receive pipeline, and the agent flag/suggestion data already produced by `impl-18` (reconciliation), `impl-19` (replenishment), `impl-20` (menu insight), `impl-21` (abuse detection). `impl-14`'s daily briefing becomes the proactive half of this same assistant conceptually — this file adds the reactive, on-demand half.

## Critical design decision — distinguishing owner messages from customer messages
The existing WhatsApp pipeline treats every inbound message as a customer conversation (order/recommendation/reservation/support intent). This assistant requires a **new routing check before intent classification**: if the inbound phone number matches a verified `users.phone` for that tenant (owner or manager role), route to the business-assistant handler instead of the customer pipeline entirely — never let the two paths blend. This must be resolved by a verified database lookup (phone → user, scoped to the tenant that owns the WhatsApp number the message arrived on, same phone_number_id-based tenant routing already fixed in the original webhook security audit) — never inferred from message content or trusted from anything client-supplied.

## Data Model
No new core tables — this reads existing data (orders, payments, agent flag tables) and reuses `agent_briefing_log`'s idempotency pattern where relevant. One addition:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20); -- if not already present — confirm first, don't duplicate
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_phone ON users(tenant_id, phone) WHERE phone IS NOT NULL;
```

## API / Message Flow (no new public REST endpoints — this lives inside the WhatsApp webhook handler)

| Flow point | Behavior |
|---|---|
| Inbound WhatsApp message | Webhook handler checks: does the sending phone match a `users.phone` for the tenant that owns this WhatsApp number? |
| If yes (owner/manager) | Route to `business-assistant-agent.js`, NOT the customer order pipeline |
| If no | Existing customer pipeline (order/recommendation/reservation/support per `impl-27`) handles it, unchanged |

## Step-by-Step Implementation

1. **Migration:** Add `users.phone` if not already present (check first — the rider system already has a distinct phone-based lookup pattern to reference, but riders and staff/owner users are structurally separate per `impl-23`, don't conflate the two).
2. **Webhook routing check (extend `whatsapp.js` webhook handler, very first step before any existing intent classification):** resolve the incoming `phone_number_id` to a tenant (already correctly done per the original security audit), then check if the sender's phone matches a `users.phone` for that tenant with `owner` or `manager` role. If matched, hand off entirely to the new business-assistant handler.
3. **Service — `server/src/services/business-assistant-agent.js` (new):**
   - `handleOwnerMessage(tenantId, userId, message)` — classify the owner's message into: a data question (routes to `generateInsights`, the same NL-to-grounded-answer engine already built), a request for "what needs attention" (queries the same flag/suggestion tables `impl-18`/`impl-19`/`impl-20`/`impl-21` already populate, summarizes conversationally), or a general capability question ("what can you do") — answer from a fixed, accurate description of real capabilities, never invented ones.
   - Reuse `generateInsights` directly for data questions — do not reimplement NL-to-SQL a second time. The only new work here is the WhatsApp conversational wrapper and the "what needs attention" aggregation across the 4 agent flag/suggestion tables.
   - Keep responses WhatsApp-appropriate: short, plain text, no markdown — matching the style already established for the daily briefing agent's output.
4. **"What needs attention" aggregation:** a single function that queries open rows from `agent_reconciliation_flags`, `agent_abuse_flags`, `agent_replenishment_suggestions`, and `agent_menu_insights` (all tenant-scoped) and produces one coherent WhatsApp-style summary — this is the same data Tier 2's dashboard "needs attention" section (if built) would show, just delivered conversationally instead of visually. Keep the underlying query logic in one shared place if both surfaces end up existing, rather than two independent implementations of the same aggregation.
5. **Rate limiting:** apply the same rate-limiting discipline already required on AI-calling endpoints — an owner texting rapidly shouldn't be blocked under normal use, but this still calls a paid AI API per message and needs a sane per-owner cap (e.g. generous, like 60/hour, mainly to catch a runaway loop or accidental spam rather than normal usage).
6. **Multi-branch owners:** if the owner manages multiple branches, a data question without a specified branch defaults to tenant-wide (matching how the existing dashboard/insights already default) — the owner can ask "how's the Gulberg branch doing" to scope down, reusing whatever branch-name-resolution logic exists elsewhere (or a simple name match against `branches.name` for this tenant).
7. **Security boundary — this is important, not optional:** a manager-role owner-assistant conversation should be scoped by the same branch-access rules as `impl-25`'s branch analytics, if that's been built (a manager shouldn't get tenant-wide answers via WhatsApp that they'd be blocked from seeing in the dashboard) — the WhatsApp channel must not become a bypass around access controls enforced everywhere else.

## Verification Steps
1. Message the tenant's WhatsApp number from a verified owner phone with a data question ("what were yesterday's sales"), confirm a correct, real-data-grounded answer.
2. Message the same number from a phone NOT registered as an owner/staff — confirm it's routed to the normal customer pipeline (order/support/etc.), not the business assistant, even if the message content looks similar.
3. Ask "what needs my attention" with at least one open flag/suggestion seeded in each of the 4 agent tables, confirm all 4 are correctly summarized.
4. As a manager (if branch-access scoping exists per impl-25), confirm a WhatsApp data question is correctly scoped to their assigned branch(es) only — not tenant-wide.
5. Confirm rate limiting engages only under actual abuse-level message volume, not normal owner usage.
6. Confirm no response ever contains fabricated data — every number in a reply should be traceable to an actual query result.

## Explicitly out of scope for this file
- Voice messages (text only, matching the rest of the WhatsApp pipeline's current scope)
- Owner-initiated actions via WhatsApp (e.g. "apply a 10% discount to table 3") — this agent answers questions and surfaces information, it does not execute consequential actions conversationally; anything action-oriented still goes through the dashboard/POS UI
- Multi-owner tenants with different access levels beyond the existing owner/manager distinction
