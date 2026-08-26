/**
 * Landing Page Builder — shared content schema and template registry.
 * All templates render the SAME content shape differently (per the spec's
 * scoping decision), so there is exactly one schema to validate against
 * regardless of which of the 5 templates a tenant picks.
 */
import { z } from 'zod';

export const TEMPLATES = [
  { id: 'classic-warm', name: 'Classic Warm', description: 'Warm, traditional layout — hero, story, menu highlights, gallery, hours.' },
  { id: 'modern-minimal', name: 'Modern Minimal', description: 'Large hero image, condensed copy, lots of white space.' },
  { id: 'family-casual', name: 'Family & Casual', description: 'Testimonials-forward, welcoming and casual.' },
  { id: 'fine-dining', name: 'Fine Dining', description: 'Full-bleed imagery, elegant type, reservation-forward.' },
  { id: 'fast-casual', name: 'Fast & Casual', description: 'Menu-highlights-forward with "Order Now" above the fold.' },
];
export const TEMPLATE_IDS = TEMPLATES.map((t) => t.id);

// Reserved subdomains that must never be assignable to a tenant.
export const RESERVED_SUBDOMAINS = new Set([
  'www', 'api', 'admin', 'app', 'order', 'static', 'assets', 'cdn', 'mail',
  'ftp', 'blog', 'help', 'support', 'status', 'dashboard', 'login', 'site',
]);

const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

export const subdomainSchema = z.string()
  .min(3, 'Subdomain must be at least 3 characters')
  .max(63, 'Subdomain must be at most 63 characters')
  .regex(SUBDOMAIN_RE, 'Use lowercase letters, numbers, and hyphens only (no leading/trailing hyphen)')
  .refine((v) => !RESERVED_SUBDOMAINS.has(v), { message: 'That subdomain is reserved' });

const testimonialEntry = z.object({
  name: z.string().min(1).max(100),
  quote: z.string().min(1).max(1000),
});

export const contentSchema = z.object({
  hero: z.object({
    headline: z.string().max(200).optional().default(''),
    subheadline: z.string().max(300).optional().default(''),
    image_url: z.string().url().optional().or(z.literal('')).default(''),
  }).default({}),
  about: z.object({
    text: z.string().max(2000).optional().default(''),
    image_url: z.string().url().optional().or(z.literal('')).default(''),
  }).default({}),
  gallery: z.object({
    image_urls: z.array(z.string().url()).max(12).optional().default([]),
  }).default({}),
  hours_location: z.object({
    address: z.string().max(500).optional().default(''),
    hours: z.string().max(500).optional().default(''),
  }).default({}),
  testimonials: z.object({
    mode: z.enum(['manual', 'reviews']).optional().default('manual'),
    manual_entries: z.array(testimonialEntry).max(10).optional().default([]),
  }).default({}),
  contact: z.object({
    phone: z.string().max(20).optional().default(''),
    whatsapp: z.string().max(20).optional().default(''),
    social_links: z.object({
      facebook: z.string().url().optional().or(z.literal('')).default(''),
      instagram: z.string().url().optional().or(z.literal('')).default(''),
    }).default({}),
  }).default({}),
}).default({});

export const themeSchema = z.object({
  accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex color like #16a34a').optional().default('#16a34a'),
}).default({});

export function defaultLandingPage() {
  return {
    template_id: TEMPLATE_IDS[0],
    subdomain: null,
    custom_domain: null,
    custom_domain_verified: false,
    published: false,
    content: contentSchema.parse({}),
    theme: themeSchema.parse({}),
  };
}
