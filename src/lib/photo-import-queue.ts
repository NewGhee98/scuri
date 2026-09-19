import { getProjectPhotos, getVisibleProjectPhotos, MAX_PROJECT_PHOTOS, mergePhotoLibraries } from "./project-photo-library";
import { nextProjectEditTime } from "./project-time";
import type { ProjectPhoto, StoredProject } from "./types";

export interface PhotoImportSource { id: string; name: string; file: (signal: AbortSignal) => Promise<File>; release?: () => void }
export type ImportState = "queued" | "reading" | "checking" | "saving" | "imported" | "duplicate" | "failed" | "paused";
export interface PhotoImportItem { id: string; projectId: string; name: string; state: ImportState; detail?: string; blobKey?: string }
interface Dependencies {
  current: () => boolean; project: (id: string) => StoredProject | undefined;
  validate: (file: File) => void; fingerprint: (file: File) => Promise<string>;
  prepare: (file: File, blobKey: string) => Promise<ProjectPhoto>;
  saveOriginal: (key: string, file: File) => Promise<void>;
  commit: (project: StoredProject) => void;
  knownFingerprint?: (photo: ProjectPhoto) => string | undefined;
  checkpoint?: (projectId: string, photo: ProjectPhoto) => Promise<void>;
  complete?: (photo: ProjectPhoto) => Promise<void>;
}
/** One original at a time. File handles may queue, decoded images may not.
 * No placement/selection state enters this queue. */
