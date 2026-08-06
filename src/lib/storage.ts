import type { StoredProject } from "./types";

const PROJECT_KEY = "layouts.current-project.v1";
const DB_NAME = "layouts-local-photos";
const DB_VERSION = 1;
const STORE_NAME = "photos";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("Local photo recovery is unavailable in this browser."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("The browser could not open local photo storage."));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void,
): Promise<T> {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(new Error("The browser could not update local photo storage."));
    };
    operation(store, resolve, reject);
  });
}

export async function savePhotoBlob(key: string, blob: Blob): Promise<void> {
  return withStore<void>("readwrite", (store, resolve, reject) => {
    const request = store.put(blob, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function loadPhotoBlob(key: string): Promise<Blob | null> {
  return withStore<Blob | null>("readonly", (store, resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
    request.onerror = () => reject(request.error);
  });
}

export async function deletePhotoBlob(key: string): Promise<void> {
  return withStore<void>("readwrite", (store, resolve, reject) => {
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export function saveProject(project: StoredProject): void {
  localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
}

export function loadProject(): StoredProject | null {
  const raw = localStorage.getItem(PROJECT_KEY);
  if (!raw) return null;
  try {
    const project = JSON.parse(raw) as StoredProject;
    if (project.version !== 1 || typeof project.photos !== "object") return null;
    return project;
  } catch {
    return null;
  }
}

export function clearSavedProject(): void {
  localStorage.removeItem(PROJECT_KEY);
}
