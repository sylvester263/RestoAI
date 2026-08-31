// Template metadata + per-template layout config. All templates render the
// SAME content schema (see server/src/services/landing-page.js) — only the
// arrangement, typography, and emphasis differ, per the builder's scoping
// decision to ship fixed templates rather than a freeform canvas editor.

export const TEMPLATES = [
  { id: 'classic-warm', name: 'Classic Warm', swatch: '#b45309', description: 'Warm, traditional layout with a full story section.' },
  { id: 'modern-minimal', name: 'Modern Minimal', swatch: '#0f172a', description: 'Large hero image, condensed copy, lots of white space.' },
  { id: 'family-casual', name: 'Family & Casual', swatch: '#0d9488', description: 'Testimonials up front, warm and welcoming.' },
  { id: 'fine-dining', name: 'Fine Dining', swatch: '#1c1917', description: 'Full-bleed imagery, elegant type, reservation-forward.' },
  { id: 'fast-casual', name: 'Fast & Casual', swatch: '#dc2626', description: 'Menu front and center, "Order Now" above the fold.' },
];

export const TEMPLATE_IDS = TEMPLATES.map((t) => t.id);

// order: which sections render and in what sequence.
// heroStyle: 'boxed' (card-like, image beside text) | 'fullbleed' (image behind text) | 'compact' (text-only banner)
// fontClass: heading font treatment
// primaryCta: 'order' | 'reserve' — which action the hero's main button performs
export const TEMPLATE_CONFIGS = {
  'classic-warm': {
    order: ['hero', 'about', 'menu', 'gallery', 'testimonials', 'hours', 'contact'],
    heroStyle: 'boxed',
    fontClass: 'font-serif',
    primaryCta: 'order',
    sectionBg: (i) => (i % 2 === 1 ? '#fffbeb' : '#ffffff'),
    darkSectionBg: (i) => (i % 2 === 1 ? '#1c1917' : '#0c0a09'),
  },
  'modern-minimal': {
    order: ['hero', 'menu', 'about', 'gallery', 'contact'],
    heroStyle: 'fullbleed',
    fontClass: 'font-sans',
    primaryCta: 'order',
    sectionBg: () => '#ffffff',
    darkSectionBg: () => '#0c0a09',
  },
  'family-casual': {
    order: ['hero', 'testimonials', 'about', 'menu', 'gallery', 'hours', 'contact'],
    heroStyle: 'boxed',
    fontClass: 'font-sans',
    primaryCta: 'order',
    sectionBg: (i) => (i % 2 === 1 ? '#f0fdfa' : '#ffffff'),
    darkSectionBg: (i) => (i % 2 === 1 ? '#042f2e' : '#0c0a09'),
  },
  'fine-dining': {
    order: ['hero', 'about', 'gallery', 'menu', 'testimonials', 'hours', 'contact'],
    heroStyle: 'fullbleed',
    fontClass: 'font-serif',
    primaryCta: 'reserve',
    sectionBg: () => '#0c0a09',
    darkSectionBg: () => '#0c0a09',
    dark: true,
  },
  'fast-casual': {
    order: ['hero', 'menu', 'about', 'testimonials', 'hours', 'contact'],
    heroStyle: 'compact',
    fontClass: 'font-sans',
    primaryCta: 'order',
    sectionBg: (i) => (i % 2 === 1 ? '#fef2f2' : '#ffffff'),
    darkSectionBg: (i) => (i % 2 === 1 ? '#1c1917' : '#0c0a09'),
  },
};
