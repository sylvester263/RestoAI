/**
 * Public landing-site resolution — path-based (yourapp.com/site/:subdomain)
 * rather than wildcard-subdomain DNS, per the hackathon-timeline scoping
 * decision (custom domains are stored but not yet verifiable/servable).
 * Never leaks unpublished content — a draft or unknown subdomain both 404.
 */
import { Router } from 'express';
import { query } from '../db/pool.js';

const router = Router();

router.get('/:subdomain', async (req, res, next) => {
  try {
    const pageRes = await query(
      `SELECT lp.*, t.name as tenant_name, t.slug as tenant_slug, t.phone as tenant_phone,
              t.address as tenant_address, t.currency as tenant_currency, t.id as tenant_id
       FROM landing_pages lp
       JOIN tenants t ON lp.tenant_id = t.id
       WHERE lp.subdomain = $1 AND lp.published = true`,
      [req.params.subdomain.toLowerCase()],
    );
    const page = pageRes.rows[0];
    if (!page) {
      return res.status(404).json({ error: { message: 'Site not found' } });
    }

    const menuRes = await query(
      `SELECT mi.id, mi.name, mi.description, mi.price, mi.image_url
       FROM menu_items mi
       WHERE mi.tenant_id = $1 AND mi.is_available = true
       ORDER BY mi.created_at DESC LIMIT 6`,
      [page.tenant_id],
    );

    let testimonials = (page.content?.testimonials?.manual_entries || [])
      .map((e) => ({ name: e.name, quote: e.quote }));
    if (page.content?.testimonials?.mode === 'reviews') {
      const reviewRes = await query(
        `SELECT r.rating, r.comment, c.name as customer_name
         FROM reviews r
         LEFT JOIN customers c ON r.customer_id = c.id
         WHERE r.tenant_id = $1 AND r.comment IS NOT NULL AND r.rating >= 4
         ORDER BY r.created_at DESC LIMIT 6`,
        [page.tenant_id],
      );
      testimonials = reviewRes.rows.map((r) => ({ name: r.customer_name || 'Verified customer', quote: r.comment }));
    }

    res.json({
      tenant: {
        name: page.tenant_name,
        slug: page.tenant_slug,
        phone: page.tenant_phone,
        address: page.tenant_address,
        currency: page.tenant_currency,
      },
      template_id: page.template_id,
      content: page.content,
      theme: page.theme,
      featured_menu_items: menuRes.rows,
      testimonials,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
