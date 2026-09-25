import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import useKeyboardShortcuts from '../hooks/useKeyboardShortcuts';
import CommandPalette from './CommandPalette';
import InstallBanner from './InstallBanner';
import DarkModeToggle from './DarkModeToggle';
import OwnerChat from './OwnerChat';
import {
  LayoutDashboard, UtensilsCrossed, ShoppingBag, BarChart3,
  MessageCircle, LogOut, ChefHat, QrCode, CalendarCheck,
  Package, Megaphone, Globe, Receipt, Bike, Users, ShieldCheck,
  Sparkles, Tag, UserPlus, Menu, X, ChevronDown, Search, Headphones, Link2, CreditCard, Clock,
} from 'lucide-react';

// ── Grouped navigation ──────────────────────────────────────────────
const navGroups = [
  {
    label: 'Operations',
    items: [
      { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/pos', icon: Receipt, label: 'POS' },
      { to: '/orders', icon: ShoppingBag, label: 'Orders' },
    ],
  },
  {
    label: 'Menu & Stock',
    items: [
      { to: '/menu', icon: UtensilsCrossed, label: 'Menu' },
      { to: '/inventory', icon: Package, label: 'Inventory' },
    ],
  },
  {
    label: 'Customers',
    items: [
      { to: '/customers', icon: Users, label: 'Customers' },
      { to: '/support', icon: Headphones, label: 'Support' },
      { to: '/tables', icon: QrCode, label: 'Tables' },
      { to: '/reservations', icon: CalendarCheck, label: 'Reservations' },
      { to: '/campaigns', icon: Megaphone, label: 'Campaigns' },
    ],
  },
  {
    label: 'Settings',
    items: [
      { to: '/riders', icon: Bike, label: 'Riders' },
      { to: '/website', icon: Globe, label: 'Website' },
      { to: '/whatsapp', icon: MessageCircle, label: 'WhatsApp Demo' },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { to: '/insights', icon: BarChart3, label: 'Insights' },
    ],
  },
];

// Role-gated items added to specific groups
const roleGatedItems = {
  'Settings': [
    { to: '/staff', icon: UserPlus, label: 'Staff', roles: ['owner', 'manager'] },
    { to: '/coupons', icon: Tag, label: 'Coupons', roles: ['owner', 'manager'] },
    { to: '/permissions', icon: ShieldCheck, label: 'Permissions', roles: ['owner'] },
    { to: '/billing', icon: CreditCard, label: 'Plan & Billing', roles: ['owner'] },
    { to: '/whatsapp-connect', icon: Link2, label: 'WhatsApp Connect', roles: ['owner', 'manager'] },
  ],
  'Intelligence': [
    { to: '/agents', icon: Sparkles, label: 'AI Agents', roles: ['owner', 'manager'] },
  ],
};

function buildNav(role) {
  return navGroups.map((group) => {
    const extras = (roleGatedItems[group.label] || []).filter(
      (item) => item.roles.includes(role),
    );
    return { ...group, items: [...group.items, ...extras] };
  }).filter((group) => group.items.length > 0);
}

export default function Layout({ children }) {
  const { user, tenant, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pendingPayment, setPendingPayment] = useState(null);
  const location = useLocation();

  const groups = buildNav(user?.role || 'staff');

  // impl-32: owners see a reminder while a bank transfer awaits verification
  useEffect(() => {
    if (user?.role !== 'owner') return;
    api.getBilling().then((res) => setPendingPayment(res.pending)).catch(() => {});
  }, [user?.role, location.pathname]);

  // Global keyboard shortcuts
  useKeyboardShortcuts([
    { key: 'k', ctrl: true, callback: () => setPaletteOpen(true) },
    { key: 'k', meta: true, callback: () => setPaletteOpen(true) },
    { key: 'g', callback: () => navigate('/dashboard') },
    { key: 'o', callback: () => navigate('/orders') },
    { key: 'p', callback: () => navigate('/pos') },
    // Not in text fields — people type question marks there.
    { key: '?', callback: () => setPaletteOpen(true) },
  ]);

  function toggleGroup(label) {
    setCollapsedGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  }

  function handleLogout() {
    logout();
    navigate('/login');
  }

  function closeSidebar() {
    setSidebarOpen(false);
  }

  const navContent = (
    <>
      {/* Brand */}
      <div className="flex h-16 items-center justify-between border-b border-gray-200 px-6 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <ChefHat className="h-6 w-6 text-brand-600" />
          <span className="text-lg font-bold text-gray-900 dark:text-gray-100">RestoAI</span>
        </div>
        <div className="flex items-center gap-1">
          <DarkModeToggle />
          <button
            onClick={() => setPaletteOpen(true)}
            className="hidden rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300 lg:block"
            aria-label="Quick navigation (Ctrl+K)"
            title="Quick navigation (Ctrl+K)"
          >
            <Search className="h-4 w-4" />
          </button>
          {/* Close button on mobile */}
          <button
            onClick={closeSidebar}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Main navigation">
        {groups.map((group) => (
          <div key={group.label} className="mb-2">
            <button
              onClick={() => toggleGroup(group.label)}
              className="mb-1 flex w-full items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              aria-expanded={!collapsedGroups[group.label]}
            >
              {group.label}
              <ChevronDown
                className={`h-3 w-3 transition-transform ${collapsedGroups[group.label] ? '-rotate-90' : ''}`}
              />
            </button>
            {!collapsedGroups[group.label] && (
              <div className="space-y-0.5">
                {group.items.map(({ to, icon: Icon, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/dashboard'}
                    onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-500'
                          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200'
                      }`
                    }
                  >
                    <Icon className="h-5 w-5" />
                    {label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      {/* Kitchen link */}
      <div className="border-t border-gray-200 px-3 py-3 dark:border-gray-800">
        <a
          href="/kitchen"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          <ChefHat className="h-5 w-5" />
          Kitchen Display ↗
        </a>
      </div>

      {/* User */}
      <div className="border-t border-gray-200 px-4 py-4 dark:border-gray-800">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{user?.name}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{tenant?.name}</p>
          </div>
          <button
            onClick={handleLogout}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex h-screen">
      {/* Skip to content — a11y */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to main content
      </a>

      {/* Mobile overlay backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — desktop: always visible; mobile: drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-gray-200 bg-white transition-transform duration-200 dark:border-gray-800 dark:bg-gray-900 lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Sidebar navigation"
      >
        {navContent}
      </aside>

      {/* Main content */}
      <main id="main-content" className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950">
        {/* Mobile top bar */}
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900 lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <ChefHat className="h-5 w-5 text-brand-600" />
            <span className="text-sm font-bold text-gray-900 dark:text-gray-100">RestoAI</span>
          </div>
          <DarkModeToggle className="ml-auto" />
        </div>

        <div className="p-6">
          {pendingPayment && location.pathname !== '/billing' && (
            <button
              type="button"
              onClick={() => navigate('/billing')}
              className="mb-4 flex w-full items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-left text-sm text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300"
            >
              <Clock className="h-4 w-4 shrink-0" />
              Payment pending verification — we'll message you on WhatsApp once it's approved.
            </button>
          )}
          {children}
        </div>
      </main>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} role={user?.role || 'staff'} />
      <InstallBanner />
      <OwnerChat />
    </div>
  );
}
