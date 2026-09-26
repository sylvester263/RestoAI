import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, marketingApi } from '../../lib/api';
import { monthlyAmount, formatRs } from '../../lib/pricing';
import {
  ChefHat, ArrowRight, CheckCircle2, Loader2, Menu as MenuIcon, X, ChevronDown,
  ShieldCheck, Users, Bike, TrendingDown, Scale, Flame,
  BadgeCheck, MessageCircle, Wand2, LifeBuoy, Lock, BadgePercent, CalendarX, Landmark,
} from 'lucide-react';
import { useReducedMotion } from 'framer-motion';
import ScrollReveal from './ScrollReveal';
import AITeamSection, { AgentStrip } from './AITeamSection';
import DarkModeToggle from '../../components/DarkModeToggle';
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

// ── impl-22 v3: visual redesign only. Every section, claim and piece of copy
// below comes from the v2 page; only layout and styling changed. The new
// structural pieces (badge, stat bar, trust section) state only facts that are
// true today — see the spec's exclusion list before adding anything here.

const META_BADGE = 'Approved Meta Tech Provider';

// The six v2 feature sections, restyled as one tabbed two-column block.
// "What's included" items are condensed from the v2 bullets/screens.
const FEATURES = [
  {
    id: 'ordering', n: '01', title: 'Ordering', tab: 'Ordering',
    subtitle: 'WhatsApp, your own storefront, and dine-in — every order lands in the same queue, no aggregator in between.',
    included: ['WhatsApp AI ordering conversations', 'Your own branded storefront & checkout', 'Dine-in QR ordering', 'In-store token & menu boards for the counter'],
    shots: [
      { src: whatsappChat, alt: 'WhatsApp AI ordering conversation, confirmed order' },
      { src: publicMenu, alt: 'RestoAI branded public ordering storefront' },
      { src: checkout, alt: 'Checkout screen on the branded storefront' },
      { src: tokenBoard, alt: 'In-store token board for the counter' },
    ],
  },
  {
    id: 'ai-team', n: '02', title: 'Your AI Team', tab: 'AI Team',
    subtitle: "Proactive automation running behind the scenes — you decide what it's allowed to do.",
    included: ['Ask Anything — in English or Urdu', '10 autonomous agents', 'Always watching for payment gaps & abuse', 'One data model across every channel'],
    custom: 'ai-team',
  },
  {
    id: 'operations', n: '03', title: 'Run Your Whole Operation', tab: 'Operations',
    subtitle: 'Kitchen display, till, and stock — the tools your shift actually runs on, not a back-office afterthought.',
    included: ['POS billing — tax, split-tender, shifts & receipts', 'Live kitchen display board', 'Ingredient-level inventory tracking', 'Multi-branch point of sale'],
    shots: [
      { src: posTill, alt: 'POS settling a bill split across cash and card' },
      { src: kitchenDisplay, alt: 'Live kitchen display board' },
      { src: inventory, alt: 'Ingredient-level inventory tracking' },
    ],
  },
  {
    id: 'business', n: '04', title: 'Know Your Business', tab: 'Insights',
    subtitle: 'Branch comparison, revenue trend, and top sellers — the same-day numbers owners actually check.',
    included: ['Branch comparison', 'Revenue trend', 'Top sellers', 'Cross-branch benchmarking'],
    shots: [{ src: branchAnalytics, alt: 'Branch comparison and revenue dashboard' }],
  },
  {
    id: 'growth', n: '05', title: 'Grow Your Customers', tab: 'Customers',
    subtitle: 'Profiles, coupons, and campaigns — the tools that bring a customer back without a commission cut.',
    included: ['Customer profiles with order history & tags', 'RFM segments', 'Coupons & a referral program', 'WhatsApp broadcast campaigns'],
    shots: [
      { src: customerProfile, alt: 'Customer profile with order history and tags' },
      { src: couponsList, alt: 'Coupons and discount codes list' },
      { src: campaign, alt: 'A sent WhatsApp broadcast campaign' },
    ],
  },
  {
    id: 'website', n: '06', title: 'Your Own Website', tab: 'Website',
    subtitle: 'A branded site your customers reach directly — built in the same dashboard, published in minutes.',
    included: ['A branded site your customers reach directly', 'Built in the same dashboard', 'Published in minutes', 'Your own presence, not an aggregator listing'],
    shots: [{ src: tenantSite, alt: 'A published restaurant landing page built with RestoAI' }],
  },
];

