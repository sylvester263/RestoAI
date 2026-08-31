import { useState } from 'react';
import { Sparkles, Bot, ShieldAlert, Database, MessageCircle, Globe, QrCode, Receipt } from 'lucide-react';
import ScreenshotFrame from './ScreenshotFrame';
import askAnything from '../../assets/marketing/ai-ask-anything.webp';
import agentsControls from '../../assets/marketing/ai-agents-controls.webp';
import reconciliation from '../../assets/marketing/ai-reconciliation.webp';

const CHANNELS = [
  { icon: MessageCircle, label: 'WhatsApp' },
  { icon: Globe, label: 'Storefront' },
  { icon: QrCode, label: 'Dine-in QR' },
  { icon: Receipt, label: 'POS' },
];

const TABS = [
  {
    id: 'ask',
    label: 'Ask Anything',
    icon: Sparkles,
    description: 'Ask about sales, orders, or customers in plain English or Urdu — Roman script included — and get a straight answer instead of a dashboard to dig through.',
    content: <ScreenshotFrame src={askAnything} alt="AI Insights answering a Roman Urdu sales question" />,
  },
  {
    id: 'agents',
    label: 'Your Agents',
    icon: Bot,
    description: 'Turn on auto-messaging for customers who’ve gone quiet, or hand rider dispatch fully to the assignment agent — you choose how much runs on autopilot versus staying suggest-only.',
    content: <ScreenshotFrame src={agentsControls} alt="Automation controls for RestoAI's background agents" />,
  },
  {
    id: 'watching',
    label: 'Always Watching',
    icon: ShieldAlert,
    description: 'Missing payments and cash discrepancies get flagged automatically, order by order — caught during the shift, not discovered at closing.',
    content: <ScreenshotFrame src={reconciliation} alt="Payment reconciliation agent flagging an unreconciled order" />,
  },
  {
    id: 'data',
    label: 'One Data Model',
    icon: Database,
    description: 'A WhatsApp order, a dine-in QR order, and a walk-in POS order are the same order underneath — one customer record, one menu, one queue, no reconciling four systems by hand.',
    content: (
      <div className="flex h-full flex-col items-center justify-center gap-6 rounded-xl border border-gray-200 bg-white p-8 shadow-lg sm:p-12">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {CHANNELS.map((c) => (
            <div key={c.label} className="flex flex-col items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <c.icon className="h-5 w-5 text-brand-600" />
              <span className="text-xs font-medium text-gray-600">{c.label}</span>
            </div>
          ))}
        </div>
        <div className="h-8 w-px bg-gray-300" />
        <div className="rounded-lg border-2 border-brand-600 bg-brand-50 px-6 py-3 text-sm font-semibold text-brand-700">
          One order queue &middot; one customer record
        </div>
      </div>
    ),
  },
];

export default function AITeamSection() {
  const [activeId, setActiveId] = useState(TABS[0].id);
  const active = TABS.find((t) => t.id === activeId) ?? TABS[0];

  return (
    <div>
      <div className="flex flex-wrap justify-center gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveId(tab.id)}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
              tab.id === activeId
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-gray-200 bg-white text-gray-600 hover:border-brand-300 hover:text-brand-700'
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-8 grid gap-8 sm:grid-cols-2 sm:items-center">
        <p className="text-base text-gray-600 sm:order-2">{active.description}</p>
        <div className="sm:order-1">{active.content}</div>
      </div>
    </div>
  );
}
