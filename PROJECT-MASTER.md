# RestoAI — Master Project Specification & Status
**Last updated:** 2026-08-29 · **Purpose:** Single source of truth for this project's current state, architecture, and roadmap. Load this file instead of re-explaining project history in future agent sessions.

**⚠️ URGENT, read this first:** the 2026-08-29 full audit found real credentials (DB connection string, JWT secret, DASHSCOPE API key, VAPID keys) sitting in a tracked `.env` file. **Confirm whether this file is committed to the public GitHub repo before anything else in this document.** If it is, those secrets are already exposed and need rotating, not just gitignoring after the fact. This supersedes every other priority below until resolved.

**Second-most-important thing to know:** the 2026-08-29 audit was thorough and file/line-cited throughout, but it was **code-only — no live API calls, no live DB queries, no production URL hits were performed**. Every "fully built" status below reflects that the code exists and is correctly wired, not that it was exercised live. Treat "code-verified" as a real step up from earlier "claimed, not verified" language, but not the same as "verified live" — this project's history shows the two can diverge.

---

## 1. Product Summary

RestoAI is a multi-tenant, AI-native restaurant operations SaaS for the Pakistani market. Core differentiator vs. Bitecast: a Qwen-powered conversational AI agent handles WhatsApp ordering (not menu-flow), plus AI menu digitization and natural-language insights. Positioning validated by market research (Section 5.1): "escape Foodpanda's 25-35% commission" is the sharpest pitch framing. Build phase deadline **September 4, 2026** (Alibaba Cloud AI Hackathon Pakistan 2026, Alkhidmat Foundation / Bano Qabil).

**Confirmed actual scale (2026-08-29 full audit, corrects earlier miscounts):** 28 route files, 22 backend services, 52 database tables, 34 client pages.

---

## 2. Current State — Code-Verified 2026-08-29

Every feature listed here has confirmed, correctly-wired code (file/line evidence in the full audit). Nothing below has been live-tested this session.

**Core system:** auth (register/login/JWT), menu (CRUD + AI digitize), orders (all channels, server-trusted pricing), WhatsApp AI ordering (full conversation pipeline — **currently demo mode, see 2.1**), NL insights Q&A, Kitchen display (4-way channel label confirmed correct, contradiction from an earlier doc resolved as that doc being wrong).

**Feature specs impl-01 through impl-25:** all confirmed present and wired — payments (COD lifecycle), dine-in QR/table sessions, loyalty/reviews/push/AI widget, POS (floor + full billing: tax, split-tender, void/refund, shifts, receipts), riders/delivery/cash reconciliation + rider auth (separate JWT, confirmed structurally non-interchangeable with staff JWT), reservations (incl. WhatsApp conversational booking), broadcasts, inventory (recipe-based depletion, suppliers, POs — **negative-stock gap, see 3.3**), token/menu display boards, CRM + tags + segments + RFM, granular RBAC (15+ files using permission-key checks), coupons + referral program (race-safe), landing page builder — **live-verified 2026-08-29: all 5 templates switch correctly, reserved-word rejection works (admin/login/register/api/dashboard all blocked), full publish→live→unpublish→404→republish→live lifecycle confirmed via real API calls; custom domain correctly shows "coming soon," consistent with its not-yet-built status** — RestoAI's own marketing site, staff invites, all 8 agentic AI workers (daily briefing, win-back, dispatch, ETA, reconciliation, abuse detection, replenishment, menu insight), branch analytics (hard-locked access per manager, as recommended).

### 2.1 Known operational gaps (informational, not bugs)
- **WhatsApp is in demo mode** — all 4 WhatsApp env vars are placeholder values; `sendReply` logs to console instead of calling Meta's API. Every WhatsApp-dependent feature (ordering, agent notifications, low-stock alerts) generates correctly but doesn't actually send until real credentials are set.
- **Rider PWA is not actually installable** — no manifest.json, no install prompt; `impl-23`'s PWA installability spec was not implemented. Currently a plain mobile web page, not "installs like an app."

---

## 3. Security Status

