# Implementation 22 (v3) — Homepage Visual Redesign (Design Only, No Content/Feature Changes)

## Scope — read this first
This is a **visual and layout redesign only**. Every feature, every section's content, every piece of copy, and all functionality established in `impl-22` v2 stays exactly as it is. Nothing is added, removed, or rewritten at the content level — this file changes *how it looks*, not *what it says or does*. If executing this requires touching component/CSS code to achieve the new visual treatment, that's expected and fine — what must not change is any feature, copy, or behavior.

Reference material: a competitor site (CallHippo) was provided as a full-page PDF and a screen-recording, both showing the same page — the recording is a plain scroll-through with no distinct interaction beyond normal scroll-reveal, so the PDF is the complete visual reference.

## Design language to adopt

**Hero section**
- Full-bleed warm, atmospheric photographic background (sunset/golden-hour landscape treatment in the reference) — for RestoAI, use warm food/restaurant-appropriate imagery instead (not a literal copy of the reference's landscape photo), consistent with the brand's terracotta/cream palette already established.
- A small pill-shaped trust-badge row directly above the headline — **for RestoAI this must NOT be star ratings or review-platform badges** (no real reviews exist to cite). Use it instead for something real and true today — e.g. "Approved Meta Tech Provider" as a small badge, since that's a genuine, verifiable credential.
- Large serif headline, two-tone (part in dark text, part in terracotta) — matches the reference's black+orange headline treatment exactly, and already matches RestoAI's existing brand type pairing.
- Two CTAs side by side: a solid terracotta primary button, a white/outline secondary button — same pattern as the reference's "Try CallHippo For Free" + "Book a Demo."
- A floating product-screenshot card below the headline, angled/layered with a subtle drop shadow — use a REAL RestoAI screenshot here (the dashboard or WhatsApp ordering view), not an illustration.

**Stat bar (directly below hero)**
- A horizontal row of 3-4 large bold numbers with a small label under each, on a plain white background — matches the reference's "5400+ Active Companies / 150+ Countries / 99.95% Uptime / 280M+ Connected Minutes" band.
- **For RestoAI, do not fabricate numbers here.** Use only real, defensible figures already established: e.g. "28 API routes," "52 database tables," "10 AI agents," "Meta Tech Provider — Approved." These are real and verifiable, unlike a customer/usage count RestoAI doesn't have yet. If a real customer/usage stat doesn't exist, this entire stat-bar section can be omitted rather than filled with invented numbers — that decision is explicitly allowed here.

**"Built for your workflow" pattern → apply directly to RestoAI's existing feature sections**
This is the reference's strongest, most reusable pattern: a pill-shaped tab selector row (Business Phone System / AI Voice Agent / Omnichannel / AI Copilot / Parallel Dialer), with each tab revealing a two-column block — left side: kicker label, bold headline, one-line description, a "What's included" checklist of 4 short items, a CTA; right side: a real product screenshot in a soft rounded card, tilted slightly, on a warm gradient panel background.
- Map this directly onto RestoAI's already-existing feature sections from `impl-22` v2 (Ordering, Your AI Team, Run Your Whole Operation, Know Your Business, Grow Your Customers, Your Own Website) — same six sections, same copy, restyled into this tabbed two-column pattern instead of the current stacked-sections layout.
- Every right-side screenshot must be a real captured screenshot (reuse the verified-correct screenshots already captured for the Product Walkthrough deck and User Manual — do not create new mockups).
- The "What's included" 4-item checklist under each section should pull directly from the bullet points already written for that section in `impl-22` v2 — condense to 4 short items per section, don't invent new ones.

**Onboarding & trust section**
- The reference shows compliance badges (ISO 27001, GDPR, HIPAA, SOC 2) alongside "Easy onboarding / Guided setup / Real support" copy blocks.
- **For RestoAI: do not display compliance certifications that haven't actually been obtained.** Keep the "Easy onboarding / Guided setup / Real support" structural pattern (three short value props with small icons), but write the actual copy to reflect RestoAI's real onboarding (Embedded Signup connection, the real security posture already documented — tenant isolation, encrypted tokens — stated honestly as engineering practice, not as a named certification RestoAI doesn't hold).

**Pricing section — dark, tabbed**
- The reference's pricing section (dark navy background, a vertical plan-selector list on the left — Basic/Starter/Professional/Ultimate — with the selected plan's full detail card on the right) is a strong pattern, directly reusable.
- Map RestoAI's actual three tiers (Starter / Growth / Enterprise) plus the AI Agent Pack add-on onto this exact layout — vertical tier selector on the left, full pricing detail (price, billing unit, what's included, CTA) on the right for whichever tier is selected/highlighted by default (Growth, matching the existing "highlighted" tier treatment from the v2 marketing spec).
- Keep the three small trust-icons row beneath the pricing card ("No setup fees / Cancel anytime / Enterprise grade security" in the reference) — adapt the specific claims to what's actually true for RestoAI.

