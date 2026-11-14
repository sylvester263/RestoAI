import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useInView, useReducedMotion, useScroll, useSpring } from 'framer-motion';
import { api, marketingApi } from '../../lib/api';
import { monthlyAmount, formatRs } from '../../lib/pricing';
import {
  ChefHat, ArrowRight, CheckCircle2, Loader2, Menu as MenuIcon, X, ChevronDown,
  ShieldCheck, Users, Bike, BadgeCheck, MessageCircle, Wand2, LifeBuoy, Lock,
  BadgePercent, CalendarX, Landmark,
} from 'lucide-react';
import ScrollReveal from './ScrollReveal';
import HeroChatDemo from './landing/HeroChatDemo';
import CommissionCalculator from './landing/CommissionCalculator';
import FeatureTabs, { FEATURES } from './landing/FeatureTabs';
import AgentsGrid from './landing/AgentsGrid';
import useCountUp from './landing/useCountUp';

const WHATSAPP_URL = 'https://wa.me/923404548850?text=Assalam%20o%20Alaikum%2C%20I%20would%20like%20a%20RestoAI%20demo.';
const META_BADGE = 'Approved Meta Tech Provider';
const EASE = [0.16, 1, 0.3, 1];

const ROLES = [
  { icon: ShieldCheck, title: 'Owners get full command', desc: 'Every branch, every number, every setting: menu, staff, pricing, and business insights in one place.' },
  { icon: Users, title: 'Staff get their branch', desc: 'Kitchen, orders, and inventory for their own shift, with permissions the owner controls, nothing more.' },
  { icon: Bike, title: 'Riders get their deliveries', desc: 'A simple phone and PIN login built for the road. No password to remember, no app to install.' },
];

const TRUST = [
  { icon: MessageCircle, title: 'Easy onboarding', desc: "Connect your WhatsApp number through Meta's official Embedded Signup. RestoAI is an approved Meta Tech Provider." },
  { icon: Wand2, title: 'Guided setup', desc: 'Import your menu from a photo, pick a website template, and invite your staff, all from the same dashboard.' },
  { icon: LifeBuoy, title: 'Real support', desc: "Questions go to a person at SylJo Tech. Leave your details below and we'll reach out." },
];

const TIER_FEATURES = {
  starter: ['WhatsApp AI ordering', 'Your own ordering website', 'Dine-in QR, reservations, loyalty and reviews', 'POS billing, basic inventory'],
  growth: ['Everything in Starter', 'Branch analytics and benchmarking', 'CRM, coupons, referrals and campaigns', 'Multi-branch staff permissions'],
  enterprise: ['Everything in Growth', 'Dedicated onboarding', 'Priority support', 'Volume pricing beyond Growth'],
};
const TIER_BLURB = {
  starter: 'Solo restaurant, one branch',
  growth: (p) => `${p.min_branches}-${p.max_branches} branches`,
  enterprise: (p) => `${p.min_branches}+ branches and chains`,
};
const PRICING_TRUST = [
  { icon: BadgePercent, label: '0% commission, always' },
  { icon: CalendarX, label: 'Cancel anytime' },
  { icon: Landmark, label: 'Billed monthly by bank transfer' },
];

function useMarketingSeo() {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'RestoAI: every order on one screen. Zero commission.';

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
      'RestoAI is an AI-native restaurant operations platform for Pakistan: WhatsApp ordering in Roman Urdu, your own branded storefront, dine-in QR, POS and kitchen display, with zero commission on every order.',
    );

    return () => {
      document.title = prevTitle;
      if (created) meta.remove();
      else if (prevContent !== null) meta.setAttribute('content', prevContent);
    };
  }, []);
}

const label = 'text-[12px] font-semibold uppercase tracking-[1.5px]';

function SectionHead({ eyebrow, children, dark = false, className = '' }) {
  return (
    <ScrollReveal as="div" className={`max-w-3xl ${className}`}>
      <p className={`${label} ${dark ? 'text-[#4ade80]' : 'text-[#15803d]'}`}>{eyebrow}</p>
      <h2 className={`mt-3 font-display text-4xl font-black leading-[0.95] tracking-[-2px] sm:text-6xl sm:tracking-[-3px] ${dark ? 'text-white' : 'text-[#111]'}`}>
        {children}<span className="text-[#22c55e]">.</span>
      </h2>
    </ScrollReveal>
  );
}

