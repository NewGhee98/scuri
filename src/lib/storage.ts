import type { LegacyStoredProject, StoredProject } from "./types";

const PROJECT_KEY = "layouts.current-project.v2";
const LEGACY_PROJECT_KEY = "layouts.current-project.v1";
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

export function migrateLegacyProject(project: LegacyStoredProject): StoredProject | null {
  if (!project.formatId || !project.templateId || typeof project.photos !== "object") return null;
  const now = project.updatedAt || new Date().toISOString();
  const pageId = crypto.randomUUID();
  return {
    version: 2,
    id: crypto.randomUUID(),
    name: "My project",
    screen: project.screen === "export" ? "project" : project.screen,
    formatId: project.formatId,
    activePageId: pageId,
    pages: [
      {
        id: pageId,
        templateId: project.templateId,
        background: project.background,
        gutter: project.gutter,
        selectedFrameId: project.selectedFrameId,
        photos: project.photos,
        createdAt: now,
        updatedAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

export function loadProject(): StoredProject | null {
  const raw = localStorage.getItem(PROJECT_KEY) ?? localStorage.getItem(LEGACY_PROJECT_KEY);
  if (!raw) return null;
  try {
    const project = JSON.parse(raw) as StoredProject | LegacyStoredProject;
    if (project.version === 1) return migrateLegacyProject(project);
    if (
      project.version !== 2 ||
      !Array.isArray(project.pages) ||
      typeof project.name !== "string" ||
      project.pages.some((page) => typeof page.photos !== "object")
    ) return null;
    return project;
  } catch {
    return null;
  }
}

export function clearSavedProject(): void {
  localStorage.removeItem(PROJECT_KEY);
  localStorage.removeItem(LEGACY_PROJECT_KEY);
}
