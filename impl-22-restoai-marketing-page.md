# Implementation 22 (v2) — RestoAI Marketing Landing Page — Complete Recreation

## Why this is a full recreation, not a patch
The original version of this file was written before the system reached its current state. Since then: the agent count grew from 8 to 10 (Customer Support and Owner's WhatsApp Assistant both built and live-verified), POS grew into a full billing system, branch analytics, coupons + a full referral program, and CRM/RFM segmentation all went from unbuilt to code-confirmed, and pricing moved from a single flat number to a size-tiered model (this file's other major change, Section 4). The old version's feature grid and pricing section are both materially wrong now — this replaces it wholesale rather than patching pieces.

## Goal
RestoAI's own public sales page — where a restaurant owner first encounters the product. Not to be confused with `impl-11`, which builds a page *for each restaurant's own customers*. This page sells RestoAI itself, and is the entry point into onboarding (`impl-23`).

## Dependency
Links into `impl-23`'s owner signup/login flow. Showcases (via screenshots/description, doesn't rebuild) `impl-11`'s per-restaurant landing pages as a feature. Does not surface `impl-29`'s super admin panel anywhere — that's an internal tool, never linked from public marketing.

---

## 1. Page Structure

1. **Header** — logo, nav (Features / Pricing), consolidated "Log in" (owner/staff, one form per `impl-23`), "Rider login" (separate), "Start free" primary CTA. *(Unchanged from the prior consolidation decision — still correct.)*

2. **Hero** — commission-escape headline + subheadline, primary CTA, paired with a **static image** of a real product screenshot (per the earlier decision to drop the 3D hero — a real WhatsApp conversation screenshot in a phone frame, CSS tilt + shadow, no WebGL).

3. **`01` Ordering — every channel, one system** — real screenshots: WhatsApp AI conversation, public menu/checkout, dine-in QR ordering.

4. **`02` Your AI Team — THE SECTION THAT WAS MISSING/STALE, rebuild in full**
   - Four-tab framing (same pattern proven in the pitch deck, reuse it here for consistency across both surfaces):
     - **Ask Anything** — natural-language Q&A over real order/sales/inventory data
     - **10 Autonomous Agents** *(not 8 — this is the number that must be correct)* — daily briefings, win-back, dispatch, ETA, reconciliation, replenishment, menu insight, abuse detection, **plus customer support and the owner's own WhatsApp business assistant**
     - **Always Watching** — reconciliation and abuse-detection flagging anomalies proactively
     - **One Data Model** — every channel shares the same orders, menu, customers
   - **Below the tabs, a "meet your team" strip — all 10 agents, name + one-line description each** (reuse the exact copy from the pitch deck's agent grid for consistency — do not write new descriptions that could drift from what's actually built):
     1. Customer Support — escalates complaints to a human, never auto-resolves
     2. Owner's Assistant — answers business questions on the owner's own WhatsApp
     3. Daily Briefing — proactive WhatsApp summary, every morning
     4. Win-Back — detects lapsed customers, sends personalized offers
     5. Rider Dispatch — reasons over load, suggests or auto-assigns
     6. Live ETA — dynamic prep-time from the real kitchen queue
     7. Reconciliation — cross-checks orders, payments and cash, flags only
     8. Replenishment — predicts stockouts, suggests purchase orders
     9. Menu Insight — flags high-margin items to feature, low performers to review
     10. Abuse Detection — flags suspicious patterns, never auto-blocks
   - Callout: "Not a chatbot. RestoAI holds a real conversation, corrects mid-order, and confirms before it commits" — positioned against menu-flow bots (Bitecast, most WhatsApp-ordering tools).

5. **`03` Run Your Whole Operation** — screenshots: POS billing (a tab mid-settlement, showing tax/split-tender), Kitchen display, Inventory (recipe/stock view).

6. **`04` Know Your Business** — screenshot of branch-level analytics — comparison view across branches, not just single-branch KPIs, since that's `impl-25`'s actual differentiator over a single-location dashboard.