### 3.1 Original 8 findings (Aug 26 audit) — fixed and previously re-verified live, holds
Tenant_id server-side resolution, LLM-SQL keyword/stacked-statement rejection, JWT_SECRET production boot-guard, rate limiting on original AI/public endpoints, generic error messages, row-locking pattern established (loyalty redemption).

### 3.2 2026-08-29 audit — tenant_id spot-check: 12/12 routes PASS
Every spot-checked route across auth, orders, public, POS, analytics, inventory, riders, rider-app, agents, purchase-orders, and segments resolves tenant_id server-side only. No client-supplied tenant_id accepted anywhere checked.

### 3.3 2026-08-29 audit findings — status after 2026-09-05 re-check
| # | Finding | Severity | Status |
|---|---|---|---|
| 0 | Real secrets in tracked `.env` | URGENT | ✅ **Resolved — confirmed never committed to git history** (`git log --all --diff-filter=A` verified), not just gitignored going forward. This item is closed. |
| 1 | `CRON_SECRET` no production boot-guard | HIGH | ✅ Fixed — now boot-guards same as `JWT_SECRET`. Also applied to the new `SUPER_ADMIN_JWT_SECRET`. |
| 2 | `/api/agents/*/run` no rate limiter | HIGH | 🔴 **Still open** — skipped while other fixes landed. Fix prompt written 2026-09-05, pending execution. |
| 3 | Inventory depletion no `FOR UPDATE`/negative-stock floor | MEDIUM | ✅ Fixed correctly — sorted-id row locking (deadlock-safe) plus a hard floor. |
| 4 | `token-board` tenant-ownership check | MEDIUM | Not re-checked this pass — status unconfirmed, carry forward |
| 5 | `customers.total_spent` includes delivery fee | LOW | Still open — business-logic decision, needs owner sign-off, not a code fix |
| 6 | Ingredient queries filter by `id` only, not `tenant_id` | LOW | Still open — defense-in-depth gap, low practical risk |

### 3.5 2026-09-05 audit — new finding, the highest-priority item right now
**Tenant suspension enforcement is built but never mounted — a real admin feature silently does nothing.** `routes/super-admin.js` correctly flips `tenants.subscription_status` to `'suspended'`. `middleware/auth.js` has fully-built `checkTenantActive`/`checkRiderTenantActive` (60s-cached lookup) — exactly what `impl-29`'s own spec explicitly required ("a required touchpoint in the existing authenticate middleware to actually enforce suspension"). **Neither is imported or mounted on any route.** A suspended tenant's staff and riders retain full normal access. Fix prompt written 2026-09-05, pending execution — this is the single highest-value fix outstanding.

### 3.6 Other findings, 2026-09-05
- **Zero automated tests anywhere in the repo.** Acceptable for the hackathon deadline; flag if this becomes a maintained product.
- `alert()`/`confirm()` cleanup (from the UX audit) mostly done — down to 2 occurrences.
- New endpoints (`/api/support`, the owner WhatsApp assistant) both correctly follow the tenant-security pattern — checked and pass.
- WhatsApp still in demo mode, rider PWA still not installable — both unchanged, both still acceptable-for-demo.
- **Note:** this audit is dated 2026-09-05, after the hackathon's Sept 4 23:59 PKT submission deadline — if already submitted, remaining fixes matter for product correctness going forward, not demo/judging risk.

