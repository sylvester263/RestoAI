# Implementation 23 — Multi-Role Onboarding & Authentication (Owner / Staff / Rider)

## Goal
Design and build the complete path from "restaurant owner discovers RestoAI" to "owner, staff, and riders are all actively using the system" — three distinct personas, each with an appropriate onboarding path and login experience, sharing one platform.

## Key design decision (make this first, it shapes everything else)

**Owner and staff share one auth system (existing `users` table, JWT, role-based). Riders do NOT — they need a separate, lighter-weight auth mechanism.**

Reasoning: owners and staff are already unified under the existing `users` table with a `role` column (`owner`/`manager`/`staff`) and the existing JWT + `authorize()`/permission system — "Staff login" on the marketing page is the **same login form and endpoint** as "Owner login," just a different persona clicking it; the backend already returns the correct role and the frontend already routes to the correct view based on it. Do not build a second owner/staff auth system — reuse what exists.

Riders are structurally different: they aren't in the `users` table at all (per `impl-05`'s data model — `riders` is a separate table with no relationship to `users`/roles/permissions), they don't need branch-management or menu-editing capabilities, and they're often lower-tech-literacy users who need the simplest possible login — not a password to remember. **Riders get phone number + PIN**, not email/password, not full OTP-per-login (added friction for a daily-use field worker), similar in spirit to how customer identity was deliberately kept lightweight (`impl-01`/customer app decided against OTP for speed) but slightly stronger since riders handle cash.

## Data Model

### Owner/Staff — no new tables (uses existing `users`, extend if needed)
If there is currently no self-service "invite a staff member" flow (verify — the existing `users` table and seed data suggest staff accounts exist, but confirm whether an owner can currently create one through the UI, or only via seed/direct DB access):

