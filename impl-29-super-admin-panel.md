# Implementation 29 — Super Admin Panel (Tenant & Subscription Management)

## Goal
A platform-operator panel, completely separate from every existing role, to see all tenants, track subscription expiration at a glance, and manually manage subscription status (extend, suspend, comp) — scoped to what's genuinely valuable now, per `super-admin-research.md`. Full dunning automation, platform-wide analytics, impersonation, and feature flags are explicitly deferred (see Out of Scope).

## The one rule that governs every decision in this file
**This is the first feature in the codebase that intentionally crosses the tenant boundary.** Every other role (owner, manager, staff, rider) has been built so that its access is bounded to one tenant, and that boundary has been the subject of a real security audit. A super admin is not "owner with more permissions" — it must be a structurally separate account type, with its own authentication, its own JWT type, and its own audit trail, built as an explicitly parallel path rather than a bypass grafted onto existing `authorize()` logic. If any step below seems like it could be shortcut by reusing existing tenant-scoped code, don't — that shortcut is exactly how this feature becomes the weakest point in an otherwise carefully audited system.

## 1. Data Model

```sql
-- Completely separate from `users` — never joined or conflated with tenant-scoped accounts
CREATE TABLE super_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  totp_secret TEXT, -- set on first MFA setup, null until then
  totp_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE super_admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  super_admin_id UUID NOT NULL REFERENCES super_admins(id),
  action VARCHAR(50) NOT NULL, -- 'view_tenant_list','view_tenant_detail','extend_subscription','suspend_tenant','reactivate_tenant','comp_period','login'
  target_tenant_id UUID REFERENCES tenants(id), -- null for actions with no single tenant target (e.g. viewing the list)
  details JSONB, -- e.g. { "reason": "...", "extended_to": "2027-01-01", "previous_status": "active" }
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_super_admin_audit_tenant ON super_admin_audit_log(target_tenant_id);
CREATE INDEX idx_super_admin_audit_admin ON super_admin_audit_log(super_admin_id);

-- Extend tenants with subscription fields
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(20) NOT NULL DEFAULT 'trial' CHECK (subscription_status IN ('trial','active','suspended','cancelled'));
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_plan VARCHAR(50);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_period_start TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_period_end TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_notes TEXT;
```

**No public registration path for `super_admins`, ever.** The first account(s) are created via a one-off seed script run manually against the database — never a signup endpoint, never something reachable from the deployed app's public surface.

## 2. Authentication — fully separate from everything else

