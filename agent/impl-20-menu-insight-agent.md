# Implementation 20 — Menu/Pricing Insight Agent

## Goal
Analyze sales velocity and food-cost margin per menu item to proactively recommend actions — feature a high-margin/high-velocity item, reconsider pricing on a low-margin one, flag a slow-moving item for possible removal — surfaced to the owner rather than requiring them to dig through the Insights dashboard and draw conclusions themselves.

## Dependency — hard blocker
Requires food-cost margin data, which requires `impl-08`'s recipe/ingredient-cost system (currently only 25% built, no recipes/costs exist). **Cannot produce meaningful margin-based recommendations until that data exists.** A velocity-only version (ignoring margin) could technically run against existing order data sooner, but would only be able to say "this sells a lot / this doesn't," not "this is profitable / this isn't" — decide whether a margin-blind interim version is worth building, or wait for impl-08 to be complete; recommend waiting, since margin is the actually valuable half of this agent's insight.

## Data Model — New Table

```sql
CREATE TABLE agent_menu_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  menu_item_id UUID NOT NULL REFERENCES menu_items(id),
  insight_type VARCHAR(30) NOT NULL, -- 'feature_candidate', 'pricing_review', 'low_velocity', 'low_margin'
  recommendation TEXT NOT NULL,
  supporting_data JSONB NOT NULL, -- the actual numbers behind the recommendation, for transparency
  status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new','acknowledged','acted_on','dismissed')),
  generated_at TIMESTAMPTZ DEFAULT now()
);
```

## API Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/agents/menu-insights/run` | POST | Internal/cron-triggered (weekly, not daily — menu trends don't shift hour to hour) | Generate this period's menu insights |
| `/api/agents/menu-insights` | GET | Authenticated (owner/manager) | List current insights |
| `/api/agents/menu-insights/:id/status` | PUT | Authenticated | Mark acknowledged/acted-on/dismissed |

## Step-by-Step Implementation

1. **Migration:** Add `agent_menu_insights`.
2. **Service — `server/src/services/menu-insight-agent.js` (new):**
   - `computeItemMetrics(menuItemId, periodDays)` — order count/velocity over the period, revenue contribution, and (once impl-08 exists) computed margin per unit (`price - recipe ingredient cost`) and total margin contribution.
   - `classifyItem(metrics)` — deterministic rules, not AI-guessed: high velocity + high margin → `feature_candidate`; high velocity + low/negative margin → `pricing_review`; low velocity regardless of margin → `low_velocity`; acceptable velocity but thin margin → `low_margin`. Keep the actual classification thresholds as code, not AI inference — reliability matters more than cleverness here, same principle as impl-18's reconciliation agent.
   - Use Qwen only to phrase the `recommendation` text clearly from the classified metrics ("Chicken Karahi sells well and carries a strong margin — consider featuring it more prominently on the menu board and in WhatsApp recommendations") — not to do the classification itself.
   - `runMenuInsightScan(tenantId)` — loop over active menu items, compute metrics, classify, generate a recommendation for anything that clears a "worth mentioning" bar (don't generate an insight for every single item every week — only ones with a clear signal), insert into `agent_menu_insights`.
3. **Route — `server/src/routes/agents.js` (extend):** standard cron-triggered run + owner-facing list/status-update endpoints, same shape as prior agents.
4. **Frontend — extend the existing Insights dashboard:** a new section/card listing current menu insights with their supporting numbers visible (not just the AI's conclusion — show the actual velocity/margin figures so the owner can verify the reasoning, not just trust it blindly).
5. **Tie-in to other agents (optional, if both exist):** a `feature_candidate` insight could feed into the WhatsApp recommendation agent's weighting (already built, per `ai-agent.js`'s existing recommendation logic) — surfacing featured items more often. Treat this as a nice-to-have integration, not required for this file's core scope.

## Verification Steps
1. With test order data showing one item selling frequently and (once impl-08 exists) at a healthy margin, run the agent, confirm it's correctly classified as `feature_candidate` with accurate supporting numbers.
2. With an item selling rarely, confirm it's classified `low_velocity`.
3. Confirm the classification logic is deterministic — running the scan twice on unchanged data produces the same classifications, not different ones (since it's rule-based, not AI-guessed).
4. Confirm the recommendation text is specific and references real numbers, not generic template language.
5. Confirm items that don't clear the "worth mentioning" bar don't generate noise insights every single run.

## Explicitly out of scope for this file
- Automatic price changes (this agent recommends, an owner manually updates pricing via the existing Menu admin page)
- A/B testing menu positioning
