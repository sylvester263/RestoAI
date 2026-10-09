/**
 * Tax invoices still waiting (impl-33) — managers and owners only.
 * Bills whose fiscal invoice is pending or failed, oldest first, aged from the
 * sale. Anything older than the warning threshold (12 h; FBR's deadline is
 * understood to be 24 h, PRA's is unconfirmed) is highlighted. The sales
 * themselves are never affected by anything shown or done here.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, FileWarning, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { toast } from '../../components/ui/toast';

const PROVIDER_LABEL = { pra: 'PRA', fbr: 'FBR', stub: 'Stub (test)', none: 'None' };

function age(hours) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.floor(hours)} h ${Math.round((hours % 1) * 60)} min`;
  return `${Math.floor(hours / 24)} days`;
}

export default function FiscalQueuePanel() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.getFiscalInvoices().then(setData).catch(() => setData(null));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  if (!data || (data.provider === 'none' && data.items.length === 0)) return null;

  async function retry() {
    setBusy(true);
    try {
      const res = await api.retryFiscalInvoices();
      setData(res);
      toast.success(res.submitted ? `${res.submitted} invoice${res.submitted === 1 ? '' : 's'} submitted` : 'Nothing could be submitted yet');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const overdue = data.items.filter((i) => i.warning).length;
  return (
    <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4 text-sm" data-testid="fiscal-queue">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <FileWarning className="h-4 w-4" />
        <h2 className="font-semibold text-[var(--text-primary)]">Tax invoices waiting</h2>
        <span className="text-xs text-[var(--text-secondary)]">Provider: {PROVIDER_LABEL[data.provider] || data.provider} · {data.items.length} waiting{overdue ? ` · ${overdue} older than ${data.warn_after_hours} h` : ''}</span>
        {data.items.length > 0 && (
          <button type="button" onClick={retry} disabled={busy} className="btn-secondary ml-auto text-xs"><RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} /> Retry now</button>
        )}
      </div>
      <p className="mb-3 text-xs text-[var(--text-secondary)]">
        Sales are complete either way; this only tracks reporting to the tax authority. Bills older than {data.warn_after_hours} hours are highlighted — FBR&apos;s deadline is understood to be 24 hours from the sale (to be confirmed), PRA&apos;s is not confirmed yet.
      </p>
      {data.items.length === 0 ? <p className="text-[var(--text-tertiary)]">Nothing waiting — every invoice has been reported.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-[var(--text-secondary)]">
              <tr><th className="py-1 pr-3">Bill</th><th className="py-1 pr-3">Sale time</th><th className="py-1 pr-3">Age</th><th className="py-1 pr-3 text-right">Total</th><th className="py-1 pr-3">Status</th><th className="py-1">Last error</th></tr>
            </thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.tab_id} data-testid="fiscal-row" data-warning={i.warning ? 'yes' : 'no'}
                  className={`border-t border-[var(--border-light)] align-top ${i.warning ? 'bg-red-50 text-red-900 dark:bg-red-900/20 dark:text-red-200' : ''}`}>
                  <td className="py-1.5 pr-3 font-medium">{i.bill_number ? `#${i.bill_number}` : '—'}{i.issued_offline && <span className="ml-1 badge bg-amber-100 text-amber-800">offline</span>}</td>
                  <td className="py-1.5 pr-3">{new Date(i.sale_time).toLocaleString()}</td>
                  <td className="py-1.5 pr-3">{i.warning && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />}{age(i.age_hours)}</td>
                  <td className="py-1.5 pr-3 text-right">Rs. {i.total.toLocaleString()}</td>
                  <td className="py-1.5 pr-3 capitalize">{i.status}{i.attempts ? ` · ${i.attempts} tr${i.attempts === 1 ? 'y' : 'ies'}` : ''}</td>
                  <td className="py-1.5 text-[var(--text-secondary)]">{i.error || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
