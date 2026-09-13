import type {
  LegacyStoredMultiPageProject,
  LegacyStoredProject,
  StoredProject,
  StoredProjectLibrary,
} from "./types";
import { isStoredProject, readProjectLibrary } from "./project-validation";
import { workspaceKey } from "./workspace";

const PROJECTS_KEY = "layouts.projects.v1";
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
    try {
      const transaction = database.transaction(STORE_NAME, mode);
      let result: T;
      transaction.oncomplete = () => { database.close(); resolve(result); };
      transaction.onerror = transaction.onabort = () => {
        database.close();
        reject(new Error("The browser could not commit local photo storage."));
      };
      // A successful request can still be followed by a failed transaction.
      operation(transaction.objectStore(STORE_NAME), (value) => { result = value; }, reject);
    } catch (error) {
      database.close();
      reject(error);
    }
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

export function saveProjects(projects: StoredProject[], ownerId?: string | null): void {
  if (!projects.every(isStoredProject)) throw new Error("Project data could not be validated. The last saved copy has been retained.");
  const key = workspaceKey(PROJECTS_KEY, ownerId);
  const previous = localStorage.getItem(key);
  if (previous) {
    try { readProjectLibrary(previous); } catch {
      // Preserve the exact damaged data before permitting a new library write.
      // If storage is full this throws, leaving the original key untouched.
      localStorage.setItem(`${key}.recovery.${Date.now()}.${crypto.randomUUID()}`, previous);
    }
  }
  const library: StoredProjectLibrary = { version: 1, projects };
  localStorage.setItem(key, JSON.stringify(library));
}

export function migrateLegacyProject(project: LegacyStoredProject): StoredProject | null {
  if (!project.formatId || !project.templateId || typeof project.photos !== "object") return null;
  const now = project.updatedAt || new Date().toISOString();
  const pageId = crypto.randomUUID();
  return {
    version: 3,
    id: crypto.randomUUID(),
    name: "My project",
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

export function migrateMultiPageProject(project: LegacyStoredMultiPageProject): StoredProject | null {
  if (!project.formatId || !Array.isArray(project.pages) || typeof project.name !== "string") return null;
  return {
    version: 3,
    id: project.id || crypto.randomUUID(),
    name: project.name.trim() || "Untitled project",
    formatId: project.formatId,
    activePageId: project.activePageId,
    pages: project.pages,
    createdAt: project.createdAt || project.updatedAt || new Date().toISOString(),
    updatedAt: project.updatedAt || new Date().toISOString(),
  };
}

export function loadProjects(ownerId?: string | null): StoredProject[] {
  const libraryRaw = localStorage.getItem(workspaceKey(PROJECTS_KEY, ownerId));
  if (libraryRaw) {
    return readProjectLibrary(libraryRaw);
  }
  if (ownerId) return []; // Never import another/unassigned workspace at sign-in.

  const raw = localStorage.getItem(PROJECT_KEY) ?? localStorage.getItem(LEGACY_PROJECT_KEY);
  if (!raw) return [];

  let project: LegacyStoredMultiPageProject | LegacyStoredProject;
  try {
    project = JSON.parse(raw) as LegacyStoredMultiPageProject | LegacyStoredProject;
  } catch {
    throw new Error("Older saved project data is damaged. The original data has been retained.");
  }

  const migrated = project.version === 1 ? migrateLegacyProject(project) : migrateMultiPageProject(project);
  if (!migrated || !isStoredProject(migrated)) throw new Error("Older project data could not be migrated. The original data has been retained.");

  // Do not swallow a failed write here: the caller must know migration did not
  // persist so it does not clear the legacy keys and lose the only saved copy.
  saveProjects([migrated]);
  return [migrated];
}

export function clearLegacySavedProject(): void {
  localStorage.removeItem(PROJECT_KEY);
  localStorage.removeItem(LEGACY_PROJECT_KEY);
}
