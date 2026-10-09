// impl-33: which product module each app page belongs to. Pages not listed
// (Dashboard, Orders, Staff, Permissions, Plan & Billing) are on every plan.
// Hiding is cosmetic: the server returns 403 module_disabled regardless.
export const ROUTE_MODULES = {
  '/pos': 'pos',
  '/tables': 'pos',
  '/kitchen': 'kitchen',
  '/menu': 'menu',
  '/inventory': 'inventory',
  '/customers': 'loyalty_crm',
  '/campaigns': 'loyalty_crm',
  '/coupons': 'loyalty_crm',
  '/support': 'whatsapp_ordering',
  '/whatsapp': 'whatsapp_ordering',
  '/whatsapp-connect': 'whatsapp_ordering',
  '/reservations': 'reservations',
  '/riders': 'delivery_riders',
  '/website': 'website_builder',
  '/insights': 'insights',
  '/agents': 'ai_agents',
};

/**
 * true if the page at `path` may be shown. `modules` is null while loading
 * or after a failed load — gated pages stay hidden then (fail closed).
 */
export function routeAllowed(modules, path) {
  const module = ROUTE_MODULES[path];
  if (!module) return true;
  return modules?.[module] === true;
}
