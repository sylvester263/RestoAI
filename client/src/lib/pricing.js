/**
 * Display-side plan pricing (impl-32). Prices come from GET /api/billing/plans
 * (server/src/services/billing.js is the source of truth); this only mirrors
 * the arithmetic so the page can show a live total. The server recomputes the
 * amount on submission and rejects a mismatch, so the two can't drift silently.
 */

export function planById(pricing, id) {
  return pricing?.plans.find((p) => p.id === id) || null;
}

/** Clamp a requested plan/branch/pack combination to what that plan allows. */
export function normalizeSelection(pricing, { plan, branches, pack }) {
  const selfServe = pricing?.plans.filter((p) => p.self_serve) || [];
  const p = planById(pricing, plan) && planById(pricing, plan).self_serve ? planById(pricing, plan) : selfServe[0];
  if (!p) return null;
  const n = Math.min(Math.max(parseInt(branches, 10) || p.min_branches, p.min_branches), p.max_branches ?? p.min_branches);
  return { plan: p.id, branches: n, pack: p.agent_pack_included ? true : !!pack };
}

export function monthlyAmount(pricing, { plan, branches, pack }) {
  const p = planById(pricing, plan);
  if (!p || !p.self_serve) return null;
  const base = p.monthly != null ? p.monthly : p.per_branch * branches;
  return base + (pack && !p.agent_pack_included ? pricing.agent_pack_monthly : 0);
}

export function formatRs(n) {
  return `Rs. ${Number(n).toLocaleString('en-PK')}`;
}
