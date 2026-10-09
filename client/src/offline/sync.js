/**
 * Offline outbox sync (impl-33 Part 4).
 *
 * Replays queued actions one at a time in `seq` order (so each bill's
 * open → items → settle arrive in the order they happened). Every action
 * carries the client_request_id it was queued with, so if the connection
 * dies mid-sync and the device replays, the server answers "duplicate"
 * instead of creating anything twice.
 *
 *  - network failure  → stop, try again later (nothing is marked)
 *  - applied/duplicate → done
 *  - flagged          → held for a manager on the server; the bill shows it
 *  - rejected (4xx)   → error on that bill; its later actions wait
 *  - 409 retry / no token for that cashier → that bill waits, others continue
 */
import { tx, getAll, put, get } from './db';
import { getEnrollment, removeEnrollment } from './pin';
import { getDeviceId } from './store';

const listeners = new Set();
let state = { syncing: false, lastSyncedAt: null, lastError: null };
let running = null;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(patch) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn(state);
}
export const getSyncState = () => state;

/** Bills with at least one action still waiting (what the banner counts). */
export async function pendingSummary() {
  const outbox = await getAll('outbox');
  const pendingBills = new Set(outbox.filter((a) => a.status === 'pending').map((a) => a.tab_cid));
  const flagged = new Set(outbox.filter((a) => a.status === 'flagged').map((a) => a.tab_cid));
  const errors = new Set(outbox.filter((a) => a.status === 'error').map((a) => a.tab_cid));
  return { pending: pendingBills.size, flagged: flagged.size, errors: errors.size };
}

function tokenExpired(exp) {
  return !exp || Date.parse(exp) <= Date.now() + 60_000;
}

/**
 * A token to send this person's action with: their own PIN-session token,
 * the current session if it's them, or — when they have none here (left,
 * or removed and signed out) — a manager/owner signed in on this device,
 * who relays it. The server still applies every rule to the cashier.
 */
async function tokenFor(userId) {
  const rec = await getEnrollment(userId);
  if (rec?.pos_token && !tokenExpired(rec.token_expires_at)) return rec.pos_token;
  try {
    const sessionUser = JSON.parse(localStorage.getItem('user') || 'null');
    const sessionToken = localStorage.getItem('token');
    if (sessionUser?.id === userId && sessionToken) return sessionToken;
    if (sessionToken && (sessionUser?.role === 'owner' || sessionUser?.role === 'manager')) return sessionToken;
  } catch { /* ignore */ }
  return null;
}

async function markAction(action, patch, billPatch) {
  await tx(['outbox', 'bills'], 'readwrite', async (s, p) => {
    await p(s.outbox.put({ ...action, ...patch }));
    if (billPatch) {
      const bill = await p(s.bills.get(action.tab_cid));
      if (bill) await p(s.bills.put(billPatch(bill)));
    }
  });
}

function billStatusAfter(bill, outboxForBill) {
  if (outboxForBill.some((a) => a.status === 'error')) return 'error';
  if (outboxForBill.some((a) => a.status === 'flagged')) return 'flagged';
  if (outboxForBill.some((a) => a.status === 'pending')) return 'pending';
  return 'synced';
}

async function refreshBillStatuses() {
  const [outbox, bills] = await Promise.all([getAll('outbox'), getAll('bills')]);
  for (const bill of bills) {
    const mine = outbox.filter((a) => a.tab_cid === bill.cid);
    const sync = billStatusAfter(bill, mine);
    if (sync !== bill.sync) await put('bills', { ...bill, sync });
  }
}

async function postAction(action, token, pendingCount) {
  const res = await fetch('/api/pos-offline/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      client_request_id: action.client_request_id,
      device_id: action.device_id,
      tab_client_id: action.tab_cid,
      type: action.type,
      payload: action.payload,
      created_at: action.created_at,
      snapshot_at: action.snapshot_at || undefined,
      pending_count: pendingCount,
      actor_user_id: action.user_id,
    }),
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
}

