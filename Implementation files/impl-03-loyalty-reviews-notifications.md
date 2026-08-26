# Implementation 03 — Loyalty, Reviews, Push Notifications, In-App AI Assistant

## Goal
Add the engagement layer to the customer app: earn/redeem loyalty points, post-order reviews, push notifications for order status, and an in-app chat entry point to the existing Qwen agent (recommendations/questions), so the app isn't just a static ordering form.

## Data Model — New Tables

```sql
CREATE TABLE loyalty_config (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id),
  points_per_currency_unit NUMERIC(6,2) NOT NULL DEFAULT 1.0,
  redemption_rate NUMERIC(6,2) NOT NULL DEFAULT 0.01,
  enabled BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE loyalty_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  points_change INTEGER NOT NULL,
  reason VARCHAR(20) NOT NULL CHECK (reason IN ('earned','redeemed','adjusted')),
  order_id UUID REFERENCES orders(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_loyalty_points_customer ON loyalty_points(customer_id);

CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  order_id UUID NOT NULL REFERENCES orders(id),
  menu_item_id UUID REFERENCES menu_items(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_reviews_tenant ON reviews(tenant_id);
CREATE INDEX idx_reviews_menu_item ON reviews(menu_item_id);

CREATE TABLE push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  endpoint TEXT NOT NULL,
  keys JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(customer_id, endpoint)
);
```

## API Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/loyalty/balance` | GET | Public (phone-scoped, same pattern as order tracking) | Customer's current points balance |
| `/api/loyalty/redeem` | POST | Public (phone-scoped) | Apply points as a discount at checkout |
| `/api/reviews` | POST | Public (phone-scoped, order-linked) | Submit a review after an order is delivered |
| `/api/reviews/item/:menuItemId` | GET | Public | Aggregate rating + recent reviews for a menu item (social proof on the menu) |
| `/api/notifications/subscribe` | POST | Public (phone-scoped) | Register a web push subscription |
| `/api/recommendations` | POST | Public | In-app AI recommendation/chat endpoint (reuses Qwen agent logic) |

## Step-by-Step Implementation

### Loyalty
1. Migration: add `loyalty_config`, `loyalty_points` tables.
2. On order completion (status → `delivered`), in the shared order-status-update logic, compute points earned = `order_total * loyalty_config.points_per_currency_unit` and insert a `loyalty_points` row with `reason='earned'`. Skip if `loyalty_config.enabled=false` or no config row exists for the tenant (loyalty is opt-in per tenant).
3. `GET /api/loyalty/balance?phone=...` — sum `points_change` for the customer, scoped by tenant.
4. `POST /api/loyalty/redeem` — at checkout, accept a points amount to redeem, validate it doesn't exceed the current balance, insert a negative `loyalty_points` row with `reason='redeemed'`, and return the resulting discount amount (`points * redemption_rate`) for the checkout flow (`Checkout.jsx`) to apply to the order total.
5. Frontend: add a loyalty balance display + redeem input to `Checkout.jsx`, and a simple `/order/:tenantSlug/loyalty` page showing balance and a plain-language explanation ("earn 1 point per Rs. 100 spent").
6. Also expose the balance conversationally via the existing WhatsApp agent (small addition to `ai-agent.js` — when a customer asks "how many points do I have," query the same balance logic).

### Reviews
1. Migration: add `reviews` table.
2. `POST /api/reviews` — accept `order_id`, `phone`, `rating`, `comment`, optional `menu_item_id`; verify the phone matches the order (same phone-gating pattern as tracking) and the order status is `delivered` before allowing a review.
3. Trigger point: on the tracking page (`TrackOrder.jsx`), once status shows `delivered`, show a review prompt (star rating + optional comment) inline.
4. `GET /api/reviews/item/:menuItemId` — return average rating + count, and a few recent comments; surface this on `PublicMenu.jsx` item cards/detail view as social proof.
5. Feed review data into the existing owner Insights dashboard — add average rating as a visible metric alongside existing KPIs (extend `insights.js`, not a new page).

### Push Notifications
1. Migration: add `push_subscriptions` table.
2. Generate VAPID keys for standard web push (no third-party service required) — store as env vars, document them in `.env.example`.
3. `POST /api/notifications/subscribe` — client sends its push subscription object (from the browser's Push API) after requesting notification permission; store it.
4. Extend the existing order-status-change hook (already sends a WhatsApp message per status change — see prior WhatsApp features) to also send a web push notification to any subscribed `push_subscriptions` for that customer, using the `web-push` npm package. WhatsApp and push are parallel channels — sending both is fine; do not remove the WhatsApp path.
5. Frontend: on the public app, prompt for notification permission after an order is placed (not on page load — permission prompts on load have poor UX and low opt-in), and register the subscription on accept.

### In-App AI Assistant
1. `POST /api/recommendations` — refactor the recommendation logic already built for WhatsApp (`ai-agent.js`) into a shared function callable from both the WhatsApp handler and this new REST endpoint, so there's one implementation, not two. Accept a free-text question + tenant/branch context, return a natural-language response (same intent-classification approach already proven in WhatsApp — reuse it, don't rebuild it).
2. Frontend: add a small floating chat widget component (`AIAssistantWidget.jsx`) on the public menu/app pages — text input, sends to `/api/recommendations`, displays the response. Keep this simple (no persistent chat history required for v1 — each question is independent, matching how the WhatsApp recommendation feature already works).

## Verification Steps
1. Complete an order end-to-end, confirm a `loyalty_points` "earned" row is created with the correct amount once status hits `delivered`.
2. Redeem points at checkout on a subsequent order, confirm the discount is applied correctly and the balance decreases.
3. Submit a review after delivery, confirm it appears via the item-rating endpoint and in the owner Insights dashboard.
4. Attempt to review an order that isn't yet `delivered` — confirm it's rejected.
5. Subscribe to push notifications, advance an order's status, confirm a push notification is received (test in a real browser, not just server logs).
6. Ask the in-app AI widget a recommendation question, confirm it returns a real answer and does not create an order (same non-order-creating guarantee already verified for the WhatsApp version).

## Explicitly out of scope for this file
- Tiered loyalty levels (e.g. bronze/silver/gold) — flat points system only for now
- Persistent multi-turn chat history in the AI widget
