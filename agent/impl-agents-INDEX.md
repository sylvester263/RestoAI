# RestoAI — Agentic AI Systems Index

**Purpose:** Companion to `impl-00-INDEX.md`, covering the 8 agent specs (impl-14 through impl-21) that emerged from the agentic-AI research pass (see `PROJECT-MASTER.md` Section 4.2). Each is a standalone implementation file in the same format as the rest.

## Shared principles across every agent in this set
- **Reuse, never duplicate** the existing Qwen integration (`ai-agent.js`) — every agent calls into it, none stand up a separate AI client.
- **Deterministic detection, AI-phrased output.** Where an agent classifies/flags something (reconciliation mismatches, menu performance tiers, abuse patterns), the classification logic is plain code with real thresholds — Qwen is used only to turn the result into readable text. This keeps anything consequential auditable rather than probabilistic.
- **Per-tenant error isolation.** Every cron-triggered agent loops over tenants with its own try/catch per tenant — one tenant's failure never blocks another's.
- **Idempotency.** Every scheduled agent has a mechanism (unique constraint, status check, or last-run tracking) preventing duplicate actions if triggered twice.
- **Owner control, tiered by consequence.** Messaging (impl-15) and rider assignment (impl-16) can reasonably default toward automation with an off-switch. Anything that commits money or reputation — purchase orders (impl-19), fraud accusations (impl-21) — **never auto-acts**; it always stops at a human-approval step. This distinction is deliberate, not an oversight — don't "improve" impl-19 or impl-21 into auto-executing later without re-examining that call.
- **Cron-secret auth pattern.** Every `/api/agents/*/run` endpoint is triggered by a scheduler (Vercel Cron or equivalent), not a logged-in user — protect each with a shared-secret header, establish this as a consistent pattern across all of them rather than reinventing it per file.

## Build order and dependencies

| # | File | Depends on | Build cost | Can start now? |
|---|---|---|---|---|
| 14 | `impl-14-daily-briefing-agent.md` | Nothing (reuses existing insights + WhatsApp) | Very low | ✅ Yes |
| 15 | `impl-15-winback-agent.md` | Broadcasts (built); coupons (`impl-12`, not built — has a fallback path without it) | Low | ✅ Yes (degraded without coupons) |
| 17 | `impl-17-eta-agent.md` | Nothing (existing Orders/Kitchen data) | Low-Medium | ✅ Yes |
| 16 | `impl-16-dispatch-agent.md` | Riders (`impl-05`, 0% built) | Medium | ❌ Blocked on impl-05 |
| 18 | `impl-18-reconciliation-agent.md` | Payments (`impl-01`, 45%) + Riders (`impl-05`, 0%) | Medium | ❌ Blocked on impl-05 |
| 20 | `impl-20-menu-insight-agent.md` | Full inventory/food-cost (`impl-08`, 25% — margin data doesn't exist yet) | Medium | ❌ Blocked on impl-08 completion |
| 19 | `impl-19-replenishment-agent.md` | Full inventory (`impl-08`, 25%) | Medium | ❌ Blocked on impl-08 completion |
| 21 | `impl-21-abuse-detection-agent.md` | Order/review checks: nothing. Coupon-abuse check: `impl-12` (0% built) | Low-Medium | 🟡 Partial — order/review checks only until impl-12 exists |

**Practical read given the Sept 4 deadline:** only 14, 15, 17, and the partial version of 21 are actually buildable without first completing another large Tier 2 feature. 16, 18, 19, and 20 are real, well-scoped agents but structurally gated behind riders (impl-05) and full inventory (impl-08) — don't attempt them until those exist, no matter how appealing the agent concept is on its own.
