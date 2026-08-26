# Implementation 07 — WhatsApp Broadcast / Marketing Campaigns

## Goal
Let restaurant owners send scheduled or immediate WhatsApp messages (menu drops, offers) to their customer base, personalized with the customer's name, using the existing WhatsApp send infrastructure — while respecting WhatsApp's messaging policies to avoid the sending number being banned.

## Important constraint to design around
WhatsApp Business API has strict rules about business-initiated messages outside a 24-hour customer service window (template message requirements, opt-in requirements). Before writing send logic, confirm what messaging capability the existing WhatsApp integration actually has (template messages approved with Meta, or only session/reply messages within the 24h window). If only session messages are available, broadcasts can only reach customers who messaged within the last 24 hours — this is a hard platform constraint, not a bug. Document whichever is true in this feature's admin UI so the owner understands the real reach before sending.

## Data Model — New Tables

```sql
CREATE TABLE broadcast_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name VARCHAR(150) NOT NULL,
  message_template TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','completed','failed')),
  scheduled_for TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE broadcast_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES broadcast_campaigns(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped_no_window')),
  sent_at TIMESTAMPTZ
);
CREATE INDEX idx_broadcast_recipients_campaign ON broadcast_recipients(campaign_id);
```

`message_template` supports a `{{name}}` placeholder at minimum, substituted per-recipient from `customers.name` at send time.

## API Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/campaigns` | GET/POST | Authenticated (owner/manager) | List/create broadcast campaigns |
| `/api/campaigns/:id/recipients` | POST | Authenticated | Select recipient segment (all customers, or a filtered subset) |
| `/api/campaigns/:id/send` | POST | Authenticated | Trigger sending (immediate) |
| `/api/campaigns/:id/status` | GET | Authenticated | Sending progress (sent/failed/skipped counts) |

## Step-by-Step Implementation

1. **Migrations:** Add `broadcast_campaigns`, `broadcast_recipients` tables.
2. **Backend — `server/src/routes/campaigns.js` (new):**
   - `POST /campaigns` — create a draft campaign with a message template.
   - `POST /campaigns/:id/recipients` — populate `broadcast_recipients` from the tenant's `customers` table; support at minimum "all customers" — if `impl-10-crm-rbac.md`'s customer segments have been built, support selecting a segment instead of always "all."
   - `POST /campaigns/:id/send` — for each pending recipient, personalize the template, call the existing WhatsApp send function (reuse, don't duplicate), respect the 24-hour-window constraint noted above (mark recipients outside the window as `skipped_no_window` if only session messaging is available, rather than silently failing or attempting a send that will be rejected), record each result. Process sends with a delay/batching between messages to avoid tripping WhatsApp's own rate/spam detection — do not fire all messages simultaneously.
   - `GET /campaigns/:id/status` — return counts by recipient status for the owner to see delivery results.
3. **Frontend — new admin page `client/src/pages/Campaigns.jsx`:** Create campaign (name, message with a live preview showing `{{name}}` substituted with a sample), select recipients, send/schedule, view results (sent/failed/skipped counts).
4. **Scheduling (if `scheduled_for` is set):** Requires a background job/cron mechanism — if the existing deployment (Vercel Functions, per `PROJECT-MASTER.md`) doesn't have a built-in scheduler, use Vercel Cron or an external trigger calling a `/api/campaigns/process-scheduled` endpoint periodically. Confirm what's actually available in the deployment environment before building this — a serverless deployment may need a different scheduling approach than a traditional always-on server.
5. **Opt-out handling:** Add a simple mechanism for a customer to stop receiving broadcasts (e.g. replying "STOP" to any message) — check an opt-out flag before including a customer in `broadcast_recipients` population. This matters both for platform compliance and basic customer respect.

## Verification Steps
1. Create a campaign, populate recipients from the full customer list, send it, confirm personalized messages (with `{{name}}` correctly substituted) go out via the existing WhatsApp send path.
2. Confirm recipients outside the messaging window (if that constraint applies to your WhatsApp integration) are correctly marked `skipped_no_window`, not silently dropped or falsely marked `sent`.
3. Test the opt-out flow — mark a test customer as opted out, confirm they're excluded from the next campaign's recipient list.
4. If scheduling was built: confirm a scheduled campaign actually sends at its scheduled time via whatever cron/trigger mechanism was set up.
5. Confirm campaign status counts (sent/failed/skipped) accurately reflect what actually happened, for owner trust in the reporting.

## Explicitly out of scope for this file
- A/B testing message variants
- Rich media (images) in broadcast messages — text-only for this pass
