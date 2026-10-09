/**
 * Typed failure from a fiscal provider (impl-33/34). Kinds:
 *  - 'not_configured' — the provider isn't set up (no integrator/credentials).
 *                       Recorded as failed; retried without using up attempts.
 *  - 'config'         — our setup is wrong or incomplete (missing settings,
 *                       rate mismatch, stub in production). Like
 *                       not_configured: failed, attempts given back.
 *  - 'rejected'       — the authority refused the invoice data; not retried
 *                       until a manager fixes the data and resubmits.
 *  - 'unauthorized'   — the authority refused our token; retries stop and the
 *                       owner is alerted.
 *  - 'unavailable'    — transient and safe to retry: the request never reached
 *                       the authority, or it answered with a server error.
 *  - 'unknown'        — the request may have been accepted (e.g. timeout after
 *                       sending). Never auto-resubmitted, to avoid a duplicate
 *                       invoice; a manager decides.
 * `code` carries the authority's own error code, stored verbatim.
 */
export class FiscalError extends Error {
  constructor(kind, message, code = null) {
    super(message);
    this.kind = kind;
    this.code = code;
  }
}
