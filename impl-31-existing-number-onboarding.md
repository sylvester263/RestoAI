# Implementation 31 — Existing WhatsApp Number Onboarding

## Goal
Give restaurant owners with an already-active WhatsApp number a clear, non-surprising path to connect it to RestoAI — instead of dropping them into Meta's Embedded Signup popup cold and letting them discover mid-flow (as happened during live testing) that their number requires deleting their existing account first.

## The three real scenarios (confirmed against Meta's current documentation)

| Scenario | What happens | Chat history |
|---|---|---|
| **A1 — Number never used on any WhatsApp app** | Straightforward — register directly via Embedded Signup, exactly like today's successful test | N/A |
| **A2 — Number on personal WhatsApp or WhatsApp Business App, no prior Cloud API use** | Two real options: (a) delete the existing account, then register fresh — chat history lost; (b) **Coexistence** — keep the Business App *and* Cloud API running simultaneously via QR-pairing, chat history preserved. **Region-limited — not confirmed available in Pakistan, must verify before promising this to owners.** | Lost (2a) or preserved (2b, if available) |
| **B — Number already on Cloud API via a different Tech Provider/BSP** (e.g. switching from Wati, Gupshup, 360dialog) | Formal API-driven migration (`migrate_phone_number: true`), preserves templates/quality rating/messaging limits. Requires both WABAs verified, payment method configured on both sides. **Not a self-service popup flow — needs backend orchestration.** | Preserved (business-level; not personal chat history, which doesn't apply to a Cloud API number anyway) |

## Part 1 — Pre-flow guidance (build this first, it's cheap and fixes today's exact surprise)

### Step-by-step
1. Before launching the "Connect WhatsApp" Embedded Signup popup, add a short pre-check screen in RestoAI's own onboarding UI (`WhatsAppConnect.jsx`) asking: **"Do you already use this number on WhatsApp?"** with three options matching the scenarios above — "No, it's a new number" / "Yes, on regular WhatsApp or WhatsApp Business App" / "Yes, already connected through another business messaging platform."
2. For **A1** — proceed straight to Embedded Signup, no extra friction.
3. For **A2** — show clear, honest guidance *before* they enter the popup: explain that Meta requires either deleting the existing app's account (chat history lost, contacts/number unaffected) or — if Coexistence turns out to be available for Pakistan — pairing via QR without losing anything. Link to the actual account-deletion steps (Settings → Account → Delete Account) as a mini-guide, matching the real error message they'll otherwise see mid-flow. This turns a confusing mid-flow surprise into an informed decision made upfront.
4. For **B** — do not attempt this through the standard "Connect WhatsApp" button at all. Show a message directing them to contact support/the platform operator for an assisted migration (see Part 3) rather than letting them get partway through the standard flow and hit a dead end.

### Verify
Walk through each of the three branches in the pre-check UI, confirm the guidance shown matches the real Meta behavior for that path, and confirm A1 users see zero extra friction (no regression for the already-working happy path).

## Part 2 — Investigate Coexistence availability for Pakistan (research task, not a build task yet)

Before promising owners the "keep your chat history" path exists, confirm:
1. Whether WhatsApp Coexistence is currently available for businesses in Pakistan — check Meta's current regional rollout documentation directly, since this is exactly the kind of detail that changes over time and shouldn't be assumed from general research.
2. If available: what's required on RestoAI's Embedded Signup configuration side to expose the "Connect your existing WhatsApp Business App" option during the flow (this may require a specific ES version, a config-level toggle, or was possibly already present as an earlier step in the flow that wasn't reached during today's specific test path — re-check the full radio-button step list from the beginning of the flow, not just where today's test entered it).
3. If confirmed available and enableable: update Part 1's A2 guidance to lead with Coexistence as the recommended option, with account-deletion as the fallback only if Coexistence isn't chosen or available.
4. If NOT available for Pakistan: keep A2's guidance as account-deletion only, but note this as a "when Meta expands Coexistence to Pakistan" future improvement, not abandoned entirely.

## Part 3 — Cross-provider migration (Scenario B) — larger, backend-driven, roadmap

This is real functionality worth having eventually (a restaurant currently on Wati/Gupshup/another provider is a legitimate acquisition target, and "you'd lose your approved templates and messaging history switching to us" is a real objection this solves) — but it's structurally different from self-service onboarding and shouldn't be built as part of this pass.

### Why it's bigger
- Requires business-token-authenticated API calls on both the source and destination side (RestoAI already has the per-tenant encrypted business token architecture from `impl-30`'s correction, which this would reuse)
- Both WABAs need payment methods configured — a real operational prerequisite outside RestoAI's control
- Likely needs a support-assisted flow (a platform-operator or account manager coordinating the migration timing with the restaurant) rather than a pure self-service button, given the coordination required with whatever provider they're leaving

### Recommended scope when this is built
- An admin/super-admin-initiated migration request (ties naturally to `impl-29`'s super admin panel) rather than a tenant-facing self-service flow
- Store migration status/progress on the tenant record (a new `whatsapp_migration_status` field, separate from the existing `whatsapp_connection_status`)
- Build only once there's a real prospective customer actually asking for this — this is exactly the kind of feature worth building against a real need, not speculatively

## Verification Steps (Part 1 only, for this pass)
1. Trigger the pre-check screen, select each of the three options, confirm the correct guidance/next-step shows for each.
2. Confirm A1 selection proceeds directly into Embedded Signup with no added steps (no regression on the now-proven working path).
3. Confirm A2's guidance text accurately reflects real Meta behavior — cross-check against the actual error message format seen in live testing ("This number is registered to an existing WhatsApp account...").
4. Confirm B's guidance correctly stops the user before they attempt the self-service flow, rather than letting them proceed into a dead end.

## Explicitly out of scope for this file
- Actually building Coexistence support (Part 2 is investigation only — build it as a follow-up once availability is confirmed)
- Building the cross-provider migration flow itself (Part 3 is scoped and roadmapped, not built now)
- Any change to the now-proven-working "new number" registration path

---

## Status (2026-09-23)

### Part 1 — BUILT
`client/src/pages/WhatsAppConnect.jsx`: "Connect WhatsApp" now opens an inline pre-check ("Do you already use this number on WhatsApp?") with three options.
- **A1 "No, it's a new number"** → calls the unchanged `handleConnect()` right away. The Embedded Signup call itself (`FB.login` config, callback, postMessage handling) is untouched.
- **A2 "Yes, on regular WhatsApp / WhatsApp Business app"** → warning quoting the real mid-flow error ("This number is registered to an existing WhatsApp account…"), a 3-step guide (optional chat backup → Settings → Account → Delete my account → keep the SIM for the OTP), what is lost vs. kept, then "I've deleted it, continue" → Embedded Signup. Leads with deletion only, because Coexistence is not wired up (see Part 2).
- **B "Yes, through another business messaging platform"** → no path into Embedded Signup. Explains the assisted migration (templates/quality rating/limits kept, don't cancel the old provider yet) with a `mailto:support@restoai.app` pre-filled with the tenant ID.
- Client build passes. **Not yet clicked through in a live browser.**

### Part 2 — investigation findings (inconclusive for Pakistan)
- Meta's own coexistence doc (developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users, fetched 2026-09-23) lists **no country availability or restrictions at all**. So Pakistan is neither confirmed nor excluded by Meta directly.
- Third-party BSP guides (chakrahq, others) claim coexistence is "live worldwide" as of 2026, with Nigeria/South Africa added April 2026. Pakistan is not named either way. **Not treated as confirmation.** Next step: test it for real (start ES with the coexistence feature type on a Pakistani WhatsApp Business app number and see if the option appears).
- What building it would need (follow-up, not done): Business app **v2.24.17+** on the owner's phone; ES with session logging; the finish event is `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` (returns `waba_id`, *no* `phone_number_id` in the documented payload); the `/register` step **must be skipped** (number already registered); contacts/history sync must be started within **24 h**; throughput fixed at **20 mps**; groups/broadcast lists/disappearing messages not supported on the API side. So `/callback` in `routes/whatsapp-connect.js` needs a separate branch, not just a flag.
- **Side finding, time-sensitive:** Meta's doc states **"Embedded Signup v2 will be deprecated on October 15, 2026"** (v4 current). Our `FB.login` passes `extras: { setup: {} }` with no `sessionInfoVersion`/`version`. Check which ES version this config resolves to before Oct 15.

### Part 3 — unchanged (roadmap, build against a real customer request)
