import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { marketingApi } from '../../lib/api';
import {
  ChefHat, MessageCircle, Camera, Globe, QrCode, CalendarCheck, Megaphone,
  Star, MonitorPlay, ShieldCheck, Users, Bike, ArrowRight, CheckCircle2,
  Loader2, Menu as MenuIcon, X,
} from 'lucide-react';

const FEATURES = [
  { icon: MessageCircle, title: 'WhatsApp AI ordering', desc: 'A conversational AI agent takes real orders on WhatsApp — not a rigid menu-button bot.' },
  { icon: Camera, title: 'AI menu digitization', desc: 'Photograph your paper menu and let AI turn it into structured, editable items in minutes.' },
  { icon: Globe, title: 'Your own branded storefront', desc: 'A zero-commission ordering site customers reach directly — no aggregator in between.' },
  { icon: QrCode, title: 'Dine-in QR ordering', desc: 'Guests scan, browse, and order straight from the table — no app to install.' },
  { icon: CalendarCheck, title: 'Reservations & table booking', desc: 'Take bookings online without a phone tied up all evening.' },
  { icon: Megaphone, title: 'WhatsApp broadcasts', desc: 'Reach your customer list directly for promotions — channel you own, not one you rent.' },
  { icon: Star, title: 'Loyalty, reviews & push', desc: 'Points, reviews, and re-engagement — built to bring customers back without a commission cut.' },
  { icon: MonitorPlay, title: 'Kitchen & display boards', desc: 'A live kitchen display and order-ready/menu boards for the counter or dining room.' },
];

const STATS = [
  { value: '0%', label: 'commission on every order' },
  { value: 'WhatsApp + web + dine-in', label: 'ordering channels, one system' },
  { value: 'Always on', label: 'AI ordering agent, day or night' },
  { value: 'Minutes', label: 'to set up your menu' },
];

const STEPS = [
  { n: '1', title: 'Set up your branches & menu', desc: 'Add your branches and menu items — or snap a photo of your existing menu and let AI digitize it for you.' },
  { n: '2', title: 'Orders land from every channel', desc: 'WhatsApp, your own storefront, dine-in QR codes, and walk-in POS all feed into one order queue.' },
  { n: '3', title: 'Run the whole shift from there', desc: 'Kitchen display, rider dispatch, reservations, and same-day insights — one dashboard, every role.' },
];

const ROLES = [
  { icon: ShieldCheck, title: 'Owners get full command', desc: 'Every branch, every number, every setting — menu, staff, pricing, and business insights in one place.' },
  { icon: Users, title: 'Staff get their branch', desc: 'Kitchen, orders, and inventory for their own shift — with permissions the owner controls, nothing more.' },
  { icon: Bike, title: 'Riders get their deliveries', desc: 'A simple phone + PIN login built for the road — no password to remember, no app to install.' },
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
      <StatsBar />
      <HowItWorks />
      <FeatureGrid />
      <RolesSection />
      <Pricing />
      <FinalCta />
      <Footer />
    </div>
  );
}

