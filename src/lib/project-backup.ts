import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { isStoredProject } from "./project-validation";
import { getTemplate } from "./templates";
import { MAX_PROJECT_PAGES } from "./project";
import { getProjectPhotos } from "./project-photo-library";
import type { StoredProject, StoredProjectPage, TemplateDefinition } from "./types";

export const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
type Original = { blobKey: string; file: string | null; sha256: string | null; mimeType: string };
type Manifest = { kind: "scuri-project-backup"; version: 1; createdAt: string; project: StoredProject; originals: Original[] };
export interface ProjectBackupPreview { project: StoredProject; originals: Map<string, Blob>; missingOriginals: number }
const hash = async (bytes: Uint8Array): Promise<string> => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer))]
  .map(value => value.toString(16).padStart(2, "0")).join("");

/** Explicit portable snapshot only. Never written as a Drive manifest. */
export async function createProjectBackup(
  project: StoredProject,
  loadOriginal: (key: string) => Promise<Blob | null>,
  resolveTemplate: (page: StoredProjectPage) => TemplateDefinition = page => getTemplate(page.templateId),
): Promise<{ blob: Blob; filename: string; missingOriginals: number }> {
  const snapshot: StoredProject = { ...project, pages: project.pages.map(page => ({ ...page,
    templateSnapshot: page.templateSnapshot ?? resolveTemplate(page) })) };
  if (!isStoredProject(snapshot)) throw new Error("Project data must be valid before it can be backed up.");
  const entries: Record<string, Uint8Array> = {};
  const originals: Original[] = [];
  let size = 0;
  const unique = new Map(getProjectPhotos(snapshot).map(photo => [photo.blobKey, photo]));
  for (const photo of unique.values()) {
    const blob = await loadOriginal(photo.blobKey);
    if (!blob) { originals.push({ blobKey: photo.blobKey, file: null, sha256: null, mimeType: photo.mimeType ?? "image/jpeg" }); continue; }
    size += blob.size;
    if (size > MAX_BACKUP_BYTES - MAX_MANIFEST_BYTES) throw new Error("This backup is over 256 MB. Back up a smaller project; your project has not changed.");
    const file = `originals/${originals.length}.bin`;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    entries[file] = bytes;
    originals.push({ blobKey: photo.blobKey, file, sha256: await hash(bytes), mimeType: blob.type || photo.mimeType || "image/jpeg" });
  }
  const manifest: Manifest = { kind: "scuri-project-backup", version: 1, createdAt: new Date().toISOString(), project: snapshot, originals };
  entries["manifest.json"] = strToU8(JSON.stringify(manifest));
  if (entries["manifest.json"].length > MAX_MANIFEST_BYTES) throw new Error("This project's metadata is too large for a portable backup.");
  const zipped = zipSync(entries, { level: 0 });
  if (zipped.length > MAX_BACKUP_BYTES) throw new Error("This backup exceeds the 256 MB limit.");
  const name = project.name.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 60) || "project";
  return { blob: new Blob([new Uint8Array(zipped).buffer], { type: "application/zip" }),
    filename: `${name}-${new Date().toISOString().slice(0, 10)}.scuri.zip`, missingOriginals: originals.filter(item => !item.file).length };
}

export async function inspectProjectBackup(blob: Blob): Promise<ProjectBackupPreview> {
  if (!blob.size || blob.size > MAX_BACKUP_BYTES) throw new Error("Choose a Scuri backup smaller than 256 MB.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let total = 0;
  const paths = new Set<string>();
  const entries = unzipSync(bytes, { filter: file => {
    if (paths.has(file.name) || !(file.name === "manifest.json" || /^originals\/\d+\.bin$/.test(file.name))) throw new Error("This backup contains unexpected or duplicate files.");
    paths.add(file.name);
    total += file.originalSize;
    if (total > MAX_BACKUP_BYTES || (file.name === "manifest.json" && file.originalSize > MAX_MANIFEST_BYTES)) throw new Error("The expanded backup exceeds the size limit.");
    return true;
  } });
  if (!entries["manifest.json"]) throw new Error("This file is not a Scuri project backup.");
  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as Manifest;
  if (manifest?.kind !== "scuri-project-backup" || manifest.version !== 1 || !isStoredProject(manifest.project) ||
      manifest.project.pages.length > MAX_PROJECT_PAGES || !Array.isArray(manifest.originals)) throw new Error("This backup has unsupported or damaged project metadata.");
  const originals = new Map<string, Blob>();
  const expectedKeys = new Set(getProjectPhotos(manifest.project).map(photo => photo.blobKey));
  const usedFiles = new Set<string>();
  for (const item of manifest.originals) {
    if (!item || !expectedKeys.delete(item.blobKey) || typeof item.mimeType !== "string") throw new Error("This backup has duplicate or unexpected photo records.");
    if (item.file === null && item.sha256 === null) continue;
    if (typeof item.file !== "string" || !/^originals\/\d+\.bin$/.test(item.file) || usedFiles.has(item.file) || !entries[item.file]) throw new Error("This backup is missing an original image.");
    usedFiles.add(item.file);
    const data = entries[item.file];
    if (await hash(data) !== item.sha256) throw new Error("A photo failed its integrity check. The backup was not imported.");
    originals.set(item.blobKey, new Blob([new Uint8Array(data).buffer], { type: item.mimeType }));
  }
  if (expectedKeys.size || paths.size !== usedFiles.size + 1) throw new Error("This backup has an incomplete or unexpected file list.");
  if (!manifest.project.pages.every(page => page.templateSnapshot && page.templateSnapshot.formatId === manifest.project.formatId)) throw new Error("This backup is missing its saved layouts.");
  return { project: manifest.project, originals, missingOriginals: manifest.originals.length - originals.size };
}

/** Fresh project/page/blob identities and no imported cloud authority. Writes
 * happen only after review, first new blobs, then one new library entry. */
export function materializeProjectBackup(preview: ProjectBackupPreview, generateId = () => crypto.randomUUID(), timestamp = new Date().toISOString()): { project: StoredProject; originals: Map<string, Blob> } {
  const pageIds = new Map(preview.project.pages.map(page => [page.id, generateId()]));
  const keys = new Map(getProjectPhotos(preview.project).map(photo => [photo.blobKey, ""]));
  for (const key of keys.keys()) keys.set(key, generateId());
  const originals = new Map<string, Blob>();
  for (const [key, blob] of preview.originals) originals.set(keys.get(key)!, blob);
  const project: StoredProject = { version: 3, id: generateId(), name: `${preview.project.name} (restored)`.slice(0, 120),
    formatId: preview.project.formatId, activePageId: pageIds.get(preview.project.activePageId ?? "") ?? null,
    createdAt: timestamp, updatedAt: timestamp,
    photoLibrary: getProjectPhotos(preview.project).map(photo => ({ ...photo, blobKey: keys.get(photo.blobKey)!,
      ...(photo.duplicateOf ? { duplicateOf: keys.get(photo.duplicateOf) ?? null } : {}), driveOriginalId: undefined, drivePreviewId: undefined })),
    pages: preview.project.pages.map(page => ({ ...page, id: pageIds.get(page.id)!, createdAt: timestamp, updatedAt: timestamp,
      photos: Object.fromEntries(Object.entries(page.photos).map(([id, photo]) => [id, { ...photo, blobKey: keys.get(photo.blobKey)!,
        cloudAssetId: undefined, driveOriginalId: undefined, drivePreviewId: undefined }])) })),
  };
  return { project, originals };
}
