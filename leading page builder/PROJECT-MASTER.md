# RestoAI — Master Project Specification & Status
**Last updated:** 2026-08-27 · **Purpose:** Single source of truth for this project's current state, architecture, and roadmap. Load this file instead of re-explaining project history in future agent sessions.

---

## 1. Product Summary

RestoAI is a multi-tenant, AI-native restaurant operations SaaS for the Pakistani market. Core differentiator vs. competitors (e.g. Bitecast): a Qwen-powered conversational AI agent handles WhatsApp ordering (not just a menu-flow bot), plus AI-driven menu digitization and natural-language business insights. Built for the Alibaba Cloud AI Hackathon Pakistan 2026 (Alkhidmat Foundation / Bano Qabil), build phase deadline **September 4, 2026**.

---

## 2. Current Production State (as of 2026-08-26)

### 2.1 Backend — Node.js/Express, Neon PostgreSQL
14 route/service files, ~2,400 lines. Status: **core functional, security-hardened per audit (Section 4).**

| File | Purpose | Status |
|---|---|---|
| index.js | Express entry, middleware | OK |
| config.js | Env config | OK — boot guard added |
| pool.js | PG connection pool | OK |
| migrate.js | Schema (10 tables + indexes) | OK — +1 column added (Fix 3) |
| seed.js | Demo data ("Lahore Karahi House") | OK |
| auth.js (middleware) | JWT verify + tenant injection | OK |
| error-handler.js | Global error handling | OK |
| auth.js (routes) | Register/Login | OK — transaction guard added |
| menu.js | Menu CRUD + digitize | OK — rate limit added |
| orders.js | Order list/kitchen/status | OK — count-query bug fixed |
| branches.js | Branch CRUD | OK |
| insights.js | Dashboard KPIs + AI Q&A | OK — authorize() gate + rate limit added |
| whatsapp.js (route) | Webhook + simulate | OK — auth, HMAC, tenant routing added |
| ai-agent.js | Qwen: order parse, vision digitize, text-to-SQL insights | OK — SQL injection/tenant-leak fixed |
| whatsapp.js (service) | Order orchestration pipeline | OK |

**Demo account:** ahmed@karahi.pk / demo1234 (tenant: Lahore Karahi House, 17 menu items)

### 2.2 Frontend (Admin Dashboard) — React, Tailwind
12 files, ~1,400 lines. Pages: Login, Dashboard, Menu, Orders, Kitchen, Insights, WhatsAppDemo. Status: **OK, functional.**

### 2.3 WhatsApp AI Features — Verified Live (2026-08-27)
All 3 features tested against the running server via `/api/whatsapp/simulate`, not just read in code:
- **Order-status push notifications** — order advanced confirmed→preparing→ready→delivered via admin API; one WhatsApp push per transition, confirmed in server logs
- **Confirmation summary before finalizing** — order not written to DB until customer confirms; mid-flow corrections re-parse the draft; "yes" finalizes with the correct total
- **AI menu recommendations** — recommendation intent correctly separated from order intent; zero orders created on a recommendation request

### 2.4 Config / Env Requirements
| Var | Status |
|---|---|
| DATABASE_URL | Configured (Neon) |
| JWT_SECRET | Configured, boot-fails if missing in production |
| DASHSCOPE_API_KEY | User reported "updated" — **not independently verified working end-to-end; re-run the verification prompt from Section 4 history if AI features misbehave** |
| WHATSAPP_TOKEN / PHONE_NUMBER_ID / WEBHOOK_VERIFY_TOKEN | Not set — demo mode (replies logged to console), acceptable for hackathon demo |
| WHATSAPP_APP_SECRET | Added (for HMAC webhook verification) |
| CORS_ORIGINS | Added (scoped CORS) |

### 2.5 Public Customer Ordering App — Phase 1-2 (Built & Verified Live)
Menu browsing, cart, checkout, and order tracking at `/order/:tenantSlug` — no login, no OTP (**decided against for hackathon speed** — customer identity is phone + name only, matching the existing WhatsApp flow).

New/modified files:
- `server/src/services/orders.js` (new) — shared pricing + order-creation logic, extracted from the WhatsApp pipeline
- `server/src/services/whatsapp.js` (mod) — now delegates to orders.js, zero behavior change for existing WhatsApp orders
- `server/src/routes/public.js` (new) — menu, checkout, phone-gated tracking; tenant resolved by slug, never by client input
- `server/src/index.js` (mod) — mounts public router + per-IP rate limiter
- `client/src/pages/public/PublicMenu.jsx`, `Checkout.jsx`, `TrackOrder.jsx` (new)
- `client/src/lib/publicOrderStore.js` (new) — tenant-scoped cart + identity in localStorage
- `client/src/lib/api.js` (mod) — added `publicApi`
- `client/src/App.jsx` (mod) — 3 new routes, outside the auth gate

