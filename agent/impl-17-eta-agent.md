# Implementation 17 — Kitchen Load / Real ETA Agent

## Goal
Replace the static "~30 mins" estimate (currently hardcoded config, used only in 2 WhatsApp messages per the 2026-08-27 verification audit) with a dynamic estimate computed from the actual live kitchen queue, and surface it everywhere an order's time matters — not just WhatsApp confirmation.

## Dependency
None beyond existing Orders/Kitchen infrastructure (already built). No blocker on other Tier 2 items.

## Data Model
No new tables required — this is a computed value, not stored state. Optionally, add a lightweight rolling-average table if historical accuracy tuning is wanted later (out of scope for this pass, see below).

## API Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/orders/:id/eta` | GET | Public (phone-gated, same pattern as existing tracking) or internal | Real-time estimated ready/delivery time for a specific order |

This can also be folded directly into the existing order-tracking response (`public.js`'s order detail endpoint) rather than a separate call — prefer adding an `estimated_ready_at` field to the existing response over introducing a new round-trip, unless there's a clear reason to keep it separate.

## Step-by-Step Implementation

1. **Service — `server/src/services/eta-agent.js` (new):**
   - `estimateReadyTime(branchId, orderId)` — compute an estimate from live signals actually available in the schema:
     - Count of currently-open orders at the same branch (status `confirmed`/`preparing`, not yet `ready`) — more orders ahead in the queue means a longer wait.
     - Item count/complexity of the order in question (more items → more prep time) — a simple heuristic like `base_time + (queue_ahead * per_order_minutes) + (item_count * per_item_minutes)` is sufficient; this does not need to be a machine-learned model, a well-reasoned formula is the right scope here.
     - Use the existing `config.js` values (`estimatedPrepMin`/`estimatedPrepMax`) as the baseline/floor for a single order with no queue ahead of it, rather than replacing them outright — the dynamic estimate should widen from that baseline as load increases, not ignore it.
   - Keep the formula's constants (per-order queue delay, per-item delay) as named, tunable values in config — not magic numbers buried in the calculation — since these will likely need adjusting once real usage data exists.
2. **Wire into existing surfaces (do not build new ones — extend what's there):**
   - **Order response (`public.js`):** add `estimated_ready_at` (or `estimated_minutes_remaining`) to the order detail/tracking response.
   - **`TrackOrder.jsx`:** display the estimate prominently (confirmed by the audit to currently show status labels only, no time estimate anywhere in the file) — update as status/queue changes on each poll.
   - **`Checkout.jsx`:** show an estimate on the order confirmation screen immediately after placing the order (confirmed by the audit to currently navigate straight to tracking with no ETA shown).
   - **WhatsApp status-change messages (`whatsapp.js`):** the audit found status-change messages are static strings with no time estimate (unlike the initial order-confirmation message, which does include one) — add the current estimate to at least the "preparing" status message, recomputed at that point since the queue may have changed since order placement.
3. **Recompute, don't cache:** the estimate must be computed fresh on each request/status-change (queue length changes constantly) — do not store a single estimate at order-creation time and never update it, which would immediately go stale and undermine the whole point of this feature.

## Verification Steps
1. Place a single order with an empty kitchen queue, confirm the estimate is close to the baseline (`estimatedPrepMin`-`estimatedPrepMax`).
2. Place several orders in quick succession at the same branch, confirm later orders show a longer estimate than earlier ones, reflecting queue depth.
3. Confirm the estimate updates on the tracking page as earlier queued orders move to `ready`/`delivered` (the wait should visibly shrink for orders still in progress).
4. Confirm the estimate appears on: checkout confirmation, tracking page, and at least the "preparing" WhatsApp status message — not just the original order-confirmation message where it already existed.
5. Confirm the formula's constants are read from config, not hardcoded inline, by changing one and confirming the computed estimate changes accordingly.

## Explicitly out of scope for this file
- Machine-learned prep-time prediction from historical data (a reasoned formula is sufficient for this pass)
- Per-item historical prep-time tracking (treat all items as roughly equal complexity for the formula, don't build item-level timing data collection)
- Delivery-time estimation beyond kitchen prep (no rider/route timing factored in unless `impl-16` dispatch agent data becomes available later)
