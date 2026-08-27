/**
 * RestoAI's own marketing-site contact form (impl-22). Not tenant-scoped —
 * this is a sales lead for RestoAI itself, stored for follow-up. No email
 * service is configured in this environment, so a simple table is enough.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query } from '../db/pool.js';

const router = Router();

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.ip,
  message: { error: { message: 'Too many submissions — please try again later' } },
});

const contactSchema = z.object({
  name: z.string().min(2).max(255),
  email: z.string().email(),
  restaurant: z.string().max(255).optional(),
  phone: z.string().max(20).optional(),
  message: z.string().max(2000).optional(),
});

// ── POST /api/contact ──
router.post('/', contactLimiter, async (req, res, next) => {
  try {
    const data = contactSchema.parse(req.body);
    await query(
      `INSERT INTO contact_inquiries (name, email, restaurant, phone, message) VALUES ($1, $2, $3, $4, $5)`,
      [data.name, data.email, data.restaurant || null, data.phone || null, data.message || null],
    );
    res.status(201).json({ message: 'Thanks — we\'ll be in touch soon.' });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

export default router;
