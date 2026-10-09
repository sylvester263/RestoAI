/**
 * FBR e-invoicing adapter (impl-33) — NOT CONFIGURED.
 *
 * Deliberately empty: no endpoint, field mapping or credential is assumed
 * here. FBR invoices go through a licensed integrator (PRAL or another
 * licensed one), and until that agreement exists every call returns a typed
 * `not_configured` failure. The sale is never affected — services/fiscal.js
 * records the failure and keeps retrying, and managers see it in the
 * fiscal invoice list.
 *
 * TODO (confirm with the licensed integrator / FBR before writing any code):
 *  - Which integrator, and their contract terms and fees.
 *  - API base URL(s) for sandbox and production, and how environments differ.
 *  - Authentication: what credential is issued, to whom (RestoAI as platform
 *    vs. each restaurant), how it is rotated and where it must be stored.
 *  - Per-restaurant registration: which identifiers (NTN/STRN, POS/terminal
 *    registration) each tenant must hold, and how a POS is registered.
 *  - The invoice payload: required fields, item/HS or service codes, tax
 *    breakdown, rounding rules, buyer details (if any), currency.
 *  - What the response returns: the invoice number format and whether a QR
 *    payload or URL is returned or must be built locally.
 *  - Time limits: the reporting deadline (understood to be 24 hours — to be
 *    confirmed) and how a late or offline-issued invoice must be marked.
 *  - Error codes: which are permanent (map to FiscalError 'rejected') and
 *    which are transient (map to 'unavailable').
 *  - Which restaurants are obliged to report to FBR rather than a provincial
 *    authority (PRA/SRB/KPRA/BRA).
 */
import { FiscalError } from '../fiscal-errors.js';

export async function submit(/* bill, config */) {
  throw new FiscalError('not_configured', 'FBR e-invoicing is not set up yet: RestoAI has no licensed integrator agreement, so no invoice was submitted.');
}