- **Dedicated secret, not derived from `JWT_SECRET`.** Add `SUPER_ADMIN_JWT_SECRET` as its own environment variable — do not reuse the rider-token pattern of hashing the main secret with a suffix (`impl-23`'s `riderSecret` derivation was an acceptable tradeoff for a low-stakes role; this is not a low-stakes role). Apply the same production boot-guard already required for `JWT_SECRET` and `CRON_SECRET`: fail to boot in production if this is missing or left at a default value.
- **Two-step login, mandatory MFA:**
  1. `POST /api/super-admin/login` — email + password (bcrypt-verified against `super_admins`). On success, issue a short-lived (~5 min) `mfa_pending` token — not a usable session yet.
  2. `POST /api/super-admin/verify-mfa` — TOTP code, verified against `totp_secret`. On success, issue the real super-admin JWT (short expiry — recommend 4-8 hours, forcing periodic re-login, unlike the tenant-side 7-day token).
  3. If `totp_enabled=false` (first login), route to a setup step instead: generate a TOTP secret, display it as a QR code (standard `otplib`/`speakeasy` + QR generation, same library category already used for table QR codes in `impl-02`), require one successful code entry to enable it before any session is issued.
- **`authenticateSuperAdmin` middleware** — new, verifies against `SUPER_ADMIN_JWT_SECRET` and checks a `type: 'super_admin'` claim, structurally parallel to how `authenticateRider` is already kept separate from `authenticate` in `impl-23`. This must reject any tenant-side JWT outright, and every existing tenant-scoped route must reject a super-admin JWT outright — full non-interchangeability, three-way now (staff/owner, rider, super admin), not just two.

## 3. API Endpoints (all under `/api/super-admin/`, all `authenticateSuperAdmin`-gated except login/MFA)

| Endpoint | Method | Purpose |
|---|---|---|
| `/login` | POST | Step 1 — email/password |
| `/verify-mfa` | POST | Step 2 — TOTP, issues real session |
| `/setup-mfa` | POST | First-login TOTP enrollment |
| `/tenants` | GET | List all tenants — name, status, plan, branch count, subscription_period_end, last activity |
| `/tenants/:id` | GET | Full detail view |
| `/tenants/expiring` | GET | `?days=N` — tenants sorted by `subscription_period_end ASC`, filtered to within N days (default 30) |
| `/tenants/:id/extend` | POST | Extend `subscription_period_end`, requires a reason |
| `/tenants/:id/suspend` | POST | Set `subscription_status='suspended'`, requires a reason |
| `/tenants/:id/reactivate` | POST | Set `subscription_status='active'`, requires a reason |
| `/tenants/:id/comp` | POST | Apply a comp period (extend + note), requires a reason |
| `/audit-log` | GET | Filterable by tenant, admin, date range |

## 4. Step-by-Step Implementation

1. **Migrations:** `super_admins`, `super_admin_audit_log`, and the `tenants` subscription columns above.
2. **Seed script:** a one-off Node script (run manually, not an API endpoint) to create the first super admin account (email + a securely generated initial password, changed on first login).
3. **Auth service — `server/src/services/super-admin-auth.js` (new):** login step 1/2, TOTP setup/verification (use a maintained library — `otplib` is a reasonable choice), JWT issuance against `SUPER_ADMIN_JWT_SECRET`.
4. **Middleware — `authenticateSuperAdmin`:** new, structurally separate from `authenticate`/`authenticateRider`, added to `server/src/middleware/auth.js` alongside them (not replacing or modifying either).
5. **Audit logging as middleware, not per-route calls:** wrap every `/api/super-admin/*` route (except login/mfa) in a logging layer that writes to `super_admin_audit_log` automatically — capturing the action, target tenant (from the route param if present), and a details payload, before or immediately after the handler runs. Building this as middleware (not a manual `logAudit()` call sprinkled into each handler) means a future new endpoint can't accidentally ship without being logged.
6. **Route — `server/src/routes/super-admin.js` (new):** implement the endpoints in Section 3. The tenant list/detail queries are **new, explicitly cross-tenant queries** — do not adapt or reuse any existing tenant-scoped query function; write these fresh, since existing functions are deliberately built to assume and enforce a single tenant_id and should not be given an escape hatch.
7. **Enforce suspension in the existing tenant-side `authenticate` middleware:** a suspended tenant's owner/staff/rider logins and API calls must actually be blocked, not just marked in the database. Add a check in the existing `authenticate` (and `authenticateRider`) middleware: look up the requesting user's `tenant_id`, check `tenants.subscription_status`, reject with a clear "subscription suspended" response if suspended. This is the one required touchpoint in existing code — keep it minimal (a single status check), don't restructure the existing middleware beyond that.
8. **Frontend — entirely separate app shell, not nested under the existing admin `Layout.jsx`:** `client/src/super-admin/` with its own login page (distinct from `Login.jsx`), its own layout, and routes that are not linked from or reachable through the normal tenant admin navigation. Pages: login + MFA entry, MFA setup (QR code display), tenant list (sortable/filterable, with a prominent "expiring soon" view), tenant detail, audit log viewer.
9. **Expiring-soon dashboard as the default landing view** after login — directly answers the original ask: sorted by days-until-expiration, with quick actions (extend/suspend/comp) inline rather than requiring a drill-into-detail round trip for routine renewals.

## Verification Steps
1. Attempt super-admin login with correct password but no/wrong TOTP code — confirm no usable session is issued.
2. Confirm a super-admin JWT is rejected by an existing tenant-scoped route (e.g. `/api/orders`), and a tenant owner's JWT is rejected by `/api/super-admin/tenants` — full non-interchangeability.
3. Perform each action type (view list, view detail, extend, suspend, reactivate, comp) and confirm each produces exactly one correct `super_admin_audit_log` entry with the right actor, target tenant, and details.
4. Seed several test tenants with varying `subscription_period_end` dates, confirm `/tenants/expiring` returns them correctly sorted and filtered.
5. Suspend a test tenant, then attempt to log in as that tenant's owner — confirm the login is rejected with a clear subscription-suspended message, not a generic error.
6. Reactivate that tenant, confirm owner login succeeds again.
7. Confirm there is no reachable endpoint or UI path to create a `super_admins` row outside the manual seed script.
8. Confirm the super-admin frontend routes are not linked anywhere in the normal tenant admin UI (check `Layout.jsx` and `App.jsx` for any accidental cross-linking).

## Explicitly out of scope for this file
- Impersonation / "login as tenant" — flagged in the research doc as the highest-risk feature on the list; not included here
- Full dunning automation / a renewal-reminder agent — roadmap, natural future extension of the existing agent pattern (`impl-14`–`impl-21`)
- Platform-wide MRR/ARR/churn analytics — roadmap
- Cross-tenant support ticket or agent-health monitoring — roadmap
- Feature flags / plan-tier gating — roadmap
- Real payment processing — this spec tracks subscription status and dates only; it does not charge anything, consistent with the rest of the system remaining COD-only pending a real gateway (`impl-01`)