// Honest onboarding/trust copy — engineering practice, never a certification.
const TRUST = [
  { icon: MessageCircle, title: 'Easy onboarding', desc: "Connect your WhatsApp number through Meta's official Embedded Signup — RestoAI is an approved Meta Tech Provider." },
  { icon: Wand2, title: 'Guided setup', desc: 'Import your menu from a photo, pick a website template, and invite your staff — all from the same dashboard.' },
  { icon: LifeBuoy, title: 'Real support', desc: "Questions go to a person at RestoAI — leave your details below and we'll reach out." },
];

export default function LandingPage() {
  useMarketingSeo();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pricing, setPricing] = useState(null);

  useEffect(() => {
    api.getBillingPlans().then(setPricing).catch(() => setPricing(false));
  }, []);

  return (
    <div className="min-h-screen bg-[var(--surface-1)] text-[var(--text-primary)]">
      <Header menuOpen={menuOpen} setMenuOpen={setMenuOpen} />
      <Hero />
      <StatBar pricing={pricing} />
      <Features />
      <RolesSection />
      <WhyThisExists />
      <TrustSection />
      <Pricing pricing={pricing} />
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
        <div className="absolute right-0 top-full mt-2 w-40 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-2)] py-1 shadow-lg">
          <Link to="/login" className="block px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-3)]" onClick={() => setOpen(false)}>Owner login</Link>
          <Link to="/login" className="block px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-3)]" onClick={() => setOpen(false)}>Staff login</Link>
        </div>
      )}
    </div>
  );
}

