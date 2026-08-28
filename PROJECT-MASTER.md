# RestoAI — Master Project Specification & Status
**Last updated:** 2026-08-29 (Steps 1-4 of the 4-feature build pass complete) · **Purpose:** Single source of truth for this project's current state, architecture, and roadmap. Load this file instead of re-explaining project history in future agent sessions.

**⚠️ Read this first:** This doc has gone stale mid-session more than once (a pasted draft or parallel edit overwrote a fuller version at least twice). This version is the authoritative consolidation of: the 2026-08-26 security audit, the 2026-08-28 full P0-P3 audit, POS (impl-04) live verification, and the 2026-08-28/29 build pass that added complete POS billing (impl-24), coupons + referrals (impl-12), RFM segmentation (impl-10 extension), and branch analytics (impl-25) — all four built **and live-verified**, not just claimed. Section 4 below reflects real current status; nothing in it should be read as "claimed, unverified" unless explicitly marked so.

---

## 1. Product Summary

RestoAI is a multi-tenant, AI-native restaurant operations SaaS for the Pakistani market. Core differentiator vs. competitors (e.g. Bitecast): a Qwen-powered conversational AI agent handles WhatsApp ordering (not just a menu-flow bot), plus AI-driven menu digitization and natural-language business insights. Positioning validated by market research (Section 4.6): Pakistani restaurants face a well-documented, litigated pain point in aggregator commissions (Foodpanda, 25-35%/order) — "escape the commission" is the sharpest pitch framing available. Built for the Alibaba Cloud AI Hackathon Pakistan 2026 (Alkhidmat Foundation / Bano Qabil), build phase deadline **September 4, 2026**.

**Scale as of 2026-08-29 (code-verified):** 28 API route modules, 23 backend services, 53 Postgres tables. npm-workspace monorepo (client/server), React 18.3 + Vite 6 + React Router 6.28 + Tailwind 3.4 on the client (no TypeScript), Express 4.21 + pg 8.13 + Zod 3.24 on the server, Neon Postgres, deployed as two separate Vercel projects (resto-ai-client, resto-ai-server) from one repo. **8 "agentic AI workers" is imprecise** — only 6 are cron-triggered (daily briefing, win-back, reconciliation, abuse detection, replenishment, menu insight, all gated by `requireCronSecret`); dispatch and ETA are on-demand/inline helpers, not scheduled jobs.

---

## 2. Current Production State

### 2.1 Fully verified-live (functionally tested end-to-end, not just code-reviewed)
WhatsApp AI ordering, menu photo digitization, natural-language insights Q&A, public ordering app (menu/cart/checkout/tracking), Kitchen display + admin dashboard, dine-in QR + table sessions, reservations, token/menu display boards, loyalty/reviews/push/AI widget, WhatsApp broadcasts, **multi-branch POS + complete billing (tax, split-tender, void/refund, shifts, receipts)**, **coupons + referral program**, **customer CRM + tags + segments + RFM + granular RBAC**, **multi-branch analytics (comparison, drill-down, benchmark, staff performance)**. See Section 4.1 for the full evidence-backed table.

### 2.2 Code-verified only (present, correctly wired, NOT functionally live-tested)
Riders/delivery + cash reconciliation, full inventory (recipes/suppliers/purchase orders/auto-deplete), the per-restaurant landing page builder, RestoAI's own marketing site, multi-role onboarding/auth, the 6 cron-gated agent workers. One confirmed gap: the "rider PWA" isn't actually installable (push-only, no manifest/offline shell — see 4.3).

### 2.3 Production Deployment
- **Client:** resto-ai-client.vercel.app · **Server:** resto-ai-server.vercel.app (Express as Vercel Function)
- **Repo:** github.com/sylvester263/RestoAI · npm workspaces, Vercel Cron drives the 6 cron-gated agent workers
- Deploy gotchas: saving a Vercel env var does **not** trigger a rebuild by itself. Monorepo "unaffected project" logic can skip a rebuild and leave a domain briefly unaliased — force a rebuild under the affected workspace if this happens.
- **Recurring operational finding (hit 3 times: impl-24, impl-12, impl-25 migrations):** the shared dev/prod Neon database has real concurrent traffic (a POS floor-view poller hits it every ~10s). Applying new schema inside `migrate.js`'s single historical transaction reliably deadlocks against it. Fix used every time: apply new DDL as individually auto-committed statements with deadlock retry, not a full `migrate.js` re-run. `migrate.js` itself has the correct statements for a fresh install — this only bites when adding an incremental change to the live shared DB.

