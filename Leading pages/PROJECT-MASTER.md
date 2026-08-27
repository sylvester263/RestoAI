# RestoAI — Master Project Specification & Status
**Last updated:** 2026-08-27 · **Purpose:** Single source of truth for this project's current state, architecture, and roadmap. Load this file instead of re-explaining project history in future agent sessions.

---

## 1. Product Summary

RestoAI is a multi-tenant, AI-native restaurant operations SaaS for the Pakistani market. Core differentiator vs. competitors (e.g. Bitecast): a Qwen-powered conversational AI agent handles WhatsApp ordering (not just a menu-flow bot), plus AI-driven menu digitization and natural-language business insights. Positioning validated by market research (Section 4.1): Pakistani restaurants face a well-documented, litigated pain point in aggregator commissions (Foodpanda, 25-35%/order) — "escape the commission" is the sharpest pitch framing available, not just "AI restaurant SaaS." Built for the Alibaba Cloud AI Hackathon Pakistan 2026 (Alkhidmat Foundation / Bano Qabil), build phase deadline **September 4, 2026**.

**Scale as of 2026-08-27 (per full codebase audit):** 62 source files, ~7,684 lines of code, 20 database tables.

---

## 2. Current Production State

### 2.1 Core Backend/Frontend (built early, security-hardened)
Auth, menu (CRUD + AI digitize), orders, branches, insights (KPIs + AI Q&A), WhatsApp (webhook + AI agent: order parse, confirmation, recommendations), Kitchen display, admin dashboard. All tenant-scoped, rate-limited where AI/public-facing, security-audited (Section 3).

**Demo account:** ahmed@karahi.pk / demo1234 (tenant: Lahore Karahi House). Staff account: bilal@karahi.pk. No manager-role account seeded.

### 2.2 Production Deployment (Live)
- **Client:** resto-ai-client.vercel.app · **Server:** resto-ai-server.vercel.app (Express as Vercel Function)
- **Repo:** github.com/sylvester263/RestoAI
- Deploy gotchas: saving a Vercel env var does **not** trigger a rebuild by itself. Monorepo "unaffected project" logic can skip a rebuild and leave the domain briefly unaliased — force a rebuild under the affected directory if this happens.

### 2.3 Config / Env
| Var | Status |
|---|---|
| DATABASE_URL, JWT_SECRET | Configured; JWT boot-fails if missing in production |
| DASHSCOPE_API_KEY | User reported "updated" — not independently re-verified since |
| WHATSAPP_TOKEN / PHONE_NUMBER_ID / WEBHOOK_VERIFY_TOKEN | Not set — demo mode (console-logged replies), acceptable for hackathon |
| WHATSAPP_APP_SECRET, CORS_ORIGINS | Configured |
| Prep-time config | `config.js`: `estimatedPrepMin: 25, estimatedPrepMax: 30` — used in WhatsApp confirmation only, not elsewhere |

---

## 3. Security Status

Full security audit performed, **all 8 original findings fixed and re-verified live**, including planting a second tenant's order to confirm a prompt-injection insights query never leaked it.

| # | Finding | Severity | Fix |
|---|---|---|---|
| 1 | LLM-generated SQL near-unsanitized → cross-tenant leak | CRITICAL | Tenant_id enforced in code, stacked-statement/keyword rejection, authorize() gate |
| 2 | `/api/whatsapp/simulate` unauthenticated, arbitrary tenant_id | CRITICAL | Auth required, tenant derived from JWT |
| 3 | Webhook: no signature check + hardcoded "first tenant" routing | HIGH | HMAC verification, routing by phone_number_id |
| 4 | JWT secret silently falls back to hardcoded default | HIGH | Boot-time guard fails fast in production |
| 5 | No rate limiting on paid AI endpoints / webhook | HIGH | Rate limiters added to digitize, insights query, webhook |
| 6 | CORS wide open | MEDIUM | Scoped allowlist via CORS_ORIGINS |
| 7 | Raw DB errors surfaced to users | MEDIUM | Generic message, real error server-logged only |
| 8 | Registration not transactional | LOW | transactionStarted guard |

**Standing rule:** any endpoint that reads a balance/count then writes an updated value must lock the row in a transaction before the read. Verified in loyalty redemption (`FOR UPDATE` row lock) and campaign send (`SELECT FOR UPDATE` inside a transaction, see 3.2).

