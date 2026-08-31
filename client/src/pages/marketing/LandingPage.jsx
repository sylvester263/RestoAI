import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { marketingApi } from '../../lib/api';
import {
  ChefHat, ArrowRight, CheckCircle2, Loader2, Menu as MenuIcon, X, ChevronDown,
  ShieldCheck, Users, Bike, TrendingDown, Scale, Flame,
} from 'lucide-react';
import Hero3D from './Hero3D';
import ScrollReveal from './ScrollReveal';
import ScreenshotFrame from './ScreenshotFrame';
import AITeamSection from './AITeamSection';
import whatsappChat from '../../assets/marketing/whatsapp-chat.webp';
import publicMenu from '../../assets/marketing/public-menu.webp';
import checkout from '../../assets/marketing/checkout.webp';
import tokenBoard from '../../assets/marketing/token-board.webp';
import posTill from '../../assets/marketing/pos-till.webp';
import kitchenDisplay from '../../assets/marketing/kitchen-display.webp';
import inventory from '../../assets/marketing/inventory.webp';
import branchAnalytics from '../../assets/marketing/branch-analytics.webp';
import customerProfile from '../../assets/marketing/customer-profile.webp';
import couponsList from '../../assets/marketing/coupons-list.webp';
import campaign from '../../assets/marketing/campaign.webp';
import tenantSite from '../../assets/marketing/tenant-site.webp';

const ROLES = [
  { icon: ShieldCheck, title: 'Owners get full command', desc: 'Every branch, every number, every setting — menu, staff, pricing, and business insights in one place.' },
  { icon: Users, title: 'Staff get their branch', desc: 'Kitchen, orders, and inventory for their own shift — with permissions the owner controls, nothing more.' },
  { icon: Bike, title: 'Riders get their deliveries', desc: 'A simple phone + PIN login built for the road — no password to remember, no app to install.' },
];

const MARKET_FACTS = [
  { icon: TrendingDown, stat: '25–35%', label: 'commission Foodpanda takes per order' },
  { icon: Scale, stat: '2021', label: 'Competition Commission of Pakistan antitrust inquiry opened, still referenced by owners today' },
  { icon: Flame, stat: '11.7%', label: 'YoY inflation (May 2026), with energy costs up ~30% annually on top' },
];

function useMarketingSeo() {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'RestoAI — Escape the commission. Run your restaurant your way.';

    let meta = document.querySelector('meta[name="description"]');
    const created = !meta;
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }
    const prevContent = meta.getAttribute('content');
    meta.setAttribute(
      'content',
      'RestoAI is an AI-native restaurant operations platform for Pakistan — WhatsApp ordering, your own branded storefront, dine-in QR, and more, with zero commission on every order.',
    );

    return () => {
      document.title = prevTitle;
      if (created) {
        meta.remove();
      } else if (prevContent !== null) {
        meta.setAttribute('content', prevContent);
      }
    };
  }, []);
}

export default function LandingPage() {
  useMarketingSeo();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <Header menuOpen={menuOpen} setMenuOpen={setMenuOpen} />
      <Hero />

      <FeatureSection
        n="01" id="ordering" title="Ordering" bg="bg-gray-50"
        subtitle="WhatsApp, your own storefront, and dine-in — every order lands in the same queue, no aggregator in between."
      >
        <div className="grid gap-5 sm:grid-cols-3">
          <ScreenshotFrame src={whatsappChat} alt="WhatsApp AI ordering conversation, confirmed order" />
          <ScreenshotFrame src={publicMenu} alt="RestoAI branded public ordering storefront" />
          <ScreenshotFrame src={checkout} alt="Checkout screen on the branded storefront" />
        </div>
        <p className="mt-4 text-center text-sm text-gray-500">
          Plus in-store token &amp; menu boards for the counter — <ScreenshotLink src={tokenBoard} />
        </p>
      </FeatureSection>

      <FeatureSection
        n="02" id="ai-team" title="Your AI Team"
        subtitle="Proactive automation running behind the scenes — you decide what it's allowed to do."
      >
        <AITeamSection />
      </FeatureSection>

      <FeatureSection
        n="03" id="operations" title="Run Your Whole Operation" bg="bg-gray-50"
        subtitle="Kitchen display, till, and stock — the tools your shift actually runs on, not a back-office afterthought."
      >
        <div className="grid gap-5 sm:grid-cols-3">
          <ScreenshotFrame src={posTill} alt="Multi-branch point of sale, dine-in tab" />
          <ScreenshotFrame src={kitchenDisplay} alt="Live kitchen display board" />
          <ScreenshotFrame src={inventory} alt="Ingredient-level inventory tracking" />
        </div>
      </FeatureSection>

      <FeatureSection
        n="04" id="business" title="Know Your Business"
        subtitle="Branch comparison, revenue trend, and top sellers — the same-day numbers owners actually check."
      >
        <ScreenshotFrame src={branchAnalytics} alt="Branch comparison and revenue dashboard" className="mx-auto max-w-3xl" />
      </FeatureSection>

      <FeatureSection
        n="05" id="growth" title="Grow Your Customers" bg="bg-gray-50"
        subtitle="Profiles, coupons, and campaigns — the tools that bring a customer back without a commission cut."
      >
        <div className="grid gap-5 sm:grid-cols-3">
          <ScreenshotFrame src={customerProfile} alt="Customer profile with order history and tags" />
          <ScreenshotFrame src={couponsList} alt="Coupons and discount codes list" />
          <ScreenshotFrame src={campaign} alt="A sent WhatsApp broadcast campaign" />
        </div>
      </FeatureSection>

      <FeatureSection
        n="06" id="website" title="Your Own Website"
        subtitle="A branded site your customers reach directly — built in the same dashboard, published in minutes."
      >
        <ScreenshotFrame src={tenantSite} alt="A published restaurant landing page built with RestoAI" className="mx-auto max-w-3xl" />
      </FeatureSection>

      <RolesSection />
      <WhyThisExists />
      <Pricing />
      <FinalCta />
      <Footer />
    </div>
  );
}

