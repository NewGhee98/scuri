import { getProjectPhotos, getVisibleProjectPhotos } from "./project-photo-library";
import { nextProjectEditTime } from "./project-time";
import { workspaceKey } from "./workspace";
import type { ProjectPhoto, StoredProject } from "./types";

export interface DuplicateGroup { keys: string[]; fingerprint: string }
export interface DuplicateScan { projectId: string; groups: DuplicateGroup[]; unavailable: string[]; checked: number }
export type FingerprintCache = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void };
const validFingerprint = (value: string): boolean => /^sha256:\d+:[a-f0-9]{64}$/.test(value);

export function fingerprintCacheKey(photo: ProjectPhoto, ownerId?: string | null): string {
  return workspaceKey(`scuri.exact-file.v1.${encodeURIComponent(photo.blobKey)}.${photo.fileSize ?? "unknown"}.${encodeURIComponent(photo.driveOriginalId ?? "local")}`, ownerId);
}

/** Only untouched original bytes enter this function. Never compare previews,
 * filenames, dimensions or palette averages as proof of an exact duplicate. */
export async function scanExactDuplicates(project: StoredProject, loadOriginal: (photo: ProjectPhoto) => Promise<Blob | null>,
  options: { signal?: AbortSignal; ownerId?: string | null; cache?: FingerprintCache; onProgress?: (done: number, total: number) => void } = {}): Promise<DuplicateScan> {
  const photos = getVisibleProjectPhotos(project), groups = new Map<string, string[]>();
  const result: DuplicateScan = { projectId: project.id, groups: [], unavailable: [], checked: 0 };
  for (const photo of photos) {
    options.signal?.throwIfAborted();
    let fingerprint: string | null = null;
    const cacheKey = fingerprintCacheKey(photo, options.ownerId);
    try { fingerprint = options.cache?.getItem(cacheKey) ?? null; } catch { /* Derived cache is optional. */ }
    if (!fingerprint || !validFingerprint(fingerprint)) {
      try {
        const blob = await loadOriginal(photo);
        options.signal?.throwIfAborted();
        if (!blob || !blob.size) throw new Error("Original unavailable");
        const bytes = await blob.arrayBuffer();
        options.signal?.throwIfAborted();
        const hash = await crypto.subtle.digest("SHA-256", bytes);
        fingerprint = `sha256:${blob.size}:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("")}`;
        try { options.cache?.setItem(cacheKey, fingerprint); } catch { /* Derived cache is optional. */ }
      } catch {
        options.signal?.throwIfAborted();
        fingerprint = null;
      }
    }
    options.signal?.throwIfAborted();
    if (fingerprint) { groups.set(fingerprint, [...(groups.get(fingerprint) ?? []), photo.blobKey]); result.checked++; }
    else result.unavailable.push(photo.blobKey);
    options.onProgress?.(result.checked + result.unavailable.length, photos.length);
  }
  result.groups = [...groups].filter(([, keys]) => keys.length > 1).map(([fingerprint, keys]) => ({ keys, fingerprint }));
  return result;
}

/** Explicit review Apply only. Original identities, page objects, row IDs,
 * crops, timestamps and Drive references are untouched. */
export function consolidateLibraryDuplicates(project: StoredProject, scan: DuplicateScan, selected: DuplicateGroup[], timestamp?: string): StoredProject {
  if (scan.projectId !== project.id) throw new Error("The project changed. Find duplicates again.");
  const visible = new Set(getVisibleProjectPhotos(project).map(photo => photo.blobKey)), aliases = new Map<string, string>();
  const used = new Set<string>();
  for (const group of selected) {
    if (!scan.groups.some(item => item.fingerprint === group.fingerprint && JSON.stringify(item.keys) === JSON.stringify(group.keys)) ||
        !validFingerprint(group.fingerprint) || group.keys.length < 2 || new Set(group.keys).size !== group.keys.length || group.keys.some(key => !visible.has(key) || used.has(key))) {
      throw new Error("The library changed. Find duplicates again before combining entries.");
    }
    group.keys.forEach(key => used.add(key));
    group.keys.slice(1).forEach(key => aliases.set(key, group.keys[0]));
  }
  if (!aliases.size) return project;
  return { ...project, updatedAt: nextProjectEditTime(project, timestamp),
    photoLibrary: getProjectPhotos(project).map(photo => aliases.has(photo.blobKey) ? { ...photo, duplicateOf: aliases.get(photo.blobKey)! } : photo) };
}