### 3.1 New finding (2026-08-27 verification pass) — not yet fixed
| Finding | Severity | Evidence |
|---|---|---|
| `GET /api/insights/dashboard` has no `authorize()` guard | Medium | Any authenticated user, including staff without the `reports.view` permission, can pull full tenant-wide analytics — `POST /insights/query` correctly requires the permission, `GET /dashboard` does not. Not a cross-tenant leak (still `tenant_id`-scoped), but breaks the permission model already built elsewhere. Add the same `authorize()`/permission check used on `/query`. |

### 3.2 Prior gaps — status after 2026-08-27 verification pass
| # | Item | Status |
|---|---|---|
| 1 | Rate limiting on campaign send | ✅ **Fixed** — `campaignSendLimiter`, 5/15min per user |
| 2 | Rate limiting on public reservations | ✅ **Fixed** — `reservationLimiter`, 10/15min per IP |
| 3 | Rate limiting on `/api/payments/*` | N/A — no standalone payment endpoints exist yet (gateway integration still deferred); payment operations are internal calls from `orders.js` only |
| 4 | Campaign duplicate-send guard | ✅ **Fixed** — `SELECT FOR UPDATE` inside a transaction, atomic check-and-lock |
| 5 | Kitchen "Dine-in" mislabel | ✅ **Fixed** — now a 4-way check (`Dine-in`/`Delivery`/`Counter`/`Pickup`), handles POS orders too |
| 6 | `loyalty_config` not seeded | ✅ **Fixed** — idempotent `ON CONFLICT DO UPDATE`, confirmed live: `{"enabled":true,...}` |

### 3.3 Bugs found and fixed in the 2026-08-27 pass
| # | Bug | Fix |
|---|---|---|
| 1 | Loyalty double-redemption race | Row-locking transaction |
| 2 | Campaign send blocked the HTTP request for the whole broadcast (serverless timeout risk) | Responds immediately, send loop via `waitUntil`, frontend polls `/status` |
| 3 | Raw `SyntaxError` leaked to users on non-JSON error responses | try/catch with clean fallback message |
| 4 | Dashboard's low-stock alert link was inert | Fixed |
| 5 | Debug instrumentation left in `PublicMenu.jsx` | Cleaned up |

**Housekeeping:** 9 untracked `step*.png` screenshot files sit at the repo root — delete them, or add `*.png` at the repo root to `.gitignore`.

---

## 4. Complete Feature Set — Verified Status

Two full codebase audits performed (2026-08-27): one against all 11 `impl-*.md` specs, one specifically verifying 6 previously-unconfirmed items. All statuses below are evidence-based (file/line level), not estimated.

