/**
 * Punjab Revenue Authority (PRA) adapter (impl-33) — NOT CONFIGURED.
 *
 * Restaurants in Punjab may report sales tax on services to PRA rather than
 * FBR. Nothing about PRA's system is assumed here: until its requirements are
 * confirmed, every call returns a typed `not_configured` failure. The sale is
 * never affected — services/fiscal.js records the failure and keeps retrying,
 * and managers see it in the fiscal invoice list.
 *
 * TODO (confirm with PRA, or the integrator PRA designates, before writing any code):
 *  - Whether PRA requires real-time POS invoice reporting for restaurants,
 *    which restaurants it applies to, and from what date.
 *  - Whether submission is direct to PRA or through an approved integrator,
 *    and that party's terms.
 *  - API base URL(s) for test and production.
 *  - Authentication and credentials: what is issued, to whom (platform vs.
 *    each restaurant), rotation and storage requirements.
 *  - Per-restaurant identifiers (PRA registration number, POS/terminal id).
 *  - The invoice payload: required fields, tax breakdown, rounding.
 *  - The response: invoice number format, QR content or URL.
 *  - The reporting deadline (unconfirmed — the app warns at 12 hours) and
 *    how an invoice issued while offline must be marked.
 *  - Error codes: permanent ('rejected') vs. transient ('unavailable').
 */
import { FiscalError } from '../fiscal-errors.js';

export async function submit(/* bill, config */) {
  throw new FiscalError('not_configured', 'PRA invoicing is not set up yet: its requirements have not been confirmed, so no invoice was submitted.');
}
