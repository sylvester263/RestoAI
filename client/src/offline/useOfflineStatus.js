import { useEffect, useState, useCallback } from 'react';
import { subscribeOnline } from './connectivity';
import { subscribe, getSyncState, pendingSummary, syncNow } from './sync';

/**
 * Online state + outbox counts for the offline banner and the till.
 * While online with anything pending, retries the sync every 30 s.
 */
export default function useOfflineStatus() {
  const [online, setOnline] = useState(true);
  const [sync, setSync] = useState(getSyncState());
  // loaded: false until the outbox has been read once, so nothing shows a
  // misleading "0 waiting" during start-up.
  const [summary, setSummary] = useState({ pending: 0, flagged: 0, errors: 0, loaded: false });

  const refresh = useCallback(() => {
    pendingSummary().then((s) => setSummary({ ...s, loaded: true })).catch(() => {});
  }, []);

  useEffect(() => subscribeOnline(setOnline), []);
  useEffect(() => subscribe((s) => { setSync(s); refresh(); }), [refresh]);
  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener('pos-outbox-changed', onChange);
    return () => window.removeEventListener('pos-outbox-changed', onChange);
  }, [refresh]);
  useEffect(() => {
    if (!online || summary.pending === 0) return undefined;
    syncNow();
    const t = setInterval(syncNow, 30_000);
    return () => clearInterval(t);
  }, [online, summary.pending]);

  return { online, ...summary, syncing: sync.syncing, lastSyncedAt: sync.lastSyncedAt, refresh };
}

/** Tell every useOfflineStatus() the outbox changed (after a till action). */
export function notifyOutboxChanged() {
  window.dispatchEvent(new Event('pos-outbox-changed'));
}