function Header({ menuOpen, setMenuOpen }) {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--surface-2)]/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2">
          <ChefHat className="h-6 w-6 text-brand-600" />
          <span className="text-lg font-bold text-[var(--text-primary)]">RestoAI</span>
        </div>

        <nav className="hidden items-center gap-8 text-sm font-medium text-[var(--text-secondary)] md:flex">
          <a href="#features" className="hover:text-[var(--text-primary)]">Features</a>
          <a href="#pricing" className="hover:text-[var(--text-primary)]">Pricing</a>
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <DarkModeToggle />
          <LoginDropdown />
          <Link to="/rider/login" className="btn-secondary text-sm">Rider login</Link>
          <Link to="/login?mode=register" className="btn-primary text-sm">Start free</Link>
        </div>

        <button className="text-[var(--text-secondary)] md:hidden" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu">
          {menuOpen ? <X className="h-6 w-6" /> : <MenuIcon className="h-6 w-6" />}
        </button>
      </div>

      {menuOpen && (
        <div className="space-y-3 border-t border-[var(--border)] px-4 py-4 md:hidden">
          <a href="#features" className="block text-sm font-medium text-[var(--text-secondary)]" onClick={() => setMenuOpen(false)}>Features</a>
          <a href="#pricing" className="block text-sm font-medium text-[var(--text-secondary)]" onClick={() => setMenuOpen(false)}>Pricing</a>
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

// Warm, atmospheric gradient (no stock/generated photo — owner decision) behind
// a layered pair of real product screenshots.
const HERO_GLOW = {
  backgroundImage:
    'radial-gradient(ellipse 70% 60% at 15% 0%, rgba(251, 191, 36, 0.28), transparent 70%),'
    + 'radial-gradient(ellipse 60% 55% at 95% 15%, rgba(22, 163, 74, 0.22), transparent 70%),'
    + 'radial-gradient(ellipse 80% 50% at 50% 100%, rgba(234, 88, 12, 0.10), transparent 70%)',
};

function Hero() {
  return (
    <section className="relative overflow-hidden" style={HERO_GLOW}>
      <div className="mx-auto grid max-w-6xl gap-12 px-4 pb-20 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[1.05fr_1fr] lg:items-center">
        <ScrollReveal as="div" className="text-center lg:text-left">
          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-2)]/80 px-3 py-1 text-xs font-semibold text-[var(--text-secondary)] shadow-sm backdrop-blur">
            <BadgeCheck className="h-4 w-4 text-brand-600" /> {META_BADGE}
          </span>
          <h1 className="mt-5 text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-6xl">
            Escape the 25-35% commission.{' '}
            <span className="block text-brand-600">Run your restaurant your way.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base text-[var(--text-secondary)] sm:text-lg lg:mx-0">
            RestoAI is an AI-native operations platform built for Pakistani restaurants — WhatsApp ordering,
            your own branded storefront, dine-in QR, and a full back-of-house, all with zero commission on every order.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
            <Link to="/login?mode=register" className="btn-primary justify-center px-6 py-3 text-base shadow-lg shadow-brand-600/20">
              Start free trial <ArrowRight className="h-4 w-4" />
            </Link>
            <a href="#features" className="btn-secondary justify-center bg-[var(--surface-2)] px-6 py-3 text-base">
              See how it works
            </a>
          </div>
        </ScrollReveal>

        <ScrollReveal as="div" delay={0.1} className="relative mx-auto h-[22rem] w-full max-w-lg sm:h-[26rem]">
          <img
            src={branchAnalytics}
            alt="Branch comparison and revenue dashboard"
            className="absolute right-0 top-4 w-[88%] rounded-2xl border border-[var(--border)] bg-white shadow-2xl"
            style={{ transform: 'rotate(3deg)' }}
          />
          <img
            src={whatsappChat}
            alt="RestoAI WhatsApp ordering conversation"
            className="absolute bottom-0 left-0 w-[70%] rounded-2xl border border-[var(--border)] bg-white shadow-2xl"
            style={{ transform: 'rotate(-4deg)' }}
          />
        </ScrollReveal>
      </div>
    </section>
  );
}

