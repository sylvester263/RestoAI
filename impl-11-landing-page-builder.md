# Implementation 11 — Restaurant Landing Page Builder (Templates + Custom Domain)

## Goal
Give each restaurant a branded marketing/brand website — separate from but linking into the existing ordering app — built from a fixed set of professionally designed templates with clearly defined editable sections (not a freeform drag-and-drop canvas — see scoping decision below). Published by default to a subdomain, with custom domain as an upgrade path. Every template's primary call-to-action routes into the existing `/order/:tenantSlug` public ordering flow — this is a marketing layer in front of what's already built, not a new ordering system.

## Scoping decision (already made, stated here for the record)
**Template + fill-in-content, not true drag-and-drop.** A freeform page builder (arrange any element anywhere, like Wix/Squarespace's core editors) is a multi-year engineering investment even for companies that specialize in nothing else. This build instead offers 5-10 fixed, well-designed templates, each with a defined set of editable sections (see 3.2). This gets the real value — a restaurant looks like it has its own professional website — at a fraction of the effort. Do not attempt a freeform canvas editor for this pass.

## Dependencies
- Existing public ordering app (`PublicMenu.jsx`, `/order/:tenantSlug`) — the landing page's primary CTA links here
- Reviews (`impl-03`) if built — used for testimonial section; if not built yet, the testimonial section falls back to owner-entered text testimonials (see 3.2)
- Menu data (exists) — used for a "menu highlights" section

## 1. Data Model — New Tables

```sql
CREATE TABLE landing_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) UNIQUE,
  template_id VARCHAR(50) NOT NULL, -- references a fixed template registry, not a DB table (see Section 2)
  subdomain VARCHAR(63) UNIQUE NOT NULL, -- e.g. 'karahi-house' -> karahi-house.yourplatform.com
  custom_domain VARCHAR(255) UNIQUE, -- nullable until upgraded + verified
  custom_domain_verified BOOLEAN DEFAULT false,
  published BOOLEAN DEFAULT false,
  content JSONB NOT NULL DEFAULT '{}', -- all editable section content, keyed by section name
  theme JSONB DEFAULT '{}', -- color/font overrides within the template's allowed customization range
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_landing_pages_subdomain ON landing_pages(subdomain);
CREATE INDEX idx_landing_pages_custom_domain ON landing_pages(custom_domain) WHERE custom_domain IS NOT NULL;
```

`content` JSONB structure (example, adapt per template's actual section list):
```json
{
  "hero": { "headline": "...", "subheadline": "...", "image_url": "..." },
  "about": { "text": "...", "image_url": "..." },
  "gallery": { "image_urls": ["...", "..."] },
  "hours_location": { "address": "...", "lat": 0, "lng": 0, "hours": {...} },
  "testimonials": { "manual_entries": [{ "name": "...", "quote": "..." }] },
  "contact": { "phone": "...", "whatsapp": "...", "social_links": {...} }
}
```

Templates are a **fixed registry in code** (a `templates/` directory with 5-10 defined layouts), not database-driven — this keeps the build simple and avoids needing an actual page-building UI. Each template defines which sections it supports and validates `content` against its own expected shape.

## 2. Template Registry (code-level, not DB)

Create `client/src/landing-templates/` (or `server`-side if server-rendering — see Section 4 rendering decision) with 5-10 templates, e.g.:
- `classic-warm` — hero + about + menu highlights + gallery + hours/location + contact
- `modern-minimal` — large hero image, condensed sections, minimal text
- `family-casual` — testimonials-forward, family/group photography emphasis
- `fine-dining` — full-bleed imagery, elegant typography, reservation-forward CTA (ties into `impl-06` if built)
- `fast-casual` — menu-highlights-forward, prominent "Order Now" above the fold
- (add 3-5 more variations on layout/emphasis as time allows — these can share most component code with different arrangement/styling, they don't need to be built from scratch each)

Each template is a React component (or set of components) that accepts `content` and `theme` as props and renders accordingly. Keep the actual editable *content schema* consistent across templates where possible (hero, about, gallery, hours, testimonials, contact) even if visual arrangement differs — this means the admin editor UI (Section 3) can be shared across all templates rather than rebuilt per-template.

## 3. API Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/landing-page` | GET/PUT | Authenticated (owner) | Get/update the tenant's landing page config (template choice, content, theme) |
| `/api/landing-page/publish` | POST | Authenticated (owner) | Toggle `published` true |
| `/api/landing-page/subdomain-check` | GET | Authenticated | Check if a desired subdomain is available before saving |
| `/api/landing-page/custom-domain` | POST | Authenticated | Submit a custom domain for verification |
| `/api/landing-page/custom-domain/verify` | POST | Authenticated | Trigger/check DNS verification status |
| `/api/public/site/:subdomainOrDomain` | GET | Public | Resolve a subdomain or verified custom domain to its tenant + landing page content, for rendering |

## 3.1 Step-by-Step Implementation — Backend

1. **Migration:** Add `landing_pages` table.
2. **Backend — `server/src/routes/landing-page.js` (new):**
   - `GET /api/landing-page` — return the authenticated tenant's config (or defaults/empty if not yet created).
   - `PUT /api/landing-page` — validate `content` against the chosen template's expected section shape (Zod schema per template, matching Section 2's registry — reject unknown/malformed sections rather than storing arbitrary JSON blindly), save.
   - `POST /api/landing-page/publish` — set `published=true`; require at minimum a subdomain and a hero section with a headline before allowing publish (basic completeness check, not full validation of every section).
   - `GET /api/landing-page/subdomain-check?value=...` — check uniqueness against existing `landing_pages.subdomain` and against reserved words (e.g. `www`, `api`, `admin`, `app`) that must never be assignable as a tenant subdomain.
   - `POST /api/landing-page/custom-domain` — accept a domain string, store it unverified, return the DNS records (CNAME/TXT) the owner needs to add at their domain registrar.
   - `POST /api/landing-page/custom-domain/verify` — check whether the required DNS record now resolves correctly (via a DNS lookup); mark `custom_domain_verified=true` on success. Depends on your hosting platform's actual custom-domain mechanics — Vercel (already in use per `PROJECT-MASTER.md`) has a documented API/dashboard flow for custom domain verification; use that rather than building DNS verification from scratch if the platform already provides it.
3. **Public resolution route — `server/src/routes/public.js` (extend existing):**
   - `GET /api/public/site/:subdomainOrDomain` — look up `landing_pages` by `subdomain` OR by `custom_domain` (only if `custom_domain_verified=true`), resolve to `tenant_id`, return `template_id` + `content` + `theme` + the tenant's basic info (name, branch list for the Order Now link target). Return 404 for anything unpublished or unverified — never leak draft/unpublished content publicly.
4. **Rate limiting:** Apply existing rate-limit patterns to the subdomain-check and custom-domain endpoints (prevent enumeration/abuse).

## 3.2 Step-by-Step Implementation — Frontend

5. **Admin editor — `client/src/pages/LandingPageEditor.jsx` (new):**
   - Template picker: visual gallery of the 5-10 templates (thumbnail previews), select one.
   - Section-by-section content editor: form fields matching the template's content schema (headline/subheadline text inputs, image upload for hero/gallery — reuse whatever image upload mechanism already exists for menu item photos, don't build a second one), hours/location (reuse map/address input patterns if any exist from other features), testimonials (manual entry list if `impl-03` reviews aren't wired in yet; if they are, offer a toggle to pull real reviews automatically instead of manual entry).
   - Live preview: render the selected template with current `content`/`theme` in an iframe or embedded preview pane as the owner edits, so they see the actual result before publishing.
   - Subdomain field with live availability check (debounced call to `/subdomain-check`).
   - Custom domain section: input + instructions showing the DNS records to add, a "verify" button, and clear status (pending/verified).
   - Publish/unpublish toggle.
6. **Public rendering — new route, separate from the admin app:** Set up routing so a request to `subdomain.yourplatform.com` (or a verified custom domain) resolves to `GET /api/public/site/:subdomainOrDomain`, then renders the matching template component with the returned `content`/`theme`. This requires wildcard subdomain DNS + hosting configuration (on Vercel: a wildcard domain pointed at the deployment, with the app reading the incoming `Host` header to determine which subdomain was requested) — confirm this is achievable within your current Vercel setup before committing to the subdomain approach; if wildcard subdomains aren't straightforward on the current plan/setup, a fallback is path-based (`yourplatform.com/site/:subdomain`) with custom domain remaining available as the "real" branded option.
7. **"Order Now" CTA wiring:** Every template's primary CTA button links to the existing `/order/:tenantSlug` (or the tenant's actual public ordering URL) — this is the single most important functional link in the whole feature; verify it explicitly per template.

## 4. Rendering Approach Decision
Client-side rendering (same React app, resolved by subdomain/domain at request time) is the simplest extension of your current architecture and is fine for a hackathon-timeline build. If SEO for these pages matters for the pitch (organic discovery was flagged as valuable in the market research), note that client-side-only rendering is weaker for search indexing than server-side rendering — this is a legitimate future upgrade (e.g. moving to a Next.js-style SSR approach for just these public pages) but is explicitly **out of scope** for this pass; ship client-side rendering first.

## Verification Steps
1. Create a landing page, select a template, fill in all sections, publish — confirm it's reachable at its subdomain and renders correctly.
2. Confirm an unpublished or not-yet-created landing page returns 404 publicly (no draft leakage).
3. Attempt to claim a reserved subdomain (e.g. `www`, `api`) — confirm it's rejected.
4. Attempt to claim a subdomain already in use by another tenant — confirm it's rejected with a clear message.
5. Submit a custom domain, add the required DNS record in a real test domain, run verification, confirm it flips to verified and the site becomes reachable at that domain.
6. Click the "Order Now" CTA on a published page — confirm it lands correctly in the existing ordering flow for the correct tenant/branch.
7. Confirm the editor's live preview accurately reflects what actually renders on the published page (no drift between preview and live).
8. Test at least 2 different templates end-to-end to confirm the shared content schema renders correctly across different visual layouts.

## Explicitly out of scope for this file
- Freeform drag-and-drop page building (see scoping decision above)
- Server-side rendering / SEO optimization (flagged as a future upgrade, not this pass)
- A/B testing between templates
- Blog/content publishing beyond the fixed sections listed

---

## Addendum — Competitive research and proposed extensions (2026-08-29)

Research into restaurant-specific site builders (BentoBox, Popmenu, Owner.com, Flavor Plate, ChowNow) surfaced 6 category-standard features. Good news: 4 of the 6 already have their underlying data/logic built elsewhere in RestoAI (reviews, win-back/RFM, reservations) — this is a **surfacing** gap on the landing page, not a new-infrastructure gap. Prioritized by leverage:

### A1. Real per-dish reviews on the menu section (highest leverage, lowest cost)
`impl-03` reviews already exist per `menu_item_id`. Extend `Sections.jsx`'s `MenuHighlights` component to show each item's real star rating and a recent comment (reuse the existing `GET /reviews/item/:menuItemId` endpoint from `impl-03`, don't build a second reviews path). This is Popmenu's signature differentiator, achievable by wiring existing data into an existing section rather than building anything new.

### A2. Visible reservation booking, not just "Order Now" (high leverage, low cost)
`impl-06` reservations already exist and have a public booking endpoint. Add a "Reserve a Table" CTA/section to the landing page templates alongside the existing Order Now CTA — currently the landing page structure (Section 3.2) only routes to ordering; for restaurants where dine-in reservations matter as much as delivery, this is a real gap in what's surfaced, not what's built.

### A3. AEO/GEO — structured data for AI-assistant discoverability (moderate cost, forward-looking, genuinely differentiating)
Add `Restaurant`/`Menu`/`LocalBusiness` JSON-LD structured data (schema.org) to every published tenant page — machine-readable name, address, hours, menu items with prices, aggregate rating. This is flagged in 2026 industry coverage as the newest differentiator in this category — restaurants invisible to LLM crawlers (ChatGPT, Gemini, Perplexity) miss the traffic shift from "search for restaurants" to "ask an AI assistant." This is a genuinely current, checkable claim worth having true before it goes in a pitch — implement as static JSON-LD generation at publish time (Section 3's existing publish flow), not a new page or feature.

### A4. Milestone-triggered marketing tie-in (no new build — a documentation/UX link)
`impl-15`'s win-back agent and `impl-10`'s RFM segments already cover "first visit" and "lapsed customer" triggers conceptually. No new backend work — just ensure the landing page's own copy/CTA reflects that these exist ("we'll remember your regulars," etc.) rather than treating this as an unbuilt gap. Birthday-specific triggers are a genuinely new addition if wanted (requires capturing a customer birthdate somewhere, which doesn't currently exist) — flag as a small future addition, not urgent.

### A5. Local listings sync — Google Business Profile (new capability, moderate cost)
Not currently built anywhere in RestoAI. Push hours/menu/photos to a connected Google Business Profile via the Google Business Profile API when a tenant updates their landing page content — keeps Google Maps/Search listings accurate automatically instead of requiring manual updates on a separate platform. Real, requested category feature; scope as a genuine new build, likely its own follow-up file (`impl-27`) rather than folding into this one given the OAuth/API integration complexity.

### A6. Digital gift cards (lower priority, new capability)
Not currently built. Ties conceptually to the "wallet/store credit" gap already noted in `PROJECT-MASTER.md` Section 2 — if store credit is ever built, gift cards are a natural extension of that same ledger rather than a separate system. Flag as future roadmap, not near-term.

**Recommended near-term scope:** A1 and A2 first (real data, existing endpoints, pure surfacing work — cheap and high-impact), A3 next if time allows (genuinely differentiating and current), A4 is a copy change not a build, A5/A6 stay roadmap.