function Header({ menuOpen, setMenuOpen }) {
  return (
    <header className="border-b border-gray-200">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2">
          <ChefHat className="h-6 w-6 text-brand-600" />
          <span className="text-lg font-bold">RestoAI</span>
        </div>

        <nav className="hidden items-center gap-8 text-sm font-medium text-gray-600 md:flex">
          <a href="#features" className="hover:text-gray-900">Features</a>
          <a href="#how-it-works" className="hover:text-gray-900">How it works</a>
          <a href="#pricing" className="hover:text-gray-900">Pricing</a>
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Link to="/login" className="btn-secondary text-sm">Owner login</Link>
          <Link to="/login" className="btn-secondary text-sm">Staff login</Link>
          <Link to="/rider/login" className="btn-secondary text-sm">Rider login</Link>
          <Link to="/login?mode=register" className="btn-primary text-sm">Start free</Link>
        </div>

        <button className="text-gray-500 md:hidden" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu">
          {menuOpen ? <X className="h-6 w-6" /> : <MenuIcon className="h-6 w-6" />}
        </button>
      </div>

      {menuOpen && (
        <div className="space-y-3 border-t border-gray-200 px-4 py-4 md:hidden">
          <a href="#features" className="block text-sm font-medium text-gray-600" onClick={() => setMenuOpen(false)}>Features</a>
          <a href="#how-it-works" className="block text-sm font-medium text-gray-600" onClick={() => setMenuOpen(false)}>How it works</a>
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
    <section className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 sm:py-24">
      <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
        Escape the 25-35% commission.<br className="hidden sm:block" /> Run your restaurant your way.
      </h1>
      <p className="mx-auto mt-5 max-w-2xl text-base text-gray-600 sm:text-lg">
        RestoAI is an AI-native operations platform built for Pakistani restaurants — WhatsApp ordering,
        your own branded storefront, dine-in QR, and a full back-of-house, all with zero commission on every order.
      </p>
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link to="/login?mode=register" className="btn-primary justify-center px-6 py-3 text-base">
          Start free trial <ArrowRight className="h-4 w-4" />
        </Link>
        <a href="#how-it-works" className="btn-secondary justify-center px-6 py-3 text-base">
          See how it works
        </a>
      </div>
    </section>
  );
}

function StatsBar() {
  return (
    <section className="border-y border-gray-200 bg-gray-50">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 py-10 sm:px-6 lg:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.label} className="text-center">
            <p className="text-xl font-bold text-brand-700 sm:text-2xl">{s.value}</p>
            <p className="mt-1 text-xs text-gray-500 sm:text-sm">{s.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
      <h2 className="text-center text-2xl font-bold sm:text-3xl">How it works</h2>
      <p className="mx-auto mt-3 max-w-xl text-center text-gray-600">Three steps from paper menu to a fully running digital operation.</p>
      <div className="mt-12 grid gap-8 sm:grid-cols-3">
        {STEPS.map((step) => (
          <div key={step.n} className="text-center sm:text-left">
            <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full border border-brand-600 text-sm font-bold text-brand-700 sm:mx-0">
              {step.n}
            </div>
            <h3 className="mt-4 text-base font-semibold">{step.title}</h3>
            <p className="mt-2 text-sm text-gray-600">{step.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function FeatureGrid() {
  return (
    <section id="features" className="border-t border-gray-200 bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <h2 className="text-center text-2xl font-bold sm:text-3xl">Everything your restaurant needs, built in</h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-gray-600">No bolt-ons, no separate subscriptions — one platform.</p>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-gray-200 bg-white p-5">
              <f.icon className="h-6 w-6 text-brand-600" />
              <h3 className="mt-3 text-sm font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-gray-500">{f.desc}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 rounded-xl border border-dashed border-gray-300 bg-white p-5 text-center">
          <p className="text-sm font-medium text-gray-700">Coming soon</p>
          <p className="mt-1 text-sm text-gray-500">Multi-branch point of sale, deeper branch-level analytics, discount coupons, and a full customer CRM.</p>
        </div>
      </div>
    </section>
  );
}

function RolesSection() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
      <h2 className="text-center text-2xl font-bold sm:text-3xl">One system, every role</h2>
      <p className="mx-auto mt-3 max-w-xl text-center text-gray-600">
        Owners, staff, and riders each get a login built for how they actually work — all on one platform.
      </p>
      <div className="mt-12 grid gap-8 sm:grid-cols-3">
        {ROLES.map((r) => (
          <div key={r.title} className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50">
              <r.icon className="h-6 w-6 text-brand-600" />
            </div>
            <h3 className="mt-4 text-base font-semibold">{r.title}</h3>
            <p className="mt-2 text-sm text-gray-600">{r.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" className="border-t border-gray-200 bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 sm:py-24">
        <h2 className="text-2xl font-bold sm:text-3xl">Flat pricing, tailored to your restaurant. Never a commission.</h2>
        <p className="mx-auto mt-3 max-w-xl text-gray-600">
          Your plan depends on your restaurant's size and branches, so we quote it directly — one thing never changes: 0% commission, on every order, always.
        </p>
        <div className="mx-auto mt-10 max-w-sm rounded-2xl border border-gray-200 bg-white p-8">
          <p className="text-sm font-medium uppercase tracking-wide text-brand-700">Flat monthly plan</p>
          <p className="mt-2 text-4xl font-bold">Contact for pricing</p>
          <p className="mt-1 text-sm text-gray-500">A plan sized to your restaurant, quoted directly</p>
          <ul className="mt-6 space-y-2 text-left text-sm text-gray-600">
            {['0% commission on every order, always', 'Every feature above included', 'Cancel anytime'].map((li) => (
              <li key={li} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-brand-600" /> {li}</li>
            ))}
          </ul>
          <a href="#contact" className="btn-primary mt-6 w-full justify-center">Get in touch</a>
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section id="contact" className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
      <h2 className="text-center text-2xl font-bold sm:text-3xl">Ready to keep more of every order?</h2>
      <p className="mx-auto mt-3 max-w-xl text-center text-gray-600">
        Start free, or leave your details and we'll reach out.
      </p>
      <div className="mt-8 flex justify-center">
        <Link to="/login?mode=register" className="btn-primary justify-center px-6 py-3 text-base">
          Start free trial <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="mx-auto mt-12 max-w-md">
        <ContactForm />
      </div>
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