// Product facts only — no customer/usage numbers exist yet (owner decision).
function StatBar({ pricing }) {
  const starter = pricing ? pricing.plans.find((p) => p.id === 'starter') : null;
  const stats = [
    { value: '10', label: 'AI agents working behind the scenes' },
    { value: '0%', label: 'commission on every order, always' },
    { value: '1', label: 'order queue for WhatsApp, storefront & dine-in' },
    starter && { value: formatRs(starter.monthly), label: 'per month — where plans start' },
  ].filter(Boolean);
  return (
    <section className="border-y border-[var(--border)] bg-[var(--surface-2)]">
      <div className={`mx-auto grid max-w-6xl grid-cols-2 gap-y-8 px-4 py-10 sm:px-6 ${stats.length === 4 ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
        {stats.map((s, i) => (
          <ScrollReveal key={s.label} as="div" delay={i * 0.09} className="px-2 text-center">
            <p className="text-3xl font-extrabold tracking-tight text-[var(--text-primary)] sm:text-4xl">{s.value}</p>
            <p className="mx-auto mt-1 max-w-[12rem] text-xs text-[var(--text-secondary)] sm:text-sm">{s.label}</p>
          </ScrollReveal>
        ))}
      </div>
    </section>
  );
}

// Sticky stacking cards (impl-22 v5): each feature is its own card that pins
// below the nav while the next one slides up and covers it. The pill row is a
// sticky set of scroll shortcuts whose highlight follows the pinned card.
const NAV_H = 70;        // sticky site header
const PILLS_H = 74;      // sticky pill row
const STACK_TOP = NAV_H + PILLS_H;
const PEEK = 14;         // each pinned card sits a little lower so earlier edges peek out

function useMediaQuery(query) {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    setMatch(mq.matches);
    const h = (e) => setMatch(e.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [query]);
  return match;
}

function FeatureCard({ f, index, stacked, cardRef }) {
  const shots = f.shots || [];
  const [shotIdx, setShotIdx] = useState(0);
  const shot = shots[shotIdx];
  return (
    <div
      ref={cardRef}
      className={`border-t border-[var(--border)] bg-[var(--surface-2)] ${
        stacked
          ? 'sticky min-h-[calc(130vh-9rem)] rounded-t-3xl shadow-[0_-10px_30px_rgba(0,0,0,0.10)]'
          : 'mb-6 rounded-3xl'
      }`}
      style={stacked ? { top: STACK_TOP + index * PEEK, zIndex: index + 1 } : undefined}
    >
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-8 lg:grid-cols-2 lg:items-start">
        <div className="lg:pt-6">
          <span className="text-sm font-bold tracking-wide text-brand-600">{f.n}</span>
          <h3 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">{f.title}</h3>
          <p className="mt-3 text-[var(--text-secondary)]">{f.subtitle}</p>
          <p className="mt-6 text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">What's included</p>
          <ul className="mt-3 space-y-2.5">
            {f.included.map((item, i) => (
              <ScrollReveal key={item} as="li" delay={i * 0.09} className="flex items-start gap-2.5 text-sm text-[var(--text-primary)]">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> {item}
              </ScrollReveal>
            ))}
          </ul>
          {f.id === 'ordering' && (
            <p className="mt-4 text-sm text-[var(--text-secondary)]">
              Plus in-store token &amp; menu boards for the counter — <ScreenshotLink src={tokenBoard} />
            </p>
          )}
          <Link to="/login?mode=register" className="btn-primary mt-7 inline-flex px-5 py-2.5">
            Start free trial <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {/* one fixed frame for every card (v4 Part 4 containment) */}
        <div className="flex h-[24rem] flex-col rounded-3xl bg-gradient-to-br from-amber-100 via-orange-50 to-brand-100 p-5 dark:from-amber-900/30 dark:via-stone-900 dark:to-brand-900/30 sm:h-[27rem] sm:p-6">
          {f.custom === 'ai-team' ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <AITeamSection compact />
            </div>
          ) : (
            <>
              <div className="flex min-h-0 flex-1 items-center justify-center">
                <img
                  key={shot.src}
                  src={shot.src}
                  alt={shot.alt}
                  className="max-h-full max-w-full rounded-xl border border-[var(--border)] bg-white object-contain shadow-2xl"
                />
              </div>
              {shots.length > 1 && (
                <div className="mt-4 flex shrink-0 justify-center gap-2">
                  {shots.map((s, i) => (
                    <button
                      key={s.src}
                      onClick={() => setShotIdx(i)}
                      aria-label={`Show: ${s.alt}`}
                      className={`h-12 w-16 overflow-hidden rounded-md border-2 bg-white transition ${i === shotIdx ? 'border-brand-600' : 'border-transparent opacity-70 hover:opacity-100'}`}
                    >
                      <img src={s.src} alt="" className="h-full w-full object-cover object-top" />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Features() {
  const reduceMotion = useReducedMotion();
  const desktop = useMediaQuery('(min-width: 1024px)');
  // Below lg a card is taller than the viewport, so pinning would hide its
  // bottom — those widths (and reduced-motion) get a plain stacked flow.
  const stacked = desktop && !reduceMotion;
  const [activeIdx, setActiveIdx] = useState(0);
  const stackRef = useRef(null);
  const cardRefs = useRef([]);

  useEffect(() => {
    let raf = 0;
    function update() {
      let idx = 0;
      cardRefs.current.forEach((el, i) => {
        if (!el) return;
        const threshold = stacked ? STACK_TOP + i * PEEK + 60 : STACK_TOP + 40;
        if (el.getBoundingClientRect().top <= threshold) idx = i;
      });
      setActiveIdx(idx);
    }
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
  }, [stacked]);

  function goTo(i) {
    const stackTop = stackRef.current.getBoundingClientRect().top + window.scrollY;
    let target;
    if (stacked) {
      // natural (unpinned) top of card i, minus where it pins
      let y = stackTop;
      for (let j = 0; j < i; j += 1) y += cardRefs.current[j].offsetHeight;
      target = y - (STACK_TOP + i * PEEK);
    } else {
      target = cardRefs.current[i].getBoundingClientRect().top + window.scrollY - STACK_TOP - 8;
    }
    window.scrollTo({ top: Math.max(0, target), behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  // Old section anchors (#ordering, #ai-team, ...) scroll to the matching card.
  useEffect(() => {
    function fromHash() {
      const i = FEATURES.findIndex((f) => f.id === window.location.hash.slice(1));
      if (i >= 0) setTimeout(() => goTo(i), 50);
    }
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  });

  return (
    <section>
      <div className="mx-auto max-w-6xl px-4 pt-16 sm:px-6 sm:pt-24">
        <ScrollReveal as="div" className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-semibold uppercase tracking-wide text-brand-600">Features</span>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Every channel, one system</h2>
        </ScrollReveal>
      </div>

      {/* sticky pill row: scroll shortcuts that follow the pinned card */}
      <div className="sticky z-30 bg-[var(--surface-1)]/95 py-3 backdrop-blur" style={{ top: NAV_H }}>
        <div className="overflow-x-auto px-4">
          <div role="tablist" aria-label="Features" className="mx-auto flex w-max gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-2)] p-1.5 shadow-sm">
            {FEATURES.map((f, i) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={i === activeIdx}
                onClick={() => goTo(i)}
                className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors duration-150 ${
                  i === activeIdx ? 'bg-brand-600 text-white shadow' : 'text-[var(--text-secondary)] hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)]'
                }`}
              >
                {f.tab}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div id="features" ref={stackRef} className={`mx-auto mt-4 max-w-[90rem] ${stacked ? '' : 'px-4 sm:px-6'}`}>
        {FEATURES.map((f, i) => (
          <FeatureCard key={f.id} f={f} index={i} stacked={stacked} cardRef={(el) => { cardRefs.current[i] = el; }} />
        ))}
      </div>

      {/* the ten-agent strip belongs to AI Team but is too tall to live in a pinned card */}
      <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-24">
        <AgentStrip />
      </div>
    </section>
  );
}