function ScreenshotLink({ src }) {
  return (
    <a href={src} target="_blank" rel="noreferrer" className="font-medium text-brand-600 underline hover:text-brand-700">
      see a board
    </a>
  );
}

function FeatureSection({ n, id, title, subtitle, bg = '', children }) {
  return (
    <section id={id} className={bg}>
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <ScrollReveal as="div" className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-wide text-brand-600">{n}</span>
          <h2 className="mt-2 text-2xl font-bold sm:text-3xl">{title}</h2>
          <p className="mt-3 text-gray-600">{subtitle}</p>
        </ScrollReveal>
        <ScrollReveal as="div" className="mt-12" delay={0.1}>
          {children}
        </ScrollReveal>
      </div>
    </section>
  );
}

function LoginDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="btn-secondary text-sm">
        Log in <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-40 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          <Link to="/login" className="block px-3 py-2 text-sm text-gray-700 hover:bg-gray-50" onClick={() => setOpen(false)}>Owner login</Link>
          <Link to="/login" className="block px-3 py-2 text-sm text-gray-700 hover:bg-gray-50" onClick={() => setOpen(false)}>Staff login</Link>
        </div>
      )}
    </div>
  );
}

function Header({ menuOpen, setMenuOpen }) {
  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2">
          <ChefHat className="h-6 w-6 text-brand-600" />
          <span className="text-lg font-bold">RestoAI</span>
        </div>

        <nav className="hidden items-center gap-8 text-sm font-medium text-gray-600 md:flex">
          <a href="#ordering" className="hover:text-gray-900">Features</a>
          <a href="#pricing" className="hover:text-gray-900">Pricing</a>
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <LoginDropdown />
          <Link to="/rider/login" className="btn-secondary text-sm">Rider login</Link>
          <Link to="/login?mode=register" className="btn-primary text-sm">Start free</Link>
        </div>

        <button className="text-gray-500 md:hidden" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu">
          {menuOpen ? <X className="h-6 w-6" /> : <MenuIcon className="h-6 w-6" />}
        </button>
      </div>

      {menuOpen && (
        <div className="space-y-3 border-t border-gray-200 px-4 py-4 md:hidden">
          <a href="#ordering" className="block text-sm font-medium text-gray-600" onClick={() => setMenuOpen(false)}>Features</a>
          <a href="#pricing" className="block text-sm font-medium text-gray-600" onClick={() => setMenuOpen(false)}>Pricing</a>
          <div className="flex flex-col gap-2 pt-2">
            <Link to="/login" className="btn-secondary justify-center text-sm">Owner login</Link>
            <Link to="/login" className="btn-secondary justify-center text-sm">Staff login</Link>
            <Link to="/rider/login" className="btn-secondary justify-center text-sm">Rider login</Link>
            <Link to="/login?mode=register" className="btn-primary justify-center text-sm">Start free</Link>
          </div>
        </div>
      )}
    </header>
  );
}

function Hero() {
  return (
    <section className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-2 lg:items-center lg:gap-6">
      <div className="text-center lg:text-left">
        <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
          Escape the 25-35% commission.<br className="hidden lg:block" /> Run your restaurant your way.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base text-gray-600 sm:text-lg lg:mx-0">
          RestoAI is an AI-native operations platform built for Pakistani restaurants — WhatsApp ordering,
          your own branded storefront, dine-in QR, and a full back-of-house, all with zero commission on every order.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
          <Link to="/login?mode=register" className="btn-primary justify-center px-6 py-3 text-base">
            Start free trial <ArrowRight className="h-4 w-4" />
          </Link>
          <a href="#ordering" className="btn-secondary justify-center px-6 py-3 text-base">
            See how it works
          </a>
        </div>
      </div>
      <div className="h-80 sm:h-96 lg:h-[30rem]">
        <Hero3D />
      </div>
    </section>
  );
}

