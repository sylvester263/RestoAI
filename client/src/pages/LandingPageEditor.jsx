import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { TEMPLATES, TEMPLATE_CONFIGS } from './public/landing/templates';
import { Hero, About, MenuHighlights, Gallery, Testimonials, HoursLocation, Contact } from './public/landing/Sections';
import { Check, X, Plus, Trash2, ExternalLink, Loader2 } from 'lucide-react';

const SECTION_COMPONENTS = { hero: Hero, about: About, menu: MenuHighlights, gallery: Gallery, testimonials: Testimonials, hours: HoursLocation, contact: Contact };

const EMPTY_CONTENT = {
  hero: { headline: '', subheadline: '', image_url: '' },
  about: { text: '', image_url: '' },
  gallery: { image_urls: [] },
  hours_location: { address: '', hours: '' },
  testimonials: { mode: 'manual', manual_entries: [] },
  contact: { phone: '', whatsapp: '', social_links: { facebook: '', instagram: '' } },
};

export default function LandingPageEditor() {
  const { tenant } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templateId, setTemplateId] = useState(TEMPLATES[0].id);
  const [subdomain, setSubdomain] = useState('');
  const [subdomainStatus, setSubdomainStatus] = useState(null); // { available, message }
  const [content, setContent] = useState(EMPTY_CONTENT);
  const [accentColor, setAccentColor] = useState('#16a34a');
  const [published, setPublished] = useState(false);
  const [menuItems, setMenuItems] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.getLandingPage(), api.getMenu()])
      .then(([lp, menuRes]) => {
        const page = lp.landing_page;
        setTemplateId(page.template_id);
        setSubdomain(page.subdomain || '');
        setContent({ ...EMPTY_CONTENT, ...page.content });
        setAccentColor(page.theme?.accent_color || '#16a34a');
        setPublished(!!page.published);
        setMenuItems(menuRes.items.slice(0, 6));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Debounced subdomain availability check
  useEffect(() => {
    if (!subdomain || subdomain.length < 3) {
      setSubdomainStatus(null);
      return;
    }
    const timer = setTimeout(() => {
      api.checkSubdomain(subdomain).then(setSubdomainStatus).catch(() => setSubdomainStatus(null));
    }, 500);
    return () => clearTimeout(timer);
  }, [subdomain]);

  function updateSection(section, patch) {
    setContent((c) => ({ ...c, [section]: { ...c[section], ...patch } }));
  }

  function addGalleryImage(url) {
    if (!url) return;
    setContent((c) => ({ ...c, gallery: { image_urls: [...(c.gallery.image_urls || []), url] } }));
  }
  function removeGalleryImage(i) {
    setContent((c) => ({ ...c, gallery: { image_urls: c.gallery.image_urls.filter((_, idx) => idx !== i) } }));
  }

  function addTestimonial() {
    setContent((c) => ({
      ...c,
      testimonials: { ...c.testimonials, manual_entries: [...(c.testimonials.manual_entries || []), { name: '', quote: '' }] },
    }));
  }
  function updateTestimonial(i, patch) {
    setContent((c) => ({
      ...c,
      testimonials: {
        ...c.testimonials,
        manual_entries: c.testimonials.manual_entries.map((t, idx) => (idx === i ? { ...t, ...patch } : t)),
      },
    }));
  }
  function removeTestimonial(i) {
    setContent((c) => ({
      ...c,
      testimonials: { ...c.testimonials, manual_entries: c.testimonials.manual_entries.filter((_, idx) => idx !== i) },
    }));
  }

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError('');
    try {
      await api.saveLandingPage({
        template_id: templateId,
        subdomain: subdomain.toLowerCase(),
        content,
        theme: { accent_color: accentColor },
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }, [templateId, subdomain, content, accentColor]);

  async function handlePublishToggle() {
    setSaving(true);
    setError('');
    try {
      await handleSave();
      const res = await api.publishLandingPage(!published);
      setPublished(!!res.landing_page.published);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400">Loading your site...</div>;

  const config = TEMPLATE_CONFIGS[templateId];
  const previewTenant = { name: tenant?.name || 'Your Restaurant', slug: tenant?.slug || 'preview', currency: tenant?.currency || 'Rs.' };
  const previewTestimonials = content.testimonials.mode === 'reviews'
    ? [{ name: 'A happy customer', quote: 'Live customer reviews will appear here once you publish.' }]
    : content.testimonials.manual_entries;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Website Builder</h1>
          <p className="text-sm text-gray-500">Build a branded marketing site for your restaurant.</p>
        </div>
        <div className="flex items-center gap-2">
          {published && subdomain && (
            <a href={`/site/${subdomain}`} target="_blank" rel="noreferrer" className="btn-secondary text-sm">
              <ExternalLink className="h-4 w-4" /> View live
            </a>
          )}
          <button onClick={handleSave} disabled={saving} className="btn-secondary text-sm">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save draft'}
          </button>
          <button onClick={handlePublishToggle} disabled={saving} className={published ? 'btn-secondary text-sm' : 'btn-primary text-sm'}>
            {published ? 'Unpublish' : 'Publish'}
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Editor column ── */}
        <div className="space-y-6">
          {/* Template picker */}
          <div className="card">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Template</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTemplateId(t.id)}
                  className={`rounded-lg border-2 p-3 text-left transition-colors ${templateId === t.id ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:border-gray-300'}`}
                >
                  <div className="mb-2 h-8 w-full rounded" style={{ backgroundColor: t.swatch }} />
                  <p className="text-xs font-semibold text-gray-900">{t.name}</p>
                  <p className="mt-0.5 text-[11px] text-gray-500">{t.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Subdomain */}
          <div className="card">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Address</h2>
            <label className="mb-1 block text-xs font-medium text-gray-600">Subdomain</label>
            <div className="flex items-center gap-2">
              <input
                className="input flex-1"
                placeholder="karahi-house"
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              />
              <span className="text-sm text-gray-400">.yourapp.com/site/...</span>
            </div>
            {subdomainStatus && (
              <p className={`mt-1 flex items-center gap-1 text-xs ${subdomainStatus.available ? 'text-green-600' : 'text-red-600'}`}>
                {subdomainStatus.available ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                {subdomainStatus.available ? 'Available' : subdomainStatus.message}
              </p>
            )}
            <div className="mt-4 rounded-lg border border-dashed border-gray-200 p-3 text-xs text-gray-400">
              Custom domain (e.g. www.yourrestaurant.com) — coming soon.
            </div>
          </div>

          {/* Accent color */}
          <div className="card">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Accent Color</h2>
            <div className="flex items-center gap-3">
              <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="h-10 w-14 cursor-pointer rounded border border-gray-200" />
              <span className="text-sm text-gray-500">{accentColor}</span>
            </div>
          </div>

          {/* Hero */}
          <div className="card space-y-3">
            <h2 className="text-sm font-semibold text-gray-700">Hero</h2>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Headline</label>
              <input className="input" value={content.hero.headline} onChange={(e) => updateSection('hero', { headline: e.target.value })} placeholder="Authentic Lahori Karahi, Made Fresh Daily" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Subheadline</label>
              <input className="input" value={content.hero.subheadline} onChange={(e) => updateSection('hero', { subheadline: e.target.value })} placeholder="Family recipes since 1998" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Image URL</label>
              <input className="input" value={content.hero.image_url} onChange={(e) => updateSection('hero', { image_url: e.target.value })} placeholder="https://..." />
            </div>
          </div>

          {/* About */}
          <div className="card space-y-3">
            <h2 className="text-sm font-semibold text-gray-700">Our Story</h2>
            <textarea className="input min-h-[100px]" value={content.about.text} onChange={(e) => updateSection('about', { text: e.target.value })} placeholder="Tell customers about your restaurant..." />
            <input className="input" value={content.about.image_url} onChange={(e) => updateSection('about', { image_url: e.target.value })} placeholder="Image URL (optional)" />
          </div>

          {/* Gallery */}
          <div className="card space-y-3">
            <h2 className="text-sm font-semibold text-gray-700">Gallery</h2>
            {content.gallery.image_urls.map((url, i) => (
              <div key={i} className="flex items-center gap-2">
                <input className="input flex-1" value={url} readOnly />
                <button onClick={() => removeGalleryImage(i)} className="rounded p-2 text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            <GalleryAdd onAdd={addGalleryImage} />
          </div>

          {/* Hours & location */}
          <div className="card space-y-3">
            <h2 className="text-sm font-semibold text-gray-700">Hours &amp; Location</h2>
            <textarea className="input" value={content.hours_location.address} onChange={(e) => updateSection('hours_location', { address: e.target.value })} placeholder="Full address" rows={2} />
            <textarea className="input" value={content.hours_location.hours} onChange={(e) => updateSection('hours_location', { hours: e.target.value })} placeholder={'Mon-Sun: 12pm - 11pm'} rows={2} />
          </div>

          {/* Testimonials */}
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">Testimonials</h2>
              <select
                className="input w-auto text-xs"
                value={content.testimonials.mode}
                onChange={(e) => updateSection('testimonials', { mode: e.target.value })}
              >
                <option value="manual">Write manually</option>
                <option value="reviews">Show real customer reviews</option>
              </select>
            </div>
            {content.testimonials.mode === 'manual' && (
              <>
                {content.testimonials.manual_entries.map((t, i) => (
                  <div key={i} className="space-y-1 rounded-lg border border-gray-100 p-3">
                    <div className="flex items-center gap-2">
                      <input className="input" value={t.name} onChange={(e) => updateTestimonial(i, { name: e.target.value })} placeholder="Customer name" />
                      <button onClick={() => removeTestimonial(i)} className="rounded p-2 text-red-500 hover:bg-red-50 shrink-0"><Trash2 className="h-4 w-4" /></button>
                    </div>
                    <textarea className="input" value={t.quote} onChange={(e) => updateTestimonial(i, { quote: e.target.value })} placeholder="What they said" rows={2} />
                  </div>
                ))}
                <button onClick={addTestimonial} className="btn-secondary text-xs"><Plus className="h-3 w-3" /> Add testimonial</button>
              </>
            )}
            {content.testimonials.mode === 'reviews' && (
              <p className="text-xs text-gray-400">Your highest-rated customer reviews (4-5 stars, with comments) will show automatically.</p>
            )}
          </div>

          {/* Contact */}
          <div className="card space-y-3">
            <h2 className="text-sm font-semibold text-gray-700">Contact</h2>
            <input className="input" value={content.contact.phone} onChange={(e) => updateSection('contact', { phone: e.target.value })} placeholder="Phone number" />
            <input className="input" value={content.contact.whatsapp} onChange={(e) => updateSection('contact', { whatsapp: e.target.value })} placeholder="WhatsApp number" />
            <input
              className="input"
              value={content.contact.social_links.facebook}
              onChange={(e) => updateSection('contact', { social_links: { ...content.contact.social_links, facebook: e.target.value } })}
              placeholder="Facebook URL"
            />
            <input
              className="input"
              value={content.contact.social_links.instagram}
              onChange={(e) => updateSection('contact', { social_links: { ...content.contact.social_links, instagram: e.target.value } })}
              placeholder="Instagram URL"
            />
          </div>
        </div>

        {/* ── Live preview column ── */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">Live Preview</p>
          <div className="overflow-hidden rounded-xl border border-gray-200 shadow-sm">
            <div className="max-h-[80vh] overflow-y-auto">
              <div className={`${config.fontClass} ${config.dark ? 'bg-gray-900' : 'bg-white'}`}>
                {config.order.map((key, i) => {
                  const Section = SECTION_COMPONENTS[key];
                  if (!Section) return null;
                  return (
                    <Section
                      key={key}
                      content={content}
                      theme={{ accent_color: accentColor }}
                      tenant={previewTenant}
                      menuItems={menuItems}
                      testimonials={previewTestimonials}
                      currency={previewTenant.currency}
                      config={config}
                      dark={!!config.dark}
                      bg={config.sectionBg(i)}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function GalleryAdd({ onAdd }) {
  const [value, setValue] = useState('');
  return (
    <div className="flex items-center gap-2">
      <input className="input flex-1" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Image URL" />
      <button
        onClick={() => { onAdd(value); setValue(''); }}
        disabled={!value}
        className="btn-secondary text-xs"
      >
        <Plus className="h-3 w-3" /> Add
      </button>
    </div>
  );
}