### 2.4 Config / Env
| Var | Status |
|---|---|
| DATABASE_URL, JWT_SECRET | Configured; JWT boot-fails if missing/default in production (`config.js:13-15`) |
| DASHSCOPE_API_KEY | User reported "updated" — never independently re-verified end-to-end |
| WHATSAPP_TOKEN / PHONE_NUMBER_ID / WEBHOOK_VERIFY_TOKEN | Not set — demo mode (console-logged replies) |
| WHATSAPP_APP_SECRET, CORS_ORIGINS | Configured |
| CRON_SECRET | **Gap, still open:** falls back to `'dev-cron-secret-change-me'` with no production guard, unlike JWT_SECRET. `/api/agents` also has no rate limiter. Not a cross-tenant leak, but can trigger real side effects (WhatsApp sends, draft POs) for free if guessed. |

---

## 3. Security Status

### 3.1 Confirmed PASS (accumulated across the 2026-08-26 audit, the 2026-08-28 full audit, and every feature built since)
- **tenant_id resolution:** always server-side (JWT or verified slug), never client input — checked across the entire codebase including all endpoints added in the 2026-08-28/29 build pass (POS billing, coupons/referral, RFM/branch-analytics — 30+ new endpoints total).
- **Parameterized queries** everywhere checked; segment `filter_rules` JSON is evaluated through fixed, hardcoded query fragments, never string-concatenated (same discipline as the original LLM-SQL fix).
- **Row-locking on read-then-write balance ops:** loyalty redemption, coupon usage-limit enforcement (both `FOR UPDATE` inside a transaction), POS settle/void/refund — all confirmed correct, including a live 5-concurrent-request race test on both loyalty and a `max_redemptions:1` coupon (exactly 1 success each, DB-confirmed).
- **Rider JWT vs staff JWT:** structurally separate signing secrets (`riderSecret` derived via `sha256(JWT_SECRET + ':rider')`) — a token from one can never verify under the other.
- **RBAC refactor is complete, not partial:** `authorize(permission_key)` is used in **15 different route files**; zero instances of the old hardcoded `authorize('owner','manager')` role-list pattern remain anywhere. A live permission-grant/revoke test confirmed changes take effect immediately (cache invalidation works).
- **Branch-access hard-lock (impl-25):** a manager restricted to one branch gets rejected with a real `403` on a **direct API call** to another branch's data — not just hidden in the UI. Verified live.
- **POS refund / permissions-management:** both deliberately use a hardcoded role check instead of the revocable permission system, by design — refunds move real money, and letting the permission system gate the page that configures itself would be circular.

### 3.2 Known gaps, still open
- **CRON_SECRET** has no production guard + no rate limiter on `/api/agents` (Section 2.4).
- **Inventory auto-deplete has no negative-stock floor** — `current_stock = current_stock - $1` is safe from lost updates (Postgres serializes concurrent UPDATEs) but nothing gates order creation on availability first, so two concurrent orders against a scarce ingredient can drive stock negative.
- **Minor defense-in-depth gap:** inventory's ingredient UPDATE/shortfall queries filter only on `id`, no `tenant_id` — not independently exploitable today (ingredient_id is always server-derived), but deviates from the project's own standard.
- **Housekeeping:** 9 untracked `step*.png` screenshot files at the repo root — delete or `.gitignore` them.

---

## 4. Complete Feature Set

