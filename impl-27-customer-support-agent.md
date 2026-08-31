# Implementation 27 — Customer Support Agent

## Goal
A WhatsApp-based support flow that acknowledges complaints/queries in real time, answers routine questions from real data only, and reliably logs and escalates anything beyond routine to a human — filling a genuine gap (no support/complaint system currently exists anywhere in RestoAI).

## Design principles (research-backed, not arbitrary)
- **Grounded answers only.** Every factual answer (hours, menu, policy, order status) comes from real tenant data via existing queries — never from the model's general knowledge. Reuse the same discipline already applied to `generateRecommendation`/`generateInsights` in `ai-agent.js`.
- **Realistic resolution target: 55-70% of routine queries handled without a human, not "fully autonomous."** Design for this ceiling explicitly — don't build toward 90%+ automation, that's not what production systems actually achieve.
- **Mandatory human escalation for anything non-routine** — complex complaints, refund/compensation requests, anything emotionally charged. This is a hard rule, not a fallback for when the AI "can't figure it out."
- **No silent closure ("vanity deflection").** A ticket is only marked resolved when the customer confirms satisfaction or a staff member explicitly closes it — never auto-closed just because the bot replied.
- **Context-rich handoff.** When escalating, staff get the full conversation, the AI's classification of the issue, and its suggested resolution — not just a bare notification.

## Dependency
Extends the existing WhatsApp pipeline (`services/whatsapp.js`) and its intent classification (already distinguishing order/recommendation/reservation) — adds a 4th intent, `support`. Reuses `impl-03`'s reviews and existing order-tracking data.

## Data Model — New Tables

```sql
CREATE TABLE support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  order_id UUID REFERENCES orders(id), -- nullable, set if the query references a specific order
  category VARCHAR(30) NOT NULL, -- 'order_issue','complaint','question','feedback','other'
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','ai_handled','escalated','resolved')),
  ai_classification TEXT, -- the agent's own read of what this is about
  ai_suggested_resolution TEXT,
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id),
  sender VARCHAR(10) NOT NULL CHECK (sender IN ('customer','ai','staff')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_support_messages_ticket ON support_messages(ticket_id);
```

## API Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/support/tickets` | GET | Authenticated (staff) | List tickets, filterable by status |
| `/api/support/tickets/:id` | GET | Authenticated | Full ticket + message history |
| `/api/support/tickets/:id/reply` | POST | Authenticated | Staff replies (sends via WhatsApp, logs as `sender='staff'`) |
| `/api/support/tickets/:id/status` | PUT | Authenticated | Mark resolved/reopen |

## Step-by-Step Implementation

1. **Migrations:** Add `support_tickets`, `support_messages`.
2. **Intent classification (extend `ai-agent.js`):** add `support` as a 4th recognized intent alongside order/recommendation/reservation, using the same structured-output/function-calling approach already proven — reuse the pattern, don't build a separate classifier.
3. **On a support-intent message:**
   - Create (or continue, if a ticket is already open for this customer) a `support_tickets` row, log the incoming message to `support_messages` (`sender='customer'`).
   - Classify the sub-category (`order_issue`/`complaint`/`question`/`feedback`/`other`) — deterministic keyword/pattern rules where possible (e.g. "wrong"/"missing"/"late" + a recent order → `order_issue`), Qwen only for ambiguous cases and always for phrasing the reply.
   - **If `order_issue`:** look up the customer's actual recent order (tenant+phone scoped, same pattern as existing order tracking), acknowledge the specific order, and respond from real data ("I see your order #1234 was marked delivered at 8:47pm — I'm sorry it arrived late"). Do not fabricate order details.
   - **If a routine question** (hours, menu availability, policy): answer from real branch/menu data, same grounding discipline as the existing recommendation agent.
   - **If `complaint` or anything the classifier flags as non-routine/emotionally charged:** do NOT attempt AI resolution — immediately mark the ticket `escalated`, notify staff (WhatsApp or an in-admin alert — reuse whatever channel is most reliable given current WHATSAPP_TOKEN status), and reply to the customer with a warm, honest acknowledgment that a team member will follow up — never a canned "your issue is resolved" for something the AI didn't actually resolve.
4. **Escalation handoff:** the staff notification/ticket view includes the full `support_messages` history, the `ai_classification`, and `ai_suggested_resolution` — this is the "context package" that research shows meaningfully speeds up human resolution; don't skip populating these fields even under time pressure.
5. **Resolution confirmation:** after an AI-handled routine reply, ask the customer a simple yes/no ("Did that solve it?"). Only mark `status='ai_handled'` → effectively resolved on a positive confirmation; a "no" or no response after a reasonable window escalates automatically rather than sitting silently closed.
6. **Admin UI — new `client/src/pages/Support.jsx`:** ticket list (filterable by status/category), ticket detail view with full conversation history, reply action, resolve/reopen.
7. **Tie-in to reviews (optional, not required for core scope):** a low-star review (`impl-03`) could optionally auto-create a `support_tickets` row proactively ("we saw your 2-star review — want to tell us more?") rather than waiting for the customer to reach out. Treat as a stretch addition, not core.

## Verification Steps
1. Send a routine question (branch hours), confirm a correct, grounded answer with no ticket left permanently open in confusion.
2. Send an order-issue message referencing a real recent order, confirm the agent correctly looks up and references the actual order (not a fabricated one).
3. Send a message with complaint/emotional language, confirm it's escalated immediately — no AI-attempted resolution, correct staff notification with full context.
4. Reply as staff to an escalated ticket, confirm the reply sends via WhatsApp and logs correctly.
5. Confirm a ticket is never marked resolved without either explicit customer confirmation or explicit staff action — test the "no" / no-response path and confirm it escalates rather than silently closing.
6. Confirm tenant scoping throughout — a ticket/message never crosses tenant boundaries.

## Explicitly out of scope for this file
- Live human chat handoff within the same WhatsApp thread in real time (staff replies via the admin UI, not by taking over the WhatsApp conversation directly in this pass)
- Multi-channel support (email, phone) — WhatsApp only, matching the rest of the product's channel strategy
- Automated refund issuance (a complaint may result in a refund, but that stays a manual staff action via the existing POS refund flow in `impl-24`, not something this agent triggers itself)
