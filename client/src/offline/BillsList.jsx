import { Printer } from 'lucide-react';
import { billTotals } from './store';

const rs = (n) => `Rs. ${Number(n || 0).toLocaleString('en-PK')}`;

// What a bill's flags mean, in the cashier's words.
export const FLAG_LABELS = {
  price_changed_offline: 'Price changed while offline — customer kept the price they were charged',
  repriced_at_sync: 'Price on the device did not match the menu — re-priced at sync',
  availability_changed_offline: 'Item was marked sold out while offline',
  total_differs_from_device: 'Server total differs from the total shown on the device',
  needs_review: 'Held for manager review',
};
const REVIEW_LABELS = {
  user_deactivated: 'cashier was removed before it synced',
  tenant_suspended: 'account suspended',
  module_disabled: 'POS not on the current plan',
  shift_not_open: 'shift was already closed',
  invalid_bill_number: 'bill number not issued to this device',
  duplicate_bill_number: 'bill number already used',
  item_not_found: 'an item is no longer on the menu',
  tab_not_open: 'bill was already closed on the server',
  bill_under_review: 'bill is under review',
};

const STATUS = {
  pending: ['Waiting to sync', 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'],
  synced: ['Synced', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'],
  flagged: ['Needs review', 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'],
  error: ['Sync failed', 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'],
};

/** impl-33 Part 4: this device's offline bills with per-bill sync status. */
export default function BillsList({ bills, taxRate, onReprint, title = 'Offline bills on this device' }) {
  if (!bills.length) return null;
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full text-sm" data-testid="bills-list">
          <thead className="bg-[var(--surface-3)] text-left text-xs text-[var(--text-secondary)]">
            <tr><th className="px-3 py-2">Bill</th><th className="px-3 py-2">Time</th><th className="px-3 py-2">Cashier</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2">Sync</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>
            {bills.map((b) => {
              const [label, cls] = STATUS[b.sync] || STATUS.pending;
              const flags = (b.flags || []).filter((f) => FLAG_LABELS[f]);
              return (
                <tr key={b.cid} className="border-t border-[var(--border-light)] align-top" data-testid="bill-row" data-sync={b.sync}>
                  <td className="px-3 py-2 font-medium">#{b.bill_number}</td>
                  <td className="px-3 py-2 text-[var(--text-secondary)]">{new Date(b.settled_at || b.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="px-3 py-2 text-[var(--text-secondary)]">{b.user_name}</td>
                  <td className="px-3 py-2 text-right">{rs(b.server_total ?? b.total ?? billTotals(b, taxRate).total)}</td>
                  <td className="px-3 py-2">
                    <span className={`badge ${cls}`}>{label}</span>
                    {b.sync === 'flagged' && b.review_reason && <p className="mt-1 text-xs text-red-700 dark:text-red-300">{REVIEW_LABELS[b.review_reason] || b.review_reason}</p>}
                    {b.sync === 'error' && b.sync_error && <p className="mt-1 text-xs text-red-700 dark:text-red-300">{b.sync_error}</p>}
                    {flags.map((f) => <p key={f} className="mt-1 text-xs text-amber-700 dark:text-amber-300" data-testid="bill-flag">{FLAG_LABELS[f]}</p>)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {onReprint && <button type="button" onClick={() => onReprint(b)} className="text-[var(--text-secondary)] hover:text-brand-600" aria-label={`Reprint bill ${b.bill_number}`}><Printer className="h-4 w-4" /></button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
