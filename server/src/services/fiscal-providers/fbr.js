/**
 * FBR Digital Invoicing (DI) adapter (impl-34).
 *
 * Source: PRAL "Technical Specification for DI API" v1.12, 24-Jul-2025.
 * Only what that document states is implemented. Open points (CONFIRM):
 *  - Whether restaurants must use this API at all, and FBR vs PRA per
 *    restaurant (blocking before any production use).
 *  - The document says one URL set routed by token (section 4) but also
 *    lists separate `_sb` sandbox URLs; the listed URLs are used here.
 *  - QR code content (section 6 gives size/version only) — no QR is built
 *    until it is confirmed; the FBR logo must come from FBR/PRAL.
 *  - HS code, UOM, sale type and rate for restaurant sales: tenant settings,
 *    never defaulted in code.
 *  - Walk-in buyer defaults, idempotency/duplicate detection, credit notes
 *    for refunds, and the late-submission deadline.
 *
 * Outcome mapping (services/fiscal-errors.js):
 *  - 200, header and every item "00", invoice number → submitted
 *  - 200 with "01" (header or item) → rejected, error code stored verbatim,
 *    not retried until a manager fixes the data and resubmits
 *  - 401 → unauthorized: retries stop, owner alerted
 *  - 500, or the request never reached the gateway → unavailable (retry)
 *  - timeout after sending, other gateway errors, unreadable answer →
 *    unknown: never auto-resubmitted (the document says nothing about
 *    duplicate detection, so a blind retry could create a second invoice)
 *
 * Tokens are decrypted only here, sent only in the Authorization header,
 * and never logged, returned or put in an error message.
 */
import { query } from '../../db/pool.js';
import { decrypt } from '../encryption.js';
import { FiscalError } from '../fiscal-errors.js';
import { buildFbrPayload, missingSettings, readFbrResponse } from './fbr-payload.js';

// FBR_DI_BASE_URL exists so tests can point at a local mock gateway.
const baseUrl = () => (process.env.FBR_DI_BASE_URL || 'https://gw.fbr.gov.pk').replace(/\/+$/, '');
const timeoutMs = () => Number(process.env.FBR_DI_TIMEOUT_MS) || 20000;

// Section 4.1 / 4.2 URLs
const PATHS = {
  post: { sandbox: '/di_data/v1/di/postinvoicedata_sb', production: '/di_data/v1/di/postinvoicedata' },
  validate: { sandbox: '/di_data/v1/di/validateinvoicedata_sb', production: '/di_data/v1/di/validateinvoicedata' },
};
// Section 5 reference APIs (no request input)
export const REFERENCE_PATHS = {
  provinces: '/pdi/v1/provinces',
  doctypecode: '/pdi/v1/doctypecode',
  transtypecode: '/pdi/v1/transtypecode',
  uom: '/pdi/v1/uom',
};

// Errors from the HTTP client that mean the request never reached the
// gateway (DNS, refused, TLS, connect timeout) — safe to retry.
const NEVER_SENT = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID', 'SELF_SIGNED_CERT_IN_CHAIN',
]);

export async function loadFbrSettings(tenantId) {
  const res = await query('SELECT * FROM tenant_fbr_settings WHERE tenant_id = $1', [tenantId]);
  return res.rows[0] || null;
}

function tokenFor(s) {
  if (s.environment === 'production' && process.env.NODE_ENV !== 'production') {
    throw new FiscalError('config', 'FBR production mode is refused outside production. Use sandbox.');
  }
  const stored = s.environment === 'production' ? s.production_token_encrypted : s.sandbox_token_encrypted;
  if (!stored) throw new FiscalError('config', `No FBR ${s.environment} token is set for this restaurant`);
  try {
    return decrypt(stored);
  } catch {
    throw new FiscalError('config', 'The stored FBR token could not be read; set it again');
  }
}

/** One gateway call. Returns { status, body } or throws a classified FiscalError. */
async function callGateway(method, path, token, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs());
  let res;
  try {
    res = await fetch(baseUrl() + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body && { 'Content-Type': 'application/json' }) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const code = err?.cause?.code || err?.code;
    if (err?.name !== 'AbortError' && NEVER_SENT.has(code)) {
      throw new FiscalError('unavailable', `FBR gateway not reachable (${code})`);
    }
    throw new FiscalError('unknown', err?.name === 'AbortError'
      ? `No answer from FBR within ${Math.round(timeoutMs() / 1000)} s — the invoice may or may not have been recorded`
      : `Connection to FBR dropped (${code || 'network error'}) — the invoice may or may not have been recorded`);
  }
  let parsed = null;
  let text = '';
  try {
    text = await res.text();
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  } finally {
    clearTimeout(timer);
  }
  return { status: res.status, body: parsed, hadBody: text.length > 0 };
}

