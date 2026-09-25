/**
 * Billing (impl-32) — the one place that knows plan prices, how a monthly
 * amount is computed, RestoAI's bank details, and whether a tenant has the
 * AI Agent Pack. The owner billing page, the marketing pricing section and
 * super-admin approval all read from here, so a price can't drift between them.
 *
 * Plans have two independent dimensions:
 *  - branch tier: starter (1 branch, flat) / growth (2-5 branches, per branch)
 *    / enterprise (custom quote — contact form only, never self-serve)
 *  - AI Agent Pack: an add-on at Starter, included at Growth and Enterprise.
 * The core WhatsApp AI ordering agent is never gated by the pack.
 */
import { query } from '../db/pool.js';

export const PLANS = {
  starter: { name: 'Starter', monthly: 8000, minBranches: 1, maxBranches: 1, agentPackIncluded: false, selfServe: true },
  growth: { name: 'Growth', perBranch: 7000, minBranches: 2, maxBranches: 5, agentPackIncluded: true, selfServe: true },
  enterprise: { name: 'Enterprise', minBranches: 6, agentPackIncluded: true, selfServe: false },
};
export const AGENT_PACK_MONTHLY = 5000; // Starter add-on (owner decision 2026-09-25)
export const BILLING_PERIOD_MONTHS = 1;

/**
 * Validate a self-serve plan choice and compute its monthly amount (PKR).
 * @returns {{ plan, branchCount, agentPack, amount }}
 * @throws {Error} with a user-facing message for an invalid choice
 */
export function priceSelection({ plan, branchCount, agentPack }) {
  const def = PLANS[plan];
  if (!def) throw new Error('Choose Starter or Growth');
  if (!def.selfServe) throw new Error('Enterprise plans are quoted directly — please use the contact form');

  const branches = plan === 'starter' ? 1 : Number(branchCount);
  if (!Number.isInteger(branches) || branches < def.minBranches || branches > def.maxBranches) {
    throw new Error(`${def.name} covers ${def.minBranches}–${def.maxBranches} branches`);
  }
  // Included at Growth, so it's always on there regardless of what was sent
  const pack = def.agentPackIncluded ? true : !!agentPack;
  const base = plan === 'starter' ? def.monthly : def.perBranch * branches;
  const amount = base + (pack && !def.agentPackIncluded ? AGENT_PACK_MONTHLY : 0);
  return { plan, branchCount: branches, agentPack: pack, amount };
}

/** Public price list for the marketing page and the billing page. */
export function publicPlanList() {
  return {
    currency: 'PKR',
    period: 'month',
    agent_pack_monthly: AGENT_PACK_MONTHLY,
    plans: Object.entries(PLANS).map(([id, p]) => ({
      id,
      name: p.name,
      monthly: p.monthly ?? null,
      per_branch: p.perBranch ?? null,
      min_branches: p.minBranches,
      max_branches: p.maxBranches ?? null,
      agent_pack_included: p.agentPackIncluded,
      self_serve: p.selfServe,
    })),
  };
}

/**
 * RestoAI's receiving account, from env vars only — never hardcoded, so no
 * placeholder account number can ever be shown to an owner. Null until set.
 */
export function bankDetails() {
  const title = process.env.BANK_ACCOUNT_TITLE;
  const number = process.env.BANK_ACCOUNT_NUMBER;
  const bank = process.env.BANK_NAME;
  if (!title || !number || !bank) return null;
  return { account_title: title, account_number: number, iban: process.env.BANK_IBAN || null, bank_name: bank };
}

// ── AI Agent Pack check ──
// Cached per tenant for a short TTL, the same shape as the tenant-status
// cache in middleware/auth.js; invalidated on the instance that changes it.
const packCache = new Map(); // tenantId -> { enabled, at }
const PACK_TTL_MS = 60_000;

export async function hasAgentPack(tenantId) {
  const cached = packCache.get(tenantId);
  if (cached && Date.now() - cached.at < PACK_TTL_MS) return cached.enabled;
  const res = await query('SELECT ai_agent_pack_enabled FROM tenants WHERE id = $1', [tenantId]);
  const enabled = !!res.rows[0]?.ai_agent_pack_enabled;
  packCache.set(tenantId, { enabled, at: Date.now() });
  return enabled;
}

export function invalidateAgentPack(tenantId) {
  packCache.delete(tenantId);
}

export const AGENT_PACK_REQUIRED_MESSAGE = 'This is part of the AI Agent Pack. Add it from Plan & Billing to turn it on.';