| Feature | Spec | Status | Notes |
|---|---|---|---|
| WhatsApp AI ordering (conversational NLU) | — | ✅ Built | Differentiator vs. Bitecast |
| Menu photo digitization (AI vision) | — | ✅ Built | Differentiator — note: discards the source photo after extracting text (relevant to impl-13) |
| Natural-language insights Q&A | — | ✅ Built | `POST /query` correctly permission-gated; `GET /dashboard` is not (Section 3.1) |
| Kitchen Display, admin dashboard, multi-tenant core | — | ✅ Built | |
| Public customer ordering app (menu/cart/checkout/tracking) | — | ✅ Built & live | Fully stateless — see Customer Accounts row below |
| **Customer accounts** (order history, reorder, saved addresses) | — | 🔴 **0% confirmed** | No `/my-orders` route, no reorder action, no address book — `customers.address` is a single TEXT column. Identity lives only in `localStorage`, no server-side session. Was assumed possibly-partial from the original customer-app spec; now confirmed fully absent. |
| **Live order ETA** | — | 🟠 **~20% confirmed** | Exists only in the 2 WhatsApp order-confirmation messages (`~30 mins`, using config values). Not in WhatsApp status-change messages, not on the tracking page, not on checkout, not in the API response. |
| **Branch-scoped analytics for manager role** | — | 🔴 **0% confirmed** | All 7 insights queries are tenant-wide only, no `branch_id` filtering anywhere. Deeper than a missing filter: `permissions.js` currently grants "manager" identical permissions to "owner" — branch-level data scoping isn't part of the current permission model's design at all. Real design work needed, not a quick patch. |
| **Payments** | impl-01 | 🟡 45% | COD lifecycle fully works, verified live. Online gateway not built — checkout UI offers JazzCash/EasyPaisa/Card but they behave as COD. |
| **Dine-in QR ordering + table sessions** | impl-02 | 🟢 80% | Built and verified. Missing: "call waiter" button, QR download/print. |
| **Loyalty, Reviews, Push, AI Assistant** | impl-03 | 🟢 85% | All sub-features built and verified live, `loyalty_config` seeding confirmed fixed. Missing: WhatsApp "how many points do I have" query. |
| **Multi-branch POS** | impl-04 | 🔴 0% | Nothing built. |
| **Riders/delivery + cash reconciliation** | impl-05 | 🔴 0% | Nothing built. |
| **Reservations & table booking** | impl-06 | 🟢 90% | Built and verified. Missing: WhatsApp conversational booking intent. |
| **Broadcasts/WhatsApp marketing** | impl-07 | 🟢 80% | Built and verified, duplicate-send guard confirmed fixed. Missing: scheduled sends, opt-out handling, 24h-window check. |
| **Inventory management** | impl-08 | 🟠 25% | Basic stock tracker only (CRUD + manual restock + low-stock KPI). Recipe-based auto-deplete, suppliers, purchase orders, auto-86, food-cost margins — **not built**. |
| **Order-ready token board + digital menu board** | impl-09 | 🟢 90% | Built and verified. Missing: rate limiting on public display endpoints. |
| **Customer CRM & segments + granular RBAC** | impl-10 | 🔴 0% | Nothing built. |
| **Restaurant landing page builder** | impl-11 | 📋 Specced only | Not started. |
| **Coupons & discounts** | impl-12 | 🔴 **0% confirmed** | Grep across entire codebase found zero coupon infrastructure — no table, no API, no UI. `orders.discount_amount` exists but is used exclusively for loyalty-point redemption. |
| **Menu item images** | impl-13 | 🟠 **~15% confirmed** | `image_url` column + Zod validation + API pass-through exist, but **zero rendering anywhere** (not PublicMenu, not MenuBoard, not admin editor), **no upload mechanism at all** (no multer, no object storage), and AI digitize discards the source photo. Fully validates impl-13 as scoped — nothing in it was solving an already-solved problem. |
| Wallet/store credit (beyond points) | — | ❌ Gap | Extend loyalty_points design if built |
| Marketplace listing | — | Not planned | |
| Multi-currency/timezone | — | Not needed | Pakistan-only focus |

**Overall:** 4 features at 80-90%, 4 confirmed at or near 0% (POS, riders, CRM/RBAC, coupons, branch analytics, customer accounts), 3 partial (payments 45%, inventory 25%, images 15%, ETA 20%). Not achievable in full before Sept 4 — see Section 7.

**Positioning note carried forward:** do not lead with "installable app" as the primary channel — Bitecast's own positioning ("no app to install, they already have WhatsApp") is deliberate and matches this market.

### 4.1 Market Research Basis (2026-08-27)
- Foodpanda commission runs 25-35% per order; a 2020 Karachi restaurant boycott and a formal CCP antitrust inquiry (opened 2021) are still referenced by owners today — documented, litigated, not hypothetical.
- Restaurants absorb reputational damage from platform-side failures that aren't their fault.
- Macro pressure compounds it: inflation 11.7% YoY (May 2026), energy costs up ~30% annually.
- Digital adoption barriers are real but WhatsApp-first tooling sidesteps most of them.
- Market is growing (~$1.93B in 2026) — a timing opportunity.

**Positioning takeaway:** "escape Foodpanda's 25-35% commission with your own zero-commission channel" is the sharpest pitch framing. The landing page builder (`impl-11`) exists to make that pitch credible.

### 4.2 Agentic AI Research (2026-08-27)
Researched where agentic AI genuinely pays off in restaurants vs. hype. Key finding: real ROI clusters in "agentic productivity tools" (scheduling, forecasting, ordering optimization, marketing automation) — not chat-wrapper novelty. Precedent: Yum Brands' Byte platform (stockouts -85%, aggregator failures -75% across 38,000 restaurants); Loop's "Samantha" agent automates financial reconciliation, inventory alerts, and customer retention.