function RolesSection() {
  return (
    <section className="border-t border-gray-200 bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <ScrollReveal as="div" className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold sm:text-3xl">One system, every role</h2>
          <p className="mt-3 text-gray-600">
            Owners, staff, and riders each get a login built for how they actually work — all on one platform.
          </p>
        </ScrollReveal>
        <div className="mt-12 grid gap-8 sm:grid-cols-3">
          {ROLES.map((r, i) => (
            <ScrollReveal key={r.title} as="div" className="text-center" delay={i * 0.08}>
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm">
                <r.icon className="h-6 w-6 text-brand-600" />
              </div>
              <h3 className="mt-4 text-base font-semibold">{r.title}</h3>
              <p className="mt-2 text-sm text-gray-600">{r.desc}</p>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function WhyThisExists() {
  return (
    <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-24">
      <ScrollReveal as="div" className="mx-auto max-w-2xl text-center">
        <h2 className="text-2xl font-bold sm:text-3xl">Why this exists</h2>
        <p className="mt-3 text-gray-600">
          Pakistani restaurants have absorbed aggregator commissions and platform-side failures for years —
          this isn't a hypothetical pain point.
        </p>
      </ScrollReveal>
      <div className="mt-12 grid gap-6 sm:grid-cols-3">
        {MARKET_FACTS.map((f, i) => (
          <ScrollReveal key={f.label} as="div" className="rounded-xl border border-gray-200 p-6 text-center" delay={i * 0.08}>
            <f.icon className="mx-auto h-6 w-6 text-brand-600" />
            <p className="mt-3 text-2xl font-bold text-gray-900">{f.stat}</p>
            <p className="mt-2 text-sm text-gray-600">{f.label}</p>
          </ScrollReveal>
        ))}
      </div>
      <ScrollReveal as="div" delay={0.2} className="mt-6 rounded-xl bg-gray-50 p-6 text-center text-sm text-gray-500">
        A 2020 Karachi restaurant boycott followed a commission jump from 18% to 35% — a documented, litigated
        pain point owners still reference today, not a marketing talking point.
      </ScrollReveal>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" className="border-t border-gray-200 bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 sm:py-24">
        <ScrollReveal as="div">
          <h2 className="text-2xl font-bold sm:text-3xl">Flat pricing, tailored to your restaurant. Never a commission.</h2>
          <p className="mx-auto mt-3 max-w-xl text-gray-600">
            Your plan depends on your restaurant's size and branches, so we quote it directly — one thing never changes: 0% commission, on every order, always.
          </p>
        </ScrollReveal>
        <ScrollReveal as="div" delay={0.1} className="mx-auto mt-10 max-w-sm rounded-2xl border border-gray-200 bg-white p-8">
          <p className="text-sm font-medium uppercase tracking-wide text-brand-700">Flat monthly plan</p>
          <p className="mt-2 text-4xl font-bold">Contact for pricing</p>
          <p className="mt-1 text-sm text-gray-500">Final numbers not yet set — a plan sized to your restaurant, quoted directly</p>
          <ul className="mt-6 space-y-2 text-left text-sm text-gray-600">
            {['0% commission on every order, always', 'Every feature above included', 'Cancel anytime'].map((li) => (
              <li key={li} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-brand-600" /> {li}</li>
            ))}
          </ul>
          <a href="#contact" className="btn-primary mt-6 w-full justify-center">Get in touch</a>
        </ScrollReveal>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section id="contact" className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
      <ScrollReveal as="div">
        <h2 className="text-center text-2xl font-bold sm:text-3xl">Ready to keep more of every order?</h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-gray-600">
          Start free, or leave your details and we'll reach out.
        </p>
        <div className="mt-8 flex justify-center">
          <Link to="/login?mode=register" className="btn-primary justify-center px-6 py-3 text-base">
            Start free trial <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </ScrollReveal>
      <ScrollReveal as="div" delay={0.1} className="mx-auto mt-12 max-w-md">
        <ContactForm />
      </ScrollReveal>
    </section>
  );
}

function ContactForm() {
  const [form, setForm] = useState({ name: '', email: '', restaurant: '', phone: '', message: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await marketingApi.submitContact(form);
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="card text-center">
        <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-green-600" />
        <p className="text-sm font-medium text-gray-900">Thanks — we'll be in touch soon.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <input className="input" placeholder="Your name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <input className="input" type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <input className="input" placeholder="Restaurant name" value={form.restaurant} onChange={(e) => setForm({ ...form, restaurant: e.target.value })} />
        <input className="input" placeholder="Phone (optional)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      </div>
      <textarea className="input" rows={3} placeholder="What would you like to know?" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send'}
      </button>
    </form>
  );
}

function Footer() {
  return (
    <footer className="border-t border-gray-200">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-gray-500 sm:flex-row sm:px-6">
        <div className="flex items-center gap-2">
          <ChefHat className="h-4 w-4" />
          <span>RestoAI</span>
        </div>
        <p>Built for Pakistani restaurants. Zero commission, always.</p>
      </div>
    </footer>
  );
}
