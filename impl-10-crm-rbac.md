# Implementation 10 — Customer CRM & Segments + Granular Staff Permissions (RBAC)

## Goal
Two related but distinct pieces: (A) let owners tag/segment customers for targeted marketing and see a richer customer profile, and (B) replace the current coarse owner/manager/staff roles with granular, assignable permissions (matching Bitecast's "21 permissions per role" positioning).

---

## Part A — Customer CRM & Segments

### Data Model

```sql
CREATE TABLE customer_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  tag VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(customer_id, tag)
);

CREATE TABLE customer_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name VARCHAR(100) NOT NULL,
  filter_rules JSONB NOT NULL, -- e.g. {"min_orders": 5, "last_order_days_ago_lt": 30, "tags": ["vip"]}
  created_at TIMESTAMPTZ DEFAULT now()
);
```

`filter_rules` is intentionally a flexible JSONB rule set rather than a rigid schema — start with a small, well-defined set of supported rule keys (order count thresholds, recency, spend thresholds, specific tags) rather than building an open-ended query builder.

### 1.1 RFM segmentation (research-validated framework — implement this as the default segment set, not a generic starting point)
RFM (Recency, Frequency, Monetary) is the standard customer-segmentation model, not something to reinvent. Score each customer 1-5 on each axis (based on tenant-relative distribution — e.g. quintiles of days-since-last-order, order count, and total spend), then map score combinations to the standard labeled segments:

| Segment | Typical RFM pattern | Suggested action |
|---|---|---|
| Champions | High R, high F, high M | Reward loyalty, early access to new items, ask for referrals |
| Loyal customers | Mid-high R, high F, high M | Exclusive offers, personalized recommendations |
| Recent/promising | High R, low-mid F, any M | Welcome campaign, encourage a second order |
| Needs attention | Mid R, mid F, mid M | Re-engagement nudge before they drift further |
| About to sleep | Low-mid R, low F | Time-sensitive win-back offer (ties directly into `impl-15`'s win-back agent) |
| Cannot lose them | Low R, high F, high M | High-value customer going quiet — highest-priority win-back target |
| Lost | Low R, low F, low M | Lowest-priority, cheapest win-back attempt only |

Compute this as a `GET /api/segments/rfm` endpoint (or a scheduled recomputation, since RFM scores drift slowly and don't need real-time freshness) that assigns every customer to one of these 7 labels — expose it as a **built-in segment set available immediately**, with the fully custom `filter_rules` system (below) available for anything beyond RFM. This directly strengthens `impl-15`'s win-back agent, which currently uses a single flat "20+ days since last order" threshold — once RFM exists, the win-back agent should target "About to sleep" and especially "Cannot lose them" (high-value customers going quiet) with more urgency/better offers than a low-value lapsed customer in the plain "Lost" segment.

### API Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/customers/:id/tags` | GET/POST/DELETE | Authenticated | Manage tags on a customer |
| `/api/segments` | GET/POST | Authenticated | Define a segment |
| `/api/segments/:id/customers` | GET | Authenticated | Resolve a segment to its matching customer list (evaluate `filter_rules` against actual order/customer data at query time — not a materialized/stale list) |
| `/api/customers/:id/profile` | GET | Authenticated | Rich profile: order history, total spend, tags, review history, loyalty balance |

### Step-by-Step Implementation
1. **Migrations:** Add `customer_tags`, `customer_segments`.
2. **Backend — extend existing customer-related routes (or add `server/src/routes/customers.js` if customers aren't already a first-class route):**
   - Tag CRUD — simple add/remove.
   - Segment evaluation: write a function that takes `filter_rules` JSON and builds a parameterized query against `customers`/`orders` (e.g. `min_orders` → `HAVING COUNT(orders) >= $1`, `last_order_days_ago_lt` → a date comparison, `tags` → a join against `customer_tags`). Keep this as a small set of composable, explicitly-coded filter types — do not let the JSON drive raw SQL construction (this is the same class of risk flagged and fixed in the earlier security audit for LLM-generated SQL; a flexible-looking rule engine must still be built from fixed, parameterized query pieces, never string-concatenated from the JSON's contents).
   - Rich profile endpoint: join order history, total spend (sum of order totals), tags, review history (if `impl-03` reviews exist), loyalty balance (if `impl-03` loyalty exists) into one response.
3. **Frontend:** Extend wherever customers are currently viewable in admin (if there's no dedicated customers list yet, add `client/src/pages/Customers.jsx`) with: a customer list showing tags, a profile detail view, tag management UI, and a segments management page (create/edit segment rules, preview matching customer count).
4. **Tie into broadcasts:** If `impl-07-broadcasts-marketing.md` has been built, extend its recipient-selection step to allow choosing a segment instead of "all customers."

### Verification Steps
1. Tag a few test customers, confirm tags persist and display correctly.
2. Create a segment (e.g. "5+ orders, ordered in last 30 days"), confirm the resolved customer list is actually correct against manually-checked test data.
3. Confirm segment evaluation is tenant-scoped — never returns another tenant's customers.
4. Load a customer's rich profile, confirm order history/spend/tags/loyalty all reflect accurate data.

---

## Part B — Granular Staff Permissions (RBAC)

### Data Model

```sql
CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(50) UNIQUE NOT NULL, -- e.g. 'menu.edit', 'orders.view', 'discounts.apply', 'reports.view'
  description TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role VARCHAR(20) NOT NULL, -- matches existing role values, or a new custom-role system if roles become fully dynamic
  permission_key VARCHAR(50) NOT NULL REFERENCES permissions(key),
  PRIMARY KEY (role, permission_key)
);

-- If moving beyond fixed roles to per-user overrides:
CREATE TABLE user_permission_overrides (
  user_id UUID NOT NULL REFERENCES users(id),
  permission_key VARCHAR(50) NOT NULL REFERENCES permissions(key),
  granted BOOLEAN NOT NULL, -- true = explicitly granted, false = explicitly revoked, overriding the role default
  PRIMARY KEY (user_id, permission_key)
);
```

### Design decision to make before starting
Decide between (a) keeping fixed roles (owner/manager/staff) but making each role's permission set configurable per-tenant via `role_permissions`, or (b) full per-user permission overrides via `user_permission_overrides` on top of role defaults, closer to Bitecast's "21 permissions per role" framing. Recommend starting with (a) — configurable role-level permissions — since it's a smaller change to the existing `authorize()` middleware and covers the realistic use case (a tenant wants to customize what "manager" can do) without the complexity of per-user exception management. Add (b) only if a concrete need for individual overrides comes up.

### Step-by-Step Implementation
1. **Migrations:** Add `permissions`, `role_permissions` (and `user_permission_overrides` only if going with option b).
2. **Seed the permission list:** Define the actual set of permission keys this system needs (e.g. `menu.edit`, `menu.view`, `orders.view`, `orders.status_update`, `discounts.apply`, `reports.view`, `staff.manage`, `branches.manage`, `campaigns.send`, `inventory.manage` — adapt to whichever features from this batch actually got built) and seed default `role_permissions` rows matching current behavior (so existing owner/manager/staff access doesn't regress on migration).
3. **Refactor `authorize()` middleware:** Currently it likely checks a hardcoded role list per route (e.g. `authorize('owner','manager')`). Change it to check whether the authenticated user's role has the specific required `permission_key` for that route, by querying `role_permissions` (cache this per-request or per-short-TTL to avoid a DB round-trip on every single request if performance becomes a concern — not required for initial correctness). Update every existing `authorize()` call site across the codebase to use permission keys instead of raw role names.
4. **Frontend — admin permissions management page:** A page (owner-only) to view/edit which permissions each role has — checkboxes per permission per role, matching the "21 permissions per role" style Bitecast advertises.
5. **Audit every existing protected route** across the whole codebase (menu, orders, branches, insights, campaigns, inventory, POS, riders, reservations — whichever exist by the time this is implemented) and confirm each now checks the correct granular permission instead of the old hardcoded role check.

### Verification Steps
1. Confirm existing owner/manager/staff accounts retain their current effective access after migration (no accidental lockout or privilege escalation from the refactor).
2. Create a custom permission configuration (e.g. remove `discounts.apply` from the manager role) and confirm a manager account is now correctly blocked from applying discounts.
3. Spot-check at least 3 previously-hardcoded `authorize()` call sites across different route files to confirm they now use the permission-key pattern, not the old role-list pattern.
4. Confirm the permissions management page itself is owner-only (a manager account cannot grant itself more permissions).

## Explicitly out of scope for this file
- Per-user permission overrides (Part B option b) unless explicitly requested later
- An audit log of who changed which permission when (worth flagging as a good follow-up given this is a security-sensitive area, but not built in this pass)
