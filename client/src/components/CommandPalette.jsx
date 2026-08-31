/**
 * CommandPalette — Cmd+K / Ctrl+K quick navigation.
 *
 * Fuzzy-searches through all app pages and lets the user jump instantly.
 * Supports keyboard navigation (↑/↓/Enter/Escape).
 *
 * Usage: render once in Layout, controlled by `open` + `onClose` props.
 */
import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Receipt, ShoppingBag, UtensilsCrossed, Package,
  Users, QrCode, CalendarCheck, Megaphone, Bike, Globe, MessageCircle,
  BarChart3, Sparkles, UserPlus, Tag, ShieldCheck, ChefHat,
  Search,
} from 'lucide-react';

const ALL_ITEMS = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', group: 'Operations' },
  { to: '/pos', icon: Receipt, label: 'POS', group: 'Operations' },
  { to: '/orders', icon: ShoppingBag, label: 'Orders', group: 'Operations' },
  { to: '/kitchen', icon: ChefHat, label: 'Kitchen Display', group: 'Operations', external: true },
  { to: '/menu', icon: UtensilsCrossed, label: 'Menu', group: 'Menu & Stock' },
  { to: '/inventory', icon: Package, label: 'Inventory', group: 'Menu & Stock' },
  { to: '/customers', icon: Users, label: 'Customers', group: 'Customers' },
  { to: '/tables', icon: QrCode, label: 'Tables', group: 'Customers' },
  { to: '/reservations', icon: CalendarCheck, label: 'Reservations', group: 'Customers' },
  { to: '/campaigns', icon: Megaphone, label: 'Campaigns', group: 'Customers' },
  { to: '/riders', icon: Bike, label: 'Riders', group: 'Settings' },
  { to: '/staff', icon: UserPlus, label: 'Staff', group: 'Settings' },
  { to: '/coupons', icon: Tag, label: 'Coupons', group: 'Settings' },
  { to: '/permissions', icon: ShieldCheck, label: 'Permissions', group: 'Settings' },
  { to: '/website', icon: Globe, label: 'Website', group: 'Settings' },
  { to: '/whatsapp', icon: MessageCircle, label: 'WhatsApp Demo', group: 'Settings' },
  { to: '/insights', icon: BarChart3, label: 'Insights', group: 'Intelligence' },
  { to: '/agents', icon: Sparkles, label: 'AI Agents', group: 'Intelligence' },
];

function fuzzyMatch(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return true;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export default function CommandPalette({ open, onClose }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return ALL_ITEMS;
    return ALL_ITEMS.filter((item) => fuzzyMatch(query, item.label));
  }, [query]);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Keep active item scrolled into view
  useEffect(() => {
    const el = listRef.current?.children[activeIndex];
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  function handleSelect(item) {
    if (item.external) {
      window.open(item.to, '_blank');
    } else {
      navigate(item.to);
    }
    onClose();
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[activeIndex]) handleSelect(filtered[activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  if (!open) return null;

  // Group filtered results
  const groups = {};
  filtered.forEach((item) => {
    if (!groups[item.group]) groups[item.group] = [];
    groups[item.group].push(item);
  });

  let runningIndex = 0;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 pt-[15vh]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label="Quick navigation"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl">
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-gray-200 px-4">
          <Search className="h-5 w-5 shrink-0 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Jump to a page…"
            className="w-full py-4 text-base text-gray-900 placeholder-gray-400 outline-none"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
          />
          <kbd className="hidden rounded border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-400 sm:inline">ESC</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-80 overflow-y-auto py-2">
          {filtered.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-gray-400">No pages match "{query}"</p>
          )}
          {Object.entries(groups).map(([group, items]) => (
            <div key={group}>
              <p className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{group}</p>
              {items.map((item) => {
                const idx = runningIndex++;
                const Icon = item.icon;
                const isActive = idx === activeIndex;
                return (
                  <button
                    key={item.to}
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                      isActive ? 'bg-brand-50 text-brand-700' : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {item.external && <span className="text-[10px] text-gray-400">↗</span>}
                    {isActive && <kbd className="text-[10px] text-gray-400">↵</kbd>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400">
          <span>↑↓ Navigate</span>
          <span>↵ Open</span>
          <span>Esc Close</span>
        </div>
      </div>
    </div>
  );
}
