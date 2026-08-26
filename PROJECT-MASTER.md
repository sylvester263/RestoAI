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

**Demo account:** ahmed@karahi.pk / demo1234 (tenant: Lahore Karahi House)

### 2.2 Production Deployment (Live)
- **Client:** resto-ai-client.vercel.app · **Server:** resto-ai-server.vercel.app (Express as Vercel Function)
- **Repo:** github.com/sylvester263/RestoAI
- Deploy gotchas: saving a Vercel env var does **not** trigger a rebuild by itself — needs a fresh deployment. Monorepo "unaffected project" logic can skip a rebuild and leave the domain briefly unaliased — force a rebuild under the affected directory if this happens.

### 2.3 Config / Env
| Var | Status |
|---|---|
| DATABASE_URL, JWT_SECRET | Configured; JWT boot-fails if missing in production |
| DASHSCOPE_API_KEY | User reported "updated" — not independently re-verified since; re-check if AI features misbehave |
| WHATSAPP_TOKEN / PHONE_NUMBER_ID / WEBHOOK_VERIFY_TOKEN | Not set — demo mode (console-logged replies), acceptable for hackathon |
| WHATSAPP_APP_SECRET, CORS_ORIGINS | Configured |

---

## 3. Security Status

Full security audit performed, **all 8 findings fixed and re-verified live** against the running server/DB (not just code review) — including planting a second tenant's order to confirm a prompt-injection insights query never leaked it.

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

**Standing rule:** any endpoint that reads a balance/count then writes an updated value must lock the row in a transaction before the read, not just wrap the write. Real bug found/fixed in loyalty redemption (5 concurrent requests could drain a balance negative) — fixed with `FOR UPDATE` row lock, re-verified: exactly 1 of 5 concurrent requests succeeds.

### 3.1 Known gaps as of 2026-08-27 full audit (not yet fixed)
| # | Gap | Severity | Where |
|---|---|---|---|
| 1 | Rate limiting missing on `/api/payments/*`, campaign send, public reservations | Medium | Only `/insights/query`, digitize, and the WhatsApp webhook are rate-limited — every other AI/public endpoint added since is not |
| 2 | Campaign "send" has no duplicate-click guard | Low-Medium | Two rapid clicks on Send could start two parallel send loops → customers get broadcast twice |
| 3 | Kitchen display mislabels dine-in orders as "Pickup" | Low (visible bug) | `Kitchen.jsx`: `delivery_address ? 'Delivery' : 'Pickup'` — dine-in has no address, so it falls into "Pickup" instead of "Dine-in" |
| 4 | `loyalty_config` not seeded | High for demo | `seed.js` has no `loyalty_config` row → loyalty shows "not enabled" on a fresh demo unless seeded manually — **5-minute fix, do this before any demo** |
| 5 | N+1 query on PublicMenu (reviews fetched per-item) | Low | Works correctly, just inefficient — fine for demo scale |

### 3.2 Bugs found and fixed in the 2026-08-27 pass
| # | Bug | Fix |
|---|---|---|
| 1 | Loyalty double-redemption race (see standing rule above) | Row-locking transaction |
| 2 | Campaign send blocked the HTTP request for the whole broadcast — would exceed serverless timeout on a real-size list | Responds immediately, send loop continues via `waitUntil`, frontend polls `/status` |
| 3 | Raw `SyntaxError` leaked to users on any non-JSON error response (e.g. 429 from express-rate-limit) | try/catch with clean fallback message |
| 4 | Dashboard's low-stock alert link was inert (`Inventory.jsx` never read the query param) | Fixed |
| 5 | Debug instrumentation left in `PublicMenu.jsx` | Cleaned up |

**Housekeeping:** 9 untracked `step*.png` screenshot files sit at the repo root — delete them, or add `*.png` at the repo root to `.gitignore`.

---

## 4. Complete Feature Set — Verified Status

Full codebase audit (2026-08-27) against all 11 `impl-*.md` specs. Percentages are spec-completion estimates from that audit, not vague labels.