7. **`05` Grow Your Customers** — screenshots: Customers/CRM page (showing RFM segment labels — Champions, About to Sleep, etc., since that's a genuinely distinctive built capability), Coupons page (showing the referral program, not just flat discount codes), Campaigns page.

8. **`06` Your Own Website** — a real published tenant landing page (from `impl-11`) as a screenshot — this is the section that makes "escape Foodpanda" tangible, since it shows the actual alternative digital presence a restaurant gets.

9. **One System, Every Role** — Owner/Staff/Rider explanation, conceptual, no screenshots.

10. **Pricing — completely new section, see Section 4 below.**

11. **No testimonials** — no real customers yet. Substitute: the market-research "why this exists" block (Foodpanda's 25-35% commission, the 2020 boycott, the 2021 CCP inquiry, the FBR compliance note) as credibility content instead of fabricated social proof. *(Unchanged rule — still correct, still non-negotiable.)*

12. **Final CTA + footer.**

---

## 2. What changed in the built feature set since this file was last accurate
Everything below is now `✅ Built` per `PROJECT-MASTER.md` and should appear in the feature sections above — none of it existed or was confirmed when this page was first specced:
- Full POS billing (tax, split-tender, void/refund, shifts, receipts) — not just basic POS
- Branch-level analytics and cross-branch benchmarking
- Coupons **and** a full referral program (not just flat discount codes)
- CRM with RFM segmentation and granular RBAC
- Customer Support Agent (new)
- Owner's WhatsApp Business Assistant (new)
- Agent count: **10, not 8**

---

## 3. Screenshots
Real, current captures only — reuse the existing `demo-*.png`/`step*.png` files already captured for the presentation (gitignored, on disk) where they cover the same screens; capture fresh ones only for anything not already covered (the RFM segment labels in Customers.jsx, the referral program in Coupons.jsx, and a published `impl-11` tenant site, since none of those were part of the original screenshot set). Do not recreate mockups for anything a real screenshot can show.

---

## 4. Pricing — Size-Tiered Model (new; replaces the old flat-rate placeholder)

### Design rationale
The original recommendation (Rs. 8,000-15,000/branch/month, flat) was a reasonable starting anchor but doesn't reflect how this category actually prices at scale — Toast, Square, and Petpooja all effectively price differently by account size, and a single independent restaurant has a very different willingness-to-pay than a 10-branch chain. Three tiers, split by restaurant size, matching how the person actually described the need: solo restaurants pay less, multi-branch pays differently, large chains pay differently again.

### Proposed tiers

| Tier | Who it's for | Price | What's included |
|---|---|---|---|
| **Starter** | Solo restaurant, single branch | **Rs. 8,000/month flat** | WhatsApp AI ordering, public ordering website, dine-in QR, reservations, loyalty & reviews, basic inventory, POS billing, 1 landing page site |
| **Growth** | 2–5 branches | **Rs. 7,000/branch/month** *(volume discount vs. Starter's effective rate — e.g. ~Rs. 21,000/month for 3 branches)* | Everything in Starter, **plus**: branch-level analytics & benchmarking, CRM + RFM segmentation, coupons & referral program, broadcast campaigns, multi-branch staff RBAC |
| **Enterprise** | 6+ branches / large chains | **Custom — "Let's talk"** | Everything in Growth, **plus**: dedicated onboarding, priority support, volume-based discount beyond Growth's rate, early access to FBR e-invoicing once the licensed-integrator partnership exists |

**Positioning line, tying back to the core pitch:** "Starter costs less than one Foodpanda commission on a single weekend order rush — then it's free, every month, forever."

### Important constraint — carried forward from every prior pricing discussion in this project
**These numbers are a recommendation with real market research behind them (Petpooja's $50/location, Toast/Square's ranges, local on-premise software pricing) — they are not an owner-confirmed final decision.** Do not treat this table as final pricing to launch with. Build the pricing section's structure, copy, and tier logic exactly as specified, but the actual numbers need explicit sign-off before this goes live to real visitors — same rule that has applied to every pricing mention in this project so far.

### Implementation notes
- This is a **marketing-page-only** feature for this file — it does not require new backend logic. The actual tier a tenant is on, and enforcement of what that tier unlocks, is `impl-29`'s `tenants.subscription_plan` field's job, not this page's. This page just displays the tiers and their CTAs ("Start free" for Starter/Growth, "Contact us" for Enterprise leading to the existing contact form from the original spec).
- If a tenant signs up via the "Growth" or "Enterprise" tier CTA, capture that intent (which plan they clicked) and pass it through to the signup flow so `impl-23`'s onboarding and `impl-29`'s eventual `subscription_plan` field can be pre-filled — don't just discard which tier they chose.

---

## 5. Step-by-Step Implementation
1. Rebuild the "Your AI Team" section (Section 1, item 4) — the 4-tab framing plus the full 10-agent strip. This is the single most important content fix in this file.
2. Update every feature-grid/screenshot section to reflect the newly-built capabilities listed in Section 2 — cross-check against `PROJECT-MASTER.md`'s Section 2 table before finalizing copy, since that's the source of truth for what's honestly claimable.
3. Build the new 3-tier pricing section (Section 4) — structure and copy as specified, numbers clearly styled as current-best-recommendation (not hidden, but not presented with false finality either — e.g. avoid language like "final pricing" anywhere).
4. Wire tier-selection intent through to the signup flow per Section 4's implementation note.
5. Capture the handful of new screenshots identified in Section 3 that aren't already covered by the existing presentation screenshot set.
6. Everything else (header, hero treatment, no-testimonials rule, footer) carries forward unchanged from the prior version of this spec — do not re-litigate those decisions.

## Verification Steps
1. Load the page, confirm the "Your AI Team" section shows all 10 agents correctly, not 8 — this is the one item most likely to regress silently if copied from an older source.
2. Confirm every feature claim on the page (POS billing, branch analytics, coupons/referral, CRM/RFM) matches something actually marked built in `PROJECT-MASTER.md` — cross-check each one explicitly, don't assume.
3. Confirm the pricing section displays all 3 tiers correctly, with Starter's flat price and Growth's per-branch price both rendering clearly (test Growth's price at a couple of different branch counts if the page does any dynamic calculation).
4. Click each tier's CTA, confirm the selected tier's intent carries through into the signup/contact flow correctly.
5. Confirm no fabricated statistics or testimonials exist anywhere on the page.
6. Mobile viewport check — this is still the primary access pattern for the target market.

## Explicitly out of scope
- Dynamic/configurable pricing display driven by a backend (this page's pricing table is static marketing content; `impl-29` owns actual per-tenant billing state)
- A live "calculate your price" interactive branch-count slider — a static 3-tier table is sufficient for this pass; add an interactive calculator later only if there's a clear need
- Server-side rendering / full SEO optimization (already deferred in the original spec, still deferred)
