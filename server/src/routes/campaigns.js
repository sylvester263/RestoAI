/**
 * Broadcast Campaigns — create marketing campaigns, populate recipients,
 * and send personalized WhatsApp messages. Respects demo mode (logs to
 * console when no real WhatsApp token is configured).
 */
import { Router } from 'express';
import { waitUntil } from '@vercel/functions';
import { authenticate, authorize } from '../middleware/auth.js';
import { query } from '../db/pool.js';
import { sendReply } from '../services/whatsapp.js';
import { z } from 'zod';

const router = Router();
router.use(authenticate);

const campaignSchema = z.object({
  name: z.string().min(1).max(150),
  message_template: z.string().min(1).max(2000),
  scheduled_for: z.string().datetime({ offset: true }).or(z.string().datetime()).optional(),
});

// ── GET /api/campaigns ──
router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT bc.*, u.name as created_by_name,
              (SELECT COUNT(*) FROM broadcast_recipients WHERE campaign_id = bc.id) as total_recipients,
              (SELECT COUNT(*) FROM broadcast_recipients WHERE campaign_id = bc.id AND status = 'sent') as sent_count,
              (SELECT COUNT(*) FROM broadcast_recipients WHERE campaign_id = bc.id AND status = 'failed') as failed_count
       FROM broadcast_campaigns bc
       LEFT JOIN users u ON bc.created_by = u.id
       WHERE bc.tenant_id = $1
       ORDER BY bc.created_at DESC`,
      [req.user.tenant_id],
    );
    res.json({ campaigns: result.rows });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/campaigns ──
router.post('/', authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const data = campaignSchema.parse(req.body);
    const result = await query(
      `INSERT INTO broadcast_campaigns (tenant_id, name, message_template, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.tenant_id, data.name, data.message_template, req.user.id],
    );
    res.status(201).json({ campaign: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

// ── POST /api/campaigns/:id/recipients ──
// Populate recipients from all customers for this tenant
router.post('/:id/recipients', authorize('owner', 'manager'), async (req, res, next) => {
  try {
    // Verify campaign ownership
    const campRes = await query(
      'SELECT id FROM broadcast_campaigns WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.user.tenant_id],
    );
    if (campRes.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Campaign not found' } });
    }

    // Clear existing recipients (allow re-population)
    await query('DELETE FROM broadcast_recipients WHERE campaign_id = $1', [req.params.id]);

    // Add all customers as recipients
    const result = await query(
      `INSERT INTO broadcast_recipients (campaign_id, customer_id, status)
       SELECT $1, c.id, 'pending'
       FROM customers c
       WHERE c.tenant_id = $2 AND c.phone IS NOT NULL
       RETURNING id`,
      [req.params.id, req.user.tenant_id],
    );
    res.json({ added: result.rows.length });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/campaigns/:id/send ──
// Send the campaign to all pending recipients with a delay between messages
router.post('/:id/send', authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const campRes = await query(
      'SELECT * FROM broadcast_campaigns WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.user.tenant_id],
    );
    if (campRes.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Campaign not found' } });
    }
    const campaign = campRes.rows[0];
    if (campaign.status === 'sending' || campaign.status === 'completed') {
      return res.status(400).json({ error: { message: 'Campaign already sent or in progress' } });
    }

    // Mark as sending
    await query("UPDATE broadcast_campaigns SET status = 'sending' WHERE id = $1", [req.params.id]);

    // Get pending recipients with their phone numbers and names
    const recipients = await query(
      `SELECT br.id, c.phone, c.name
       FROM broadcast_recipients br
       JOIN customers c ON br.customer_id = c.id
       WHERE br.campaign_id = $1 AND br.status = 'pending'`,
      [req.params.id],
    );

    // Respond immediately — sending N messages with a throttling delay between
    // each can take well past a request's timeout window. The client polls
    // GET /:id/status for progress instead of waiting on this response.
    // waitUntil keeps the send loop running past the response on Vercel's
    // serverless runtime, where a handler can otherwise be frozen once its
    // response is flushed; it's a no-op wrapper (runs the promise normally)
    // outside that environment, so local dev is unaffected.
    res.json({ started: true, total: recipients.rows.length });

    waitUntil((async () => {
      for (const recipient of recipients.rows) {
        const message = campaign.message_template.replace(/\{\{name\}\}/g, recipient.name || 'Valued Customer');
        try {
          await sendReply(recipient.phone, message);
          await query(
            "UPDATE broadcast_recipients SET status = 'sent', sent_at = NOW() WHERE id = $1",
            [recipient.id],
          );
        } catch {
          await query(
            "UPDATE broadcast_recipients SET status = 'failed' WHERE id = $1",
            [recipient.id],
          );
        }
        // Small delay between messages to avoid rate limiting (500ms)
        await new Promise((r) => setTimeout(r, 500));
      }

      await query("UPDATE broadcast_campaigns SET status = 'completed' WHERE id = $1", [req.params.id]);
    })());
  } catch (err) {
    next(err);
  }
});

// ── GET /api/campaigns/:id/status ──
router.get('/:id/status', async (req, res, next) => {
  try {
    const campRes = await query(
      'SELECT * FROM broadcast_campaigns WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.user.tenant_id],
    );
    if (campRes.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Campaign not found' } });
    }

    const statsRes = await query(
      `SELECT status, COUNT(*) as count FROM broadcast_recipients WHERE campaign_id = $1 GROUP BY status`,
      [req.params.id],
    );

    const stats = { pending: 0, sent: 0, failed: 0, skipped_no_window: 0 };
    for (const row of statsRes.rows) {
      stats[row.status] = parseInt(row.count, 10);
    }

    res.json({ campaign: campRes.rows[0], stats });
  } catch (err) {
    next(err);
  }
});

export default router;