function RolesSection() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--surface-3)]">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <ScrollReveal as="div" className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">One system, every role</h2>
          <p className="mt-3 text-[var(--text-secondary)]">
            Owners, staff, and riders each get a login built for how they actually work — all on one platform.
          </p>
        </ScrollReveal>
        <div className="mt-12 grid gap-6 sm:grid-cols-3">
          {ROLES.map((r, i) => (
            <ScrollReveal key={r.title} as="div" className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-6 shadow-sm" delay={i * 0.08}>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30">
                <r.icon className="h-5 w-5 text-brand-600" />
              </div>
              <h3 className="mt-4 text-base font-semibold">{r.title}</h3>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">{r.desc}</p>
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
        <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Why this exists</h2>
        <p className="mt-3 text-[var(--text-secondary)]">
          Pakistani restaurants have absorbed aggregator commissions and platform-side failures for years —
          this isn't a hypothetical pain point.
        </p>
      </ScrollReveal>
      <div className="mt-12 grid gap-6 sm:grid-cols-3">
        {MARKET_FACTS.map((f, i) => (
          <ScrollReveal key={f.label} as="div" className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-6 text-center shadow-sm" delay={i * 0.08}>
            <f.icon className="mx-auto h-6 w-6 text-brand-600" />
            <p className="mt-3 text-3xl font-extrabold text-[var(--text-primary)]">{f.stat}</p>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">{f.label}</p>
          </ScrollReveal>
        ))}
      </div>
      <ScrollReveal as="div" delay={0.2} className="mt-6 rounded-2xl bg-[var(--surface-3)] p-6 text-center text-sm text-[var(--text-secondary)]">
        A 2020 Karachi restaurant boycott followed a commission jump from 18% to 35% — a documented, litigated
        pain point owners still reference today, not a marketing talking point.
      </ScrollReveal>
    </section>
  );
}

function TrustSection() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--surface-3)]">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="grid gap-6 sm:grid-cols-3">
          {TRUST.map((t, i) => (
            <ScrollReveal key={t.title} as="div" delay={i * 0.08} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-6 shadow-sm">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30">
                <t.icon className="h-5 w-5 text-brand-600" />
              </div>
              <h3 className="mt-4 text-base font-semibold">{t.title}</h3>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">{t.desc}</p>
            </ScrollReveal>
          ))}
        </div>
        <ScrollReveal as="div" delay={0.2} className="mt-6 flex items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-5 text-sm text-[var(--text-secondary)]">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
          <p>
            Built with care for your data: every restaurant's data is kept separate from every other restaurant's,
            WhatsApp credentials are stored encrypted, and money-moving actions like refunds are limited to owners and managers.
          </p>
        </ScrollReveal>
      </div>
    </section>
  );
}

