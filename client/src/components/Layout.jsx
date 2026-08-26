import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard, UtensilsCrossed, ShoppingBag, BarChart3,
  MessageCircle, LogOut, ChefHat,
} from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/menu', icon: UtensilsCrossed, label: 'Menu' },
  { to: '/orders', icon: ShoppingBag, label: 'Orders' },
  { to: '/insights', icon: BarChart3, label: 'Insights' },
  { to: '/whatsapp', icon: MessageCircle, label: 'WhatsApp Demo' },
];

export default function Layout({ children }) {
  const { user, tenant, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-gray-200 bg-white">
        {/* Brand */}
        <div className="flex h-16 items-center gap-2 border-b border-gray-200 px-6">
          <ChefHat className="h-6 w-6 text-brand-600" />
          <span className="text-lg font-bold text-gray-900">RestoAI</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`
              }
            >
              <Icon className="h-5 w-5" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Kitchen link */}
        <div className="border-t border-gray-200 px-3 py-3">
          <a
            href="/kitchen"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            <ChefHat className="h-5 w-5" />
            Kitchen Display ↗
          </a>
        </div>

        {/* User */}
        <div className="border-t border-gray-200 px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">{user?.name}</p>
              <p className="text-xs text-gray-500">{tenant?.name}</p>
            </div>
            <button onClick={handleLogout} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-gray-50 p-6">
        {children}
      </main>
    </div>
  );
}
