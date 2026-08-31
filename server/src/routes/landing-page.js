/**
 * Landing Page Builder — admin CRUD for the tenant's branded marketing site.
 * Includes custom domain submission and DNS TXT-record verification.
 */
import { Router } from 'express';
import { z } from 'zod';
import dns from 'node:dns/promises';
import crypto from 'node:crypto';
import { authenticate, authorize } from '../middleware/auth.js';
import { query } from '../db/pool.js';
import {
  TEMPLATE_IDS, contentSchema, themeSchema, subdomainSchema, defaultLandingPage,
} from '../services/landing-page.js';

const router = Router();
router.use(authenticate);

async function getRow(tenantId) {
  const res = await query('SELECT * FROM landing_pages WHERE tenant_id = $1', [tenantId]);
  return res.rows[0] || null;
}

// ── GET /api/landing-page ──
router.get('/', async (req, res, next) => {
  try {
    const row = await getRow(req.user.tenant_id);
    res.json({ landing_page: row || defaultLandingPage() });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/landing-page/subdomain-check?value=... ──
router.get('/subdomain-check', async (req, res, next) => {
  try {
    const parsed = subdomainSchema.safeParse((req.query.value || '').toString().toLowerCase());
    if (!parsed.success) {
      return res.json({ available: false, message: parsed.error.errors[0].message });
    }
    const existing = await query(
      'SELECT tenant_id FROM landing_pages WHERE subdomain = $1',
      [parsed.data],
    );
    const takenByOther = existing.rows.length > 0 && existing.rows[0].tenant_id !== req.user.tenant_id;
    res.json({ available: !takenByOther, message: takenByOther ? 'That subdomain is already taken' : null });
  } catch (err) {
    next(err);
  }
});

const saveSchema = z.object({
  template_id: z.enum(TEMPLATE_IDS),
  subdomain: subdomainSchema,
  content: contentSchema,
  theme: themeSchema.optional(),
});

// ── PUT /api/landing-page ── (create or update)
router.put('/', authorize('website.manage'), async (req, res, next) => {
  try {
    const data = saveSchema.parse(req.body);
    const theme = data.theme || themeSchema.parse({});

    const subCheck = await query(
      'SELECT tenant_id FROM landing_pages WHERE subdomain = $1',
      [data.subdomain],
    );
    if (subCheck.rows.length > 0 && subCheck.rows[0].tenant_id !== req.user.tenant_id) {
      return res.status(409).json({ error: { message: 'That subdomain is already taken' } });
    }

    const result = await query(
      `INSERT INTO landing_pages (tenant_id, template_id, subdomain, content, theme)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id) DO UPDATE SET
         template_id = EXCLUDED.template_id,
         subdomain = EXCLUDED.subdomain,
         content = EXCLUDED.content,
         theme = EXCLUDED.theme,
         updated_at = NOW()
       RETURNING *`,
      [req.user.tenant_id, data.template_id, data.subdomain, JSON.stringify(data.content), JSON.stringify(theme)],
    );
    res.json({ landing_page: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    if (err.code === '23505') { // unique_violation (race on subdomain)
      return res.status(409).json({ error: { message: 'That subdomain is already taken' } });
    }
    next(err);
  }
});

// ── POST /api/landing-page/publish ── body: { published?: boolean } — defaults to true
router.post('/publish', authorize('website.manage'), async (req, res, next) => {
  try {
    const publish = req.body?.published !== false;
    const row = await getRow(req.user.tenant_id);
    if (!row) {
      return res.status(400).json({ error: { message: 'Save your landing page before publishing' } });
    }
    if (publish) {
      const content = row.content || {};
      if (!row.subdomain || !content.hero?.headline) {
        return res.status(400).json({ error: { message: 'Add a subdomain and a hero headline before publishing' } });
      }
    }
    const result = await query(
      'UPDATE landing_pages SET published = $2, updated_at = NOW() WHERE tenant_id = $1 RETURNING *',
      [req.user.tenant_id, publish],
    );
    res.json({ landing_page: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ── Custom domain flow ──────────────────────────────────────────────

const domainSchema = z.string()
  .min(4, 'Domain must be at least 4 characters')
  .max(253, 'Domain must be at most 253 characters')
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/, 'Enter a valid domain (e.g. www.yourrestaurant.com)')
  .refine((v) => !v.endsWith('.vercel.app') && !v.endsWith('.now.sh'), { message: 'Cannot use a platform subdomain' });

// POST /api/landing-page/custom-domain — submit a custom domain for verification
router.post('/custom-domain', authorize('website.manage'), async (req, res, next) => {
  try {
    const domain = domainSchema.parse((req.body?.domain || '').toLowerCase().trim());

    // Check if this domain is already claimed by another tenant
    const existing = await query(
      'SELECT tenant_id FROM landing_pages WHERE custom_domain = $1',
      [domain],
    );
    if (existing.rows.length > 0 && existing.rows[0].tenant_id !== req.user.tenant_id) {
      return res.status(409).json({ error: { message: 'That domain is already in use by another restaurant' } });
    }

    // Generate a verification token
    const token = crypto.randomBytes(16).toString('hex');

    // Store the domain (unverified) and the token in theme._verification
    const row = await getRow(req.user.tenant_id);
    if (!row) {
      return res.status(400).json({ error: { message: 'Save your landing page before adding a custom domain' } });
    }

    const theme = { ...(row.theme || {}), _verification: { token, domain, submitted_at: new Date().toISOString() } };

    await query(
      `UPDATE landing_pages SET custom_domain = $2, custom_domain_verified = false, theme = $3, updated_at = NOW() WHERE tenant_id = $1`,
      [req.user.tenant_id, domain, JSON.stringify(theme)],
    );

    res.json({
      custom_domain: domain,
      verified: false,
      dns_instructions: {
        type: 'TXT',
        host: `_restoai-verify.${domain}`,
        value: `restoai-verify=${token}`,
        explanation: 'Add this TXT record at your domain registrar to prove ownership.',
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

// POST /api/landing-page/custom-domain/verify — check DNS and flip verified
router.post('/custom-domain/verify', authorize('website.manage'), async (req, res, next) => {
  try {
    const row = await getRow(req.user.tenant_id);
    if (!row || !row.custom_domain) {
      return res.status(400).json({ error: { message: 'No custom domain submitted' } });
    }
    if (row.custom_domain_verified) {
      return res.json({ verified: true, domain: row.custom_domain });
    }

    const theme = row.theme || {};
    const verification = theme._verification;
    if (!verification?.token) {
      return res.status(400).json({ error: { message: 'No verification token found — re-submit your custom domain' } });
    }

    const expectedValue = `restoai-verify=${verification.token}`;
    const lookupHost = `_restoai-verify.${row.custom_domain}`;

    let verified = false;
    try {
      const records = await dns.resolveTxt(lookupHost);
      // resolveTxt returns string[][] — each inner array is one TXT record's parts
      verified = records.some((parts) => parts.join('').includes(expectedValue));
    } catch {
      // DNS lookup failed — domain not configured yet
    }

    if (verified) {
      await query(
        `UPDATE landing_pages SET custom_domain_verified = true, updated_at = NOW() WHERE tenant_id = $1`,
        [req.user.tenant_id],
      );
    }

    res.json({ verified, domain: row.custom_domain });
  } catch (err) {
    next(err);
  }
});

export default router;
