# Implementation 22 — RestoAI Marketing Landing Page

## Goal
RestoAI's own public-facing marketing/sales site — where a restaurant owner first encounters the product, not to be confused with `impl-11`, which builds a landing page *for each individual restaurant's own customers*. This page sells RestoAI itself to prospective restaurant owners, and is the entry point into onboarding (`impl-23`).

## Dependency
None for the page itself. Its CTAs link into `impl-23`'s signup/login flows — build that alongside or immediately after.

## Where this lives
A new top-level route in the existing client app (e.g. `/` or `/home`, depending on what currently occupies the root route — confirm this doesn't collide with anything already there, likely `/login` is currently the effective landing point and needs to move behind this page rather than being the first thing a visitor sees) or a small separate static site if keeping marketing content fully decoupled from the authenticated app is preferred. Recommend keeping it in the same client app for simplicity given the existing single-deployment Vercel setup, unless there's a strong reason to split it.

## Page Structure (per the mockup already shown)

1. **Header:** logo, nav links (Features / How it works / Pricing), and — the key structural decision for this file — **three distinct login buttons: Owner login, Staff login, Rider login**, plus a primary "Start free" CTA.
2. **Hero:** headline built around the market-research-validated positioning (`PROJECT-MASTER.md` Section 4.1) — "escape the commission" framing, not generic "AI restaurant SaaS" language. Two CTAs: "Start free trial" (→ owner signup) and "See how it works" (→ scrolls to or links the How It Works section).
3. **Stats bar:** 0% commission, ordering channels count, WhatsApp AI availability, setup time — reuse real, defensible numbers once available (don't fabricate usage stats like Bitecast's "500+ restaurants" until real numbers exist; use qualitative framing like "Minutes to set up" instead of invented user counts).
4. **How it works:** 3-step section (set up branches/menu → orders land from every channel → the whole shift runs from there) — matches the structure already used for the original hackathon pitch narrative.
5. **Feature grid:** the built, differentiated capabilities — conversational WhatsApp AI ordering, AI menu digitization, own branded storefront, dine-in QR ordering, reservations, broadcasts, loyalty/reviews, display boards. Pull directly from `PROJECT-MASTER.md` Section 4's actually-built list — do not advertise anything still at 0% (POS, riders, full inventory, CRM/RBAC, coupons) as a current feature; if desired, a clearly-labeled "coming soon" strip is fine, matching Bitecast's own honest use of that pattern.
6. **"One system, every role" section:** explains the three-login model in plain language — owners get full command, staff get their branch, riders get their deliveries — directly setting up the value of `impl-23`'s multi-role system as a feature in its own right, not just plumbing.
7. **Pricing:** depends on the still-undecided commission/pricing stance (`PROJECT-MASTER.md` Section 8) — **do not build this section with real numbers until that decision is made.** Build the section's structure now (flat-plan framing, matching the zero-commission narrative) with a placeholder, and fill in numbers once decided.
8. **Final CTA + contact form.**

## Data/Backend
This page is almost entirely static/marketing content — no new tables required. The only backend touchpoint is the contact form (if included): a simple `POST /api/contact` that stores or emails the submission (reuse existing WhatsApp/email send capability if one exists, otherwise a simple stored-inquiries table is sufficient — this doesn't need to be sophisticated).

## Step-by-Step Implementation

1. **Route:** Add the marketing page as the new root/public entry route in `client/src/App.jsx`, ensuring it doesn't require authentication and is the first thing an unauthenticated visitor sees (move the existing `/login` route behind an explicit "Owner login" / "Staff login" click rather than being the default landing experience).
2. **Component:** `client/src/pages/marketing/LandingPage.jsx` (new) — build the sections above as a single scrollable page, following the CDS-style flat, restrained design already used in the mockup (no gradients/shadows, sentence case, existing color tokens).
3. **Three login buttons — routing:** All three ("Owner login," "Staff login," "Rider login") can point to the **same underlying login form** if the backend auth model is genuinely unified (per `impl-23`'s design decision below) — the distinction may be purely about which persona a visitor identifies with, not three different technical flows. Confirm `impl-23`'s decision before wiring these, since it directly determines whether this is 1 route or 2-3 routes.
4. **Feature grid content:** Pull feature copy directly from `PROJECT-MASTER.md`'s Section 4 table — treat that file as the source of truth for what's honestly claimable, and update this page's copy whenever that table changes (e.g. once coupons or POS ship, they can move from absent/coming-soon to the main grid).
5. **Contact form (if included):** simple form → `POST /api/contact`, basic validation, confirmation message on submit.
6. **SEO basics:** since this page's whole purpose is being found by prospective restaurant owners (ties into the market-research-driven positioning), add basic meta tags (title, description) even without full SSR — client-side meta tag updates are better than nothing, though true SEO strength would need server-side rendering, which is out of scope here (same call already made for `impl-11`'s per-restaurant pages).

## Verification Steps
1. Visit the root URL unauthenticated, confirm the marketing page renders (not a login redirect or blank page).
2. Click each of the three login buttons, confirm each routes correctly per whatever decision `impl-23` settles on (same form or distinct forms).
3. Click "Start free trial," confirm it correctly enters the owner signup flow (`impl-23`).
4. Confirm the feature grid does not claim anything currently at 0% built (cross-check against `PROJECT-MASTER.md` Section 4 at time of launch).
5. Submit the contact form (if built), confirm the submission is received/stored/sent correctly.
6. Check the page renders correctly on a mobile viewport — this is the primary access pattern for the target market.

## Explicitly out of scope for this file
- Server-side rendering / full SEO optimization
- A/B testing different hero copy or CTAs
- Real usage statistics until genuine numbers exist to report