**What must be explicitly EXCLUDED from this redesign, not adapted**
- Any customer logo wall (the reference shows "Finofy," "Bacancy," etc.) — RestoAI has no real customers to display yet. Omit this section entirely rather than substitute placeholder logos.
- Any testimonial cards with names, photos, and quotes (the reference shows "Amit Patel, Business Consultant, Bacancy" with a headshot and quote) — fabricating this violates the project's standing no-fake-testimonials rule. Omit entirely. If real pilot-customer testimonials exist by the time this is built, that's a future addition, not something to backfill now.
- Any case-study cards implying measured customer results ("Finofy turned reliable calling into more conversions") — same reasoning, omit.
- Any star-rating badges (Capterra, G2, etc.) — RestoAI isn't listed on these platforms; do not imply otherwise.
- The "100+ business tool integrations" grid (Zapier, Slack, Shopify, etc.) — RestoAI doesn't have this integration ecosystem; omit rather than list unbuilt integrations as if they exist.

**Footer**
- The reference's four-column categorized footer (By Need / Features / Resources / Company) plus a large full-bleed closing CTA banner directly above it is a strong, reusable pattern.
- Rebuild RestoAI's footer in this structure using only real, existing pages/links already established in this project (Privacy Policy, Terms, Pricing, Features sections, Contact) — do not invent new footer links to pages that don't exist just to fill out the four-column pattern. A shorter, honest footer is correct if RestoAI doesn't yet have enough real pages to fill four full columns.

## Step-by-Step Implementation
1. Rebuild the hero section per the pattern above, using real RestoAI imagery/screenshots and the one real trust badge (Meta Tech Provider), not fabricated ratings.
2. Build (or omit, if no real numbers exist) the stat bar using only real, defensible figures.
3. Restructure the six existing feature sections into the tabbed two-column pattern, reusing existing copy and real screenshots — no new content written.
4. Rebuild the onboarding/trust section with honest copy, no fabricated certifications.
5. Rebuild the pricing section as a dark, tabbed vertical-selector layout using the real, current tier structure and numbers.
6. Explicitly confirm the excluded sections (customer logos, testimonials, case studies, star ratings, integration grid) are NOT present anywhere in the rebuilt page.
7. Rebuild the footer using only real, existing links.
8. Confirm every single piece of copy on the page after this redesign matches, word for word or intentionally condensed from, what already existed in `impl-22` v2 — this is a design pass, and any new claim appearing on the page that wasn't already written and verified is a scope violation of this spec, not a feature of it.

## Verification Steps
1. Side-by-side diff of all copy/content before and after — confirm no feature, claim, or piece of information was added, removed, or changed in meaning; only layout/visual treatment changed.
2. Confirm every screenshot on the rebuilt page is a real, current, verified capture — not a new mockup, not a stale/broken image (the marketing site already has 3 known broken screenshot captures per the Product Walkthrough session findings — this redesign is a good moment to fix those using the now-available verified screenshot set, but do not use this as license to change anything else).
3. Confirm none of the explicitly excluded elements (customer logos, testimonials, case studies, ratings badges, fabricated integration grid, fabricated certifications) appear anywhere on the page.
4. Mobile responsiveness check — this remains the primary access pattern for the target market, unchanged from every prior version of this spec.
5. Confirm the pricing section correctly reflects the current three-tier + Agent Pack structure with accurate numbers (cross-check against the corrected pricing from the most recent pricing decision, not any stale figure).

## Explicitly out of scope
- Any new feature, page, or piece of content not already established in `impl-22` v2
- Any fabricated social proof, certification, statistic, or integration claim
- Backend/application code changes of any kind — this is the public marketing page only
