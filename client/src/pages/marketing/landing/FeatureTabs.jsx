import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import whatsappChat from '../../../assets/marketing/whatsapp-chat.webp';
import publicMenu from '../../../assets/marketing/public-menu.webp';
import checkout from '../../../assets/marketing/checkout.webp';
import tokenBoard from '../../../assets/marketing/token-board.webp';
import posTill from '../../../assets/marketing/pos-till.webp';
import kitchenDisplay from '../../../assets/marketing/kitchen-display.webp';
import inventory from '../../../assets/marketing/inventory.webp';
import branchAnalytics from '../../../assets/marketing/branch-analytics.webp';
import customerProfile from '../../../assets/marketing/customer-profile.webp';
import couponsList from '../../../assets/marketing/coupons-list.webp';
import campaign from '../../../assets/marketing/campaign.webp';
import tenantSite from '../../../assets/marketing/tenant-site.webp';
import askAnything from '../../../assets/marketing/ai-ask-anything.webp';
import agentsControls from '../../../assets/marketing/ai-agents-controls.webp';
import reconciliation from '../../../assets/marketing/ai-reconciliation.webp';

// Copy and screenshots are the existing, approved marketing content.
export const FEATURES = [
  {
    id: 'ordering', title: 'Ordering',
    subtitle: 'WhatsApp, your own storefront, and dine-in. Every order lands in the same queue, no aggregator in between.',
    included: ['WhatsApp AI ordering conversations', 'Your own branded storefront and checkout', 'Dine-in QR ordering', 'In-store token and menu boards for the counter'],
    shots: [
      { src: whatsappChat, label: 'WhatsApp', alt: 'WhatsApp AI ordering conversation, confirmed order' },
      { src: publicMenu, label: 'Storefront', alt: 'RestoAI branded public ordering storefront' },
      { src: checkout, label: 'Checkout', alt: 'Checkout screen on the branded storefront' },
      { src: tokenBoard, label: 'Token board', alt: 'In-store token board for the counter' },
    ],
  },
  {
    id: 'ai-team', title: 'Your AI Team',
    subtitle: "Proactive automation running behind the scenes. You decide what it's allowed to do.",
    included: ['Ask Anything, in English or Urdu', '10 autonomous agents', 'Always watching for payment gaps and abuse', 'One data model across every channel'],
    shots: [
      { src: askAnything, label: 'Ask Anything', alt: "AI Insights answering an owner's question about their top dishes this month" },
      { src: agentsControls, label: 'Agent controls', alt: "Automation controls for RestoAI's background agents" },
      { src: reconciliation, label: 'Reconciliation', alt: 'Payment reconciliation agent flagging an unreconciled order' },
    ],
  },
  {
    id: 'operations', title: 'Run Your Whole Operation',
    subtitle: 'Kitchen display, till, and stock. The tools your shift actually runs on, not a back-office afterthought.',
    included: ['POS billing: tax, split payment, shifts and receipts', 'Live kitchen display board', 'Ingredient-level inventory tracking', 'Multi-branch point of sale'],
    shots: [
      { src: posTill, label: 'POS till', alt: 'POS settling a bill split across cash and card' },
      { src: kitchenDisplay, label: 'Kitchen', alt: 'Live kitchen display board' },
      { src: inventory, label: 'Stock', alt: 'Ingredient-level inventory tracking' },
    ],
  },
  {
    id: 'business', title: 'Know Your Business',
    subtitle: 'Branch comparison, revenue trend, and top sellers. The same-day numbers owners actually check.',
    included: ['Branch comparison', 'Revenue trend', 'Top sellers', 'Cross-branch benchmarking'],
    shots: [{ src: branchAnalytics, label: 'Analytics', alt: 'Branch comparison and revenue dashboard' }],
  },
  {
    id: 'growth', title: 'Grow Your Customers',
    subtitle: 'Profiles, coupons, and campaigns. The tools that bring a customer back without a commission cut.',
    included: ['Customer profiles with order history and tags', 'RFM segments', 'Coupons and a referral program', 'WhatsApp broadcast campaigns'],
    shots: [
      { src: customerProfile, label: 'Customers', alt: 'Customer profile with order history and tags' },
      { src: couponsList, label: 'Coupons', alt: 'Coupons and discount codes list' },
      { src: campaign, label: 'Campaign', alt: 'A sent WhatsApp broadcast campaign' },
    ],
  },
  {
    id: 'website', title: 'Your Own Website',
    subtitle: 'A branded site your customers reach directly, built in the same dashboard and published in minutes.',
    included: ['A branded site your customers reach directly', 'Built in the same dashboard', 'Published in minutes', 'Your own presence, not an aggregator listing'],
    shots: [{ src: tenantSite, label: 'Your site', alt: 'A published restaurant landing page built with RestoAI' }],
  },
];