export default function LandingPage() {
  useMarketingSeo();
  const [pricing, setPricing] = useState(null);

  useEffect(() => {
    api.getBillingPlans().then(setPricing).catch(() => setPricing(false));
  }, []);

  const starterMonthly = pricing ? pricing.plans.find((p) => p.id === 'starter')?.monthly ?? null : null;

  return (
    <div className="min-h-screen bg-white font-sans text-[#111]">
      <Header />
      <Hero />
      <ProofBand />

      <section id="features" className="scroll-mt-20 mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <SectionHead eyebrow="What it does">Every channel, one system</SectionHead>
        <div className="mt-12"><FeatureTabs /></div>
      </section>

      <section id="savings" className="scroll-mt-20 bg-[#111] text-white">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <SectionHead eyebrow="Run your own numbers" dark>What commission costs you</SectionHead>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-[#bbb]">Move the sliders to match your restaurant. Orders on WhatsApp and your own storefront carry 0% commission.</p>
          <ScrollReveal as="div" className="mt-10"><CommissionCalculator planMonthly={starterMonthly} /></ScrollReveal>
        </div>
      </section>

      <section id="agents" className="scroll-mt-20 bg-[#f4f4f4]">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <SectionHead eyebrow="Your AI team">10 agents on shift</SectionHead>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-[#555]">Not a chatbot. RestoAI holds a real conversation, corrects mid-order, and confirms before it commits. Tap an agent to see what it does.</p>
          <div className="mt-10"><AgentsGrid /></div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <SectionHead eyebrow="One system, every role">Built for how your team works</SectionHead>
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {ROLES.map((r, i) => (
            <ScrollReveal key={r.title} as="div" delay={i * 0.08} className="border-t-[6px] border-[#15803d] pt-5">
              <r.icon className="h-6 w-6 text-[#15803d]" aria-hidden="true" />
              <h3 className="mt-4 font-display text-2xl font-extrabold tracking-tight">{r.title}</h3>
              <p className="mt-2 leading-relaxed text-[#555]">{r.desc}</p>
            </ScrollReveal>
          ))}
        </div>
      </section>

      <section className="border-y border-[#d9d9d9] bg-[#f4f4f4]">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <SectionHead eyebrow="Easy onboarding">Live in days, not months</SectionHead>
          <div className="mt-12 grid gap-px bg-[#d9d9d9] md:grid-cols-3">
            {TRUST.map((t, i) => (
              <ScrollReveal key={t.title} as="div" delay={i * 0.08} className="bg-[#f4f4f4] pr-6 md:px-6 md:first:pl-0">
                <p className="font-display text-3xl font-black text-[#15803d]">{String(i + 1).padStart(2, '0')}</p>
                <h3 className="mt-3 font-display text-xl font-extrabold tracking-tight">{t.title}</h3>
                <p className="mt-2 leading-relaxed text-[#555]">{t.desc}</p>
              </ScrollReveal>
            ))}
          </div>
          <ScrollReveal as="div" delay={0.2} className="mt-10 flex items-start gap-3 text-sm text-[#555]">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[#15803d]" aria-hidden="true" />
            <p>
              Every restaurant's data is kept separate from every other restaurant's, WhatsApp credentials are stored encrypted,
              and money-moving actions like refunds are limited to owners and managers.
            </p>
          </ScrollReveal>
        </div>
      </section>

      <Pricing pricing={pricing} />
      <FinalCta />
      <Footer />
    </div>
  );
}

function LoginDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex min-h-[44px] items-center gap-1 px-3 text-sm font-semibold text-[#111] hover:text-[#15803d]">
        Log in <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full z-50 mt-1 w-44 border border-[#d9d9d9] bg-white py-1 shadow-lg"
          >
            <Link to="/login" className="block px-4 py-3 text-sm font-medium text-[#111] hover:bg-[#f4f4f4]" onClick={() => setOpen(false)}>Owner login</Link>
            <Link to="/login" className="block px-4 py-3 text-sm font-medium text-[#111] hover:bg-[#f4f4f4]" onClick={() => setOpen(false)}>Staff login</Link>
            <Link to="/rider/login" className="block px-4 py-3 text-sm font-medium text-[#111] hover:bg-[#f4f4f4]" onClick={() => setOpen(false)}>Rider login</Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 28, restDelta: 0.001 });

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const links = [['Features', '#features'], ['Savings', '#savings'], ['AI team', '#agents'], ['Pricing', '#pricing']];

  return (
    <header className={`sticky top-0 z-40 bg-white/95 backdrop-blur transition-shadow ${scrolled ? 'shadow-[0_1px_0_#111]' : 'border-b-2 border-[#111]'}`}>
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <a href="#top" className="flex items-center gap-2" aria-label="RestoAI home">
          <span className="flex h-9 w-9 items-center justify-center bg-[#15803d] text-white"><ChefHat className="h-5 w-5" aria-hidden="true" /></span>
          <span className="font-display text-2xl font-black tracking-[-1px]">RestoAI<span className="text-[#22c55e]">.</span></span>
        </a>

        <nav className="hidden items-center gap-6 md:flex" aria-label="Primary">
          {links.map(([t, h]) => (
            <a key={h} href={h} className="inline-flex min-h-[44px] items-center text-sm font-semibold text-[#555] transition-colors hover:text-[#111]">{t}</a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <LoginDropdown />
          <a href="#contact" className="inline-flex min-h-[44px] items-center border-2 border-[#111] px-4 text-sm font-bold text-[#111] transition-colors hover:bg-[#111] hover:text-white">Book a demo</a>
          <Link to="/login?mode=register" className="inline-flex min-h-[44px] items-center bg-[#15803d] px-4 text-sm font-bold text-white transition-colors hover:bg-[#111]">Start free trial</Link>
        </div>

        <button type="button" className="flex h-11 w-11 items-center justify-center md:hidden" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu" aria-expanded={menuOpen}>
          {menuOpen ? <X className="h-6 w-6" /> : <MenuIcon className="h-6 w-6" />}
        </button>
      </div>

      <AnimatePresence>
        {menuOpen && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: EASE }} className="overflow-hidden border-t border-[#d9d9d9] md:hidden">
            <div className="space-y-1 px-4 py-4">
              {links.map(([t, h]) => (
                <a key={h} href={h} onClick={() => setMenuOpen(false)} className="flex min-h-[44px] items-center text-base font-semibold text-[#111]">{t}</a>
              ))}
              <div className="grid gap-2 pt-3">
                <Link to="/login" className="flex min-h-[44px] items-center justify-center border-2 border-[#111] text-sm font-bold">Owner and staff login</Link>
                <Link to="/rider/login" className="flex min-h-[44px] items-center justify-center border-2 border-[#111] text-sm font-bold">Rider login</Link>
                <Link to="/login?mode=register" className="flex min-h-[44px] items-center justify-center bg-[#15803d] text-sm font-bold text-white">Start free trial</Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <motion.div style={{ scaleX: progress }} className="h-[3px] origin-left bg-[#22c55e]" aria-hidden="true" />
    </header>
  );
}

const HEADLINE = [['Every', 'order,'], ['on', 'one', 'screen']];

function Hero() {
  const reduce = useReducedMotion();
  let wordIndex = 0;

  return (
    <section id="top" className="relative overflow-hidden">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[1fr_1.05fr]">
        <div>
          <motion.p initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }} className={`${label} flex items-center gap-2 text-[#15803d]`}>
            <BadgeCheck className="h-4 w-4" aria-hidden="true" /> {META_BADGE}
          </motion.p>
          <h1 className="mt-5 font-display text-[3.25rem] font-black leading-[0.92] tracking-[-2.5px] sm:text-7xl sm:tracking-[-4px]">
            {HEADLINE.map((line, li) => (
              <span key={li} className="block">
                {line.map((w, wi) => {
                  const d = wordIndex++ * 0.09;
                  const last = li === HEADLINE.length - 1 && wi === line.length - 1;
                  return (
                    <span key={w + li} className={`${last ? '' : 'mr-[0.22em]'} inline-block overflow-hidden align-bottom`}>
                      <motion.span
                        className="inline-block"
                        initial={reduce ? false : { y: '110%' }}
                        animate={{ y: 0 }}
                        transition={{ duration: 0.7, delay: 0.1 + d, ease: EASE }}
                      >
                        {w}{last && <span className="text-[#22c55e]">.</span>}
                      </motion.span>
                    </span>
                  );
                })}
              </span>
            ))}
          </h1>
          <motion.p initial={reduce ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.6, ease: EASE }} className="mt-6 max-w-xl text-lg leading-relaxed text-[#333] sm:text-xl">
            RestoAI reads your WhatsApp orders in Roman Urdu, sends them to your kitchen, and keeps billing and stock in one place. Zero commission on every order.
          </motion.p>
          <motion.div initial={reduce ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.75, ease: EASE }} className="mt-8 flex flex-wrap gap-3">
            <Link to="/login?mode=register" className="group inline-flex min-h-[52px] items-center gap-2 bg-[#15803d] px-7 text-base font-bold text-white transition-colors hover:bg-[#111]">
              Start free trial <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
            </Link>
            <a href="#contact" className="inline-flex min-h-[52px] items-center border-2 border-[#111] px-7 text-base font-bold text-[#111] transition-colors hover:bg-[#111] hover:text-white">Book a demo</a>
          </motion.div>
          <p className="mt-4 text-sm text-[#555]">A SylJo Tech product. Flat monthly plans, no long contract.</p>
        </div>

        <motion.div initial={reduce ? false : { opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.35, ease: EASE }}>
          <HeroChatDemo />
        </motion.div>
      </div>
    </section>
  );
}

