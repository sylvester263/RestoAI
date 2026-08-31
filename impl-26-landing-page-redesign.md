# Implementation 26 — Marketing Landing Page Redesign (3D Hero + Real Screenshots + Scroll Motion)

## Goal
Redesign `client/src/pages/marketing/LandingPage.jsx` (the RestoAI sales site, distinct from `impl-11`'s per-restaurant builder) around real product screenshots, a single striking 3D hero element, and scroll-triggered motion throughout — without touching any backend logic, routing, or the actual product this page is marketing. This is a presentation-layer redesign only.

## Scope containment — read this before starting
**3D is scoped to exactly one place: the hero section.** Every other section uses Framer Motion scroll-reveal animations (fade/slide-in), not 3D. This is a deliberate risk boundary, not a limitation to work around — do not extend Three.js/WebGL into other sections without this being explicitly re-scoped first. A full-page 3D experience is a multi-week effort; a single well-built hero element is achievable in the time available and contains the risk if something goes wrong (worst case: the hero degrades gracefully, per the fallback strategy below, and the rest of the page is unaffected).

## 1. Overall Page Structure (confirmed structure, recap)
1. Header — consolidated: logo, Features, Pricing, "Log in" (owner/staff, one dropdown), "Rider login", "Start free" primary CTA
2. **Hero — 3D element** (this file's main focus, see Section 2)
3. `01` Ordering — real screenshots: WhatsApp conversation, public menu/checkout, dine-in QR
4. `02` Your AI Team — 4-tab section (Ask Anything / Your Agents / Always Watching / One Data Model), real screenshots per tab (Insights.jsx, Agents.jsx, reconciliation/abuse flags)
5. `03` Run Your Whole Operation — screenshots: POS.jsx, Kitchen.jsx, Inventory.jsx
6. `04` Know Your Business — branch analytics dashboard screenshot
7. `05` Grow Your Customers — Customers.jsx, Coupons.jsx, Campaigns.jsx screenshots
8. `06` Your Own Website — a real published tenant landing page screenshot (impl-11 output)
9. One System, Every Role — conceptual, no screenshots
10. Pricing — structure ready, **numbers stay placeholder until explicit sign-off** (per PROJECT-MASTER.md Section 5.3 — the Rs. 8,000-15,000/branch recommendation is not yet owner-confirmed)
11. **No testimonials section** — no real customers yet; do not fabricate logos, quotes, or review badges. Substitute a "why this exists" block using the real market-research numbers (Foodpanda's 25-35% commission, the FBR compliance note) as credibility content instead.
12. Final CTA + footer

## 2. The 3D Hero Element

### Tech decision
Use **React Three Fiber (`@react-three/fiber`) + `@react-three/drei`** — not raw Three.js. R3F integrates as normal React components, is far faster to build correctly, and has drei's helper utilities (`useTexture`, `Float`, `Environment`, `OrbitControls` if needed) for exactly this kind of scene without reinventing primitives.

### Recommended concept: a floating 3D phone displaying the real WhatsApp ordering conversation
- Build the phone as a procedural 3D primitive (a rounded box geometry — `RoundedBox` from drei), not an imported 3D model file. This avoids asset-sourcing risk (no need to find/license/create a phone .glb model) and keeps the whole scene self-contained in code.
- Apply the **real WhatsApp conversation screenshot** (from `WhatsAppDemo.jsx` or an actual captured conversation) as a texture on the phone's screen face (`useTexture` + a plane mesh positioned on the phone's front, or a texture directly on that face of the RoundedBox).
- Animate: gentle continuous rotation (slow, subtle — this should read as "alive," not "spinning demo"), plus a scroll-linked or mouse-parallax tilt for interactivity. Use drei's `Float` helper for a natural subtle bob, and keep rotation speed low enough that the screenshot texture stays legible — the point is to show the real product, not obscure it with motion.
- Lighting: simple 2-3 point setup (a key light + soft fill) or drei's `Environment` preset for quick, decent-looking lighting without hand-tuning a full studio setup — this is not the place to over-invest engineering time.
- Background: keep the rest of the hero (headline, subheadline, CTA button) as normal HTML/CSS layered behind or beside the 3D canvas, not inside the 3D scene — text should never be 3D-rendered (bad for legibility, accessibility, and SEO).

### Fallback strategy — required, not optional
- **No-WebGL / low-end device fallback:** detect WebGL support before mounting the R3F canvas; if unavailable, render a static image of the phone/screenshot instead (a plain `<img>` with a subtle CSS tilt/shadow for a "flat" version of the same idea) — the hero must never show a blank space or an error.
- **`prefers-reduced-motion` support:** if the user's OS/browser signals reduced motion preference, freeze the phone's animation (or drop to the static fallback) — this is an accessibility requirement, not a nice-to-have.
- **Performance budget:** test on a mid-range Android device or Chrome's mobile CPU/network throttling, not just a development laptop — the actual target audience (Pakistani restaurant owners and their customers) skews toward mid-range phones, not high-end hardware. If frame rate visibly struggles, drop to the static fallback below a defined device-capability threshold rather than shipping a janky experience.
- **Bundle size awareness:** `@react-three/fiber` + `drei` add real weight to the JS bundle — lazy-load the 3D hero component (`React.lazy` + `Suspense`, showing the static fallback while it loads) so it doesn't block first paint of the rest of the page.

## 3. Screenshots — real, not fabricated
Every screenshot referenced in Section 1's structure must come from the actual running application with real (seeded demo) data — not a mockup, not an AI-generated image, not a Figma comp. Capture these by running the app locally against the seeded demo tenant (Lahore Karahi House) and taking real screenshots of each listed page/feature. Store them as static image assets in the client build (e.g. `client/src/assets/marketing/`), optimized (WebP, reasonable dimensions — these don't need to be full-resolution captures) before use.

## 4. Scroll Motion (everywhere except the hero)
Use **Framer Motion**'s scroll-triggered variants (`whileInView`, or `useScroll` for more control) for every non-hero section: fade + slight upward slide as each section enters the viewport. Keep this consistent and subtle across all sections — the goal is polish, not a different animation style per section. Apply the same `prefers-reduced-motion` respect here as the hero (Framer Motion has built-in support for this via `useReducedMotion`).

## 5. Step-by-Step Implementation
1. Install `@react-three/fiber`, `@react-three/drei`, `three`, and `framer-motion` (confirm none are already present before adding duplicates).
2. Capture all required screenshots per Section 3 against the live seeded demo tenant; optimize and add to the client assets.
3. Build the 3D hero component in isolation first (`Hero3D.jsx`) with the WebGL-detection fallback and reduced-motion handling built in from the start, not retrofitted — test it alone before integrating into the full page.
4. Rebuild `LandingPage.jsx`'s section structure per Section 1, wiring in the real screenshots and Framer Motion scroll-reveal wrappers per section.
5. Rebuild the header per the already-agreed consolidation (single "Log in" dropdown, Rider login separate, one primary CTA).
6. Build the "Your AI Team" 4-tab section (Section 1, item 4) with real screenshots per tab.
7. Leave the pricing section's numbers as placeholder/TBD styling, clearly not final.
8. Remove any testimonial/fake-social-proof content if present in the current page; add the market-research "why this exists" block instead.

## Verification Steps
1. Load the page on a modern desktop browser — confirm the 3D phone renders, rotates subtly, and the WhatsApp screenshot texture is legible.
2. Load the page with WebGL disabled (browser flag or a device that lacks it) — confirm the static fallback renders cleanly, no blank space, no console errors.
3. Enable `prefers-reduced-motion` at the OS level, reload — confirm the 3D animation freezes/simplifies and Framer Motion scroll animations are suppressed or reduced.
4. Test on a throttled mobile CPU/network profile (Chrome DevTools) — confirm frame rate stays acceptable, or the fallback correctly engages if it doesn't.
5. Confirm every screenshot on the page is a real, current capture of the actual app (not a stale/mismatched older version of a UI that's since changed) — cross-check at least 3 screenshots against the current live pages they claim to represent.
6. Confirm the pricing section shows no real numbers, and no testimonial/fake-logo content exists anywhere on the page.
7. Run a Lighthouse performance check — confirm the lazy-loaded 3D bundle doesn't meaningfully regress the page's first-contentful-paint time compared to before this redesign.

## Explicitly out of scope
- 3D anywhere outside the hero — every other section uses Framer Motion only, per the scope containment stated at the top of this file
- Imported/external 3D model files (.glb/.gltf) — the phone is built procedurally in code
- WebXR/AR features
- Per-visitor A/B testing of the 3D hero vs. a static version
