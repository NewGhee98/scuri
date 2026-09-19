import { downloadGoogleDrivePhoto } from "./google-drive";
import { createPhotoPreview } from "./image";
import { loadPhotoBlob } from "./storage";
import { readDerived, writeDerived } from "./photo-cache-storage";
import { workspaceKey } from "./workspace";
import type { PhotoAsset, ProjectPage, ProjectPhoto } from "./types";

export const SESSION_PREVIEW_LONG_EDGE = 640;
export type DisplayPhoto = Pick<PhotoAsset, "frameId" | "blobKey" | "previewUrl" | "sourceWidth" | "sourceHeight" | "crop"> & { fallbackPreviewUrl?: string };
export type PreviewPage = Pick<ProjectPage, "photos" | "unavailablePhotos">;
type PreviewSource = Pick<ProjectPhoto, "blobKey" | "sourceWidth" | "sourceHeight" | "drivePreviewId" | "driveThumbnailId" | "fingerprint">;
type Preview = Pick<DisplayPhoto, "previewUrl" | "sourceWidth" | "sourceHeight">;
export const EMPTY_PHOTO_PREVIEWS: ReadonlyMap<string, Preview> = new Map();
type Entry = Preview & { bytes: number; decoded: number; blob: Blob; edge: number };
type Job = { priority: number; run: () => Promise<Preview | null>; finish: (preview: Preview | null) => void };
export function previewStorageKey(photo: PreviewSource, ownerId?: string | null, longEdge = SESSION_PREVIEW_LONG_EDGE): string {
  return workspaceKey(`scuri.preview.v2.${encodeURIComponent(photo.blobKey)}.${longEdge}`, ownerId);
}
const decodedBytes = (width: number, height: number, edge: number) => {
  const scale = Math.min(1, edge / Math.max(width, height));
  return Math.max(1, Math.round(width * scale)) * Math.max(1, Math.round(height * scale)) * 4;
};

/** Display bytes only: never an original, upload source, placement or crop cache.
 * One instance belongs to one workspace session and survives project navigation. */
export class PhotoPreviewCache {
  private entries = new Map<string, Entry>();
  private pending = new Map<string, Promise<Preview | null>>();
  private queue: Job[] = [];
  private running = 0;
  private generation = 0;
  private snapshot = EMPTY_PHOTO_PREVIEWS;
  private bytes = 0;
  private decoded = 0;
  private pins = new Map<string, number>();
  private retired = new Map<string, Entry[]>();
  private ownerId: string | null = null;
  private listeners = new Set<() => void>();

  constructor(private maxBytes = 64 * 1024 * 1024, private maxEntries = 1000, private maxDecoded = 48 * 1024 * 1024) {}
  setWorkspace(ownerId: string | null) { if (ownerId !== this.ownerId) { this.clear(); this.ownerId = ownerId; } }
  getBlob = (blobKey: string): Blob | undefined => this.entries.get(blobKey)?.blob;
  pin(blobKey: string): () => void {
    const generation = this.generation;
    this.pins.set(blobKey, (this.pins.get(blobKey) ?? 0) + 1);
    return () => { if (generation !== this.generation) return; const count = this.pins.get(blobKey) ?? 0;
      if (count <= 1) { this.pins.delete(blobKey); for (const entry of this.retired.get(blobKey) ?? []) {
        URL.revokeObjectURL(entry.previewUrl); this.bytes -= entry.bytes; this.decoded -= entry.decoded;
      } this.retired.delete(blobKey); } else this.pins.set(blobKey, count - 1); };
  }
  get = (blobKey: string): Preview | undefined => this.entries.get(blobKey);
  getSnapshot = (): ReadonlyMap<string, Preview> => this.snapshot;
  capture(): () => boolean {
    const generation = this.generation;
    return () => generation === this.generation;
  }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private changed() { this.snapshot = new Map(this.entries); this.listeners.forEach(listener => listener()); }

