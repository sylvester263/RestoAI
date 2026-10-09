/**
 * Is the RestoAI server reachable? navigator.onLine alone says "online" on a
 * Wi-Fi with no internet, so the till also pings the server. One shared
 * poller for the whole app; going from offline to online starts a sync.
 */
import { syncNow } from './sync';

const PING_MS = 15_000;
const listeners = new Set();
let online = typeof navigator === 'undefined' ? true : navigator.onLine;
let timer = null;

function set(next) {
  if (next === online) return;
  online = next;
  for (const fn of listeners) fn(online);
  if (online) syncNow();
}

export async function checkNow() {
  if (!navigator.onLine) { set(false); return false; }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch('/api/pos-offline/ping', { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(t);
    set(res.ok);
  } catch {
    set(false);
  }
  return online;
}

function start() {
  if (timer) return;
  window.addEventListener('online', checkNow);
  window.addEventListener('offline', () => set(false));
  timer = setInterval(checkNow, PING_MS);
  checkNow();
}

export function subscribeOnline(fn) {
  start();
  listeners.add(fn);
  fn(online);
  return () => listeners.delete(fn);
}

export const isOnline = () => online;