function ProofBand() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const zero = useCountUp(0, { active: inView });
  const agents = useCountUp(10, { active: inView });
  const queue = useCountUp(1, { active: inView });

  return (
    <section ref={ref} className="bg-[#111] text-white" aria-label="RestoAI at a glance">
      <div className="mx-auto grid max-w-6xl gap-px px-4 py-10 sm:px-6 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [`${Math.round(zero)}%`, 'commission on every order, always'],
          [String(Math.round(agents)), 'AI agents working behind the scenes'],
          [String(Math.round(queue)), 'order queue for WhatsApp, storefront and dine-in'],
        ].map(([n, t]) => (
          <div key={t} className="py-4 lg:pr-8">
            <p className="font-display text-5xl font-black tracking-[-2px] text-[#4ade80]">{n}</p>
            <p className="mt-1 text-sm text-[#bbb]">{t}</p>
          </div>
        ))}
        <div className="py-4">
          <p className="font-display text-2xl font-black leading-tight tracking-[-1px]">{META_BADGE}</p>
          <p className="mt-1 text-sm text-[#bbb]">Built on Alibaba Cloud Qwen AI</p>
        </div>
      </div>
    </section>
  );
}

function Pricing({ pricing }) {
  const reduce = useReducedMotion();
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
    price = tier.monthly; unit = '/month';
    total = monthlyAmount(pricing, { plan: 'starter', branches: 1, pack: starterPack });
    cta = { to: `/login?mode=register&plan=starter&pack=${starterPack ? 1 : 0}`, label: 'Start with Starter' };
  } else if (tier?.id === 'growth') {
    price = tier.per_branch; unit = '/branch/month';
    total = monthlyAmount(pricing, { plan: 'growth', branches: growthBranches, pack: true });
    cta = { to: `/login?mode=register&plan=growth&branches=${growthBranches}&pack=1`, label: 'Start with Growth' };
  } else if (tier) {
    cta = { href: '#contact', label: "Let's talk" };
  }

  const shownPrice = useCountUp(typeof price === 'number' ? price : 0, { active: typeof price === 'number', duration: 0.5 });
  const shownTotal = useCountUp(total ?? 0, { active: total != null, duration: 0.5 });

  return (
    <section id="pricing" className="scroll-mt-20 mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
      <SectionHead eyebrow="Pricing, billed monthly">Flat price. Never a commission</SectionHead>
      <p className="mt-5 max-w-2xl text-lg leading-relaxed text-[#555]">Pick the plan that fits your restaurant. 0% commission on every order, always.</p>

      {pricing === false && (
        <p className="mt-10 text-sm text-[#555]">Pricing couldn't load right now. <a href="#contact" className="font-semibold text-[#15803d] underline">Get in touch</a> and we'll send it over.</p>
      )}
      {pricing === null && <div className="mt-10 h-72 animate-pulse bg-[#f4f4f4]" aria-hidden="true" />}

      {tier && (
        <div className="mt-12 grid gap-6 md:grid-cols-[17rem_1fr]">
          <div role="tablist" aria-label="Plans" className="grid grid-cols-3 gap-px bg-[#d9d9d9] md:grid-cols-1 md:content-start">
            {pricing.plans.map((p) => {
              const on = p.id === tierId;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setTierId(p.id)}
                  className={`relative min-h-[64px] px-4 py-4 text-left transition-colors ${on ? 'bg-[#111] text-white' : 'bg-white text-[#111] hover:bg-[#f4f4f4]'}`}
                >
                  {on && !reduce && <motion.span layoutId="plan-mark" className="absolute inset-y-0 left-0 w-1.5 bg-[#22c55e]" />}
                  <span className="block font-display text-lg font-extrabold tracking-tight">{p.name}</span>
                  <span className={`mt-0.5 hidden text-xs md:block ${on ? 'text-[#bbb]' : 'text-[#555]'}`}>{blurb(p)}</span>
                </button>
              );
            })}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={tier.id}
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0 }}
              transition={{ duration: 0.22 }}
              className="border border-[#d9d9d9] bg-white p-6 sm:p-8"
            >
              <p className={`${label} text-[#15803d]`}>{tier.name}</p>
              <p className="mt-1 text-sm text-[#555]">{blurb(tier)}</p>
              <p className="mt-5 flex items-baseline gap-2">
                <span className="font-display text-6xl font-black tracking-[-3px]">{typeof price === 'number' ? formatRs(Math.round(shownPrice)) : 'Custom'}</span>
                <span className="text-sm text-[#555]">{unit}</span>
              </p>

              <div className="mt-6 bg-[#f4f4f4] p-4 text-sm">
                {tier.agent_pack_included ? (
                  <p className="flex items-center justify-between gap-2"><span className="text-[#555]">AI Agent Pack</span><span className="font-bold text-[#15803d]">Included</span></p>
                ) : (
                  <label className="flex min-h-[44px] cursor-pointer items-start gap-3">
                    <input type="checkbox" className="mt-1 h-5 w-5 accent-[#15803d]" checked={starterPack} onChange={(e) => setStarterPack(e.target.checked)} />
                    <span>
                      <span className="font-semibold">+ {formatRs(pricing.agent_pack_monthly)}/month AI Agent Pack</span>
                      <span className="block text-xs text-[#555]">Unlock the full 10-agent automation system</span>
                    </span>
                  </label>
                )}
              </div>

              {tier.id === 'growth' && (
                <div className="mt-5">
                  <div className="flex items-center justify-between text-sm">
                    <label htmlFor="growth-branches" className="font-semibold">Branches</label>
                    <span className="font-display text-xl font-black">{growthBranches}</span>
                  </div>
                  <input
                    id="growth-branches"
                    type="range"
                    min={tier.min_branches}
                    max={tier.max_branches}
                    step={1}
                    value={growthBranches}
                    onChange={(e) => setGrowthBranches(Number(e.target.value))}
                    className="mt-2 h-2 w-full cursor-pointer accent-[#15803d]"
                  />
                </div>
              )}
              {total != null && (
                <p className="mt-5 text-sm text-[#555]">Total: <span className="font-display text-2xl font-black text-[#111]">{formatRs(Math.round(shownTotal))}</span> /month</p>
              )}

              <ul className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
                {TIER_FEATURES[tier.id].map((li) => (
                  <li key={li} className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#15803d]" aria-hidden="true" /> {li}</li>
                ))}
              </ul>

              {cta.to ? (
                <Link to={cta.to} className="mt-8 flex min-h-[52px] w-full items-center justify-center bg-[#15803d] text-base font-bold text-white transition-colors hover:bg-[#111]">{cta.label}</Link>
              ) : (
                <a href={cta.href} className="mt-8 flex min-h-[52px] w-full items-center justify-center border-2 border-[#111] text-base font-bold transition-colors hover:bg-[#111] hover:text-white">{cta.label}</a>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      )}

      <div className="mt-10 flex flex-wrap gap-x-8 gap-y-3 text-sm text-[#555]">
        {PRICING_TRUST.map((t) => (
          <span key={t.label} className="inline-flex items-center gap-2"><t.icon className="h-4 w-4 text-[#15803d]" aria-hidden="true" /> {t.label}</span>
        ))}
      </div>
      <p className="mt-4 text-xs text-[#555]">Prices in PKR, billed monthly by bank transfer. Cancel anytime.</p>
    </section>
  );
}

