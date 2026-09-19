/** Cache eviction only touches derived entries, never original blobs or jobs. */
export interface DerivedEntry<T = unknown> { blob?: Blob; data?: T; bytes: number; touched: number }
const LIMIT = 128 * 1024 * 1024;
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    if (typeof indexedDB === "undefined") { reject(new Error("Local cache storage is unavailable.")); return; }
    const request = indexedDB.open("scuri-photo-cache-v1", 1);
    request.onupgradeneeded = () => { request.result.createObjectStore("derived"); request.result.createObjectStore("jobs"); };
    request.onerror = () => reject(new Error("Local cache storage could not be opened."));
    request.onblocked = () => { blocked = true; reject(new Error("Close older Scuri tabs to open local cache storage.")); };
    request.onsuccess = () => { if (blocked) { request.result.close(); return; } request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
}
async function transact<T>(name: "derived" | "jobs", mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    let value: T;
    let transaction: IDBTransaction;
    try { transaction = db.transaction(name, mode); }
    catch (error) { db.close(); reject(error); return; }
    transaction.oncomplete = () => { db.close(); resolve(value); };
    transaction.onabort = transaction.onerror = () => { db.close(); reject(new Error("Local cache storage could not commit. Free device storage and retry.")); };
    try { operation(transaction.objectStore(name), next => { value = next; }); }
    catch (error) { transaction.abort(); reject(error); }
  });
}
export async function readDerived<T = unknown>(key: string): Promise<DerivedEntry<T> | null> {
  try { return await transact("derived", "readonly", (store, done) => { const request = store.get(key); request.onsuccess = () => done(request.result ?? null); }); }
  catch { return null; }
}
export async function writeDerived<T>(key: string, value: { blob?: Blob; data?: T }): Promise<void> {
  const bytes = (value.blob?.size ?? 0) + JSON.stringify(value.data ?? null).length * 2;
  if (bytes > LIMIT) return;
  try {
    const quota = typeof navigator !== "undefined" ? await navigator.storage?.estimate?.().catch(() => undefined) : undefined;
    const budget = Math.min(LIMIT, Math.max(8 * 1024 * 1024, (quota?.quota ?? LIMIT * 10) * 0.1));
    if (bytes > budget) return;
    await transact<void>("derived", "readwrite", (store, done) => {
      const entries: Array<{ key: IDBValidKey; bytes: number; touched: number }> = [];
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) { if (cursor.key !== key) entries.push({ key: cursor.key, bytes: cursor.value.bytes, touched: cursor.value.touched }); cursor.continue(); return; }
        let total = entries.reduce((sum, entry) => sum + entry.bytes, 0) + bytes;
        for (const entry of entries.sort((a, b) => a.touched - b.touched)) {
          if (total <= budget) break;
          store.delete(entry.key); total -= entry.bytes;
        }
        store.put({ ...value, bytes, touched: Date.now() }, key); done();
      };
    });
  } catch { /* Cache failure must not change membership or original availability. */ }
}
/** Safe quota recovery: only disposable derived data, never jobs or originals. */
export async function clearDerivedCache(): Promise<void> {
  return transact("derived", "readwrite", (store, done) => { store.clear(); done(); });
}
export async function readPhotoJob<T>(key: string): Promise<T | null> {
  return transact("jobs", "readonly", (store, done) => { const request = store.get(key); request.onsuccess = () => done(request.result ?? null); });
}
export async function writePhotoJob<T>(key: string, value: T): Promise<void> {
  return transact("jobs", "readwrite", (store, done) => { store.put(value, key); done(); });
}
export async function removePhotoJob(key: string): Promise<void> {
  return transact("jobs", "readwrite", (store, done) => { store.delete(key); done(); });
}
export async function listPhotoJobs<T>(prefix: string): Promise<Array<{ key: string; value: T }>> {
  return transact("jobs", "readonly", (store, done) => {
    const result: Array<{ key: string; value: T }> = [], request = store.openCursor();
    request.onsuccess = () => { const cursor = request.result;
      if (!cursor) { done(result); return; }
      if (typeof cursor.key === "string" && cursor.key.startsWith(prefix)) result.push({ key: cursor.key, value: cursor.value });
      cursor.continue(); };
  });
}
