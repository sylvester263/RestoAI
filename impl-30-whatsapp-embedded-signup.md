# Implementation 30 — WhatsApp Embedded Signup (Per-Tenant Number Connection)

## Goal
Let each restaurant owner connect their own WhatsApp Business number directly inside RestoAI's onboarding/settings — via Meta's Embedded Signup flow — instead of the platform operator manually configuring one number per tenant outside the product. The result (a WABA ID and `phone_number_id` per tenant) feeds directly into the webhook routing logic that's already built and audited.

## Dependency — read before starting
**Requires an approved, Live Meta Tech Provider app.** This is a business/compliance process (business verification, App Review with demo videos, Tech Provider Terms acceptance), not something this spec builds — it's a precondition. The code in this file can be built and tested against Meta's test/sandbox tools before that approval fully lands, but production use (a real restaurant connecting a real number) requires the app to be in Live mode with Advanced Access to `whatsapp_business_management` and `whatsapp_business_messaging`.

Extends `impl-23`'s owner onboarding flow. Reuses `tenants.whatsapp_phone_number_id` (already exists, already used by the audited webhook tenant-routing logic) and the existing WhatsApp send pipeline in `services/whatsapp.js`.

## Key architectural point — one platform token, many tenant numbers
Under the Tech Provider delegated-access model, `WHATSAPP_TOKEN` stays a **single platform-level credential** (your System User token) — it does not need to be different per tenant. What varies per tenant is `phone_number_id`, which every outbound API call must specify. Do not build per-tenant token storage; that would be solving a problem the Tech Provider model already solves for you. Confirm the existing send pipeline already threads `phone_number_id` per-call rather than assuming a single global one (it should, since it already receives inbound messages scoped by `phone_number_id` per the existing webhook routing) — if it doesn't, that's a required fix within this same pass, not a separate one.

## 1. Data Model

```sql
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS whatsapp_waba_id VARCHAR(50);
-- whatsapp_phone_number_id already exists per prior audits — confirm, don't duplicate
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS whatsapp_connection_status VARCHAR(20) NOT NULL DEFAULT 'not_connected' CHECK (whatsapp_connection_status IN ('not_connected','connected','error'));
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS whatsapp_connected_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS whatsapp_pin_encrypted TEXT; -- two-step verification PIN, encrypted at rest — never store this in plaintext
```

## 2. API Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/whatsapp-connect/session` | POST | Authenticated (owner) | Generate the Embedded Signup launch config (app ID, configuration ID) for the frontend SDK |
| `/api/whatsapp-connect/callback` | POST | Authenticated (owner) | Receive the result of a completed signup flow, complete number registration, store connection details |
| `/api/whatsapp-connect/status` | GET | Authenticated (owner/manager) | Current connection status for the tenant |
| `/api/whatsapp-connect/disconnect` | POST | Authenticated (owner) | Clear connection state (does not deregister the number from Meta — that's a separate, deliberate action, not a casual toggle) |

## 3. Step-by-Step Implementation

1. **Migration:** Add the new `tenants` columns above.
2. **Frontend — Facebook Login for Business SDK:** integrate Meta's JavaScript SDK, configured with your Tech Provider app's ID and the Embedded Signup configuration ID (created in the Meta App Dashboard under Facebook Login for Business, per the Tech Provider setup already completed as a precondition). Add a "Connect WhatsApp" button to the owner onboarding flow (`impl-23`) and to an admin settings page for reconnecting later.
3. **Launch flow:** clicking the button calls `FB.login()` with the Embedded Signup configuration, opening Meta's hosted popup where the owner logs in with Facebook and connects/creates their WhatsApp Business Account and number. On completion, the SDK returns a WABA ID, a `phone_number_id`, and an authorization code to your frontend.
4. **Backend — `/api/whatsapp-connect/callback`:** receive the WABA ID + `phone_number_id` + code from the frontend. Complete whatever exchange/confirmation step Meta's flow requires (check current Meta documentation for the exact token-exchange mechanics at implementation time, since this detail is more likely to have changed than the broader flow shape).
5. **Register the phone number for Cloud API use:** call Meta's phone number registration endpoint with the `phone_number_id` and a two-step verification PIN. **Generate this PIN programmatically** (a random 6-digit value) rather than asking the owner to invent one — they shouldn't need to manage a technical PIN they'll never directly use again. Store it **encrypted**, not plaintext, in `whatsapp_pin_encrypted` (re-use whatever encryption-at-rest pattern, if any, already exists in the codebase for other sensitive values; if none exists, this is a reasonable place to establish one rather than storing it in reversible-but-unencrypted form).
6. **Confirm webhook subscription:** verify the connected WABA is actually subscribed to your app's webhook for the `messages` field — Embedded Signup may handle this automatically depending on the flow version in use at implementation time, but **do not assume it silently worked** — explicitly check/set the subscription as part of this callback step, since an unsubscribed WABA means messages will never reach your webhook despite the connection appearing to succeed.
7. **Store the result:** `whatsapp_waba_id`, `whatsapp_phone_number_id`, `whatsapp_connection_status='connected'`, `whatsapp_connected_at=now()` on the tenant record.
8. **Status endpoint + UI:** show connection state clearly in the admin UI (not connected / connected with the masked phone number displayed / error), with a way to retry if the flow fails partway.
9. **Failure handling:** if registration or webhook subscription fails after the frontend signup step succeeds, set `whatsapp_connection_status='error'` with enough detail (logged server-side, not necessarily shown raw to the owner) to debug — don't leave the tenant in a state that looks "connected" in the UI when messages won't actually flow.

## Verification Steps
1. Complete the full Connect WhatsApp flow with a real test business/number in Meta's test environment, confirm `whatsapp_waba_id` and `whatsapp_phone_number_id` are stored correctly on the tenant record.
2. Confirm the number is actually registered and callable: send a test message via the Cloud API using the returned `phone_number_id`, confirm real delivery.
3. Send an inbound test message to the newly connected number, confirm it's correctly routed to this tenant via the existing (already-audited) `phone_number_id`-based webhook routing — this is the point where this new feature and the already-built, already-tested routing logic meet, and it should just work if both sides are correct.
4. Confirm the connection status UI accurately reflects reality at each stage (not connected → connecting → connected, or → error with a retry path).
5. Confirm the PIN is stored encrypted, not plaintext — inspect the actual stored value, don't just trust the column name.
6. Confirm tenant isolation: one tenant's Embedded Signup session can never write to or affect another tenant's `whatsapp_*` fields — attempt to trigger the callback endpoint with a mismatched tenant context and confirm it's rejected.
7. Confirm the disconnect action clears local connection state without silently deregistering the number from Meta (that should require a separate, explicit, clearly-labeled action if built at all).

## Explicitly out of scope for this file
- The Meta Tech Provider approval process itself — business/compliance work, not code, and a precondition for this file rather than part of it
- Message template creation/management UI — a distinct feature (candidate for a future `impl-31` if needed)
- Multiple WhatsApp numbers per tenant (one number per tenant for this pass)
- A BSP-hosted version of this flow (this spec assumes direct Meta Tech Provider integration; a BSP path would look structurally different and isn't covered here)
- Actually deregistering/porting a number away from RestoAI — only connection is covered, not offboarding