**Recommended single addition for the hackathon (not yet built):** a **Daily Briefing Agent** — runs the existing `ai-agent.js` insights-Q&A capability on a schedule instead of on-demand, WhatsApps the owner a proactive morning summary. Lowest build cost of any agent idea (reuses existing Qwen insights logic + existing WhatsApp send), and the most legible "agentic" demo moment for judges. Other agent ideas (smart rider dispatch, inventory replenishment, reconciliation, fraud detection) are real but gated behind unbuilt features (impl-04/05/08/10) — roadmap only.

---

## 5. Architecture Reference

```
Customers → WhatsApp Gateway + Public Web App (menu/cart/checkout/tracking, live, stateless)
          → Dine-in QR (live) → Reservations (live) → Display boards (live)
                              ↓
                   Shared Backend API (Express)
                   Built: auth, menu (image field unused), orders, branches,
                   insights (dashboard missing authorize() gate), whatsapp,
                   public, table-sessions, reservations, campaigns,
                   inventory (basic tracker only), display
                   Not built: pos, riders, full inventory, crm/segments,
                   granular branch-level RBAC, payment gateway, landing-page,
                   coupons, menu image upload/rendering, customer accounts
                              ↓
              PostgreSQL (Neon, 20 tables) ←→ Qwen AI Agent (via Qoder/DashScope)
                              ↓
                    Payment Gateway — NOT integrated (COD-only in production)
```

**Multi-tenancy:** shared schema, `tenant_id` on every table, enforced in code — consistently applied across all built features per both 2026-08-27 audits.

---

## 6. Reference Documents

- `restaurant-saas-development-plan.md` — original hackathon dev plan
- `customer-app-specification.md` — full customer-facing app spec (status superseded by Section 4)
- `impl-00-INDEX.md` through `impl-13-menu-images.md` — step-by-step build specs; status tracked in Section 4
- `impl-agents-INDEX.md`, `impl-14-daily-briefing-agent.md` through `impl-21-abuse-detection-agent.md` — 8 agentic AI specs (Section 4.2); only impl-14, 15, 17, and part of 21 are buildable without completing impl-05/impl-08/impl-12 first
- `impl-22-restoai-marketing-page.md` — RestoAI's own sales/marketing site (distinct from impl-11, which builds pages for individual restaurants' customers), with the three-login header (owner/staff/rider)
- `impl-23-multi-role-onboarding-auth.md` — owner signup, staff invite flow, and a new rider auth system (phone+PIN, separate JWT type from owner/staff) — **key decision: owner and staff share one login form/backend already built; riders need a new, structurally separate lightweight auth system since they aren't in the `users` table at all**

This master document is the **entry point** — read this first; open a spec file only for field-level implementation detail.

---

## 7. Immediate Priorities (in order)

1. **Add `authorize()`/permission gate to `GET /api/insights/dashboard`** — new finding, closes a real permission-model gap (Section 3.1)
2. **Decide and clearly frame the payments story for the pitch** — COD works end-to-end; gateway is roadmap, not "almost done"
3. **Delete/.gitignore the stray screenshot files**
4. **Build `impl-13` (menu images)** — confirmed only 15% done (schema only, zero rendering/upload), high demo impact for a restaurant app
5. **Consider the Daily Briefing Agent** (Section 4.2) — cheapest genuinely-agentic addition, reuses existing infrastructure almost entirely
6. **Rehearse the full live demo** — WhatsApp ordering, public web ordering, dine-in QR, reservations, loyalty, reviews, broadcasts, display boards
7. ~~Decide pricing/commission stance before the pitch~~ — **Done** (Section 8)
8. POS, riders, full inventory, CRM/segments, branch-level RBAC, coupons, landing page, and customer accounts (history/reorder/addresses) remain roadmap-only unless real time remains before Sept 4

---

## 8. Business Model Note (from Bitecast benchmark)

Bitecast's model: 0% commission, flat monthly plan, no setup fee, cancel anytime.

**Decision (2026-08-27):** Same shape, contact-based pricing — the plan is quoted directly per restaurant (size/branch count) rather than published as a fixed number, so the marketing page's pricing section reads "Contact for pricing." The one number that's never variable and always advertised: **0% commission, on every order, always.** No setup fee, cancel anytime, all features included at every tier (no feature-gated plans). Reflected in `impl-22`'s Pricing section on the marketing page.