| Feature | Spec | Status | Notes |
|---|---|---|---|
| WhatsApp AI ordering (conversational NLU) | — | ✅ Built | Differentiator vs. Bitecast — theirs is menu-flow, not conversational AI |
| Menu photo digitization (AI vision) | — | ✅ Built | Differentiator |
| Natural-language insights Q&A | — | ✅ Built | Differentiator |
| Kitchen Display, admin dashboard, multi-tenant core | — | ✅ Built | Kitchen has the dine-in mislabel bug (Section 3.1) |
| Public customer ordering app (menu/cart/checkout/tracking) | — | ✅ Built & live | No login, phone+name identity, no OTP (decided against for speed) |
| **Payments** | impl-01 | 🟡 45% | COD lifecycle fully works (pending→paid on delivery, verified live). Online gateway (JazzCash/EasyPaisa/card initiate+webhook) **not built** — checkout UI offers the options but they currently behave as COD. Decide before pitch whether this was an intentional scope call or needs framing as roadmap. |
| **Dine-in QR ordering + table sessions** | impl-02 | 🟢 80% | Built and largely verified: QR→session resolution, multi-round ordering, itemized bill, even-split, staff close. Schema improved on the spec (separate `restaurant_tables`/`table_sessions`). Missing: "call waiter" button, QR download/print. |
| **Loyalty, Reviews, Push, AI Assistant** | impl-03 | 🟢 85% | Loyalty: built, row-lock-safe, **but needs `loyalty_config` seeded (3.1) or it shows disabled**. Reviews: built. Push: built (VAPID, service worker). AI widget: built, read-only confirmed. Missing: WhatsApp "how many points do I have" query. |
| **Multi-branch POS** | impl-04 | 🔴 0% | Nothing built. Largest unbuilt feature by scope. |
| **Riders/delivery + cash reconciliation** | impl-05 | 🔴 0% | Nothing built. |
| **Reservations & table booking** | impl-06 | 🟢 90% | Built and verified: public booking, WhatsApp confirmation, admin day view, status lifecycle, future-date validation. Missing: WhatsApp conversational booking intent, rate limiting (3.1). |
| **Broadcasts/WhatsApp marketing** | impl-07 | 🟢 80% | Built, verified live (17-recipient test), serverless-timeout bug fixed. Missing: scheduled sends, opt-out handling, 24h-window check, duplicate-send guard (3.1). |
| **Inventory management** | impl-08 | 🟠 25% | **Correction from earlier status** — what exists is a basic stock tracker (CRUD + manual restock + low-stock KPI), which is genuinely useful but is not what impl-08 specified. Recipe-based auto-deplete, supplier management, purchase orders, auto-86, and food-cost margins — the actual differentiator vs. Bitecast — are **not built**. Treat as still "Large effort, post-hackathon" per the original spec. |
| **Order-ready token board + digital menu board** | impl-09 | 🟢 90% | Built and verified: no-PII token board, auto-refreshing menu board with sold-out flagging, Urdu names. Missing: rate limiting on public display endpoints. |
| **Customer CRM & segments + granular RBAC** | impl-10 | 🔴 0% | Nothing built. |
| **Restaurant landing page builder** | impl-11 | 📋 Specced only | Not yet started — market-research-driven addition (Section 4.1), directly counters the Foodpanda-commission pain point |
| Wallet/store credit (beyond points) | — | ❌ Gap | Extend loyalty_points design if built |
| Marketplace listing | — | Not planned | Bitecast also lists as "coming soon" — low priority for either |
| Multi-currency/timezone | — | Not needed | Pakistan-only focus |

**Overall:** 4 of 11 features fully/mostly complete (80%+), 2 partial (25-45%), 1 specced-only, 4 not started. Remaining full-completion effort estimated at ~15-22 days across the unfinished/unstarted items — not achievable before Sept 4 in full; see Section 7 for what's actually worth doing before the deadline.

**Positioning note carried forward:** do not lead with "installable app" as the primary channel — Bitecast's own positioning ("no app to install, they already have WhatsApp") is deliberate and matches this market; the public web app is link-based/no-install-required, PWA install is a bonus, not the headline.