### 4.1 Fully verified-live — every row here was tested against the running server/DB with evidence (API responses, DB cross-checks, or browser screenshots), not just read as code
| Feature | Verification evidence |
|---|---|
| WhatsApp AI ordering, menu digitization, NL insights Q&A | 2026-08-26/27 audits — differentiators vs. Bitecast |
| Public ordering, Kitchen display, dine-in QR, reservations, display boards, loyalty/reviews/push, broadcasts | 2026-08-27 audit; Kitchen dine-in mislabel confirmed fixed on 2026-08-28 (an architecture doc briefly claimed otherwise — the doc was wrong) |
| **Multi-branch POS (impl-04)** | All 5 spec steps: counter/dine-in settlement, dine-in tab correctly attaches to an existing customer session, discount RBAC (real 403 on staff), Kitchen labeling, Insights inclusion |
| **Complete POS billing (impl-24)** | All 8 spec steps: tax computed on post-discount subtotal (16% PRA, exact match), split-tender sum validation (reject/accept both tested), void-item + refund RBAC both ways with audit trail, shift Z-report variance exact to the rupee, hold/resume, table transfer (Kitchen picks up new table), receipt rendering. 1 bug found+fixed (join-alias typo 500'd receipts). Regression-checked clean after Steps 1-3. |
| **Coupons + referral program (impl-12)** | All 6 spec steps incl. 5-concurrent-checkout race on `max_redemptions:1` (exactly 1 success, DB-confirmed). Also verified: `first_order_only`, `free_delivery`, `bogo` (single- and multi-item cart), full referral loop (code → friend's order → delivery → referrer's reward coupon), self-referral block. 2 bugs found+fixed (`discount_type` column too narrow for `'free_delivery'`; preview endpoint missing delivery-fee default). |
| **Customer CRM + tags + segments + RFM + RBAC (impl-10)** | Tags, rich profiles, custom segments all pre-existing and re-verified. RFM segmentation (new): 7-label classifier verified against manual reference data; win-back agent now prioritizes "Cannot lose them"/"About to sleep" with tiered coupon value (20%/15%/10%), confirmed live. Broadcast recipient selection by segment/RFM confirmed (exact count match). RBAC: permission grant/revoke takes effect live; 15 files use the new pattern, zero old-style calls remain. 2 bugs found+fixed (route-ordering conflict, non-deterministic RFM tie-breaking). |
| **Branch analytics (impl-25)** | All 6 spec steps: compare/drill-down/benchmark/staff-performance all cross-checked against manual DB queries (exact matches to the rupee), hard-lock access confirmed via direct API rejection (not UI-only), zero-POS-activity branch shows a clear message not an error, period switching recomputes real numbers. 1 bug found+fixed (`bg-brand-400` — undefined Tailwind color, chart silently invisible). |

**Known limitations on otherwise-verified features:** dine-in QR is missing a call-waiter button and QR print/download; reservations lack WhatsApp conversational booking intent; broadcasts lack scheduled sends/opt-out/24h-window check; one low-confidence, unreproduced POS UI glitch (a rapid double-click once appeared to stage the wrong item — never recurred in 3 follow-ups, no bad order was ever created).

### 4.2 Code-verified only — present and correctly wired, not functionally live-tested
| Feature | Spec | Notes |
|---|---|---|
| Riders/delivery + cash reconciliation | impl-05 | `riders.js` (staff, `authenticate`) + `rider-app.js` (rider, `authenticateRider`) correctly separated |
| Rider PWA | impl-23 | **Gap confirmed** — no `manifest.json`, no install prompt, no offline shell. `sw.js` handles push only. Push notifications work; it is not an installable PWA. |
| Full inventory (recipes, suppliers, POs, auto-deplete) | impl-08 | Present; deplete logic has the negative-stock-floor gap noted in 3.2 |
| Per-restaurant landing page builder | impl-11 | `routes/landing-page.js`, `routes/sites.js`, editor + public renderer present |
| RestoAI's own marketing site | impl-22 | `pages/marketing/LandingPage.jsx` — feature grid updated 2026-08-28 to include POS/riders/CRM/coupons/inventory, doesn't overclaim beyond what's verified |
| Multi-role onboarding/auth (owner/staff/rider) | impl-23 | Present |
| 6 cron-gated agent workers | impl-14, 15, 18, 19, 20, 21 | `requireCronSecret`-gated at every `/run` endpoint, confirmed by code inspection |
| Dispatch, ETA (on-demand, not cron) | impl-16, impl-17 | Confirmed **not** cron-triggered — dispatch is human-invoked via `authorize()`, ETA is a synchronous helper |

### 4.3 Cross-feature integration findings
- **No unified "Team" view** — Riders and Staff are separate nav items/pages (`Layout.jsx`).
- **Marketing site copy is accurate**, not inflated, as of the 2026-08-28 review.
- **Agentic AI design principles hold under inspection:** replenishment's cron path only ever creates *suggestions*, never a purchase order (human approval required via `authorize('inventory.manage')`); abuse-detection only ever creates flags, never blocks/cancels anything.

### 4.4 Known open gaps (unaffected by everything built since)
| Feature | Status |
|---|---|
| Online payment gateway (JazzCash/EasyPaisa/card) | COD lifecycle works fully (now with real provincial tax handling via impl-24); online gateway remains roadmap |
| Wallet/store credit beyond loyalty points | Not built |
| Marketplace listing | Not planned |
| Multi-currency/timezone | Not needed — Pakistan-only |

### 4.5 Explicitly out of scope, by design (not gaps)
- FBR e-invoicing direct integration — Pakistani law requires a licensed integrator; `orders.fbr_invoice_number`/`fbr_qr_code_url` are schema-ready, deliberately unpopulated.
- Per-user permission overrides beyond role-level config, cross-tenant benchmarking, predictive/forecasting analytics, pre-aggregated `branch_daily_stats` — all explicitly deferred per their own spec files' "out of scope" sections.

### 4.6 Market Research Basis (2026-08-27)
Foodpanda commission runs 25-35%/order; a 2020 Karachi boycott and a 2021 CCP antitrust inquiry are still referenced by owners today. Inflation 11.7% YoY (May 2026), energy costs up ~30% annually. Market growing (~$1.93B in 2026). **Positioning takeaway:** "escape Foodpanda's commission with your own zero-commission channel" — the landing page builder and marketing site exist to make that pitch credible.

---

## 5. Architecture Reference

```
Customers → WhatsApp Gateway + Public Web App + Dine-in QR + Rider web app (not an installable PWA)
                              ↓
                   Express API — 28 route modules, 23 services, 7 rate limiters
                   Fully verified live: auth, menu, orders, branches, insights, whatsapp,
                   public, table-sessions, reservations, campaigns, display,
                   pos + full billing (impl-04+24), coupons + referrals (impl-12),
                   customers/segments/RFM/permissions (impl-10), analytics (impl-25)
                   Code-verified only: riders, inventory (full), landing-page,
                   marketing-site, staff-invites, rider-auth, 6 cron agents
                              ↓
      PostgreSQL (Neon, 53 tables) ←→ Qwen AI Agent (Qoder/DashScope)
                              ↓
                    Payment Gateway — NOT integrated (COD-only in production)
```

**Multi-tenancy + branch scoping:** shared schema, `tenant_id` resolved server-side only — confirmed to hold across every feature. `user_branch_access` (new, impl-25) hard-locks non-owner branch visibility on top of that, checked server-side via `req.user.branchAccess`, never a client-supplied `branch_id` alone.

---

## 6. Reference Documents

- `restaurant-saas-development-plan.md`, `customer-app-specification.md` — original planning docs, superseded by Section 4
- `impl-00-INDEX.md` through `impl-13-menu-images.md` — feature build specs
- `impl-agents-INDEX.md`, `impl-14` through `impl-21` — 8 agent specs (6 cron-triggered, 2 on-demand)
- `impl-22-restoai-marketing-page.md`, `impl-23-multi-role-onboarding-auth.md` — marketing site + owner/staff/rider auth
- `impl-24-pos-billing-system.md` — **built & fully live-verified.** Tax handling, split-tender, void/refund audit trail, shift/Z-reports, hold/park, table transfer, receipts, FBR schema hook only (licensed-integrator requirement, not attempted directly)
- `impl-12-coupons-discounts.md` — **built & fully live-verified.** first_order_only, referral program, free_delivery/bogo types, tiered discounts (via multiple coupon rows)
- `impl-10-crm-rbac.md` — **RFM extension built & fully live-verified**; the original tags/segments/RBAC core was already complete from earlier work and was re-verified, not rebuilt
- `impl-25-branch-analytics.md` — **built & fully live-verified.** Hard-locked branch access (explicit design decision, stated and justified in Section 3), comparison/drill-down/benchmark/staff-performance

This master document is the **entry point** — read this first; open a spec file only for field-level detail.

---

## 7. Immediate Priorities (in order)

1. **Fix the CRON_SECRET gap** — add the same production guard JWT_SECRET has, plus a rate limiter on `/api/agents`.
2. **Decide the rider PWA story for the pitch** — either build the real manifest/service-worker/install-prompt impl-23 asks for, or reframe it honestly as "rider web app."
3. **Decide on the inventory negative-stock floor** — likely fine to leave as a known limitation for a hackathon demo, but say so explicitly.
4. **Live-verify the remaining code-only features if time allows** — riders/delivery, full inventory, landing-page builder, marketing site, the 6 cron agents (Section 4.2). Everything else major is now done.
5. Decide and clearly frame the payments story — COD works (with real tax handling now); online gateway remains roadmap.
6. Delete/.gitignore the stray screenshot files.
7. **Decide pricing/commission stance** before the pitch (Section 8).
8. **Rehearse the full live demo** — now spans WhatsApp ordering, public web ordering, dine-in QR, POS (tax/split-tender/shifts/receipts), coupons/referrals, CRM/RFM segmentation, branch analytics, riders, reservations, loyalty, reviews, broadcasts, display boards, inventory, landing-page builder. This is a lot of surface area — budget real rehearsal time.

---

## 8. Business Model Note

Bitecast's model: 0% commission, flat monthly plan, no setup fee, cancel anytime. No decision made yet on RestoAI's own stance.
