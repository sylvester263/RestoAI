# Implementation 14 — Daily Briefing Agent

## Goal
The first genuinely agentic (proactive, not on-demand) capability in the product: every morning, automatically generate and WhatsApp the tenant owner a plain-language summary of yesterday's business — without anyone asking a question. This is the cheapest agent to build in the whole roster because it reuses existing infrastructure almost entirely.

## Dependency
None beyond what's already built (`ai-agent.js` insights logic, WhatsApp send capability). Does not require any Tier 2 feature.

## Data Model — New Table (minimal, for idempotency tracking)

```sql
CREATE TABLE agent_briefing_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  briefing_date DATE NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT now(),
  content TEXT NOT NULL,
  UNIQUE(tenant_id, briefing_date)
);
```

The `UNIQUE(tenant_id, briefing_date)` constraint is the idempotency mechanism — a second attempt to send the same day's briefing for the same tenant will fail the insert, which is the desired behavior (catch the conflict, skip silently rather than erroring the whole run).

## API Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/agents/daily-briefing/run` | POST | Internal/cron-triggered (see auth note below) | Generate and send today's briefings for all active tenants |

**Auth note:** since this is triggered by Vercel Cron (or whatever scheduling mechanism is confirmed available), it isn't user-authenticated in the normal JWT sense. Protect it with a shared secret header (e.g. `X-Cron-Secret`, compared against an env var) so it can't be triggered by an arbitrary public request — this is the same class of concern as protecting any internal-only endpoint, follow whatever pattern (if any) already exists in this codebase for non-user-triggered endpoints, or establish this as the pattern if none exists yet.

## Step-by-Step Implementation

1. **Migration:** Add `agent_briefing_log`.
2. **Service — `server/src/services/daily-briefing-agent.js` (new):**
   - `generateBriefingForTenant(tenantId)` — builds a fixed internal prompt (see example below) and calls the *same* underlying Qwen function that `POST /api/insights/query` already uses (do not write a second AI integration path). Returns the generated text.
   - Example prompt: *"Summarize yesterday's business performance for this restaurant: total orders, revenue, any low-stock inventory alerts, any customers who haven't ordered in 20+ days, and anything unusual worth flagging. Keep it to 4-6 short lines in a WhatsApp-message style — no markdown, no headers, just plain conversational text a busy owner can read in 10 seconds."*
   - `sendBriefingForTenant(tenantId)` — calls `generateBriefingForTenant`, sends the result via the existing WhatsApp send function to the tenant's registered owner phone number, and inserts into `agent_briefing_log` (catch the unique-constraint conflict as "already sent today," not as an error).
3. **Route — `server/src/routes/agents.js` (new):**
   - `POST /daily-briefing/run` — verify the cron secret header, then loop over all active tenants (query `tenants` table, whatever "active" means in the existing schema — e.g. not soft-deleted), call `sendBriefingForTenant` for each. **Wrap each tenant's attempt in its own try/catch** — one tenant's failure (bad phone number, AI error, etc.) must never block the rest of the loop. Collect and return a summary (`{sent: N, skipped: N, failed: N}`) in the response for observability.
4. **Scheduling:** Add a `vercel.json` cron entry calling this endpoint once daily at a sensible time (e.g. 8:00 AM — but confirm the deployment's timezone handling, Vercel Cron runs in UTC by default, so adjust the schedule expression accordingly for Pakistan Standard Time). Confirm Vercel Cron is available on the current plan before finalizing — if not available, fall back to whatever scheduling mechanism the environment actually supports and note the deviation.
5. **Manual trigger option (useful for demo purposes):** Since waiting for the actual cron time isn't practical for testing/demoing, ensure the same endpoint can be manually triggered (with the cron secret) at any time — this doubles as your demo mechanism ("watch, I can trigger the AI's daily briefing right now") without needing a second code path.

## Verification Steps
1. Manually trigger the endpoint (not waiting for the scheduled time), confirm a real WhatsApp message (or console log in demo mode) is sent with genuinely tenant-specific content — actual order counts/revenue for that tenant, not generic text.
2. If more than one tenant exists in the environment, trigger for both and confirm no cross-tenant data leakage in either generated summary (tenant A's briefing never mentions tenant B's numbers).
3. Trigger the endpoint twice in immediate succession — confirm the second call does NOT send a duplicate message (idempotency via the unique constraint working as intended).
4. Simulate a failure for one tenant (e.g. temporarily break its phone number format) and confirm other tenants' briefings still send successfully — the loop must not halt on one failure.
5. Confirm the endpoint rejects a request without the correct cron secret header.

## Explicitly out of scope for this file
- Owner-configurable briefing time or content preferences (fixed schedule/prompt for this pass)
- Weekly/monthly rollup briefings (daily only)
