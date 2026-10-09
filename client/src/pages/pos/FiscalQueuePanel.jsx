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
import Modal from '../../components/ui/Modal';

const PROVIDER_LABEL = { pra: 'PRA', fbr: 'FBR', stub: 'Stub (test)', none: 'None' };

function age(hours) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.floor(hours)} h ${Math.round((hours % 1) * 60)} min`;
  return `${Math.floor(hours / 24)} days`;
}

export default function FiscalQueuePanel() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState(null); // { item, mode: 'resubmit' | 'reported' }

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
              <tr><th className="py-1 pr-3">Bill</th><th className="py-1 pr-3">Sale time</th><th className="py-1 pr-3">Age</th><th className="py-1 pr-3 text-right">Total</th><th className="py-1 pr-3">Status</th><th className="py-1 pr-3">Last error</th><th className="py-1" /></tr>
            </thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.tab_id} data-testid="fiscal-row" data-warning={i.warning ? 'yes' : 'no'}
                  className={`border-t border-[var(--border-light)] align-top ${i.warning ? 'bg-red-50 text-red-900 dark:bg-red-900/20 dark:text-red-200' : ''}`}>
                  <td className="py-1.5 pr-3 font-medium">{i.bill_number ? `#${i.bill_number}` : '—'}{i.issued_offline && <span className="ml-1 badge bg-amber-100 text-amber-800">offline</span>}</td>
                  <td className="py-1.5 pr-3">{new Date(i.sale_time).toLocaleString()}</td>
                  <td className="py-1.5 pr-3">{i.warning && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />}{age(i.age_hours)}</td>
                  <td className="py-1.5 pr-3 text-right">Rs. {i.total.toLocaleString()}</td>
                  <td className="py-1.5 pr-3">{i.status === 'unknown' ? 'Unknown — check with the authority' : <span className="capitalize">{i.status}</span>}{i.attempts ? ` · ${i.attempts} tr${i.attempts === 1 ? 'y' : 'ies'}` : ''}</td>
                  <td className="py-1.5 pr-3 text-[var(--text-secondary)]">{i.error_code && <span className="mr-1 font-mono">[{i.error_code}]</span>}{i.error || '—'}</td>
                  <td className="whitespace-nowrap py-1.5 text-right">
                    {i.status === 'unknown' && <button type="button" onClick={() => setActing({ item: i, mode: 'reported' })} className="mr-2 text-brand-600 hover:underline">Mark reported…</button>}
                    {(i.status === 'unknown' || i.status === 'failed') && <button type="button" onClick={() => setActing({ item: i, mode: 'resubmit' })} className="text-brand-600 hover:underline" data-testid="fiscal-resubmit">Resubmit…</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {acting && <ActionModal acting={acting} onClose={() => setActing(null)} onDone={(res) => { setActing(null); if (res) setData(res); }} />}
    </div>
  );
}

function ActionModal({ acting, onClose, onDone }) {
  const { item, mode } = acting;
  const [confirmed, setConfirmed] = useState(false);
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const res = mode === 'reported'
        ? await api.markFiscalReported(item.tab_id, number.trim())
        : await api.resubmitFiscalInvoice(item.tab_id, confirmed);
      toast.success(mode === 'reported' ? 'Marked as reported' : `Resubmitted: ${res.outcome || 'done'}`);
      onDone(res);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }
  const unknown = item.status === 'unknown';
  return (
    <Modal open onClose={onClose} title={`${item.bill_number ? `Bill #${item.bill_number}` : 'This bill'} — ${mode === 'reported' ? 'mark as reported' : 'resubmit'}`} size="sm">
      {mode === 'reported' ? (
        <>
          <p className="mb-2 text-sm text-[var(--text-secondary)]">If you found this invoice recorded with the tax authority, enter the invoice number it was given.</p>
          <input className="input mb-3 font-mono" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Invoice number" autoFocus />
          <button type="button" disabled={busy || number.trim().length < 5} onClick={go} className="btn-primary w-full justify-center">Mark as reported</button>
        </>
      ) : (
        <>
          <p className="mb-2 text-sm text-[var(--text-secondary)]">
            {unknown
              ? 'The last attempt got no clear answer, so the tax authority may already have this invoice. Resubmitting a recorded invoice could create a duplicate.'
              : 'Fix whatever the error says (for example the HS code or rate in the FBR settings), then resubmit.'}
          </p>
          {unknown && (
            <label className="mb-3 flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              I checked and this invoice is not recorded with the tax authority.
            </label>
          )}
          <button type="button" disabled={busy || (unknown && !confirmed)} onClick={go} className="btn-primary w-full justify-center">Resubmit now</button>
        </>
      )}
    </Modal>
  );
}