```sql
CREATE TABLE staff_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  email VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('manager','staff')),
  branch_id UUID REFERENCES branches(id),
  invite_token VARCHAR(64) UNIQUE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Riders — extends `impl-05`'s `riders` table
```sql
ALTER TABLE riders ADD COLUMN pin_hash TEXT; -- bcrypt-hashed 4-6 digit PIN, set by owner at rider creation
ALTER TABLE riders ADD COLUMN last_login_at TIMESTAMPTZ;
```

## API Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/auth/register` | POST | Public | **Existing** — owner signup (creates tenant+user+branch). No change needed unless verification shows gaps. |
| `/api/auth/login` | POST | Public | **Existing** — used by both owner and staff, returns role-appropriate JWT. No change needed. |
| `/api/staff-invites` | POST | Authenticated (owner/manager) | Owner invites a staff member by email |
| `/api/staff-invites/:token/accept` | POST | Public (token-gated) | Invited staff sets their password, account activated |
| `/api/rider-auth/login` | POST | Public | Rider logs in with phone + PIN, returns a rider-scoped JWT |
| `/api/riders` (extend `impl-05`'s create endpoint) | POST | Authenticated (owner/manager) | When creating a rider, owner also sets an initial PIN (or the system generates one and displays it once for the owner to share) |

## Step-by-Step Implementation

### Owner onboarding (verify existing, extend if gaps found)
1. **Verify the existing `/api/auth/register` flow** actually covers: restaurant name → tenant creation, first branch creation, owner user creation — per the earlier audit, this already exists and is transactional (the registration-transaction bug was already fixed). Confirm it's still solid; no rebuild needed unless verification finds regressions.
2. **Post-signup guided setup (new, if it doesn't exist):** after registration, walk the owner through: add menu items (offering the AI photo-digitize option prominently, since it's a real differentiator), connect WhatsApp (or note it's in demo mode if credentials aren't configured), optionally invite staff, optionally add riders. This can be a simple checklist/wizard UI on first login rather than a hard-gated multi-step flow — don't block the owner from reaching their dashboard if they skip steps.

### Staff invitation + login
3. **Migration:** Add `staff_invites` if no invite mechanism currently exists (verify first — check the existing `users`/auth routes for any staff-creation endpoint before assuming this needs to be built from scratch).
4. **Backend — `server/src/routes/staff-invites.js` (new, if needed):**
   - `POST /` — owner/manager creates an invite (email, role, branch assignment), generates a token, sends an invite link via email or WhatsApp (whichever send capability is more reliably configured in this environment — WhatsApp is already built and demo-mode-safe, email may not be set up at all, prefer WhatsApp if the invitee's phone number is available).
   - `POST /:token/accept` — validates the token (exists, not expired, not already accepted), lets the invitee set a password, creates their `users` row with the specified role/branch, marks the invite `accepted`.
5. **Staff login:** uses the **existing** `/api/auth/login` endpoint unchanged — the marketing page's "Staff login" button routes to the same login form as "Owner login." Post-login, the frontend already routes based on the returned role (confirm this routing exists and correctly limits a staff account's visible nav/pages vs. an owner's — if it doesn't fully exist, this ties into `impl-10`'s granular RBAC work, but basic role-based page visibility should already partially work given `authorize()` gates already exist on various routes).

### Rider invitation + login
6. **Migration:** Add `pin_hash`/`last_login_at` to `riders` (requires `impl-05` to exist first — this file cannot proceed without it).
7. **Backend — extend `impl-05`'s rider creation endpoint:** when an owner/manager adds a rider, either let them set an initial PIN directly or auto-generate one and display it once (in the UI, not sent insecurely) for the owner to communicate to the rider directly (in person, being a real-world workflow already implied by riders being local hires).
8. **Backend — `server/src/routes/rider-auth.js` (new):**
   - `POST /login` — accept `phone` + `pin`, look up the rider by phone (tenant-scoped — but note riders log in without necessarily knowing which tenant, so this may need to search across tenants by phone and disambiguate, or require the rider to have been given a tenant-specific link/QR at onboarding, similar in spirit to how a customer reaches a specific tenant via `/order/:tenantSlug`; recommend the latter — give each rider a tenant-scoped login link, avoiding any cross-tenant phone lookup ambiguity or leakage), verify the PIN (bcrypt compare), issue a **rider-scoped JWT** with different claims than the owner/staff JWT (`rider_id`, `tenant_id`, `branch_id` — explicitly no `role`/`permissions` claims that could be confused with the owner/staff permission system; keep these two token types structurally distinct so a rider token can never accidentally pass an `authorize()` check meant for staff).
   - Rate limit this endpoint (PIN brute-forcing is a real concern with a short numeric PIN) — apply the same rate-limiting pattern used elsewhere, tuned tighter given the smaller PIN keyspace (e.g. 5 attempts per 15 minutes per phone number, not just per IP).
9. **Rider-facing app (new, minimal):** `client/src/pages/rider/` — a lightweight, mobile-first view showing the rider's assigned deliveries (from `impl-05`'s `rider_assignments`), a "mark picked up / mark delivered" action per delivery, and a running total of cash collected for the day. This was flagged as an optional stretch in `impl-05` — this file promotes it to a real requirement, since "rider login" only means something if there's somewhere for the rider to land after logging in.
10. **Rider JWT middleware:** a separate `authenticateRider` middleware (distinct from the existing `authenticate` used for owner/staff), applied only to rider-facing routes (`rider_assignments` update endpoints) — never let a rider token pass through the owner/staff `authorize()` middleware or vice versa.

## Verification Steps
1. Complete owner signup end-to-end, confirm tenant/branch/owner-user creation still works exactly as previously verified (no regression).
2. Invite a staff member, confirm the invite link/message is sent, accept it, confirm the new staff account can log in via the same `/api/auth/login` used by the owner and sees only what their role permits.
3. Create a rider with a PIN, confirm the rider can log in via `/api/rider-auth/login` with phone+PIN and receives a rider-scoped token.
4. Confirm a rider token is rejected by any owner/staff-only endpoint (`authorize()`-gated routes), and an owner/staff JWT is rejected by rider-only endpoints — the two token types must be fully non-interchangeable.
5. Brute-force a rider PIN (repeated wrong attempts) — confirm the rate limiter kicks in.
6. Log in as a rider, confirm they see their assigned deliveries and can mark status changes, and that this correctly updates the same `rider_assignments` data the owner-side Riders admin view shows.
7. Confirm a rider from tenant A cannot access tenant B's delivery data under any circumstance (tenant-scoping applies to rider auth exactly as rigorously as everywhere else in this codebase).

## Explicitly out of scope for this file
- Rider self-signup (riders are always added by an owner/manager, never self-register — this matches the real-world hiring relationship)
- Password reset flows for staff (add later if needed; not blocking for initial launch)
- Biometric/passwordless login for any role
