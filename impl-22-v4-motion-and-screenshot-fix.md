# Implementation 22 (v4) — Scroll Motion, Tab Transitions & Screenshot Containment

## Scope — read first
This adds **motion behavior only** — no colors, no layout structure, no copy changes. The current dark/green color scheme stays exactly as it is; do not touch it. Three things, in priority order: (1) fix the Insights tab's broken screenshot — a real bug, not a motion task, but it directly undermines "proper screenshot format," so it's grouped here; (2) scroll-reveal animation; (3) tab cross-fade transition; (4) consistent, contained screenshot sizing across all six feature tabs.

## Part 1 — Fix the Insights tab screenshot (real bug, do this first)
On the "Know Your Business" (Insights) tab specifically, the screenshot panel currently renders as an empty box — confirmed by checking consecutive video frames, not a loading state, a genuinely missing/broken image. Every other tab (Ordering, AI Team, Operations, Customers, Website) shows a real screenshot correctly.

- Find the image source/reference used for the Insights tab's screenshot specifically.
- Confirm whether the file path is wrong, the asset was never actually added, or it's an import/build issue specific to this one tab.
- Fix it so a real screenshot renders, consistent with the other five tabs.
- Verify: click through all six tabs in sequence, confirm every single one shows a real, correctly-loaded screenshot — not just Insights.

## Part 2 — Scroll-reveal animation
Add a fade + slide-up reveal that triggers as each section enters the viewport while scrolling, matching the CallHippo reference's behavior. The current site has no scroll-reveal at all — content is simply present as the page is scrolled to it.

**Implementation approach:** check `package.json` first for an existing animation library (Framer Motion is common in this kind of stack) before adding a new dependency. If one already exists, use it (e.g. Framer Motion's `whileInView` prop). If not, implement a lightweight, dependency-free `useScrollReveal` hook using the native `IntersectionObserver` API — this is well-supported, requires no new package, and is the standard approach for this exact effect.

**Exact behavior:**
- Each major section (hero content, the stat bar's four numbers, each feature-tab panel, the "One system, every role" three cards, the "Why this exists" three stat cards, the onboarding three cards, the pricing card, the closing CTA) starts at `opacity: 0` and translated `20-24px` downward, and animates to `opacity: 1` / `translateY: 0` when it enters the viewport.
- Duration: ~500-600ms, ease-out timing (not linear, not bouncy).
- Trigger threshold: roughly 15-20% of the element visible before the animation starts — don't wait for full visibility, and don't trigger the instant it's barely on screen.
- **Animate once only** — once a section has revealed, it stays visible; scrolling back up and down again should not replay the animation. This matches standard professional scroll-reveal behavior and avoids a distracting repeated effect.
- **Stagger grouped elements** — where multiple similar items reveal together (the four stat-bar numbers, the three "What's included" checklist items, the three role cards, the three "why this exists" stat cards), each item in the group should reveal roughly 80-100ms after the previous one, not all simultaneously — this is what makes a reveal feel deliberate rather than like a single flat fade.
- Respect `prefers-reduced-motion` — if a visitor has that OS/browser setting enabled, skip the animation and show content immediately at full opacity; this is a real accessibility requirement, not optional polish.

## Part 3 — Tab cross-fade transition
When switching between the six feature tabs (Ordering / AI Team / Operations / Insights / Customers / Website), the content panel currently hard-cuts to the new tab's content — this is exactly what made the Insights bug visually jarring (an instant blank box appearing with no transition to soften it).

**Exact behavior:**
- On tab click, the current panel's content (headline, description, checklist, screenshot) fades out over ~150-200ms, then the new tab's content fades in over ~150-200ms — a simple cross-fade, not a slide or a more elaborate transition.
- The tab pill itself (the selected state — currently shown in green per the existing design) should transition its background/text color smoothly (~150ms) rather than snapping, consistent with the rest of the new motion language.
- Keep this subtle and fast — a cross-fade this quick reads as "responsive," not as "loading." Do not add a spinner or loading state for this transition; the six tabs' content should already be available client-side (it's static content, not a fresh data fetch), so the fade itself is the only transition needed.

## Part 4 — Consistent, contained screenshot sizing
Screenshots across the feature tabs currently vary in effective size/framing (contributing to the "goes very big" problem described) — fix this so every tab's screenshot sits within the same bounded card dimensions, matching the CallHippo reference's treatment where every feature section's screenshot mockup occupies a consistent, contained frame regardless of the underlying image's actual resolution.

- Set a fixed max-width and max-height for the screenshot container within the two-column feature-tab layout (a specific px or rem value the coding agent should determine by matching the reference's actual proportions — the screenshot should comfortably fit within its column without overflowing, cropping awkwardly, or looking tiny relative to the card around it).
- Use `object-fit: contain` (not `cover`, which would crop) so each screenshot's full content stays visible, letterboxed within the frame if its aspect ratio doesn't exactly match, rather than being stretched or cut off.
- Apply this same contained sizing rule uniformly across all six tabs — Ordering, AI Team, Operations, Insights (once Part 1's fix lands), Customers, and Website — so switching between tabs doesn't cause the screenshot area to visibly jump in size.
- This same containment rule should also apply to any other screenshot on the page outside the tab section, if any exist (e.g. the hero's layered screenshot cards) — check for consistency across the whole page, not just the feature-tab section.

## Verification Steps
1. Reload the homepage fresh, scroll slowly from top to bottom, confirm every section fades/slides in as it enters the viewport, in the correct stagger order for grouped elements, and that nothing re-triggers on scrolling back up.
2. Enable `prefers-reduced-motion` in browser dev tools, reload, confirm all content appears immediately with no animation.
3. Click through all six feature tabs in sequence (including clicking back to an earlier one), confirm a smooth cross-fade every time, confirm Insights now shows a real screenshot like every other tab, confirm no hard-cut or flash of blank content anywhere.
4. Visually compare screenshot sizing across all six tabs side by side (screenshot each tab, compare) — confirm consistent framing, no tab's screenshot appears oversized, cropped, or noticeably smaller than the others.
5. Confirm no color, layout structure, or copy changed anywhere on the page as a side effect of this work — this file is motion and screenshot-containment only.

## Explicitly out of scope
- Any color or theme change — confirmed staying as-is
- Any layout restructuring beyond what's needed for consistent screenshot containment
- Any new copy or content
- Parallax effects, 3D transforms, or anything beyond the specific fade/slide-up + cross-fade behavior described above — keep the motion restrained and consistent with the reference, not more elaborate than it
