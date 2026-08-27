/**
 * Landing Page Builder — admin CRUD for the tenant's branded marketing site.
 * Custom domains are stored (schema-complete per spec) but DNS verification
 * is not implemented yet — the editor surfaces that as "coming soon" and
 * this route never flips custom_domain_verified.
 */
import { Router } from 'express';
import { z } from 'zod';
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

export default router;
