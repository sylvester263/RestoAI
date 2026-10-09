/**
 * IndexedDB for the offline POS (impl-33 Part 4). Holds only what a till
 * needs to keep selling: the menu/table snapshot, this device's bill-number
 * blocks, the outbox of queued actions, local copies of offline bills, and
 * per-person offline-unlock records (PBKDF2 hash + a POS-scoped token —
 * never an owner/admin session token).
 *
 * Stores:
 *  meta     { key, value }            device id, bill blocks, cached shifts
 *  snapshot { branch_id, ... }        menu, prices, tables, tax, snapshot_at
 *  outbox   { seq (auto), ... }       queued actions, replayed strictly in seq order
 *  bills    { cid, ... }              offline bills (cid = client id = open_tab request id)
 *  pins     { user_id, ... }          offline unlock records
 */
const DB_NAME = 'restoai-pos';
const DB_VERSION = 1;

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('snapshot')) db.createObjectStore('snapshot', { keyPath: 'branch_id' });
      if (!db.objectStoreNames.contains('outbox')) {
        const outbox = db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
        outbox.createIndex('tab_cid', 'tab_cid');
        outbox.createIndex('status', 'status');
      }
      if (!db.objectStoreNames.contains('bills')) {
        const bills = db.createObjectStore('bills', { keyPath: 'cid' });
        bills.createIndex('branch_id', 'branch_id');
      }
      if (!db.objectStoreNames.contains('pins')) db.createObjectStore('pins', { keyPath: 'user_id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

const asPromise = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/**
 * Run `fn(stores)` inside one transaction; resolves with fn's result once the
 * transaction has committed (so callers never see a write that later aborts).
 */
export async function tx(storeNames, mode, fn) {
  const db = await openDb();
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  return new Promise((resolve, reject) => {
    const t = db.transaction(names, mode);
    const stores = Object.fromEntries(names.map((n) => [n, t.objectStore(n)]));
    let result;
    Promise.resolve(fn(stores, asPromise)).then((r) => { result = r; }, (err) => { try { t.abort(); } catch { /* already done */ } reject(err); });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  });
}

export const get = (store, key) => tx(store, 'readonly', (s, p) => p(s[store].get(key)));
export const getAll = (store) => tx(store, 'readonly', (s, p) => p(s[store].getAll()));
export const put = (store, value) => tx(store, 'readwrite', (s, p) => p(s[store].put(value)));
export const del = (store, key) => tx(store, 'readwrite', (s, p) => p(s[store].delete(key)));

export async function getMeta(key, fallback = null) {
  const row = await get('meta', key);
  return row ? row.value : fallback;
}
export const setMeta = (key, value) => put('meta', { key, value });
