# Implementation 01 — Payments (JazzCash / EasyPaisa / Card / COD)

## Goal
Add real payment processing to both the WhatsApp order flow and the public web ordering app, alongside the existing Cash on Delivery option. Orders currently exist without any payment record — this adds one.

## Decision to make before starting
Pick a payment gateway/aggregator that supports JazzCash and EasyPaisa in a single integration (rather than integrating each separately) — e.g. a Pakistani PSP aggregator. If Claude Code has web access, research current options and propose 1-2 before writing integration code; do not guess at an API contract. Card payments (Stripe or a local processor) can be added as a second phase if the chosen aggregator doesn't cover cards.

## Data Model — New Table

```sql
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  order_id UUID NOT NULL REFERENCES orders(id),
  method VARCHAR(20) NOT NULL CHECK (method IN ('jazzcash','easypaisa','card','cod')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','refunded')),
  amount NUMERIC(10,2) NOT NULL,
  gateway_reference VARCHAR(255),
  gateway_response JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_payments_tenant ON payments(tenant_id);
CREATE INDEX idx_payments_order ON payments(order_id);
```

Add this table via a new migration in `migrate.js`, following the existing transaction-wrapped, idempotent pattern already used there.

## API Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/payments/initiate` | POST | Public (order-scoped) or authenticated | Start a payment for a given `order_id`; returns gateway redirect/session info |
| `/api/payments/webhook` | POST | None (gateway calls this) — **must verify signature** | Gateway callback confirming payment success/failure |
| `/api/payments/:orderId/status` | GET | Public (phone-gated, same pattern as existing order tracking) | Check payment status for an order |

## Step-by-Step Implementation

1. **Migration:** Add the `payments` table as shown above.
2. **Gateway service:** Create `server/src/services/payments.js` — wraps the chosen gateway's SDK/API (initiate transaction, verify webhook signature, parse callback). Keep gateway-specific code isolated here so the rest of the app only calls generic functions like `initiatePayment(order, method)` and `verifyWebhookSignature(payload, signature)`.
3. **Route:** Create `server/src/routes/payments.js`:
   - `POST /initiate` — validate `order_id` belongs to the tenant/order being paid for (never trust a client-supplied tenant_id — resolve tenant via the order record itself), create a `payments` row with `status='pending'`, call the gateway service, return whatever the client needs (redirect URL, form fields, or a client-side SDK token depending on gateway).
   - `POST /webhook` — **verify the gateway's signature first, reject with 403 if invalid, exactly like the WhatsApp webhook HMAC fix already done in this codebase.** On valid signature, update the matching `payments` row status to `paid` or `failed`, and if paid, update the parent `orders` row status forward (e.g. `confirmed`) if it was awaiting payment.
   - `GET /:orderId/status` — phone-gated like the existing public order tracking endpoint; returns payment status only, no other order internals beyond what tracking already exposes.
4. **COD path:** For orders where `method='cod'`, create a `payments` row immediately with `status='pending'` at order creation time (in the shared `orders.js` service) — this makes COD a payment record too, not a special case, so reporting/insights can query `payments` uniformly regardless of method. COD rows get marked `paid` manually by staff on delivery (add a small status-update action in the existing Orders admin page, or piggyback on the existing order-status-to-`delivered` transition — auto-mark COD `paid` when order status becomes `delivered`).
5. **Frontend — public checkout (`client/src/pages/public/Checkout.jsx`):** Add payment method selection (JazzCash / EasyPaisa / COD). On non-COD selection, after order creation call `/api/payments/initiate` and redirect/present the gateway's flow. Handle the return/callback path (gateway redirects back to your site) — add a route like `/order/:tenantSlug/payment-return` that polls `/api/payments/:orderId/status` and shows success/failure, with a retry option that does not lose the cart if payment failed.
6. **Frontend — admin (`client/src/pages/Orders.jsx`):** Show payment method + status per order in the existing orders list/detail view.
7. **Rate limiting:** Apply the same rate-limiting pattern already used elsewhere to `/api/payments/initiate` (prevent abuse of a paid gateway integration).

## Verification Steps
1. Place a COD order via the public app — confirm a `payments` row is created with `method='cod', status='pending'`, and confirm it flips to `paid` when the order is marked `delivered`.
2. Place an online-payment order — confirm the gateway flow initiates, and using the gateway's sandbox/test mode, confirm a successful test payment flips the `payments` row to `paid` and the order proceeds.
3. Simulate a failed payment (gateway sandbox failure case) — confirm the order/cart is not lost and the customer can retry.
4. Send a forged webhook payload (bad signature) — confirm it's rejected with 403 and no payment status is altered.
5. Confirm payment status is visible in the admin Orders view for at least one order of each method.

## Explicitly out of scope for this file
- Refund initiation (only `refunded` as a status value is modeled — actually processing a refund through the gateway is a future addition)
- Split payments across multiple methods on one order