function classifyHttp(status, isPost) {
  if (status === 401) return new FiscalError('unauthorized', 'FBR refused the token (401 Unauthorized)', '401');
  if (status === 500) return new FiscalError('unavailable', 'FBR internal server error (500)', '500');
  // Not listed in the document (only 200/401/500 are). For a post this could
  // follow a gateway that already forwarded the invoice — don't retry blindly.
  return new FiscalError(isPost ? 'unknown' : 'unavailable', `Unexpected answer from FBR (HTTP ${status})`, String(status));
}

async function prepare(bill) {
  const s = await loadFbrSettings(bill.tenantId);
  if (!s) throw new FiscalError('not_configured', 'FBR Digital Invoicing settings are not set up for this restaurant');
  const missing = missingSettings(s);
  if (missing.length) throw new FiscalError('config', `FBR settings incomplete: ${missing.join(', ')}`);
  // The bill's own tax must be the FBR rate on (subtotal − discount), or every
  // line would fail the percentage check (error 0104).
  const expectedTax = Math.round((bill.subtotal - bill.discount) * (Number(s.rate_value) / 100) * 100) / 100;
  if (Math.abs(expectedTax - bill.tax) > 0.011) {
    throw new FiscalError('config', `Bill tax Rs. ${bill.tax} does not match the FBR rate ${s.rate_value}% (expected Rs. ${expectedTax}). Check the branch tax rate and the FBR rate setting.`);
  }
  return { s, token: tokenFor(s), payload: buildFbrPayload(bill, s) };
}

/** submitInvoice() seam for fiscal_provider = 'fbr'. */
export async function submit(bill) {
  const { s, token, payload } = await prepare(bill);
  const { status, body } = await callGateway('POST', PATHS.post[s.environment], token, payload);
  if (status !== 200) throw classifyHttp(status, true);
  const read = readFbrResponse(body);
  if (read.ok === true) return { invoiceNumber: read.invoiceNumber, qrUrl: null }; // QR content: CONFIRM (section 6)
  if (read.ok === false) throw new FiscalError('rejected', read.message, read.code);
  throw new FiscalError('unknown', read.message);
}

/**
 * Validate-only call (section 4.2) for piloting a restaurant before posting
 * real invoices. Never stores anything. Returns the document's own fields.
 */
export async function validate(bill) {
  const { s, token, payload } = await prepare(bill);
  const { status, body } = await callGateway('POST', PATHS.validate[s.environment], token, payload);
  if (status !== 200) {
    const e = classifyHttp(status, false);
    return { ok: false, http_status: status, message: e.message, payload_preview: redactPayload(payload) };
  }
  // Validate issues no invoice number, so "valid" = header and every item "00".
  const v = body?.validationResponse;
  const items = Array.isArray(v?.invoiceStatuses) ? v.invoiceStatuses : [];
  const ok = v?.statusCode === '00' && items.every((it) => it?.statusCode === '00');
  return { ok, http_status: 200, validation: v || null, payload_preview: redactPayload(payload) };
}

const redactPayload = (p) => ({ ...p, sellerNTNCNIC: p.sellerNTNCNIC ? `***${String(p.sellerNTNCNIC).slice(-3)}` : p.sellerNTNCNIC });

// ── Reference data (section 5), cached; only used for setting up a tenant,
// never on the sale path, so a failed refresh can't block a sale. ──
const refCache = new Map(); // `${tenantId}:${kind}` -> { at, data }
const REF_TTL_MS = 12 * 60 * 60 * 1000;

export async function fetchReference(tenantId, kind) {
  const path = REFERENCE_PATHS[kind];
  if (!path) throw new FiscalError('config', `Unknown FBR reference list: ${kind}`);
  const key = `${tenantId}:${kind}`;
  const cached = refCache.get(key);
  if (cached && Date.now() - cached.at < REF_TTL_MS) return { data: cached.data, cached: true };
  const s = await loadFbrSettings(tenantId);
  if (!s) throw new FiscalError('not_configured', 'FBR settings are not set up for this restaurant');
  try {
    const { status, body } = await callGateway('GET', path, tokenFor(s));
    if (status !== 200) throw classifyHttp(status, false);
    refCache.set(key, { at: Date.now(), data: body });
    return { data: body, cached: false };
  } catch (err) {
    if (cached) return { data: cached.data, cached: true, stale: true, error: err.message };
    throw err;
  }
}