export default function FeatureTabs() {
  const reduce = useReducedMotion();
  const [activeId, setActiveId] = useState(FEATURES[0].id);
  const [shotIdx, setShotIdx] = useState(0);
  const active = FEATURES.find((f) => f.id === activeId);
  const shot = active.shots[Math.min(shotIdx, active.shots.length - 1)];

  const select = (id) => { setActiveId(id); setShotIdx(0); };

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14">
      <div role="tablist" aria-label="Features" className="border-t-2 border-[#111]">
        {FEATURES.map((f, i) => {
          const on = f.id === activeId;
          return (
            <div key={f.id} className="border-b border-[#d9d9d9]">
              <button
                type="button"
                role="tab"
                id={`tab-${f.id}`}
                aria-selected={on}
                aria-controls={`panel-${f.id}`}
                onClick={() => select(f.id)}
                className="group flex min-h-[44px] w-full items-center gap-4 py-4 text-left"
              >
                <span className="w-10 font-display text-xl font-black text-[#15803d]">{String(i + 1).padStart(2, '0')}</span>
                <span className={`font-display text-xl font-extrabold tracking-tight transition-colors sm:text-2xl ${on ? 'text-[#111]' : 'text-[#555] group-hover:text-[#111]'}`}>{f.title}</span>
              </button>
              <AnimatePresence initial={false}>
                {on && (
                  <motion.div
                    id={`panel-${f.id}`}
                    role="tabpanel"
                    aria-labelledby={`tab-${f.id}`}
                    initial={reduce ? false : { height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={reduce ? undefined : { height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="pb-6 pl-14">
                      <p className="text-base leading-relaxed text-[#555]">{f.subtitle}</p>
                      <ul className="mt-4 grid gap-2 text-sm text-[#111] sm:grid-cols-2">
                        {f.included.map((li) => (
                          <li key={li} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 bg-[#15803d]" aria-hidden="true" />{li}</li>
                        ))}
                      </ul>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      <div className="lg:sticky lg:top-24 lg:self-start">
        <div className="border border-[#d9d9d9] bg-[#f4f4f4] p-3 sm:p-5">
          <div className="flex items-center gap-1.5 pb-3" aria-hidden="true">
            <span className="h-2.5 w-2.5 bg-[#d9d9d9]" /><span className="h-2.5 w-2.5 bg-[#d9d9d9]" /><span className="h-2.5 w-2.5 bg-[#d9d9d9]" />
          </div>
          <div className="relative aspect-[16/10] w-full overflow-hidden bg-white">
            <AnimatePresence mode="wait">
              <motion.img
                key={shot.src}
                src={shot.src}
                alt={shot.alt}
                initial={reduce ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0 }}
                transition={{ duration: 0.22 }}
                className="absolute inset-0 h-full w-full object-contain"
              />
            </AnimatePresence>
          </div>
          {active.shots.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {active.shots.map((s, i) => (
                <button
                  key={s.src}
                  type="button"
                  onClick={() => setShotIdx(i)}
                  aria-pressed={i === shotIdx}
                  className={`min-h-[44px] px-4 text-sm font-semibold transition-colors ${i === shotIdx ? 'bg-[#111] text-white' : 'bg-white text-[#555] hover:text-[#111]'}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
