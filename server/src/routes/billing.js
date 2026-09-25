/**
 * Owner-facing plan & billing (impl-32): see the current plan, pick a plan,
 * get RestoAI's bank details, and submit a bank transfer for verification.
 * A super admin approves or rejects it (routes/super-admin.js).
 *
 * The amount is always computed server-side from the chosen plan
 * (services/billing.js) — a client-sent amount is only compared, never
 * trusted. Tenant scope always comes from the JWT.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import crypto from 'crypto';
import { z } from 'zod';
import { put } from '@vercel/blob';
import { authenticate, checkTenantActive } from '../middleware/auth.js';
import { query } from '../db/pool.js';
import { priceSelection, publicPlanList, bankDetails, PLANS } from '../services/billing.js';

const router = Router();

// ── GET /api/billing/plans — public price list (marketing page) ──
router.get('/plans', (_req, res) => {
  res.json(publicPlanList());
});

router.use(authenticate);
router.use(checkTenantActive);

function requireOwner(req, res, next) {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: { message: 'Only the restaurant owner can manage the plan and payments.' } });
  }
  next();
}

// ── GET /api/billing — current plan, latest submission, how to pay ──
router.get('/', requireOwner, async (req, res, next) => {
  try {
    const tenantRes = await query(
      `SELECT subscription_status, subscription_plan, subscription_period_start, subscription_period_end,
              ai_agent_pack_enabled, (SELECT COUNT(*) FROM branches b WHERE b.tenant_id = t.id)::int AS branch_count
       FROM tenants t WHERE id = $1`,
      [req.user.tenant_id],
    );
    const subsRes = await query(
      `SELECT id, claimed_plan, claimed_branch_count, claimed_agent_pack, claimed_amount, bank_reference_number,
              receipt_image_url, status, rejection_reason, submitted_at, reviewed_at
       FROM payment_submissions WHERE tenant_id = $1
       ORDER BY submitted_at DESC LIMIT 5`,
      [req.user.tenant_id],
    );
    res.json({
      subscription: tenantRes.rows[0],
      submissions: subsRes.rows,
      pending: subsRes.rows.find((s) => s.status === 'pending') || null,
      bank: bankDetails(),
      pricing: publicPlanList(),
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/billing/submissions — submit a bank transfer ──
const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: { message: 'Too many payment submissions — please try again later.' } },
});

const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return cb(new Error('Receipt must be a JPEG, PNG or WebP image'));
    }
    cb(null, true);
  },
});

function receiveReceipt(req, res, next) {
  receiptUpload.single('receipt')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: { message: 'Receipt image must be under 5 MB' } });
    if (err.message?.includes('Receipt must be')) return res.status(400).json({ error: { message: err.message } });
    return next(err);
  });
}

const submissionSchema = z.object({
  plan: z.enum(['starter', 'growth', 'enterprise']),
  branch_count: z.coerce.number().int().optional(),
  agent_pack: z.preprocess((v) => v === true || v === 'true' || v === '1', z.boolean()),
  claimed_amount: z.coerce.number().positive(),
  bank_reference_number: z.string().trim().min(4, 'Enter the transaction/reference number from your bank').max(100),
});

router.post('/submissions', requireOwner, submitLimiter, receiveReceipt, async (req, res, next) => {
  try {
    if (!bankDetails()) {
      return res.status(503).json({ error: { message: "Bank transfer isn't available yet — RestoAI's bank details haven't been set up. Please contact support." } });
    }
    const data = submissionSchema.parse(req.body);
    let priced;
    try {
      priced = priceSelection({ plan: data.plan, branchCount: data.branch_count, agentPack: data.agent_pack });
    } catch (err) {
      return res.status(400).json({ error: { message: err.message } });
    }
    if (Math.abs(priced.amount - data.claimed_amount) > 0.001) {
      return res.status(400).json({ error: { message: `The amount for this plan is Rs. ${priced.amount.toLocaleString()} — please refresh and check the amount you transferred.` } });
    }

    let receiptUrl = null;
    if (req.file) {
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        return res.status(503).json({ error: { message: "Receipt upload isn't available right now — submit without the screenshot, your reference number is enough." } });
      }
      try {
        const ext = req.file.mimetype === 'image/png' ? 'png' : req.file.mimetype === 'image/webp' ? 'webp' : 'jpg';
        // Unguessable path: the store is public-read, so the URL is the only protection.
        const blob = await put(`payment-receipts/${req.user.tenant_id}/${crypto.randomBytes(16).toString('hex')}.${ext}`, req.file.buffer, {
          access: 'public',
          contentType: req.file.mimetype,
        });
        receiptUrl = blob.url;
      } catch (err) {
        console.error('[billing] receipt upload failed:', err.message);
        return res.status(502).json({ error: { message: "The receipt image couldn't be saved. Please try again, or submit without it." } });
      }
    }

    let row;
    try {
      const result = await query(
        `INSERT INTO payment_submissions
           (tenant_id, claimed_plan, claimed_branch_count, claimed_agent_pack, claimed_amount, bank_reference_number, receipt_image_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, claimed_plan, claimed_branch_count, claimed_agent_pack, claimed_amount, bank_reference_number,
                   receipt_image_url, status, submitted_at`,
        [req.user.tenant_id, priced.plan, priced.branchCount, priced.agentPack, priced.amount, data.bank_reference_number, receiptUrl],
      );
      row = result.rows[0];
    } catch (err) {
      if (err.code === '23505') {
        const msg = err.constraint === 'uq_payment_submissions_one_pending'
          ? 'You already have a payment waiting for verification. We\'ll message you as soon as it\'s reviewed.'
          : 'That reference number has already been submitted. Please check it and try again.';
        return res.status(409).json({ error: { message: msg } });
      }
      throw err;
    }
    res.status(201).json({ submission: row, plan_name: PLANS[row.claimed_plan].name });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

export default router;