function FinalCta() {
  return (
    <section id="contact" className="scroll-mt-20 bg-[#15803d] text-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-2 lg:items-center">
        <ScrollReveal as="div">
          <h2 className="font-display text-4xl font-black leading-[0.95] tracking-[-2px] sm:text-6xl sm:tracking-[-3px]">See it with your own menu.</h2>
          <p className="mt-5 max-w-md text-lg leading-relaxed">A 10-minute demo, set up around your restaurant. Message us on WhatsApp, or leave your details and we'll reach out.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="inline-flex min-h-[52px] items-center gap-2 rounded-full bg-[#111] px-7 text-base font-bold text-white transition-colors hover:bg-white hover:text-[#111]">
              <MessageCircle className="h-5 w-5" aria-hidden="true" /> Chat on WhatsApp
            </a>
            <Link to="/login?mode=register" className="inline-flex min-h-[52px] items-center gap-2 border-2 border-white px-7 text-base font-bold transition-colors hover:bg-white hover:text-[#15803d]">
              Start free trial <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          <p className="mt-5 text-sm">+92 340 454 8850 · info@syljotech.com</p>
        </ScrollReveal>
        <ScrollReveal as="div" delay={0.1} className="mx-auto w-full max-w-md text-[#111]">
          <ContactForm />
        </ScrollReveal>
      </div>
    </section>
  );
}

