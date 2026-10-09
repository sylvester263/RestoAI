import { useEffect, useState } from 'react';
import { WifiOff, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import useOfflineStatus from './useOfflineStatus';
import { getActiveBranch, getSnapshot } from './store';
import { syncNow } from './sync';

function timeAgo(iso) {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours} h ago` : new Date(iso).toLocaleString();
}

/**
 * impl-33 Part 4: never-silent offline state.
 * "Offline — N sales waiting to sync" → "Syncing…" → "All synced".
 */
export default function OfflineBanner() {
  const { online, pending, flagged, errors, syncing, lastSyncedAt, loaded } = useOfflineStatus();
  const [snapshotAt, setSnapshotAt] = useState(null);
  const [showSynced, setShowSynced] = useState(false);

  useEffect(() => {
    getActiveBranch().then((b) => (b ? getSnapshot(b) : null)).then((s) => setSnapshotAt(s?.snapshot_at || null)).catch(() => {});
  }, [online, syncing]);

  // Show "All synced" for a few seconds after a sync empties the outbox.
  useEffect(() => {
    if (!online || syncing || pending > 0 || !lastSyncedAt) return undefined;
    setShowSynced(true);
    const t = setTimeout(() => setShowSynced(false), 6000);
    return () => clearTimeout(t);
  }, [online, syncing, pending, lastSyncedAt]);

  const sales = (n) => `${n} sale${n === 1 ? '' : 's'}`;
  let tone = null;
  let content = null;
  if (!online) {
    tone = 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200';
    content = (
      <>
        <WifiOff className="h-4 w-4 shrink-0" />
        <span className="font-semibold">{loaded ? `Offline — ${sales(pending)} waiting to sync` : 'Offline'}</span>
        <span className="text-xs opacity-80">· menu last updated {timeAgo(snapshotAt)}</span>
      </>
    );
  } else if (syncing) {
    tone = 'border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-200';
    content = (<><RefreshCw className="h-4 w-4 shrink-0 animate-spin" /><span className="font-semibold">Syncing… {pending > 0 ? `${sales(pending)} left` : ''}</span></>);
  } else if (pending > 0) {
    tone = 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200';
    content = (
      <>
        <RefreshCw className="h-4 w-4 shrink-0" />
        <span className="font-semibold">{sales(pending)} waiting to sync</span>
        <button type="button" onClick={() => syncNow()} className="ml-auto rounded border border-current px-2 py-0.5 text-xs">Sync now</button>
      </>
    );
  } else if (showSynced) {
    tone = 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200';
    content = (<><CheckCircle2 className="h-4 w-4 shrink-0" /><span className="font-semibold">All synced</span></>);
  }

  return (
    <>
      {content && (
        <div role="status" aria-live="polite" data-testid="offline-banner" className={`mb-3 flex flex-wrap items-center gap-2 rounded-lg border px-4 py-2 text-sm ${tone}`}>
          {content}
        </div>
      )}
      {(flagged > 0 || errors > 0) && (
        <div role="alert" className="mb-3 flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {flagged > 0 && <span>{flagged} offline bill{flagged === 1 ? '' : 's'} held for manager review.</span>}
          {errors > 0 && <span>{errors} offline bill{errors === 1 ? '' : 's'} could not sync — see the bills list.</span>}
        </div>
      )}
    </>
  );
}
