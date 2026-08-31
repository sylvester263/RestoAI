import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { authenticate } from '../middleware/auth.js';
import { staffReplyToTicket, updateTicketStatus } from '../services/customer-support-agent.js';

const router = Router();

// All support routes require authentication
router.use(authenticate);

// ── GET /api/support/tickets ──
// List tickets for the caller's tenant, optionally filtered by status.
// Tenant is always derived from the JWT — never trusted from query params.
router.get('/tickets', async (req, res, next) => {
  try {
    const { status, category, limit } = req.query;
    const tenantId = req.user.tenant_id;

    let sql = `
      SELECT st.*, c.name as customer_name, c.phone as customer_phone
      FROM support_tickets st
      JOIN customers c ON c.id = st.customer_id
      WHERE st.tenant_id = $1
    `;
    const params = [tenantId];
    let paramIdx = 2;

    if (status) {
      sql += ` AND st.status = $${paramIdx}`;
      params.push(status);
      paramIdx++;
    }
    if (category) {
      sql += ` AND st.category = $${paramIdx}`;
      params.push(category);
      paramIdx++;
    }

    sql += ` ORDER BY st.updated_at DESC`;

    if (limit) {
      const lim = parseInt(limit, 10);
      if (!isNaN(lim) && lim > 0 && lim <= 100) {
        sql += ` LIMIT $${paramIdx}`;
        params.push(lim);
      }
    } else {
      sql += ` LIMIT 50`;
    }

    const result = await query(sql, params);
    res.json({ tickets: result.rows });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/support/tickets/:id ──
// Full ticket detail with message history. Tenant-scoped.
router.get('/tickets/:id', async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const ticketId = req.params.id;

    const ticketRes = await query(
      `SELECT st.*, c.name as customer_name, c.phone as customer_phone
       FROM support_tickets st
       JOIN customers c ON c.id = st.customer_id
       WHERE st.id = $1 AND st.tenant_id = $2`,
      [ticketId, tenantId],
    );

    if (ticketRes.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Ticket not found' } });
    }

    const messagesRes = await query(
      `SELECT * FROM support_messages WHERE ticket_id = $1 ORDER BY created_at ASC`,
      [ticketId],
    );

    // If the ticket has an order_id, include basic order info
    let orderInfo = null;
    if (ticketRes.rows[0].order_id) {
      const orderRes = await query(
        `SELECT id, order_number, status, total, created_at FROM orders WHERE id = $1 AND tenant_id = $2`,
        [ticketRes.rows[0].order_id, tenantId],
      );
      orderInfo = orderRes.rows[0] || null;
    }

    res.json({
      ticket: ticketRes.rows[0],
      messages: messagesRes.rows,
      order: orderInfo,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/support/tickets/:id/reply ──
// Staff replies to a ticket. Sends via WhatsApp and logs as sender='staff'.
const replySchema = z.object({
  content: z.string().min(1).max(2000),
});

router.post('/tickets/:id/reply', async (req, res, next) => {
  try {
    const parsed = replySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: 'content is required (1-2000 chars)' } });
    }

    const tenantId = req.user.tenant_id;
    const result = await staffReplyToTicket(req.params.id, tenantId, req.user.id, parsed.data.content);

    if (!result) {
      return res.status(404).json({ error: { message: 'Ticket not found' } });
    }

    res.json({ ok: true, sent_to: result.customerPhone });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/support/tickets/:id/status ──
// Mark a ticket resolved or reopen it. Manager/owner only.
const statusSchema = z.object({
  status: z.enum(['resolved', 'open', 'escalated']),
});

router.put('/tickets/:id/status', async (req, res, next) => {
  try {
    // Only manager/owner can change ticket status
    if (req.user.role !== 'owner' && req.user.role !== 'manager') {
      return res.status(403).json({ error: { message: 'Only managers and owners can change ticket status' } });
    }

    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: 'status must be resolved, open, or escalated' } });
    }

    const tenantId = req.user.tenant_id;
    const result = await updateTicketStatus(req.params.id, tenantId, req.user.id, parsed.data.status);

    if (!result) {
      return res.status(404).json({ error: { message: 'Ticket not found' } });
    }

    res.json({ ticket: result });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/support/stats ──
// Quick stats for the dashboard badge / overview
router.get('/stats', async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const result = await query(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'open') as open_count,
        COUNT(*) FILTER (WHERE status = 'escalated') as escalated_count,
        COUNT(*) FILTER (WHERE status = 'ai_handled') as ai_handled_count,
        COUNT(*) FILTER (WHERE status = 'resolved') as resolved_count,
        COUNT(*) as total_count
       FROM support_tickets WHERE tenant_id = $1`,
      [tenantId],
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
