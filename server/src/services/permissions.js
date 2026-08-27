/**
 * The fixed permission catalog and default per-role grants. Kept in one
 * place so migrate.js (seeding), auth.js (register-time seeding for a new
 * tenant), and routes/permissions.js (validation) never drift apart.
 *
 * Defaults are chosen to exactly preserve the app's pre-RBAC behavior —
 * every route these keys gate was previously either open to all
 * authenticated roles or hardcoded to authorize('owner','manager'[,'staff']).
 * Seeding these on migration/registration means no existing account loses
 * access it already had; an owner can only ever narrow access from here.
 */
export const PERMISSIONS = [
  { key: 'menu.edit', description: 'Create, edit, and delete menu items' },
  { key: 'orders.view', description: 'View orders and order details' },
  { key: 'orders.status_update', description: 'Advance order/delivery status' },
  { key: 'discounts.apply', description: 'Apply a discount on a POS tab' },
  { key: 'reports.view', description: 'Ask the AI insights assistant business questions' },
  { key: 'branches.manage', description: 'Create/edit branches and dine-in tables' },
  { key: 'campaigns.manage', description: 'Create broadcast campaigns and build recipient lists' },
  { key: 'campaigns.send', description: 'Send a broadcast campaign to customers' },
  { key: 'inventory.manage', description: 'Add, edit, and delete inventory items' },
  { key: 'inventory.restock', description: 'Restock an existing inventory item' },
  { key: 'riders.manage', description: 'Manage the rider roster' },
  { key: 'riders.reconcile', description: "Run a rider's cash reconciliation" },
  { key: 'tables.close', description: 'Close a dine-in table session' },
  { key: 'website.manage', description: 'Edit and publish the restaurant landing page' },
  { key: 'staff.manage', description: 'Manage staff role permissions (owner only, not itself grantable)' },
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

export const ROLES = ['owner', 'manager', 'staff'];

// Roles other than 'owner' are the only ones a tenant can reconfigure —
// 'owner' always has every permission via a hardcoded bypass (see
// middleware/auth.js) so an owner can never lock themselves out.
export const EDITABLE_ROLES = ['manager', 'staff'];

export const DEFAULT_ROLE_PERMISSIONS = {
  owner: PERMISSION_KEYS,
  manager: PERMISSION_KEYS,
  staff: ['menu.edit', 'orders.view', 'orders.status_update', 'inventory.restock', 'tables.close'],
};
