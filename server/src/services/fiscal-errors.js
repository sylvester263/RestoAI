/**
 * Typed failure from a fiscal provider (impl-33). Kinds:
 *  - 'not_configured' — the provider isn't set up (no integrator/credentials).
 *                       Recorded as failed; retried without using up attempts,
 *                       so bills go through once it is configured.
 *  - 'config'         — misconfiguration (unknown provider, stub in production).
 *  - 'rejected'       — the authority refused the invoice; not retried.
 *  - 'unavailable'    — transient (network, outage); retried with backoff.
 */
export class FiscalError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}