### 4.1 Market Research Basis (2026-08-27)
- Foodpanda commission runs 25-35% per order; a 2020 Karachi restaurant boycott followed a jump from 18% to 35%, and a formal Competition Commission of Pakistan antitrust inquiry (opened 2021) is still referenced by owners today — documented, litigated, not hypothetical.
- Restaurants absorb reputational damage from platform-side failures (misdelivery, refund/VAT disputes) that aren't their fault.
- Macro pressure compounds it: inflation 11.7% YoY (May 2026), energy costs up ~30% annually.
- Digital adoption barriers are real (poor infrastructure, high cost) but WhatsApp-first tooling sidesteps most of them — validates the existing product direction.
- Market is growing (~$1.93B in 2026) — a timing opportunity, not a shrinking-market play.

**Positioning takeaway:** "escape Foodpanda's 25-35% commission with your own zero-commission channel" is the sharpest pitch framing. The landing page builder (`impl-11`) exists specifically to make that pitch credible — a restaurant with only WhatsApp + a Foodpanda listing has no independent web presence; a branded page they own is what "stop depending on Foodpanda" needs to visibly look like.

---

## 5. Architecture Reference

```
Customers → WhatsApp Gateway + Public Web App (menu/cart/checkout/tracking, live)
          → Dine-in QR (table sessions, live) → Reservations (live) → Display boards (live)
                              ↓
                   Shared Backend API (Express)
                   Built: auth, menu, orders, branches, insights, whatsapp,
                   public (cart/checkout/tracking/reviews/loyalty/recommendations),
                   table-sessions, reservations, campaigns, inventory (basic), display
                   Not built: pos, riders, full inventory (recipes/PO/auto-deplete),
                   crm/segments, granular rbac, payment gateway, landing-page
                              ↓
              PostgreSQL (Neon, 20 tables) ←→ Qwen AI Agent (via Qoder/DashScope)
                              ↓
                    Payment Gateway — NOT integrated (COD-only in production)
```

**Multi-tenancy:** shared schema, `tenant_id` on every table, enforced in code after the audit fixes — consistently applied per the 2026-08-27 audit across all built features.

---

## 6. Reference Documents

- `restaurant-saas-development-plan.md` — original hackathon dev plan, architecture principles
- `customer-app-specification.md` — full customer-facing app spec (superseded in status by Section 4 above, kept for field-level detail)
- `impl-00-INDEX.md` through `impl-11-landing-page-builder.md` — step-by-step build specs; status of each now tracked in Section 4's table, not in the index file (which predates the audit)

This master document is the **entry point** — read this first; open a spec file only for field-level implementation detail this summary omits.

---

## 7. Immediate Priorities (in order)

1. **Seed `loyalty_config`** — 5-minute fix, currently blocks the loyalty demo entirely (Section 3.1 #4)
2. **Fix the Kitchen "Dine-in" mislabel** — trivial, but visible in any live demo of dine-in ordering (Section 3.1 #3)
3. **Add rate limiting to `/api/payments/*`, campaign send, and public reservations** — closes a real gap against the established security pattern (Section 3.1 #1)
4. **Add a duplicate-click guard to campaign send** — prevents accidentally double-broadcasting to customers (Section 3.1 #2)
5. **Decide and clearly frame the payments story for the pitch** — COD works end-to-end; be ready to say gateway integration is roadmap, not "almost done"
6. **Delete/.gitignore the stray screenshot files**
7. **Rehearse the full live demo** — WhatsApp ordering, public web ordering, dine-in QR, reservations, loyalty (after fix #1), reviews, broadcasts, display boards — this is now a lot of real surface area to walk through, budget real rehearsal time
8. **Decide pricing/commission stance** before the pitch (Section 8)
9. POS, riders, full inventory, CRM/segments, granular RBAC, and the landing page builder remain roadmap-only unless real time remains before Sept 4 — do not start these now

---

## 8. Business Model Note (from Bitecast benchmark)

Bitecast's model: 0% commission, flat monthly plan, no setup fee, cancel anytime. Worth deciding your own pricing/commission stance before the pitch, since judges may ask — no decision made yet.