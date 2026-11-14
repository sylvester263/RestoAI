import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Headphones, MessageCircle, Sunrise, Heart, Bike, Timer, Scale, PackageSearch, Lightbulb, ShieldAlert } from 'lucide-react';

const AGENTS = [
  { icon: Headphones, name: 'Customer Support', desc: 'Escalates complaints to a human, never auto-resolves.' },
  { icon: MessageCircle, name: "Owner's Assistant", desc: "Answers business questions on the owner's own WhatsApp." },
  { icon: Sunrise, name: 'Daily Briefing', desc: 'Proactive WhatsApp summary, every morning.' },
  { icon: Heart, name: 'Win-Back', desc: 'Detects lapsed customers, sends personalized offers.' },
  { icon: Bike, name: 'Rider Dispatch', desc: 'Reasons over load, suggests or auto-assigns.' },
  { icon: Timer, name: 'Live ETA', desc: 'Dynamic prep time from the real kitchen queue.' },
  { icon: Scale, name: 'Reconciliation', desc: 'Cross-checks orders, payments and cash, flags only.' },
  { icon: PackageSearch, name: 'Replenishment', desc: 'Predicts stockouts, suggests purchase orders.' },
  { icon: Lightbulb, name: 'Menu Insight', desc: 'Flags high-margin items to feature, low performers to review.' },
  { icon: ShieldAlert, name: 'Abuse Detection', desc: 'Flags suspicious patterns, never auto-blocks.' },
];

export default function AgentsGrid() {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(null);

  return (
    <ol className="grid gap-px bg-[#d9d9d9] sm:grid-cols-2 lg:grid-cols-5">
      {AGENTS.map((a, i) => {
        const on = open === i;
        return (
          <motion.li
            key={a.name}
            initial={reduce ? false : { opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.45, delay: (i % 5) * 0.07, ease: [0.16, 1, 0.3, 1] }}
            className="bg-white"
          >
            <button
              type="button"
              onClick={() => setOpen(on ? null : i)}
              aria-expanded={on}
              className={`group flex h-full min-h-[150px] w-full flex-col items-start gap-3 p-5 text-left transition-colors duration-200 ${on ? 'bg-[#111] text-white' : 'hover:bg-[#f4f4f4]'}`}
            >
              <span className="flex w-full items-center justify-between">
                <span className={`text-[11px] font-semibold uppercase tracking-[1.5px] ${on ? 'text-[#4ade80]' : 'text-[#15803d]'}`}>{String(i + 1).padStart(2, '0')}</span>
                <a.icon className={`h-5 w-5 transition-transform duration-200 group-hover:scale-110 ${on ? 'text-[#4ade80]' : 'text-[#111]'}`} aria-hidden="true" />
              </span>
              <span className="font-display text-lg font-extrabold leading-tight tracking-tight">{a.name}</span>
              <span className={`text-sm leading-snug ${on ? 'text-[#bbb]' : 'text-[#555]'}`}>{a.desc}</span>
            </button>
          </motion.li>
        );
      })}
    </ol>
  );
}
