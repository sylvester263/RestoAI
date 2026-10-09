/**
 * Online POS page: keeps the device ready for offline use and shows its
 * offline state (impl-33 Part 4) — bill-number ranges, menu snapshot age,
 * who can PIN-unlock here, this device's offline bills and, for managers,
 * the queue of offline actions the server held for review.
 */
import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, KeyRound, Trash2, WifiOff } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/ui/Modal';
import { toast } from '../components/ui/toast';
import { prepareOffline, SNAPSHOT_REFRESH_MS } from './prepare';
import { getDeviceId, getSnapshot, listBills } from './store';
import { listEnrollments, saveEnrollment, removeEnrollment } from './pin';
import BillsList from './BillsList';
import { LocalReceipt } from './OfflineTill';
import useOfflineStatus from './useOfflineStatus';

export default function OfflineSetupPanel({ branchId }) {
  const { user, tenant } = useAuth();
  const { syncing, pending } = useOfflineStatus();
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState(null);
  const [device, setDevice] = useState(null);
  const [enrolled, setEnrolled] = useState([]);
  const [bills, setBills] = useState([]);
  const [snap, setSnap] = useState(null);
  const [review, setReview] = useState(null);
  const [showEnroll, setShowEnroll] = useState(false);
  const [error, setError] = useState('');
  const [reprint, setReprint] = useState(null);
  const isManager = user.role === 'owner' || user.role === 'manager';

  const refreshLocal = useCallback(async () => {
    const [e, b, s] = await Promise.all([listEnrollments(), listBills(branchId), getSnapshot(branchId)]);
    setEnrolled(e.filter((r) => r.tenant?.id === user.tenant_id));
    setBills(b);
    setSnap(s);
  }, [branchId, user.tenant_id]);

  const prepare = useCallback(async () => {
    if (!branchId) return;
    try {
      const res = await prepareOffline({ branchId, user });
      setInfo(res);
      setError('');
      const dev = await api.getPosDevice(res.deviceId);
      setDevice(dev);
    } catch (err) {
      setError(err.message);
    }
    await refreshLocal();
  }, [branchId, user, refreshLocal]);

  useEffect(() => {
    prepare();
    const t = setInterval(prepare, SNAPSHOT_REFRESH_MS);
    return () => clearInterval(t);
  }, [prepare]);
  useEffect(() => { refreshLocal(); }, [syncing, pending, refreshLocal]);

  useEffect(() => {
    if (!open || !isManager || user.offline_session) return;
    api.getPosSyncReview().then((r) => setReview(r.items)).catch(() => setReview(null));
  }, [open, isManager, user.offline_session, syncing]);

  const [resolving, setResolving] = useState(null); // review item
  async function resolve(note) {
    try {
      await api.resolvePosSyncReview(resolving.id, note);
      setReview((r) => r.filter((x) => x.id !== resolving.id));
      setResolving(null);
    } catch (err) {
      toast.error(err.message);
    }
  }

  const blocks = device?.blocks?.filter((b) => b.branch_id === branchId) || [];
  const me = enrolled.find((r) => r.user_id === user.id);

  return (
    <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface-2)]" data-testid="offline-panel">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-[var(--text-primary)]" aria-expanded={open}>
        <WifiOff className="h-4 w-4" /> Offline mode on this device
        <span className="ml-2 text-xs font-normal text-[var(--text-secondary)]">
          {error ? `Not ready: ${error}` : info ? `Ready · ${info.remaining} bill numbers · menu saved ${new Date(info.snapshotAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Preparing…'}
        </span>
        <ChevronDown className={`ml-auto h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && (
        <div className="space-y-5 border-t border-[var(--border-light)] px-4 py-4 text-sm">
          <div>
            <h3 className="mb-1 font-semibold">Bill numbers for this device</h3>
            <p className="mb-2 text-xs text-[var(--text-secondary)]">
              Each device gets its own block of bill numbers so bills made offline on two tills never clash.
              Numbers left unused in a block are skipped, so gaps in the bill sequence are normal and don&apos;t mean a bill is missing.
            </p>
            {blocks.length === 0 ? <p className="text-[var(--text-tertiary)]">No block yet.</p> : (
              <ul className="space-y-0.5" data-testid="device-ranges">
                {blocks.map((b) => (
                  <li key={b.id}>#{Number(b.range_start)}–#{Number(b.range_end)} <span className="text-xs text-[var(--text-tertiary)]">leased {new Date(b.leased_at).toLocaleDateString()}{b.highest_synced ? ` · highest synced #${b.highest_synced}` : ''}</span></li>
                ))}
              </ul>
            )}
            {info?.deviceId && <p className="mt-1 text-xs text-[var(--text-tertiary)]">Device {info.deviceId.slice(0, 8)}</p>}
          </div>

          <div>
            <h3 className="mb-1 font-semibold">PIN unlock</h3>
            <p className="mb-2 text-xs text-[var(--text-secondary)]">
              People set up here can unlock the till with their POS PIN when the internet is down. A PIN session can only sell (cash) — nothing else.
            </p>
            {enrolled.length > 0 && (
              <ul className="mb-2 space-y-1">
                {enrolled.map((r) => (
                  <li key={r.user_id} className="flex items-center gap-2">
                    <KeyRound className="h-3.5 w-3.5" /> {r.name} <span className="text-xs text-[var(--text-tertiary)]">({r.role})</span>
                    {(r.user_id === user.id || isManager) && (
                      <button type="button" onClick={async () => { await removeEnrollment(r.user_id); refreshLocal(); }} className="ml-auto text-[var(--text-tertiary)] hover:text-red-600" aria-label={`Remove ${r.name} from this device`}><Trash2 className="h-3.5 w-3.5" /></button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!me && !user.offline_session && (
              <button type="button" onClick={() => setShowEnroll(true)} className="btn-secondary text-sm" data-testid="enroll-pin"><KeyRound className="h-4 w-4" /> Set up PIN unlock for me</button>
            )}
          </div>

          <BillsList bills={bills} taxRate={snap?.tax?.rate || 0} onReprint={setReprint} />

          {isManager && review && review.length > 0 && (
            <div>
              <h3 className="mb-1 font-semibold text-red-700 dark:text-red-300">Held for review ({review.length})</h3>
              <p className="mb-2 text-xs text-[var(--text-secondary)]">Offline actions the server didn&apos;t apply on its own. Check them, re-enter the sale if needed, then mark them resolved.</p>
              <ul className="space-y-1">
                {review.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-2 rounded border border-[var(--border)] px-3 py-2 text-xs">
                    <span className="font-medium">{item.action_type.replace('_', ' ')}</span>
                    {item.payload?.bill_number && <span>bill #{item.payload.bill_number}</span>}
                    <span className="text-[var(--text-secondary)]">{item.user_name} · {new Date(item.created_at).toLocaleString()}</span>
                    <span className="badge bg-red-100 text-red-800">{item.reason.replace(/_/g, ' ')}</span>
                    <button type="button" onClick={() => setResolving(item)} className="ml-auto text-brand-600 hover:underline">Mark resolved…</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {showEnroll && (
        <EnrollModal
          onClose={() => setShowEnroll(false)}
          onEnroll={async (pin) => {
            const deviceId = await getDeviceId();
            const res = await api.enrollPosPin({ pin, device_id: deviceId });
            await saveEnrollment({ user: res.user, tenant, pin, posToken: res.pos_token, tokenExpiresAt: res.expires_at, branchId });
            setShowEnroll(false);
            toast.success('PIN unlock is set up on this device');
            refreshLocal();
          }}
        />
      )}
      {resolving && <ResolveModal item={resolving} onClose={() => setResolving(null)} onResolve={resolve} />}
      {reprint && <LocalReceipt bill={reprint} snap={snap} tenant={tenant} taxRate={snap?.tax?.rate || 0} onClose={() => setReprint(null)} />}
    </div>
  );
}

function EnrollModal({ onClose, onEnroll }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onEnroll(pin);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Set up PIN unlock" size="sm">
      <form onSubmit={submit}>
        <p className="mb-3 text-sm text-[var(--text-secondary)]">Enter your POS PIN (a manager sets it on the Staff page). The PIN is checked online now; afterwards it unlocks this till even without internet.</p>
        <input className="input mb-2 text-center text-lg tracking-widest" type="password" inputMode="numeric" autoComplete="off" maxLength={6}
          value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="PIN" autoFocus data-testid="enroll-pin-input" />
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={busy || pin.length < 4} className="btn-primary w-full justify-center">{busy ? 'Checking…' : 'Set up'}</button>
      </form>
    </Modal>
  );
}

function ResolveModal({ item, onClose, onResolve }) {
  const [note, setNote] = useState('');
  return (
    <Modal open onClose={onClose} title="Mark resolved" size="sm">
      <p className="mb-2 text-sm text-[var(--text-secondary)]">{item.action_type.replace('_', ' ')} · {item.reason.replace(/_/g, ' ')}. What did you do about it?</p>
      <textarea className="input mb-3 min-h-[80px]" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} autoFocus />
      <button type="button" disabled={!note.trim()} onClick={() => onResolve(note.trim())} className="btn-primary w-full justify-center">Mark resolved</button>
    </Modal>
  );
}