### 3.7 impl-30 — WhatsApp Embedded Signup (per-tenant number connection) — built 2026-09-05
Lets an owner connect their own WhatsApp Business number via Meta's Embedded Signup instead of the platform operator hand-configuring one number per tenant. New: `services/encryption.js` (AES-256-GCM, establishes this codebase's first encryption-at-rest pattern — `ENCRYPTION_KEY` env var, same production boot-guard shape as `JWT_SECRET`), `services/whatsapp-connect.js` (Graph API calls: code exchange, phone registration, webhook subscription with a read-back confirmation), `routes/whatsapp-connect.js` (`/session`, `/callback`, `/status`, `/disconnect`, owner-gated except status which is owner/manager), migration adds `tenants.whatsapp_waba_id`/`whatsapp_connection_status`/`whatsapp_connected_at`/`whatsapp_pin_encrypted`/`whatsapp_connection_error` (last one beyond the spec's literal list, added to satisfy its own "enough detail to debug" requirement), client page `WhatsAppConnect.jsx` + nav entry.

**Required architectural fix made in the same pass, per the spec's own instruction:** `services/whatsapp.js`'s `sendReply()` was resolving `phone_number_id` from one global env var for every tenant, while inbound webhook routing was already correctly per-tenant — a real gap the spec explicitly flagged as "confirm this, fix it in this same pass if not." Fixed: `sendReply(phone, text, tenantId)` now resolves each tenant's own connected number first, falling back to the platform default only for tenants that haven't connected one yet. All 12 call sites across the codebase (whatsapp.js, campaigns, public checkout, staff-invites, and 6 agent services) updated to pass `tenantId`.

**Live-verified 2026-09-05** (no real Meta Tech Provider app available in this environment, so full end-to-end signup couldn't be exercised — see what follows for exactly what was and wasn't proven): migration applied to the live DB (individually, auto-committed — the single-transaction historical `migrate.js` deadlocked against live traffic exactly as documented elsewhere in this doc, worked around the same way); AES-256-GCM round-trip + tamper detection confirmed (a modified stored value correctly fails to decrypt); owner-only gating on `/session`/`/callback`/`/disconnect` confirmed (a manager got 403 with a clear message, could still read `/status`); tenant isolation on `/callback` confirmed (a spoofed `tenant_id` in the request body has no effect — the schema doesn't even accept the field, everything is scoped to `req.user.tenant_id`); the "not configured" 503 gate confirmed, then, with fake-but-present `META_APP_ID`/`META_APP_SECRET`/`META_CONFIG_ID`, confirmed the code path executes a **real** call to `graph.facebook.com` (got back a genuine `Invalid Client ID` OAuthException with a real `fbtrace_id`) and correctly stored `whatsapp_connection_status='error'` with the raw Meta error logged server-side only (never returned to the client) — and a bug this same live-testing pass caught and fixed: `/status` was showing a masked phone number for tenants with a legacy manually-set `whatsapp_phone_number_id` even while `connection_status` was `'not_connected'`, now correctly gated to only show once actually connected via this flow.

**Not verifiable without a real approved Meta Tech Provider app** (this file's own stated precondition): the actual frontend FB.login() popup flow end-to-end, the phone `register` call, and the `subscribed_apps` webhook subscription + read-back — these are implemented per Meta's documented Cloud API shape (confirmed via live doc fetches for the `register` endpoint's exact parameters; the `subscribed_apps` POST behavior is implemented from broad, well-established integration knowledge since Meta's own auto-generated Graph API reference page for that edge was inconclusive on live fetch — flagged in this exact spot in the code as the one detail most worth re-confirming against current docs before relying on it in production, per the spec's own caution on this point).

### 3.4 Confirmed-correct on this pass (worth knowing what's solid, not just what's broken)
Row-locking (`FOR UPDATE`) confirmed present and correctly transaction-scoped on: loyalty redemption, coupon validation/redemption, referral reward completion, POS settlement/void/refund, rider cash reconciliation, purchase order receiving, campaign send. Rider JWT vs. staff JWT confirmed structurally non-interchangeable (separate secret + a `type: 'rider'` claim check, not just convention).

---

## 4. Reference Documents

- `restaurant-saas-development-plan.md`, `customer-app-specification.md` — original planning docs
- `impl-00-INDEX.md` through `impl-25-branch-analytics.md` — all feature build specs; per Section 2, every one of these is now code-confirmed built
- `impl-agents-INDEX.md`, `impl-14` through `impl-21` — the original 8 agent specs, all code-confirmed built (now 10 total with impl-27/28, see below)
- `impl-22-restoai-marketing-page.md` — **recreated 2026-08-30 (v2)**, replacing a stale version written before the agent count reached 10 and before POS billing/branch analytics/coupons-referral/CRM-RFM were confirmed built. Now includes: a rebuilt "Your AI Team" section showing all 10 agents (not 8), and a **new size-tiered pricing model** (Starter/Growth/Enterprise, by branch count) replacing the old flat per-branch number. **Pricing figures are still a recommendation pending owner sign-off, not final** — same standing rule as every prior pricing mention in this project.
- `impl-26-landing-page-redesign.md` — marketing site 3D-hero/screenshot/motion redesign (superseded in scope by impl-22 v2 above for content; this file's visual-treatment guidance — static hero image, real screenshots, Framer Motion scroll reveal — still applies)
- `impl-27-customer-support-agent.md` — **BUILT AND VERIFIED (2026-08-30)**. `support_tickets`/`support_messages` tables confirmed, "support" intent live in the classifier, escalation path live-tested (complaint language → immediate escalation, zero AI-attempted resolution, correct reply), admin `Support.jsx` (457 lines) wired and functional.
- `impl-28-owner-whatsapp-assistant.md` — **BUILT AND VERIFIED (2026-08-30)**. `users.phone` + unique index confirmed. **Security boundary live-tested and holds**: an unregistered phone asking a business-data question was correctly routed to the customer support pipeline (zero business data leaked); a verified owner phone got a real, data-grounded answer. `business-assistant-agent.js` (362 lines) — rate limited, branch-access scoped for managers, "what needs attention" aggregation across all 4 agent flag tables.
- `impl-29-super-admin-panel.md` — new, not yet built. Platform-operator tenant/subscription management (expiration tracking, extend/suspend/comp), scoped deliberately small. **Key design: structurally separate auth from every existing role — dedicated JWT secret, mandatory TOTP MFA, full audit-log middleware, and a required touchpoint in the existing `authenticate` middleware to actually enforce suspension.** Impersonation, dunning automation, and platform analytics are explicitly deferred.
- `impl-30-whatsapp-embedded-signup.md` — new, not yet built. Per-tenant "Connect WhatsApp" flow via Meta Embedded Signup, feeding the already-audited `phone_number_id`-based webhook routing. **Hard precondition: requires an approved, Live Meta Tech Provider app — this is a business/compliance process, not something this spec builds.** Key design: one platform-level `WHATSAPP_TOKEN` serves all connected tenants (Tech Provider delegated access), only `phone_number_id` varies per tenant; two-step verification PIN generated programmatically and stored encrypted, never plaintext.
- **Agent count is now 10, not 8** — update any presentation/pitch material accordingly.

This master document is the entry point — read this first.

---

## 5. Business & Market Context

### 5.1 Market Research Basis
Foodpanda commission 25-35%/order; a 2020 Karachi boycott and 2021 CCP antitrust inquiry are still referenced today. Inflation 11.7% YoY (May 2026), energy costs up ~30% annually. Market ~$1.93B in 2026. **Positioning:** "escape the commission" is the sharpest pitch framing — the landing page builder and marketing site exist to make it credible.

### 5.2 Regulatory note — FBR e-invoicing
Mandatory for registered businesses (SRO 69(I)/2025, SRO 709(I)/2025) — real-time invoice reporting, QR code + invoice number on receipts. **Must go through a licensed integrator (PRAL or equivalent) — cannot be built directly.** `impl-24` added a schema hook only (`fbr_invoice_number`/`fbr_qr_code_url`, unpopulated), correctly scoped as a partnership decision, not a build task.

### 5.3 Pricing research (2026-08-29) and recommendation
**International (US/UK) SaaS restaurant tech:** flat monthly fee + separate card-processing %, no order commission — Toast ($0-69+/mo, 2.49-3.09%+15¢), Square ($0/$49/$149, 2.6-3.3%+15-30¢), Clover ($60+/mo, 2.3-3.5%+10¢), SpotOn ($0+/mo, 1.99%+25¢), TouchBistro ($69+/mo). Category norm confirms "flat fee, no commission" is standard practice globally, not a novel pitch.

**Regional (South Asia, closest comparable market):** Petpooja (India) — **$50/location/month**, the most useful direct anchor given similar price sensitivity. Local on-premise billing software: ₹1,500-25,000, often one-time, low-quality/non-cloud — not real competition, just what restaurants settle for absent a better cloud option.

**Recommendation:** price meaningfully below Petpooja's $50/location, well above the low-quality local tier — **Rs. 8,000-15,000/month per branch (~$28-54)**, pitched explicitly as "less than one Foodpanda commission on a single busy weekend, every month, forever" rather than compared to competitor pricing. This is a recommendation with real data behind it, not yet an owner-confirmed decision — still needs sign-off before it goes in the pitch deck's pricing section (`impl-22`) or anywhere customer-facing.

### 5.4 Competitive landscape (2026-08-29)
**Local Pakistani POS (no AI/WhatsApp ordering — not real competition for the core differentiator):** LookPOS, itKINS (from PKR 2,000/mo), Moneypex, Foodnerd POS (FBR-integrated), MutfakPOS.

**⚠️ Most important finding: CherryBerry RMS** — a genuine, close, same-market competitor, more directly comparable than Bitecast. Does conversational WhatsApp AI ordering with explicit Roman Urdu / regional dish name understanding, WhatsApp Catalogue integration, multi-branch chains, multilingual auto-detection. **Recommend studying this product directly, not just Bitecast, before finalizing pitch positioning.**

**Bitecast** (prior research): full ops platform (POS/riders/broadcasts/reservations) but menu-flow bot, not conversational AI — differentiator gap holds against Bitecast specifically, not against CherryBerry.

**International WhatsApp/AI-ordering specialists (not Pakistan-specific, similar positioning):** MaviBot, OrderOnWhats.app (both use near-identical "no commission" framing to RestoAI's own pitch — confirms the positioning is sound but not unique globally), QuickReply.ai.

**International full-stack POS (already in pricing research, Section 5.3):** Toast, Square, Clover, SpotOn, TouchBistro — not WhatsApp-first, not Pakistan-focused.

**Actual defensible edge:** not "has WhatsApp AI ordering" alone (multiple competitors do) — it's the **combination**: full POS+billing+tax+shifts, multi-branch analytics, recipe-based inventory, 8 autonomous agents, a landing-page builder, and RFM-driven CRM sharing one data model, backed by a working, security-audited, code-confirmed system. Lead the pitch with breadth + working demo, not the WhatsApp-AI claim in isolation.

---

## 6. Immediate Priorities (in order) — updated 2026-09-05

1. **Mount `checkTenantActive`/`checkRiderTenantActive`** — suspension enforcement is built but never wired in; highest-value fix outstanding (Section 3.5). Fix prompt written, pending execution.
2. **Add rate limiting to `/api/agents/*/run`** — still open since 2026-08-29, skipped while other fixes landed. Fix prompt written, pending execution.
3. **Decide the `customers.total_spent` delivery-fee question** — business call, not a code fix
4. Re-check the `token-board` tenant-ownership item — not re-verified in the 2026-09-05 pass
5. Decide pricing/commission stance — the tiered model in `impl-22` v2 is a recommendation, not confirmed (Section 5.3)
6. Consider automated tests if this becomes a maintained product beyond the hackathon — currently zero
7. WhatsApp demo mode and the rider PWA gap remain open, both still acceptable unless time allows

**Resolved since 2026-08-29** (no longer priorities): the `.env` secrets question (confirmed clean), `CRON_SECRET`/`SUPER_ADMIN_JWT_SECRET` boot-guards, inventory row-locking + negative-stock floor, most of the `alert()`/`confirm()` UX cleanup.

---

## 7. UX/Design Audit (2026-08-29) — post-hackathon roadmap, not pre-deadline work

A full design-system audit across all 34 client pages found solid information architecture (role-based nav, 4 well-separated UX contexts: admin/kitchen/customer/rider) but a "template Tailwind" visual layer with no design tokens or component library — scored 3/10 design maturity. **This is normal for a project at this stage and functional depth, not a red flag** — a hackathon judge weighs functional scope and AI usage far more heavily than modal focus-trap compliance.

**The only 2 findings pulled forward into Section 6 above** (toast notifications, skeleton loading) — cheap, low-risk, visibly reduce "unpolished" moments in a live demo.

**Everything else is explicitly deferred, not forgotten:** WebSocket real-time (replacing the working 5-10s polling — real regression risk this close to the deadline), a full shadcn/ui + Radix component migration, PWA/offline support, keyboard shortcuts for POS, a 5-group sidebar restructure, framer-motion transitions. The full audit's 3-phase, ~10-week roadmap is legitimate future work — reference it after Sept 4, not before.