  private keep(key: string, entry: Entry): Preview | null {
    const existing = this.entries.get(key);
    if ((existing && existing.edge >= entry.edge) || entry.bytes > this.maxBytes || entry.decoded > this.maxDecoded) {
      URL.revokeObjectURL(entry.previewUrl);
      return existing ?? null;
    }
    const retained = existing && this.pins.has(key);
    const additionalBytes = entry.bytes - (existing && !retained ? existing.bytes : 0);
    const additionalDecoded = entry.decoded - (existing && !retained ? existing.decoded : 0);
    const additionalCount = existing ? 0 : 1;
    const exceeds = () => this.entries.size + additionalCount > this.maxEntries ||
      this.bytes + additionalBytes > this.maxBytes || this.decoded + additionalDecoded > this.maxDecoded;
    while (exceeds()) {
      const oldest = [...this.entries].find(([candidate]) => candidate !== key && !this.pins.has(candidate));
      if (!oldest) break;
      this.entries.delete(oldest[0]); this.bytes -= oldest[1].bytes; this.decoded -= oldest[1].decoded;
      URL.revokeObjectURL(oldest[1].previewUrl);
    }
    if (exceeds()) { URL.revokeObjectURL(entry.previewUrl); this.changed(); return existing ?? null; }
    if (existing) {
      this.entries.delete(key);
      if (retained) this.retired.set(key, [...(this.retired.get(key) ?? []), existing]);
      else { URL.revokeObjectURL(existing.previewUrl); this.bytes -= existing.bytes; this.decoded -= existing.decoded; }
    }
    this.entries.set(key, entry); this.bytes += entry.bytes; this.decoded += entry.decoded;
    this.changed();
    return entry;
  }

  /** Reuse an already small, uncropped analysis thumbnail without decoding the original again. */
  rememberThumbnail(photo: PreviewSource, thumbnail: Blob, longEdge = 320): void {
    if ((this.entries.get(photo.blobKey)?.edge ?? 0) >= longEdge || !(photo.sourceWidth > 0 && photo.sourceHeight > 0)) return;
    this.keep(photo.blobKey, { previewUrl: URL.createObjectURL(thumbnail), sourceWidth: photo.sourceWidth,
      sourceHeight: photo.sourceHeight, bytes: thumbnail.size, blob: thumbnail, edge: longEdge, decoded: decodedBytes(photo.sourceWidth, photo.sourceHeight, longEdge) });
    void writeDerived(previewStorageKey(photo, this.ownerId, longEdge), { blob: thumbnail });
  }

