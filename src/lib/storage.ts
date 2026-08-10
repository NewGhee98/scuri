import type {
  LegacyStoredMultiPageProject,
  LegacyStoredProject,
  StoredProject,
  StoredProjectLibrary,
} from "./types";

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

export function saveProjects(projects: StoredProject[]): void {
  const library: StoredProjectLibrary = { version: 1, projects };
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(library));
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

function isStoredProject(project: unknown): project is StoredProject {
  if (!project || typeof project !== "object") return false;
  const value = project as Partial<StoredProject>;
  return value.version === 3 &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.formatId === "instagram-post" || value.formatId === "instagram-square" || value.formatId === "instagram-story") &&
    Array.isArray(value.pages) &&
    value.pages.every((page) => page && typeof page.photos === "object") &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string";
}

export function loadProjects(): StoredProject[] {
  const libraryRaw = localStorage.getItem(PROJECTS_KEY);
  if (libraryRaw) {
    try {
      const library = JSON.parse(libraryRaw) as StoredProjectLibrary;
      if (library.version !== 1 || !Array.isArray(library.projects)) return [];
      return library.projects.filter(isStoredProject);
    } catch {
      return [];
    }
  }

  const raw = localStorage.getItem(PROJECT_KEY) ?? localStorage.getItem(LEGACY_PROJECT_KEY);
  if (!raw) return [];
  try {
    const project = JSON.parse(raw) as LegacyStoredMultiPageProject | LegacyStoredProject;
    const migrated = project.version === 1 ? migrateLegacyProject(project) : migrateMultiPageProject(project);
    if (!migrated) return [];
    saveProjects([migrated]);
    return [migrated];
  } catch {
    return [];
  }
}

export function clearLegacySavedProject(): void {
  localStorage.removeItem(PROJECT_KEY);
  localStorage.removeItem(LEGACY_PROJECT_KEY);
}