// Dark, tabbed pricing (impl-22 v3 layout) over the impl-32 plans. Prices come
// from GET /api/billing/plans — the same numbers Plan & Billing charges — and
// the chosen tier, branch count and Agent Pack carry through signup.
const TIER_FEATURES = {
  starter: ['WhatsApp AI ordering', 'Your own ordering website', 'Dine-in QR, reservations, loyalty & reviews', 'POS billing, basic inventory'],
  growth: ['Everything in Starter', 'Branch analytics & benchmarking', 'CRM, coupons, referrals & campaigns', 'Multi-branch staff permissions'],
  enterprise: ['Everything in Growth', 'Dedicated onboarding', 'Priority support', 'Volume pricing beyond Growth'],
};
const TIER_BLURB = {
  starter: 'Solo restaurant, one branch',
  growth: (p) => `${p.min_branches}–${p.max_branches} branches`,
  enterprise: (p) => `${p.min_branches}+ branches and chains`,
};
const PRICING_TRUST = [
  { icon: BadgePercent, label: '0% commission, always' },
  { icon: CalendarX, label: 'Cancel anytime' },
  { icon: Landmark, label: 'Billed monthly by bank transfer' },
];

function Pricing({ pricing }) {
  const [tierId, setTierId] = useState('growth');
  const [starterPack, setStarterPack] = useState(false);
  const [growthBranches, setGrowthBranches] = useState(3);

  const tier = pricing ? pricing.plans.find((p) => p.id === tierId) : null;
  const blurb = (p) => (typeof TIER_BLURB[p.id] === 'function' ? TIER_BLURB[p.id](p) : TIER_BLURB[p.id]);

  let price = null;
  let unit = '';
  let total = null;
  let cta = null;
  if (tier?.id === 'starter') {
    price = formatRs(tier.monthly); unit = '/month';
    total = monthlyAmount(pricing, { plan: 'starter', branches: 1, pack: starterPack });
    cta = { to: `/login?mode=register&plan=starter&pack=${starterPack ? 1 : 0}`, label: 'Start with Starter' };
  } else if (tier?.id === 'growth') {
    price = formatRs(tier.per_branch); unit = '/branch/month';
    total = monthlyAmount(pricing, { plan: 'growth', branches: growthBranches, pack: true });
    cta = { to: `/login?mode=register&plan=growth&branches=${growthBranches}&pack=1`, label: 'Start with Growth' };
  } else if (tier) {
    price = 'Custom';
    cta = { href: '#contact', label: "Let's talk" };
  }

  return (
    <section id="pricing" className="scroll-mt-16 bg-gray-950 text-gray-100">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <ScrollReveal as="div" className="text-center">
          <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">Flat monthly pricing. Never a commission.</h2>
          <p className="mx-auto mt-3 max-w-xl text-gray-400">
            Pick the plan that fits your restaurant. 0% commission on every order, always — and WhatsApp AI ordering is included on every plan.
          </p>
        </ScrollReveal>

        {pricing === false && (
          <p className="mt-10 text-center text-sm text-gray-400">
            Pricing couldn't load right now — <a href="#contact" className="font-medium text-brand-500 underline">get in touch</a> and we'll send it over.
          </p>
        )}

        {tier && (
          <ScrollReveal as="div" className="mx-auto mt-12 grid max-w-4xl gap-5 md:grid-cols-[15rem_1fr]">
            {/* vertical tier selector (horizontal on phones) */}
            <div role="tablist" aria-label="Plans" className="grid grid-cols-3 gap-2 md:grid-cols-1 md:content-start">
              {pricing.plans.map((p) => (
                <button
                  key={p.id}
                  role="tab"
                  aria-selected={p.id === tierId}
                  onClick={() => setTierId(p.id)}
                  className={`rounded-xl border px-3 py-3 text-left transition md:px-4 md:py-4 ${
                    p.id === tierId ? 'border-brand-500 bg-brand-600/15 text-white' : 'border-gray-800 bg-gray-900 text-gray-400 hover:border-gray-700 hover:text-gray-200'
                  }`}
                >
                  <span className="block text-sm font-semibold md:text-base">{p.name}</span>
                  <span className="mt-0.5 hidden text-xs text-gray-400 md:block">{blurb(p)}</span>
                </button>
              ))}
            </div>

            {/* detail card */}
            <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6 sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wide text-brand-500">{tier.name}</p>
                  <p className="mt-1 text-sm text-gray-400">{blurb(tier)}</p>
                </div>
              </div>
              <p className="mt-5 flex items-baseline gap-1">
                <span className="text-5xl font-extrabold tracking-tight text-white">{price}</span>
                <span className="text-sm text-gray-400">{unit}</span>
              </p>

              <div className="mt-5 rounded-xl bg-gray-800/60 px-4 py-3 text-sm">
                {tier.agent_pack_included ? (
                  <p className="flex items-center justify-between gap-2">
                    <span className="text-gray-300">AI Agent Pack</span>
                    <span className="font-semibold text-brand-400">Included</span>
                  </p>
                ) : (
                  <label className="flex cursor-pointer items-start gap-2">
                    <input type="checkbox" className="mt-1 h-4 w-4" checked={starterPack} onChange={(e) => setStarterPack(e.target.checked)} />
                    <span>
                      <span className="font-medium text-white">+ {formatRs(pricing.agent_pack_monthly)}/month AI Agent Pack</span>
                      <span className="block text-xs text-gray-400">Unlock the full 10-agent automation system</span>
                    </span>
                  </label>
                )}
              </div>

              {tier.id === 'growth' && (
                <label className="mt-4 flex items-center justify-between gap-2 text-sm text-gray-300">
                  Branches
                  <select className="w-20 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-white" value={growthBranches} onChange={(e) => setGrowthBranches(Number(e.target.value))}>
                    {Array.from({ length: tier.max_branches - tier.min_branches + 1 }, (_, i) => tier.min_branches + i).map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
              )}
              {total != null && (
                <p className="mt-4 text-sm text-gray-300">
                  Total: <span className="font-semibold text-white">{formatRs(total)}/month</span>
                </p>
              )}

              <ul className="mt-6 grid gap-2.5 text-sm text-gray-300 sm:grid-cols-2">
                {TIER_FEATURES[tier.id].map((li) => (
                  <li key={li} className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" /> {li}</li>
                ))}
              </ul>

              {cta.to ? (
                <Link to={cta.to} className="btn-primary mt-8 w-full justify-center py-3 text-base">{cta.label}</Link>
              ) : (
                <a href={cta.href} className="mt-8 flex w-full items-center justify-center rounded-lg border border-gray-600 py-3 text-base font-medium text-white hover:bg-gray-800">{cta.label}</a>
              )}
            </div>
          </ScrollReveal>
        )}

        <div className="mx-auto mt-10 flex max-w-4xl flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-gray-400">
          {PRICING_TRUST.map((t) => (
            <span key={t.label} className="inline-flex items-center gap-2"><t.icon className="h-4 w-4 text-brand-500" /> {t.label}</span>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-gray-500">Prices in PKR, billed monthly by bank transfer. Cancel anytime.</p>
      </div>
    </section>
  );
}

// Full-bleed closing CTA banner (with the existing contact form), then footer.
function FinalCta() {
  return (
    <section id="contact" className="scroll-mt-16 bg-brand-700 text-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-2 lg:items-center">
        <ScrollReveal as="div" className="text-center lg:text-left">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Ready to keep more of every order?</h2>
          <p className="mt-3 text-brand-100">Start free, or leave your details and we'll reach out.</p>
          <div className="mt-8 flex justify-center lg:justify-start">
            <Link to="/login?mode=register" className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-base font-semibold text-brand-700 shadow-lg hover:bg-brand-50">
              Start free trial <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </ScrollReveal>
        <ScrollReveal as="div" delay={0.1} className="mx-auto w-full max-w-md text-[var(--text-primary)]">
          <ContactForm />
        </ScrollReveal>
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
        <p className="text-sm font-medium text-[var(--text-primary)]">Thanks — we'll be in touch soon.</p>
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

// Four columns, real links only (every one points at an existing section or page).
const FOOTER_COLUMNS = [
  { title: 'Features', links: FEATURES.map((f) => ({ label: f.title, href: `#${f.id}` })) },
  { title: 'Pricing', links: [{ label: 'Plans', href: '#pricing' }, { label: 'Start free trial', to: '/login?mode=register' }] },
  { title: 'Log in', links: [{ label: 'Owner login', to: '/login' }, { label: 'Staff login', to: '/login' }, { label: 'Rider login', to: '/rider/login' }] },
  { title: 'Company', links: [{ label: 'Contact', href: '#contact' }, { label: 'Terms', to: '/terms' }, { label: 'Privacy', to: '/privacy' }] },
];

function Footer() {
  return (
    <footer className="border-t border-[var(--border)] bg-[var(--surface-2)]">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <div className="flex items-center gap-2">
              <ChefHat className="h-5 w-5 text-brand-600" />
              <span className="font-bold text-[var(--text-primary)]">RestoAI</span>
            </div>
            <p className="mt-3 max-w-xs text-sm text-[var(--text-secondary)]">Built for Pakistani restaurants. Zero commission, always.</p>
          </div>
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="text-sm font-semibold text-[var(--text-primary)]">{col.title}</p>
              <ul className="mt-3 space-y-2 text-sm text-[var(--text-secondary)]">
                {col.links.map((l) => (
                  <li key={l.label + (l.to || l.href)}>
                    {l.to
                      ? <Link to={l.to} className="hover:text-[var(--text-primary)]">{l.label}</Link>
                      : <a href={l.href} className="hover:text-[var(--text-primary)]">{l.label}</a>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 border-t border-[var(--border)] pt-6 text-xs text-[var(--text-tertiary)]">
          © {new Date().getFullYear()} RestoAI
        </div>
      </div>
    </footer>
  );
}