export class PhotoImportQueue {
  private items: PhotoImportItem[] = [];
  private sources = new Map<string, PhotoImportSource>();
  private orders = new Map<string, number>();
  private listeners = new Set<() => void>();
  private running = false;
  private paused = false;
  private controller = new AbortController();
  constructor(private dependencies: Dependencies) {}
  getSnapshot = () => this.items;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(id: string, patch: Partial<PhotoImportItem>) { this.items = this.items.map(item => item.id === id ? { ...item, ...patch } : item); this.listeners.forEach(fn => fn()); }
  add(projectId: string, sources: PhotoImportSource[]) {
    const start = Math.max(Date.now(), ...this.orders.values(), 0) + 1;
    sources.forEach((source, index) => { const id = crypto.randomUUID(); this.sources.set(id, source); this.orders.set(id, start + index);
      this.items = [...this.items, { id, projectId, name: source.name, state: this.paused ? "paused" : "queued" }]; });
    this.listeners.forEach(fn => fn()); void this.drain();
  }
  retry(id?: string) {
    this.paused = false;
    this.items = this.items.map(item => (!id || item.id === id) && ["failed", "paused"].includes(item.state) && this.sources.has(item.id)
      ? { ...item, state: "queued", detail: undefined } : item);
    this.listeners.forEach(fn => fn()); void this.drain();
  }
  stop() { this.controller.abort(); this.sources.forEach(source => source.release?.()); this.sources.clear(); this.items = []; this.orders.clear(); this.listeners.forEach(fn => fn()); }
  private release(id: string) { this.sources.get(id)?.release?.(); this.sources.delete(id); this.orders.delete(id); }
  private async drain() {
    if (this.running || this.paused || this.controller.signal.aborted) return;
    this.running = true;
    try {
      while (!this.paused && this.dependencies.current() && !this.controller.signal.aborted) {
        const item = this.items.find(item => item.state === "queued"); if (!item) break;
        const source = this.sources.get(item.id); if (!source) break;
        const current = () => this.dependencies.current() && !this.controller.signal.aborted && Boolean(this.dependencies.project(item.projectId));
        try {
          if (!current()) throw new Error("The destination project is no longer available.");
          this.update(item.id, { state: "reading" });
          const file = await source.file(this.controller.signal);
          if (!current()) throw new Error("The destination project is no longer available.");
          this.dependencies.validate(file); this.update(item.id, { state: "checking" });
          const fingerprint = await this.dependencies.fingerprint(file);
          if (!current()) throw new Error("The destination project is no longer available.");
          let latest = this.dependencies.project(item.projectId)!;
          const duplicate = getProjectPhotos(latest).find(photo => (photo.fingerprint ?? this.dependencies.knownFingerprint?.(photo)) === fingerprint);
          if (duplicate) {
            // Exact verified bytes can safely restore an evicted local original.
            // Retain its identity and every existing placement/crop/Drive ID.
            try { await this.dependencies.saveOriginal(duplicate.blobKey, file); }
            catch { this.paused = true; throw new Error("Device storage is full. This photo is already in the library; retry to restore its original."); }
            if (!current()) throw new Error("The destination project is no longer available.");
            latest = this.dependencies.project(item.projectId)!;
            this.dependencies.commit({ ...latest, photoLibrary: getProjectPhotos(latest).map(photo => photo.blobKey === duplicate.blobKey ? { ...photo, fingerprint } : photo), updatedAt: nextProjectEditTime(latest) });
            this.update(item.id, { state: "duplicate", blobKey: duplicate.blobKey, detail: "Already in this project; original available again for backup" }); this.release(item.id); continue;
          }
          if (getVisibleProjectPhotos(latest).length >= MAX_PROJECT_PHOTOS) throw new Error(`The library already has ${MAX_PROJECT_PHOTOS} photos. Existing photos are unchanged.`);
          const blobKey = item.blobKey ?? crypto.randomUUID();
          this.update(item.id, { state: "saving", blobKey });
          const prepared = await this.dependencies.prepare(file, blobKey);
          if (!current()) throw new Error("The destination project is no longer available.");
          const photo: ProjectPhoto = { ...prepared, fingerprint, importedAt: new Date(this.orders.get(item.id)!).toISOString(), importOrder: this.orders.get(item.id) };
          // If durable original storage fails, stop intake; do not retain hundreds
          // of decoded/volatile originals and pretend they were imported.
          try { await this.dependencies.saveOriginal(blobKey, file); }
          catch { this.paused = true; throw new Error("Device storage could not save this original. Intake paused; free storage and Retry. No existing photo was removed."); }
          if (!current()) throw new Error("The destination project is no longer available.");
          latest = this.dependencies.project(item.projectId)!;
          const newlyKnown = getProjectPhotos(latest).find(item => item.fingerprint === fingerprint);
          if (newlyKnown) { this.update(item.id, { state: "duplicate", blobKey: newlyKnown.blobKey, detail: "Already in this project" }); this.release(item.id); continue; }
          if (getVisibleProjectPhotos(latest).length >= MAX_PROJECT_PHOTOS) throw new Error("The library filled while importing. This photo was not placed; existing photos are unchanged.");
          await this.dependencies.checkpoint?.(item.projectId, photo);
          if (!current()) throw new Error("The destination project is no longer available.");
          latest = this.dependencies.project(item.projectId)!;
          try { this.dependencies.commit({ ...latest, photoLibrary: mergePhotoLibraries(getProjectPhotos(latest), [photo]), updatedAt: nextProjectEditTime(latest) }); }
          catch (error) { this.paused = true; throw error; }
          await this.dependencies.complete?.(photo).catch(() => {});
          this.update(item.id, { state: "imported", detail: "Saved on this device; cloud backup tracked separately" }); this.release(item.id);
        } catch (error) {
          if (!this.dependencies.current() || this.controller.signal.aborted) break;
          this.update(item.id, { state: "failed", detail: error instanceof Error ? error.message : "Import failed. Retry this file." });
          if (this.paused) { this.items = this.items.map(item => item.state === "queued" ? { ...item, state: "paused" } : item); this.listeners.forEach(fn => fn()); }
        }
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    } finally { this.running = false; }
  }
}
export function fileImportSources(files: File[]): PhotoImportSource[] {
  return files.map(file => ({ id: crypto.randomUUID(), name: file.webkitRelativePath || file.name, file: async () => file }));
}
