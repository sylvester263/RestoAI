/**
 * Development stand-in (impl-33) so the receipt, queue and retry paths can be
 * exercised end to end. Refused in production. Set `{"fail": true}` in the
 * tenant's fiscal_config to simulate an outage. Bills issued offline get an
 * "OFF" marker in the invoice number so tests can see the flag arrived.
 */
import { FiscalError } from '../fiscal-errors.js';

export async function submit(bill, config) {
  if (process.env.NODE_ENV === 'production') throw new FiscalError('config', 'The stub fiscal provider is disabled in production');
  if (config?.fail) throw new FiscalError('unavailable', 'Stub provider simulated outage');
  const invoiceNumber = `STUB-${bill.issuedOffline ? 'OFF-' : ''}${bill.branchId.slice(0, 4).toUpperCase()}-${Date.now()}`;
  return { invoiceNumber, qrUrl: `https://example.invalid/fiscal/${invoiceNumber}` };
}
