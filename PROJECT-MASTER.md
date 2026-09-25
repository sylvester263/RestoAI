# RestoAI — Master Project Specification & Status
**Last updated:** 2026-09-25 (User-Manual QA fix pass, Section 2.2; impl-32 bank-transfer payments + AI Agent Pack, Section 2.3) · **Purpose:** Single source of truth for this project's current state, architecture, and roadmap. Load this file instead of re-explaining project history in future agent sessions.

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
- **Rider PWA is not actually installable** (re-checked on production 2026-09-25) — a `manifest.json` now exists, but it is app-wide with `start_url: /dashboard` (owner app, not rider), its `icon-192.png`/`icon-512.png` don't exist (production serves the SPA's HTML for both URLs, so Chrome rejects the manifest), and `sw.js` is only registered when someone opts into push. No rider-specific manifest, no install prompt; `impl-23`'s PWA installability spec still not implemented.

### 2.2 2026-09-25 User-Manual QA fix pass — live-verified on production
All 18 items the manual's QA found were worked through; commits `569a8cb` (Tier 1), `e2c4fcd` (Tier 2), `2adb66d` (Tier 3), each deployed and checked against production (API calls + headless Chrome), except where noted.
- **Fixed + verified live:** published tenant site crash (hook order in `PublicSite.jsx`); duplicate reviews (one per order, 409, tracking page shows the existing review); POS Settle window left open under the receipt; raw `**` in Menu Assistant / owner chat / Insights (new `MarkdownText`, no innerHTML) and in WhatsApp replies; staff "Failed to load dashboard" (staff now get an operations-scoped, branch-scoped dashboard, no financials); staff Coupons "No coupons yet" → honest permission message (command palette also now hides owner-only pages); menu photo upload (production had **no Blob store at all** — `restoai-menu-photos` created and connected to `resto-ai-server`; clear errors when upload fails); menu digitization (**never worked** — model's fenced JSON was never parsed; fixed + new "Import from photo" review screen); staff roster with remove/restore (soft `users.deactivated_at`; login and every authenticated request reject removed users, existing sessions cut off within ~30s); "Run now" for Daily Briefing (preview, doesn't consume the scheduled send), Reconciliation, Abuse Detection, Replenishment, Menu Insights (Win-Back stays scheduled-only — it messages customers); "?" shortcut no longer fires inside text fields; the 3 broken marketing screenshots replaced with User Manual captures.
- **Fixed, verified locally against the live DB only:** WhatsApp support routing (#2 — `/api/whatsapp/simulate` is 404 in production). Root cause was deeper than reported: every message went to the open ticket, `in_support` never cleared after a customer confirmed resolution or staff resolved (next message opened a new ticket), and every support reply was sent twice. Now only messages that continue the support thread go to it; orders/reservations/etc. are processed normally with the ticket left open. POS settle fix (#4) likewise verified locally to avoid another real sale.
- **Insights ≠ Dashboard (#6) — several root causes:** Dashboard "This week/month" were rolling 7/30 days while Insights read them as calendar periods, and branch "Top items" ignored the period toggle entirely (the exact mismatch the manual captured); DB session TZ is GMT so "today" began at 5am PKT everywhere; cancelled orders counted as revenue. One shared definition now (`server/src/utils/business-time.js`: PKT, calendar week from Monday / month from 1st, cancelled excluded) used by Dashboard, branch analytics and Insights — 6 scenarios compared, all match exactly. Also found a **security issue, see 3.7**.
- **Also fixed along the way:** shared `Modal` rendered inside the transformed page container (tall dialogs ran off-screen, size ignored, white in dark mode) — now portalled and themed; Insights SQL generation now sees conversation history; branch-locked managers now get branch-scoped Dashboard and Insights numbers.
- **Investigated, not built (each needs its own spec):** (a) **multi-branch** — `POST/PUT /api/branches` exist and `api.createBranch` is defined but no screen calls it; more importantly **9 call sites pick "the first branch" with an unordered `LIMIT 1`** (online orders, WhatsApp orders, reservations, POS, riders, inventory, POs, support agent), so a second branch would never receive online/WhatsApp orders — a spec must cover per-order branch selection, not just an "add branch" button; (b) **tenant subscription/plan page** — confirmed absent at the time; **since built by impl-32 (Section 2.3)**; (c) **custom domain** — the TXT ownership check works (Pending → Verified after "Check DNS"), but nothing serves the site on the domain (no host-based routing, domain never added to Vercel) and a domain can't be removed/changed once entered; (d) rider PWA — see 2.1.
- **Test data left in the live DB:** order #151 and support tickets for +923330000777 / +923330000778; a settled Rs 70 POS tab; two voided QA tabs; 2 Menu Insights created by the "Run now" test. (Bilal Staff restored; test menu item and test photo removed.)

### 2.3 impl-32 — Bank-transfer payments + AI Agent Pack (built and deployed 2026-09-25, commit `8b1fdaf`)
- **Pricing is now owner-confirmed (2026-09-25), no longer a recommendation:** Starter **Rs 8,000/month flat** (1 branch), Growth **Rs 7,000/branch/month** (2–5 branches), Enterprise custom via the contact form (not self-serve). **AI Agent Pack +Rs 5,000/month at Starter, included at Growth and Enterprise.** Billed monthly. Single source of truth: `server/src/services/billing.js`, exposed publicly at `GET /api/billing/plans` and read by both the marketing page and Plan & Billing.
- **Owner flow:** owner-only "Plan & Billing" page (`/billing`) — plan picker, RestoAI's bank details with copy buttons, reference number + optional receipt screenshot; pending state + app-wide "Payment pending verification" banner; rejection reason shown with resubmit. Server recomputes the amount (client amount only compared), one pending submission per tenant and no reuse of a bank reference (both DB-enforced partial unique indexes). Marketing pricing section rebuilt (3 tiers, Starter add-on checkbox, Growth branch picker); the chosen tier/branches/pack carry through signup (`/login?mode=register&plan=…`) into Plan & Billing.
- **Bank details** come only from env vars on `resto-ai-server` (`BANK_ACCOUNT_TITLE`, `BANK_ACCOUNT_NUMBER`, `BANK_IBAN`, `BANK_NAME`) — set 2026-09-25 to Bank Alfalah, title "eladeen" (branch Raiwind Road 0076 / SWIFT ALFHPKKAXXX recorded in the env comment, not displayed). If unset, the page says bank transfer isn't available and submission returns 503 — never placeholder numbers.
- **Super admin:** Payments queue is the new default landing view, with a "Needs Action" strip (payments to verify + subscriptions expiring in 30 days); approve = one locked transaction setting status active, plan, Agent Pack and period (+1 month, from the current end if renewing early); reject needs a reason and leaves the subscription untouched; small Revenue Overview (verified payments this month in PKT, pending total, active subs by tier, Agent Pack counts); Agent Pack column + manual toggle with mandatory reason on tenant detail; every action through the existing audit middleware; owner notified on WhatsApp either way (demo-mode logged until WhatsApp goes live).
- **Agent Pack gating:** `tenants.ai_agent_pack_enabled`. **Existing tenants were grandfathered** (column added `DEFAULT true`, then default switched to `false` — all 5 pre-existing tenants keep their agents; new signups start without the pack until a payment is approved or a super admin comps it). Gated: the 6 cron loops (SQL filter), "Run now", dispatch routes + auto-assign hook, ETA (tracking page and WhatsApp "preparing" message), customer support (falls back to a human-only escalated ticket), owner WhatsApp assistant. **Never gated:** WhatsApp ordering, recommendations, reservations, Insights, Menu Assistant.
- **Verification:** 27/27 checks via a local harness against the live DB (spec steps 1–7, incl. ordering with the pack off); production browser check of step 8 (pricing cards, CTA carry-through, Plan & Billing), bank details live, receipt upload to Blob confirmed on production. Test payment `TEST-RECEIPT-001` rejected through the real reject route (audit row written, tenant unchanged). **Not yet exercised in the production UI:** the super-admin screens themselves (login needs the owner's TOTP).
- **Open decisions / known limits:** no grace/trial period logic (spec said not to invent one) — a new restaurant has no agents until approval or a comp; receipt screenshots sit in the public-read Blob store behind an unguessable URL (move to private storage when available); a real payment gateway (JazzCash/EasyPaisa/card), dunning and full MRR analytics remain out of scope.

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

### 3.5 2026-09-05 audit — suspension enforcement (**RESOLVED**, commit `67f7a04`; `checkTenantActive` is now mounted across route files, confirmed in code 2026-09-25 — original finding kept below for history)
**Tenant suspension enforcement is built but never mounted — a real admin feature silently does nothing.** `routes/super-admin.js` correctly flips `tenants.subscription_status` to `'suspended'`. `middleware/auth.js` has fully-built `checkTenantActive`/`checkRiderTenantActive` (60s-cached lookup) — exactly what `impl-29`'s own spec explicitly required ("a required touchpoint in the existing authenticate middleware to actually enforce suspension"). **Neither is imported or mounted on any route.** A suspended tenant's staff and riders retain full normal access. Fix prompt written 2026-09-05, pending execution — this is the single highest-value fix outstanding.

### 3.6 Other findings, 2026-09-05
- **Zero automated tests anywhere in the repo.** Acceptable for the hackathon deadline; flag if this becomes a maintained product.
- `alert()`/`confirm()` cleanup (from the UX audit) mostly done — down to 2 occurrences.
- New endpoints (`/api/support`, the owner WhatsApp assistant) both correctly follow the tenant-security pattern — checked and pass.
- WhatsApp still in demo mode, rider PWA still not installable — both unchanged, both still acceptable-for-demo.
- **Note:** this audit is dated 2026-09-05, after the hackathon's Sept 4 23:59 PKT submission deadline — if already submitted, remaining fixes matter for product correctness going forward, not demo/judging risk.

### 3.7 2026-09-25 findings (User-Manual QA fix pass)
- **FIXED — Insights cross-tenant read (confirmed exploitable before the fix).** `injectTenantFilter` spliced `AND tenant_id = $1` into the LLM's SQL as text, so an `OR` in the WHERE, a `UNION`, or a subquery left part of the query unscoped — a `UNION` query returned 129 orders (both tenants) instead of this tenant's 127. Replaced with structural scoping: inside one read-only, rolled-back transaction the allowed table names (`orders`, `order_items`, `customers`, `menu_items`, `branches`) are shadowed by temp views that already contain only this tenant's (and, for branch-locked users, these branches') rows, and `search_path` is reduced to those views; schema-qualified names and catalog/admin functions are rejected. Tested against 8 hostile queries. Reference implementation: `runScopedInsightsQuery` in `server/src/services/ai-agent.js` — use it (not text splicing) for any future LLM-authored SQL.
- **FIXED — branch-locked managers saw tenant-wide numbers** in `/api/insights/query` and `/api/insights/dashboard`; both now honour `attachBranchAccess`.
- **FIXED — removed staff kept working sessions.** JWTs last 7 days; `authenticate()` now also checks `users.deactivated_at` (30s per-user cache, cleared immediately on the instance that made the change).
- **OPEN — `/api/events` (SSE) has no authentication**: anyone who knows a channel name (`kitchen:<branchId>`, `pos:<branchId>`, `riders`) can subscribe to its event stream.
- **OPEN — production has no `VAPID_*` env vars**, so web push is very likely inactive in production (not live-tested).

### 3.4 Confirmed-correct on this pass (worth knowing what's solid, not just what's broken)
Row-locking (`FOR UPDATE`) confirmed present and correctly transaction-scoped on: loyalty redemption, coupon validation/redemption, referral reward completion, POS settlement/void/refund, rider cash reconciliation, purchase order receiving, campaign send. Rider JWT vs. staff JWT confirmed structurally non-interchangeable (separate secret + a `type: 'rider'` claim check, not just convention).

---

## 4. Reference Documents

- `restaurant-saas-development-plan.md`, `customer-app-specification.md` — original planning docs
- `impl-00-INDEX.md` through `impl-25-branch-analytics.md` — all feature build specs; per Section 2, every one of these is now code-confirmed built
- `impl-agents-INDEX.md`, `impl-14` through `impl-21` — the original 8 agent specs, all code-confirmed built (now 10 total with impl-27/28, see below)
- `impl-22-restoai-marketing-page.md` — **recreated 2026-08-30 (v2)**, replacing a stale version written before the agent count reached 10 and before POS billing/branch analytics/coupons-referral/CRM-RFM were confirmed built. Now includes: a rebuilt "Your AI Team" section showing all 10 agents (not 8), and a **new size-tiered pricing model** (Starter/Growth/Enterprise, by branch count) replacing the old flat per-branch number. ~~Pricing figures are still a recommendation pending owner sign-off~~ — **confirmed 2026-09-25 with the AI Agent Pack add-on, see Section 2.3**; the marketing pricing section was rebuilt from it by impl-32.
- `impl-32-bank-transfer-payments.md` — **BUILT + DEPLOYED 2026-09-25** (`8b1fdaf`): bank-transfer payment submission and super-admin verification, Revenue Overview, two-dimensional plan (branch tier + AI Agent Pack) and agent gating. Details and open items in Section 2.3.
- `impl-26-landing-page-redesign.md` — marketing site 3D-hero/screenshot/motion redesign (superseded in scope by impl-22 v2 above for content; this file's visual-treatment guidance — static hero image, real screenshots, Framer Motion scroll reveal — still applies)
- `impl-27-customer-support-agent.md` — **BUILT AND VERIFIED (2026-08-30)**. `support_tickets`/`support_messages` tables confirmed, "support" intent live in the classifier, escalation path live-tested (complaint language → immediate escalation, zero AI-attempted resolution, correct reply), admin `Support.jsx` (457 lines) wired and functional.
- `impl-28-owner-whatsapp-assistant.md` — **BUILT AND VERIFIED (2026-08-30)**. `users.phone` + unique index confirmed. **Security boundary live-tested and holds**: an unregistered phone asking a business-data question was correctly routed to the customer support pipeline (zero business data leaked); a verified owner phone got a real, data-grounded answer. `business-assistant-agent.js` (362 lines) — rate limited, branch-access scoped for managers, "what needs attention" aggregation across all 4 agent flag tables.
- `impl-29-super-admin-panel.md` — new, not yet built. Platform-operator tenant/subscription management (expiration tracking, extend/suspend/comp), scoped deliberately small. **Key design: structurally separate auth from every existing role — dedicated JWT secret, mandatory TOTP MFA, full audit-log middleware, and a required touchpoint in the existing `authenticate` middleware to actually enforce suspension.** Impersonation, dunning automation, and platform analytics are explicitly deferred.
- `impl-30-whatsapp-embedded-signup.md` — **LIVE-VERIFIED END TO END (2026-09-09).** The full real Embedded Signup flow was completed successfully through Meta's actual infrastructure: business connected to eladeen, WABA selected, real popup completed through to "Your account is connected to eladeen." Prior blockers all resolved in this session: (1) real production secrets (`WHATSAPP_APP_SECRET`, `META_APP_SECRET`) replacing Aug 26 placeholders — confirmed via Meta's own webhook "Test" button returning a genuine 200; (2) OAuth Redirect URI added to Meta's Client OAuth Settings (was blocking with "URL Blocked"); (3) **a genuine root-cause find: Chrome's FedCM (Federated Credential Management) API was silently intercepting the SDK's login call and stripping `config_id`, rewritten as a generic OpenID flow** — confirmed via before/after request-shape comparison, fixed with a documented (not-officially-cited, code-commented) SDK-level opt-out. **Separately and urgently found+fixed in this same session:** production had been running `NODE_ENV=development` since Aug 26 with public default fallback secrets for `CRON_SECRET` and `SUPER_ADMIN_JWT_SECRET` — rotated all 4 affected secrets, confirmed guards now genuinely active, retroactive log check found no evidence of exploitation (not proof of none, logs don't reach back far enough). `.vercel/project.json` team-mismatch (cause of an earlier wrong-project redeploy) also fixed. **Still open:** real send/receive message test with a real external phone (connection succeeded but the immediate follow-up message test wasn't completed in this session — do this next, given Hobby's ~1hr log retention).
- `impl-31-existing-number-onboarding.md` — new, not yet built. Surfaced directly by live testing: Embedded Signup's default path only supports a genuinely new number or one requiring account deletion first. Confirmed against Meta's current docs: a real **Coexistence** option exists (keeps chat history, region-limited, **Pakistan availability unconfirmed**) and a real **cross-provider migration** mechanism exists (for restaurants switching from another WhatsApp SaaS) — both scoped as follow-ups; Part 1 (pre-flow guidance so owners aren't surprised mid-flow, exactly as happened in testing) is the only piece recommended to build now.
- **Agent count is now 10, not 8** — update any presentation/pitch material accordingly.
- `docs/RestoAI-User-Manual.docx` (64 pp) and `docs/RestoAI-Quick-Start-Guide.docx` (6 pp), built 2026-09-24/25 from 126 real screenshots in `docs/screenshots/` (see its `INDEX.md`). The two .docx files and `INDEX.md` are committed (`963fc99`); **the 126 PNGs are not in the repo** — `.gitignore`'s `*.png` rule excludes them, they exist only on the local disk. Several captures show bugs since fixed (e.g. `C01`/`C03` tenant-site crash, staff dashboard/coupons, raw `**` in the Menu Assistant, no Team list on Staff, no "Import from photo" / "Run now" buttons) — recapture those screens before sharing the manual.

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

**Recommendation:** price meaningfully below Petpooja's $50/location, well above the low-quality local tier — **Rs. 8,000-15,000/month per branch (~$28-54)**, pitched explicitly as "less than one Foodpanda commission on a single busy weekend, every month, forever" rather than compared to competitor pricing. This is a recommendation with real data behind it, not yet an owner-confirmed decision — still needs sign-off before it goes in the pitch deck's pricing section (`impl-22`) or anywhere customer-facing. **Superseded 2026-09-25:** the owner confirmed the tiered model (Starter Rs 8,000 flat / Growth Rs 7,000 per branch / Enterprise custom) plus a Rs 5,000/month AI Agent Pack add-on at Starter — now live on the marketing page and charged via impl-32 (Section 2.3).

### 5.4 Competitive landscape (2026-08-29)
**Local Pakistani POS (no AI/WhatsApp ordering — not real competition for the core differentiator):** LookPOS, itKINS (from PKR 2,000/mo), Moneypex, Foodnerd POS (FBR-integrated), MutfakPOS.

**⚠️ Most important finding: CherryBerry RMS** — a genuine, close, same-market competitor, more directly comparable than Bitecast. Does conversational WhatsApp AI ordering with explicit Roman Urdu / regional dish name understanding, WhatsApp Catalogue integration, multi-branch chains, multilingual auto-detection. **Recommend studying this product directly, not just Bitecast, before finalizing pitch positioning.**

**Bitecast** (prior research): full ops platform (POS/riders/broadcasts/reservations) but menu-flow bot, not conversational AI — differentiator gap holds against Bitecast specifically, not against CherryBerry.

**International WhatsApp/AI-ordering specialists (not Pakistan-specific, similar positioning):** MaviBot, OrderOnWhats.app (both use near-identical "no commission" framing to RestoAI's own pitch — confirms the positioning is sound but not unique globally), QuickReply.ai.

**International full-stack POS (already in pricing research, Section 5.3):** Toast, Square, Clover, SpotOn, TouchBistro — not WhatsApp-first, not Pakistan-focused.

**Actual defensible edge:** not "has WhatsApp AI ordering" alone (multiple competitors do) — it's the **combination**: full POS+billing+tax+shifts, multi-branch analytics, recipe-based inventory, 8 autonomous agents, a landing-page builder, and RFM-driven CRM sharing one data model, backed by a working, security-audited, code-confirmed system. Lead the pitch with breadth + working demo, not the WhatsApp-AI claim in isolation.

---

## 6. Immediate Priorities (in order) — updated 2026-09-25

1. **Authenticate `/api/events`** — the SSE stream is open to anyone who knows a channel name (Section 3.7)
2. **Set `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` on `resto-ai-server` production** and live-test a push notification (Section 3.7)
3. **Multi-branch spec** — per-order branch selection to replace the 9 unordered `LIMIT 1` "first branch" lookups, then an add-branch UI and manager↔branch assignment (Section 2.2). Needed before any real chain customer or a multi-branch demo.
4. **Decide the `customers.total_spent` delivery-fee question** — business call, not a code fix
5. Re-check the `token-board` tenant-ownership item — not re-verified since 2026-09-05
6. **impl-32 follow-ups:** (a) log into the super-admin panel once to confirm the Payments queue / Revenue / Agent Pack toggle screens on production (everything else is verified); (b) decide whether new signups get a grace/trial period with agents on — currently none, by design; (c) move receipt screenshots to private storage when available (Section 2.3). Pricing itself is now decided.
7. **Custom domain serving spec** — ownership verification works, but nothing serves the site on the domain and a domain can't be changed/removed (Section 2.2)
8. Smaller gaps found 2026-09-25: staff see Insights in the sidebar but get 403 on asking; a sold-out item in a WhatsApp order is dropped without telling the customer; Dashboard "Customers" card is capped at 10 (it counts the recent-customers list)
9. Consider automated tests if this becomes a maintained product beyond the hackathon — currently zero
10. WhatsApp demo mode and the rider PWA gap (now precisely diagnosed, Section 2.1) remain open
11. **Once Meta Tech Provider approval lands:** re-check `subscribed_apps`'s exact POST behavior against current Meta docs before relying on it with real traffic (`impl-30`), then run the full end-to-end Embedded Signup flow (real `FB.login()` popup, real number registration) for the first time — everything else in that spec is already built and verified as far as possible without it

**Resolved since 2026-08-29** (no longer priorities): the `.env` secrets question (confirmed clean), `CRON_SECRET`/`SUPER_ADMIN_JWT_SECRET` boot-guards, inventory row-locking + negative-stock floor, most of the `alert()`/`confirm()` UX cleanup, tenant suspension enforcement (`67f7a04`), rate limiting on `/api/agents/*/run` (`agentRunLimiter` on all 12 run routes), and all 18 User-Manual QA items that were fixable in a pass (Section 2.2).

---

## 7. UX/Design Audit (2026-08-29) — post-hackathon roadmap, not pre-deadline work

A full design-system audit across all 34 client pages found solid information architecture (role-based nav, 4 well-separated UX contexts: admin/kitchen/customer/rider) but a "template Tailwind" visual layer with no design tokens or component library — scored 3/10 design maturity. **This is normal for a project at this stage and functional depth, not a red flag** — a hackathon judge weighs functional scope and AI usage far more heavily than modal focus-trap compliance.

**The only 2 findings pulled forward into Section 6 above** (toast notifications, skeleton loading) — cheap, low-risk, visibly reduce "unpolished" moments in a live demo.

**Everything else is explicitly deferred, not forgotten:** WebSocket real-time (replacing the working 5-10s polling — real regression risk this close to the deadline), a full shadcn/ui + Radix component migration, PWA/offline support, keyboard shortcuts for POS, a 5-group sidebar restructure, framer-motion transitions. The full audit's 3-phase, ~10-week roadmap is legitimate future work — reference it after Sept 4, not before.
