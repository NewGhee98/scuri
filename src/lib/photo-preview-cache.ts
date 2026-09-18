import { downloadGoogleDrivePhoto } from "./google-drive";
import { createPhotoPreview } from "./image";
import { loadPhotoBlob } from "./storage";
import type { PhotoAsset, ProjectPage, ProjectPhoto } from "./types";

export const SESSION_PREVIEW_LONG_EDGE = 640;
export type DisplayPhoto = Pick<PhotoAsset, "frameId" | "blobKey" | "previewUrl" | "sourceWidth" | "sourceHeight" | "crop"> & { fallbackPreviewUrl?: string };
export type PreviewPage = Pick<ProjectPage, "photos" | "unavailablePhotos">;
type PreviewSource = Pick<ProjectPhoto, "blobKey" | "sourceWidth" | "sourceHeight" | "drivePreviewId">;
type Preview = Pick<DisplayPhoto, "previewUrl" | "sourceWidth" | "sourceHeight">;
export const EMPTY_PHOTO_PREVIEWS: ReadonlyMap<string, Preview> = new Map();
type Entry = Preview & { bytes: number };
type Job = { run: () => Promise<Preview | null>; finish: (preview: Preview | null) => void };

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
  private listeners = new Set<() => void>();

  constructor(private maxBytes = 64 * 1024 * 1024, private maxEntries = 1000) {}
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
    if (existing || entry.bytes > this.maxBytes) {
      URL.revokeObjectURL(entry.previewUrl);
      return existing ?? null;
    }
    while (this.entries.size >= this.maxEntries || this.bytes + entry.bytes > this.maxBytes) {
      const oldest = this.entries.entries().next().value;
      if (!oldest) break;
      this.entries.delete(oldest[0]); this.bytes -= oldest[1].bytes;
      URL.revokeObjectURL(oldest[1].previewUrl);
    }
    this.entries.set(key, entry); this.bytes += entry.bytes;
    this.changed();
    return entry;
  }

  /** Reuse an already small, uncropped analysis thumbnail without decoding the original again. */
  rememberThumbnail(photo: PreviewSource, thumbnail: Blob): void {
    if (this.entries.has(photo.blobKey) || !(photo.sourceWidth > 0 && photo.sourceHeight > 0)) return;
    this.keep(photo.blobKey, { previewUrl: URL.createObjectURL(thumbnail), sourceWidth: photo.sourceWidth,
      sourceHeight: photo.sourceHeight, bytes: thumbnail.size });
  }

  request(photo: PreviewSource, getDriveToken: () => string | null, getVolatileBlob?: (key: string) => Blob | undefined): Promise<Preview | null> {
    const existing = this.entries.get(photo.blobKey);
    if (existing) {
      // Touch on requests, not reads during React rendering.
      this.entries.delete(photo.blobKey); this.entries.set(photo.blobKey, existing);
      return Promise.resolve(existing);
    }
    const pending = this.pending.get(photo.blobKey);
    if (pending) return pending;
    const generation = this.generation;
    const isCurrent = () => generation === this.generation;
    let finish!: Job["finish"];
    const promise = new Promise<Preview | null>(resolve => { finish = resolve; });
    this.pending.set(photo.blobKey, promise);
    this.queue.push({ finish, run: async () => {
      try {
        if (!isCurrent()) return null;
        let blob = getVolatileBlob?.(photo.blobKey) ?? await loadPhotoBlob(photo.blobKey).catch(() => null);
        if (!isCurrent()) return null;
        // Preview downloads never enter IndexedDB's original-blob namespace.
        const token = getDriveToken();
        if (!blob && token && photo.drivePreviewId) blob = await downloadGoogleDrivePhoto(token, photo.drivePreviewId);
        if (!blob || !isCurrent()) return null;
        const preview = await createPhotoPreview(blob, { longEdge: SESSION_PREVIEW_LONG_EDGE, quality: 0.72 });
        if (!isCurrent()) { URL.revokeObjectURL(preview.previewUrl); return null; }
        return this.keep(photo.blobKey, { previewUrl: preview.previewUrl, bytes: preview.blob.size,
          sourceWidth: photo.sourceWidth > 0 ? photo.sourceWidth : preview.width,
          sourceHeight: photo.sourceHeight > 0 ? photo.sourceHeight : preview.height });
      } catch { return null; } // A missing preview never changes photo membership.
      finally { if (this.pending.get(photo.blobKey) === promise) this.pending.delete(photo.blobKey); }
    } });
    this.drain();
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
    this.entries.clear(); this.bytes = 0;
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