  request(photo: PreviewSource, getDriveToken: () => string | null, getVolatileBlob?: (key: string) => Blob | undefined, priority = 0): Promise<Preview | null> {
    const existing = this.entries.get(photo.blobKey);
    if (existing && (existing.edge >= SESSION_PREVIEW_LONG_EDGE || priority > 0)) {
      // Touch on requests, not reads during React rendering.
      this.entries.delete(photo.blobKey); this.entries.set(photo.blobKey, existing);
      return Promise.resolve(existing);
    }
    const pending = this.pending.get(photo.blobKey);
    if (pending) return pending;
    const generation = this.generation;
    const ownerId = this.ownerId;
    const isCurrent = () => generation === this.generation;
    let finish!: Job["finish"];
    const promise = new Promise<Preview | null>(resolve => { finish = resolve; });
    this.pending.set(photo.blobKey, promise);
    this.queue.push({ finish, priority, run: async () => {
      try {
        if (!isCurrent()) return null;
        const cached = await readDerived(previewStorageKey(photo, ownerId));
        if (!isCurrent()) return null;
        if (cached?.blob && photo.sourceWidth > 0 && photo.sourceHeight > 0) return this.keep(photo.blobKey, {
          blob: cached.blob, edge: SESSION_PREVIEW_LONG_EDGE, bytes: cached.blob.size, decoded: decodedBytes(photo.sourceWidth, photo.sourceHeight, SESSION_PREVIEW_LONG_EDGE),
          previewUrl: URL.createObjectURL(cached.blob), sourceWidth: photo.sourceWidth, sourceHeight: photo.sourceHeight });
        const small = !this.entries.has(photo.blobKey) ? await readDerived(previewStorageKey(photo, ownerId, 320)) : null;
        if (!isCurrent()) return null;
        if (small?.blob) this.rememberThumbnail(photo, small.blob);
        if (priority > 0 && this.entries.has(photo.blobKey)) return this.entries.get(photo.blobKey)!;
        const inspection = await readDerived(previewStorageKey(photo, ownerId, 2200));
        if (!isCurrent()) return null;
        let blob = inspection?.blob ?? getVolatileBlob?.(photo.blobKey) ?? await loadPhotoBlob(photo.blobKey).catch(() => null);
        if (!isCurrent()) return null;
        // Preview downloads never enter IndexedDB's original-blob namespace.
        const token = getDriveToken();
        if (!blob && token && (photo.driveThumbnailId || photo.drivePreviewId)) blob = await downloadGoogleDrivePhoto(token, (photo.driveThumbnailId ?? photo.drivePreviewId)!);
        if (!isCurrent()) return null;
        if (!blob) return this.entries.get(photo.blobKey) ?? null;
        const preview = await createPhotoPreview(blob, { longEdge: SESSION_PREVIEW_LONG_EDGE, quality: 0.72 });
        if (!isCurrent()) { URL.revokeObjectURL(preview.previewUrl); return null; }
        void writeDerived(previewStorageKey(photo, ownerId), { blob: preview.blob });
        return this.keep(photo.blobKey, { previewUrl: preview.previewUrl, bytes: preview.blob.size, blob: preview.blob, edge: SESSION_PREVIEW_LONG_EDGE,
          decoded: decodedBytes(preview.width, preview.height, SESSION_PREVIEW_LONG_EDGE),
          sourceWidth: photo.sourceWidth > 0 ? photo.sourceWidth : preview.width,
          sourceHeight: photo.sourceHeight > 0 ? photo.sourceHeight : preview.height });
      } catch { return null; } // A missing preview never changes photo membership.
      finally { if (this.pending.get(photo.blobKey) === promise) this.pending.delete(photo.blobKey); }
    } });
    this.queue.sort((a, b) => a.priority - b.priority); this.drain();
    return promise;
  }

  private drain() {
    while (this.running < 2 && this.queue.length) {
      const job = this.queue.shift()!;
      this.running++;
      void job.run().then(job.finish).finally(() => { this.running--; this.drain(); });
    }
  }

  clear(): void {
    this.generation++;
    this.queue.splice(0).forEach(job => job.finish(null));
    this.pending.clear();
    this.entries.forEach(entry => URL.revokeObjectURL(entry.previewUrl));
    this.retired.forEach(entries => entries.forEach(entry => URL.revokeObjectURL(entry.previewUrl))); this.retired.clear();
    this.entries.clear(); this.bytes = 0; this.decoded = 0; this.pins.clear();
    this.changed();
  }
}

/** Always take placement/crop from the current page. A cache hit does not make
 * unavailable originals available and cannot reintroduce deleted assignments. */
export function displayPagePhotos(page: PreviewPage | null, cache: Pick<ReadonlyMap<string, Preview>, "get">): Record<string, DisplayPhoto> {
  const photos: Record<string, DisplayPhoto> = Object.fromEntries(Object.entries(page?.photos ?? {}).map(([id, photo]) =>
    [id, { ...photo, fallbackPreviewUrl: cache.get(photo.blobKey)?.previewUrl }]));
  for (const [frameId, stored] of Object.entries(page?.unavailablePhotos ?? {})) {
    if (photos[frameId]) continue;
    const preview = cache.get(stored.blobKey);
    if (preview) photos[frameId] = { ...stored, frameId, previewUrl: preview.previewUrl,
      sourceWidth: stored.sourceWidth > 0 ? stored.sourceWidth : preview.sourceWidth,
      sourceHeight: stored.sourceHeight > 0 ? stored.sourceHeight : preview.sourceHeight };
  }
  return photos;
}