async function runSync() {
  emit({ syncing: true, lastError: null });
  const waitingTabs = new Set();
  const pinChangedUsers = new Set();
  let stoppedByNetwork = false;
  try {
    const outbox = (await getAll('outbox')).filter((a) => a.status === 'pending').sort((a, b) => a.seq - b.seq);
    const errored = new Set((await getAll('outbox')).filter((a) => a.status === 'error').map((a) => a.tab_cid));
    let remaining = new Set(outbox.map((a) => a.tab_cid)).size;

    for (const action of outbox) {
      if (waitingTabs.has(action.tab_cid) || errored.has(action.tab_cid)) continue;
      const token = await tokenFor(action.user_id);
      if (!token) { waitingTabs.add(action.tab_cid); continue; }

      let res;
      try {
        res = await postAction(action, token, remaining);
      } catch {
        stoppedByNetwork = true;
        break; // connection gone — everything stays pending, replay is safe
      }
      const d = res.data || {};
      if (d.pin_changed) pinChangedUsers.add(action.user_id);

      if (res.status === 200 && (d.status === 'applied' || d.status === 'duplicate')) {
        await markAction(action, { status: 'done', result: d, synced_at: new Date().toISOString() }, (bill) => ({
          ...bill,
          server_tab_id: d.tab_id || bill.server_tab_id,
          primary_order_id: d.primary_order_id || bill.primary_order_id,
          server_total: d.total ?? bill.server_total,
          flags: [...new Set([...(bill.flags || []), ...(d.flags || []), ...(d.sync_flags || [])])],
        }));
      } else if (res.status === 200 && d.status === 'flagged') {
        // Held for a manager. The bill's later actions are still sent: the
        // server files them under the same review instead of applying them.
        await markAction(action, { status: 'flagged', result: d }, (bill) => ({ ...bill, review_reason: d.reason }));
      } else if (res.status === 409 || res.status === 401 || res.status >= 500 || d.status === 'retry') {
        // not yet (bill not opened server-side / token expired / no one here may relay it / server trouble)
        waitingTabs.add(action.tab_cid);
        if (res.status >= 500) emit({ lastError: d?.error?.message || `Server error ${res.status}` });
      } else {
        await markAction(action, { status: 'error', error: d?.error?.message || `Rejected (${res.status})`, result: d }, (bill) => ({ ...bill, sync_error: d?.error?.message }));
        errored.add(action.tab_cid);
      }
      if (!waitingTabs.has(action.tab_cid)) {
        const left = (await getAll('outbox')).filter((a) => a.status === 'pending');
        remaining = new Set(left.map((a) => a.tab_cid)).size;
      }
    }

    // A PIN that was changed on the server retires this device's offline
    // unlock for that person once nothing of theirs is left to send.
    if (pinChangedUsers.size) {
      const left = (await getAll('outbox')).filter((a) => a.status === 'pending');
      for (const userId of pinChangedUsers) {
        if (!left.some((a) => a.user_id === userId)) await removeEnrollment(userId);
      }
    }
    await refreshBillStatuses();
    if (!stoppedByNetwork) await reportPending();
    emit({ syncing: false, lastSyncedAt: stoppedByNetwork ? state.lastSyncedAt : new Date().toISOString(), stoppedByNetwork });
  } catch (err) {
    emit({ syncing: false, lastError: err.message });
  }
}

/** Tell the server how many sales this device still holds (shift close reads it). */
export async function reportPending() {
  const token = localStorage.getItem('token');
  const branchId = await get('meta', 'active_branch');
  if (!token || !branchId?.value) return;
  const { pending } = await pendingSummary();
  try {
    await fetch('/api/pos-offline/devices/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ device_id: await getDeviceId(), branch_id: branchId.value, pending_count: pending }),
    });
  } catch { /* offline — next sync reports it */ }
}

/** Start a sync unless one is already running (then share it). */
export function syncNow() {
  if (!running) running = runSync().finally(() => { running = null; });
  return running;
}