Verified end-to-end live in a real browser session: full browse→cart→checkout→track flow; order appears in admin Orders/Kitchen with `channel='web'` and a server-computed total; status changes reflect on the tracking page within 10s; wrong phone on tracking → generic 404 (no data leak). A stale-closure bug in the tracking page's polling loop was caught and fixed pre-ship (rewritten as a self-scheduling poll).

### 2.6 Production Deployment (Live)
Both halves deployed on Vercel:
- **Client:** resto-ai-client.vercel.app
- **Server:** resto-ai-server.vercel.app (Express app as a Vercel Function, `app.listen()` guarded under `process.env.VERCEL`)
- **Repo:** github.com/sylvester263/RestoAI
- **Full production sweep:** 47 live requests across login, dashboard, menu, orders, insights, kitchen display, and the full public ordering flow — all 200/201, zero 404s

Deploy gotchas worth remembering if redeploying: saving a Vercel env var does **not** trigger a rebuild by itself — a fresh deployment is required for env var changes to take effect. Monorepo "unaffected project" logic can skip a rebuild and leave the production domain briefly unaliased — force a rebuild under the affected directory if this happens.

---

## 3. Security Status

A full security audit was performed and **all 8 findings were addressed** (per agent's fix summary — CRITICAL items 1-2 should be spot-verified again given their severity, see caution below):

| # | Finding | Severity | Fix applied |
|---|---|---|---|
| 1 | LLM-generated SQL executed near-unsanitized → cross-tenant leak risk | CRITICAL | Tenant_id enforced in code (not prompt), stacked-statement/keyword rejection, authorize() gate added to insights route |
| 2 | `/api/whatsapp/simulate` unauthenticated, arbitrary tenant_id accepted | CRITICAL | Auth required, tenant derived from JWT not request body |
| 3 | Webhook: no signature verification + hardcoded "first tenant" routing | HIGH | HMAC verification added, routing by phone_number_id (new `tenants.whatsapp_phone_number_id` column) |
| 4 | JWT secret silently falls back to hardcoded default | HIGH | Boot-time guard fails fast in production if unset |
| 5 | No rate limiting on paid AI endpoints / webhook | HIGH | Rate limiters added to digitize, insights query, webhook |
| 6 | CORS wide open | MEDIUM | Scoped to allowlist via CORS_ORIGINS |
| 7 | Raw DB errors surfaced to end users | MEDIUM | Generic user-facing message, detail logged server-side only |
| 8 | Registration not transactional (edge case on pre-BEGIN validation failure) | LOW | transactionStarted guard added |

**✅ Re-verified live (2026-08-27):** All 8 fixes tested against the running server/DB, not just code review — including planting a second tenant's Rs. 999,999 order to confirm a prompt-injection insights query never leaked it, and confirming a staff-role account gets 403 on the insights endpoint. No further re-verification needed unless this code changes again.

**Any new feature/endpoint built going forward must follow this same pattern:** tenant_id enforced in code, parameterized queries only, rate limits on AI-calling or public-facing endpoints, generic error messages to users.

**New standing rule (added 2026-08-27):** any endpoint that reads a balance/count then writes an updated value (loyalty points, inventory stock, wallet/store credit if built later) must lock the relevant row inside a transaction before the read, not just wrap the write in a transaction. A real exploitable bug was found and fixed in loyalty redemption (`redeemPoints` read balance and inserted the redemption as two separate, unlocked queries — 5 concurrent requests could drain a balance negative). Verified fix: row-locked, re-tested with 5 concurrent requests, exactly 1 succeeds, balance lands at exactly 0. **Inventory's stock-decrement logic (built in this same pass) has not yet been confirmed safe against this same race condition — check it before relying on stock counts under real concurrent order load.**

### 3.1 Other bugs found and fixed in this pass (2026-08-27)
| # | Bug | Fix |
|---|---|---|
| 1 | Loyalty double-redemption race (see above) | Row-locking transaction |
| 2 | Campaign send blocked the HTTP request for the whole broadcast — would exceed serverless function timeout on any real-size list | Endpoint responds immediately, send loop continues via `waitUntil` (`@vercel/functions`), frontend polls `/status` |
| 3 | Raw `SyntaxError` leaked to users on any non-JSON error response (e.g. a 429 from express-rate-limit returns plain text, crashed the shared `api.js` request helper) | try/catch with a clean fallback message |
| 4 | Dashboard's low-stock alert link was inert — linked to `/inventory?low_stock=true` but `Inventory.jsx` never read that query param | Fixed, filter now applies on click |
| 5 | Debug instrumentation (`window.__debug`, stray `console.log`) left in `PublicMenu.jsx` | Cleaned up |

**Housekeeping open item:** 9 untracked `step*.png` screenshot files sit at the repo root (leftover manual-verification artifacts from another session) — not committed, but not deleted. Recommend deleting them, or adding `*.png` at the repo root to `.gitignore` if screenshots may land there again during testing.

---

## 4. Complete Feature Set — Built / Planned / Gap

Benchmarked against Bitecast (bitecast.ai), a mature competitor product, as of 2026-08-26.

| Feature | Status | Notes |
|---|---|---|
| WhatsApp AI ordering (conversational NLU) | ✅ Built | **Differentiator vs. Bitecast** — theirs is menu-flow, not conversational AI |
| Menu photo digitization (AI vision) | ✅ Built | Differentiator |
| Natural-language insights Q&A | ✅ Built | Differentiator |
| Kitchen Display System | ✅ Built | Realtime poll (10s) |
| Multi-branch, multi-tenant core | ✅ Built | Strong isolation (tenant_id enforced everywhere post-audit) |
| Owner admin dashboard | ✅ Built | Menu, Orders, Kitchen, Insights, Branches |
| Order status → WhatsApp push | ✅ Verified live | |
| Order confirmation summary | ✅ Verified live | |
| AI menu recommendations (WhatsApp) | ✅ Verified live | |
| Customer web app (browse/cart/checkout) | ✅ Built & live (Phase 1-2) | Deployed at resto-ai-client.vercel.app/order/:tenantSlug; no login, phone+name identity, no OTP |
| Payments (JazzCash/EasyPaisa/cards/COD) | 📋 Partial — COD bookkeeping only | Gateway integration skipped by decision; `payments` table + COD flow built and verified, no live charge capability |
| Live order tracking (customer-facing) | ✅ Built & live | Phone-gated, 10s polling |
| Dine-in QR ordering + table sessions | 📋 Specced | Phase 4 |
| Bill splitting (dine-in) | 📋 Specced | Phase 4 |
| Loyalty points | ✅ Built & verified live | Row-locking race-condition fix applied (see Section 3) — verified 5 concurrent redemptions → exactly 1 succeeds, balance never goes negative |
| Reviews | 📋 Specced | Phase 5 |
| Push notifications | 📋 Specced | Phase 5 |
| In-app AI assistant widget | 📋 Specced | Phase 5, reuses WhatsApp agent logic |
| **Multi-branch POS** (counter + dine-in orders, split tabs, settle bills) | ❌ Gap | Bitecast has this; not in current spec — **post-hackathon roadmap** |
| **Riders/delivery management + cash reconciliation** | ❌ Gap | Post-hackathon roadmap |
| **Broadcasts/WhatsApp marketing campaigns** | ✅ Built & verified live | 17-recipient live test passed; fixed a serverless-timeout bug (send loop now uses `waitUntil`, frontend polls `/status` instead of blocking) |
| **Reservations & table booking** | ❌ Gap | Cheap to stub as "coming soon" for pitch |
| **Wallet/store credit** (beyond points) | ❌ Gap | Extend loyalty_points design when built |
| **Inventory management** (recipe-based auto-deplete, suppliers, purchase orders, food-cost margins) | ✅ Built | Reviewed solid on tenant-scoping/validation — **stock-decrement logic not yet confirmed safe under concurrent orders; same race-condition class as the loyalty bug, needs the same row-locking check (see Section 3)** |
| **Order-ready token board + digital menu board** (in-store screens) | ❌ Gap | Post-hackathon roadmap |
| **Customer CRM & segments** (tags, smart segments) | ❌ Gap | Post-hackathon roadmap |
| **Granular staff permissions** (Bitecast has 21/role) | Partial | Basic RBAC exists (authorize() gates); not granular |
| **Restaurant landing page builder** (5-10 templates, subdomain + custom domain) | 📋 Specced | `impl-11-landing-page-builder.md` — not in Bitecast's feature set; market-research-driven addition directly countering the Foodpanda-commission pain point (see below) |

### 4.1 Market Research Basis (2026-08-27)
Researched Pakistani restaurant industry pain points to validate positioning. Key findings:
- Foodpanda commission runs 25-35% per order; a 2020 Karachi restaurant boycott followed a jump from 18% to 35%, and a formal Competition Commission of Pakistan antitrust inquiry (opened 2021, following APRA and competitor complaints) is still referenced by owners today — this is a documented, litigated pain point, not a hypothetical one
- Restaurants absorb reputational damage from platform-side failures (misdelivery, refund disputes, VAT disputes) that aren't their fault
- Macro pressure compounds the commission pain: inflation at 11.7% YoY (May 2026), energy costs up ~30% annually
- Digital adoption barriers are real (poor infrastructure, high cost) but WhatsApp-first tooling sidesteps most of them — validates the existing product direction
- Market is growing (~$1.93B in 2026), so this is a timing opportunity, not a shrinking-market play

**Positioning takeaway:** the strongest pitch framing is "escape Foodpanda's 25-35% commission with your own zero-commission channel" — not just "AI restaurant SaaS." The landing page builder (Section 4, `impl-11`) exists specifically to make that pitch credible — a restaurant with only a WhatsApp number and a Foodpanda listing has no independent web presence to point to; a branded page they own is what "stop depending on Foodpanda" needs to visibly look like.
| Branded ordering website, custom domain | 📋 Partially specced | Customer app spec covers the app; custom-domain-per-branch not yet designed |
| Marketplace listing (discovery) | Not planned | Bitecast also lists as "coming soon" — low priority for either |
| Multi-currency/timezone | Not needed | Pakistan-only focus, skip |

**Positioning note:** Do not lead with "installable app" as the primary channel — Bitecast's stated positioning ("no app to install, they already have WhatsApp") is deliberate and matches this market. Position the customer web app as link-based/no-install-required, with PWA install as an optional bonus, not the headline.

---

## 5. Architecture Reference

```
Customers → [WhatsApp Gateway] + [Customer Web App (planned)] + [POS counter (gap)]
                              ↓
                   Shared Backend API (Express)
                   - Existing: auth, menu, orders, branches, insights, whatsapp
                   - Planned: customer-auth(OTP), cart, payments, reviews,
                     loyalty, notifications, table-sessions, recommendations(REST)
                              ↓
              PostgreSQL (Neon) ←→ Qwen AI Agent (via Qoder/DashScope)
                              ↓
                    Payment Gateway (JazzCash/EasyPaisa — provider TBD)
```

**Multi-tenancy:** shared schema, `tenant_id` on every table, enforced in code (not prompt/client input) after the audit fixes.

**New tables required for customer app** (not yet built): `customer_sessions`, `carts`, `cart_items`, `table_sessions`, `payments`, `reviews`, `loyalty_points`, `loyalty_config`, `notifications`, `push_subscriptions`, `saved_addresses`. Full field-level detail in `customer-app-specification.md`.

**New tables required for Bitecast-parity gap features** (not designed yet, add when scoped): `pos_sessions`/`tabs` (POS), `riders` + `rider_assignments` + `cash_reconciliation` (delivery), `reservations` (table booking), `broadcast_campaigns` (marketing), `inventory_items` + `recipes` + `suppliers` + `purchase_orders` (inventory), `staff_permissions` (granular RBAC), `customer_tags`/`segments` (CRM).

---

## 6. Reference Documents (still valid, not superseded)

- `restaurant-saas-development-plan.md` — original hackathon dev plan, architecture principles, sprint timeline
- `customer-app-specification.md` — full customer-facing app spec (features, data model, API endpoints, page structure, phases 1-6)
- `impl-00-INDEX.md` through `impl-11-landing-page-builder.md` — step-by-step build specs for all pending features; `impl-07` (broadcasts) and `impl-08` (inventory) are now built (Section 4), the rest remain pending
- Prior fix/security prompts — implementation instructions already executed (Section 3 above is the outcome summary; full prompt text not needed going forward)

This master document is the **entry point** — read this first, then open the two docs above only if implementing something in their scope requires field-level detail this summary omits.

---

## 7. Immediate Priorities (in order)

1. **Verify inventory's stock-decrement logic is safe under concurrent orders** — same race-condition class as the fixed loyalty bug (Section 3), not yet confirmed for `impl-08`
2. **Delete or .gitignore the 9 untracked `step*.png` screenshot files** at the repo root
3. **Rehearse the live demo end-to-end** using the production URLs (resto-ai-client.vercel.app) — WhatsApp AI ordering + public web ordering + admin dashboard + broadcasts + inventory
4. **Decide pricing/commission stance** (Section 8) before the pitch, in case judges ask post-Bitecast-benchmark — no decision made yet
5. **Pick 1 more "coming soon" feature** to mention in the pitch beyond what's now built (reservations is the cheapest remaining option) — broadcasts is no longer "coming soon," it's built
6. Remaining `impl-*.md` files not yet built (dine-in QR, POS, riders, reservations, loyalty's reviews/notifications/AI-widget siblings, token/menu boards, CRM+RBAC) stay roadmap-only unless time remains before the deadline

---

## 8. Business Model Note (from Bitecast benchmark)

Bitecast's model: 0% commission, flat monthly plan, no setup fee, cancel anytime. Worth deciding your own pricing/commission stance before the pitch, since judges may ask — no decision has been made on this yet in any prior session.
