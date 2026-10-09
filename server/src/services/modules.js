/**
 * Module gating (impl-33) — which product areas a tenant can use. Plans are
 * presets over these modules; a super admin can override any one per tenant.
 *
 * Storage is tenant_modules(tenant_id, module, enabled). A missing row means
 * enabled, so every tenant that existed before this table keeps everything
 * it had, and adding a new module later doesn't silently switch it off for
 * existing customers. A POS Only tenant therefore has explicit `false` rows.
 *
 * `ai_agents` is the product area (Agents page, flags, settings). Whether an
 * agent may actually run is still the impl-32 Agent Pack check on top of it,
 * so a Starter tenant without the pack keeps seeing the page and its upsell.
 *
 * Enforcement is server-side: requireModule() on routes, isModuleEnabled()
 * for unauthenticated paths (public ordering, sites, the WhatsApp webhook),
 * and moduleEnabledSql() for cron loops. The client nav is cosmetic.
 */
import { query } from '../db/pool.js';

export const MODULES = [
  'pos',
  'kitchen',
  'menu',
  'whatsapp_ordering', // WhatsApp + web online ordering, support inbox
  'delivery_riders',
  'reservations',
  'inventory',
  'loyalty_crm', // customers, segments, campaigns, coupons, loyalty
  'insights', // AI Q&A + branch analytics (the basic Dashboard is always on)
  'ai_agents',
  'website_builder',
];

export const MODULE_LABELS = {
  pos: 'POS & billing',
  kitchen: 'Kitchen display',
  menu: 'Menu',
  whatsapp_ordering: 'WhatsApp & online ordering',
  delivery_riders: 'Delivery & riders',
  reservations: 'Reservations',
  inventory: 'Inventory & purchasing',
  loyalty_crm: 'Loyalty & CRM',
  insights: 'Insights & analytics',
  ai_agents: 'AI agents',
  website_builder: 'Website builder',
};

const POS_ONLY = new Set(['pos', 'kitchen', 'menu']);

/** Module -> enabled for a plan. Unknown/empty plan = everything on. */
export function presetFor(plan) {
  return Object.fromEntries(MODULES.map((m) => [m, plan === 'pos_only' ? POS_ONLY.has(m) : true]));
}

/**
 * Write a plan's preset for a tenant. Pass a transaction client when called
 * inside one (tenant create, payment approval). Overwrites earlier per-tenant
 * overrides — a plan change is a deliberate reset.
 */
export async function applyPlanPreset(db, tenantId, plan) {
  const preset = presetFor(plan);
  const modules = Object.keys(preset);
  await db.query(
    `INSERT INTO tenant_modules (tenant_id, module, enabled, updated_at)
     SELECT $1, m, e, NOW() FROM unnest($2::varchar[], $3::boolean[]) AS t(m, e)
     ON CONFLICT (tenant_id, module) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
    [tenantId, modules, modules.map((m) => preset[m])],
  );
  invalidateModules(tenantId);
}

// Same cache shape as the agent-pack and tenant-status caches: per tenant,
// short TTL, cleared on the instance that made the change.
const cache = new Map(); // tenantId -> { at, modules: { name: bool } }
const TTL_MS = 30_000;

/** Uncached read — for the super admin, who must see the stored state. */
export async function loadTenantModules(tenantId) {
  const rowsRes = await query('SELECT module, enabled FROM tenant_modules WHERE tenant_id = $1', [tenantId]);
  const modules = Object.fromEntries(MODULES.map((m) => [m, true]));
  for (const row of rowsRes.rows) {
    if (row.module in modules) modules[row.module] = row.enabled;
  }
  return modules;
}

export async function getTenantModules(tenantId) {
  const cached = cache.get(tenantId);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.modules;
  const modules = await loadTenantModules(tenantId);
  cache.set(tenantId, { at: Date.now(), modules });
  return modules;
}

/** Super-admin override of one module for one tenant. */
export async function setTenantModule(tenantId, module, enabled) {
  if (!MODULES.includes(module)) throw new Error(`Unknown module: ${module}`);
  await query(
    `INSERT INTO tenant_modules (tenant_id, module, enabled, updated_at) VALUES ($1, $2, $3, NOW())
     ON CONFLICT (tenant_id, module) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
    [tenantId, module, enabled],
  );
  invalidateModules(tenantId);
}

export function invalidateModules(tenantId) {
  cache.delete(tenantId);
}

export async function isModuleEnabled(tenantId, module) {
  const modules = await getTenantModules(tenantId);
  return modules[module] === true;
}

export function moduleDisabledBody(module) {
  return {
    error: {
      message: `${MODULE_LABELS[module] || module} isn't part of your plan. Upgrade from Plan & Billing to use it.`,
      code: 'module_disabled',
    },
    module,
  };
}

/**
 * Route guard. Mount after authenticate and checkTenantActive — tenant_id
 * only ever comes from the verified JWT. Fails closed on a lookup error.
 */
export function requireModule(module) {
  if (!MODULES.includes(module)) throw new Error(`Unknown module: ${module}`);
  return async (req, res, next) => {
    try {
      if (!(await isModuleEnabled(req.user.tenant_id, module))) {
        return res.status(403).json(moduleDisabledBody(module));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * SQL predicate for cron loops selecting from `tenants` (aliased or not):
 * true unless the tenant has an explicit disabled row for the module.
 * `module` is checked against MODULES, never user input.
 */
export function moduleEnabledSql(module, tenantIdColumn = 'tenants.id') {
  if (!MODULES.includes(module)) throw new Error(`Unknown module: ${module}`);
  return `NOT EXISTS (SELECT 1 FROM tenant_modules tm WHERE tm.tenant_id = ${tenantIdColumn} AND tm.module = '${module}' AND tm.enabled = false)`;
}