const field = 'w-full border border-[#767676] bg-white px-3 py-3 text-base text-[#111] placeholder:text-[#767676] focus:border-[#15803d] focus:outline-none focus:ring-2 focus:ring-[#15803d]/30';

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
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="bg-white p-8 text-center">
        <CheckCircle2 className="mx-auto mb-2 h-9 w-9 text-[#15803d]" />
        <p className="font-display text-xl font-extrabold">Thanks. We'll be in touch soon.</p>
      </motion.div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 bg-white p-6 sm:p-8">
      <p className="font-display text-xl font-extrabold tracking-tight">Leave your details</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="sr-only">Your name</span><input className={field} placeholder="Your name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
        <label className="block"><span className="sr-only">Email</span><input className={field} type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="sr-only">Restaurant name</span><input className={field} placeholder="Restaurant name" value={form.restaurant} onChange={(e) => setForm({ ...form, restaurant: e.target.value })} /></label>
        <label className="block"><span className="sr-only">Phone</span><input className={field} placeholder="Phone (optional)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
      </div>
      <label className="block"><span className="sr-only">Message</span><textarea className={field} rows={3} placeholder="What would you like to know?" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label>
      {error && <p className="text-sm text-[#b91c1c]" role="alert">{error}</p>}
      <button type="submit" disabled={loading} className="flex min-h-[52px] w-full items-center justify-center bg-[#111] text-base font-bold text-white transition-colors hover:bg-[#15803d] disabled:opacity-70">
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Send'}
      </button>
    </form>
  );
}

const FOOTER_COLUMNS = [
  { title: 'Features', links: FEATURES.map((f) => ({ label: f.title, href: '#features' })) },
  { title: 'Pricing', links: [{ label: 'Plans', href: '#pricing' }, { label: 'Start free trial', to: '/login?mode=register' }] },
  { title: 'Log in', links: [{ label: 'Owner login', to: '/login' }, { label: 'Staff login', to: '/login' }, { label: 'Rider login', to: '/rider/login' }] },
  { title: 'Company', links: [{ label: 'Contact', href: '#contact' }, { label: 'Terms', to: '/terms' }, { label: 'Privacy', to: '/privacy' }] },
];

function Footer() {
  return (
    <footer className="border-t-2 border-[#111] bg-white">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center bg-[#15803d] text-white"><ChefHat className="h-4 w-4" aria-hidden="true" /></span>
              <span className="font-display text-xl font-black tracking-[-1px]">RestoAI<span className="text-[#22c55e]">.</span></span>
            </div>
            <p className="mt-3 max-w-xs text-sm text-[#555]">Built for Pakistani restaurants. Zero commission, always.</p>
            <p className="mt-3 text-sm font-semibold">A SylJo Tech product</p>
          </div>
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.title}>
              <p className={`${label} text-[#111]`}>{col.title}</p>
              <ul className="mt-4 space-y-1 text-sm text-[#555]">
                {col.links.map((l) => (
                  <li key={l.label + (l.to || l.href)}>
                    {l.to
                      ? <Link to={l.to} className="inline-flex min-h-[32px] items-center hover:text-[#111]">{l.label}</Link>
                      : <a href={l.href} className="inline-flex min-h-[32px] items-center hover:text-[#111]">{l.label}</a>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-wrap justify-between gap-2 border-t border-[#d9d9d9] pt-6 text-xs text-[#555]">
          <span>© SylJo Tech 2026</span>
          <span>Lahore, Pakistan</span>
        </div>
      </div>
    </footer>
  );
}
