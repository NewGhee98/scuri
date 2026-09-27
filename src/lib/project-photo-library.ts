import type { ProjectPhoto, StoredPhotoAsset, StoredProject } from "./types";
import { normalizePhotoLabel, normalizePhotoLabels, type PhotoMetadataEdit } from "./photo-metadata";
import { nextProjectEditTime } from "./project-time";

export const MAX_PROJECT_PHOTOS = 250;

export function libraryPhoto(photo: ProjectPhoto | StoredPhotoAsset): ProjectPhoto {
  return { blobKey: photo.blobKey, sourceWidth: photo.sourceWidth, sourceHeight: photo.sourceHeight,
    sourceName: photo.sourceName, mimeType: photo.mimeType, fileSize: photo.fileSize,
    driveOriginalId: photo.driveOriginalId, drivePreviewId: photo.drivePreviewId,
    ...("duplicateOf" in photo && photo.duplicateOf !== undefined ? { duplicateOf: photo.duplicateOf } : {}),
    ...("fingerprint" in photo && photo.fingerprint !== undefined ? { fingerprint: photo.fingerprint } : {}),
    ...("importedAt" in photo && photo.importedAt !== undefined ? { importedAt: photo.importedAt } : {}),
    ...("importOrder" in photo && photo.importOrder !== undefined ? { importOrder: photo.importOrder } : {}),
    ...("colourOverride" in photo && photo.colourOverride !== undefined ? { colourOverride: photo.colourOverride } : {}),
    ...("rank" in photo && photo.rank !== undefined ? { rank: photo.rank } : {}),
    ...("labels" in photo && photo.labels !== undefined ? { labels: normalizePhotoLabels(photo.labels) } : {}),
    ...("driveThumbnailId" in photo && photo.driveThumbnailId !== undefined ? { driveThumbnailId: photo.driveThumbnailId } : {}),
    ...("pendingUpload" in photo && photo.pendingUpload !== undefined ? { pendingUpload: photo.pendingUpload } : {}) };
}

/** Absence never removes an original. Frame deletion is separate from membership. */
export function mergePhotoLibraries(...libraries: Array<readonly ProjectPhoto[] | undefined>): ProjectPhoto[] {
  const photos = new Map<string, ProjectPhoto>();
  for (const library of libraries) for (const incoming of library ?? []) {
    const photo = libraryPhoto(incoming);
    const old = photos.get(photo.blobKey);
    photos.set(photo.blobKey, old ? { ...old, ...photo,
      sourceWidth: photo.sourceWidth || old.sourceWidth, sourceHeight: photo.sourceHeight || old.sourceHeight,
      sourceName: photo.sourceName ?? old.sourceName, mimeType: photo.mimeType ?? old.mimeType,
      fileSize: photo.fileSize ?? old.fileSize, driveOriginalId: photo.driveOriginalId ?? old.driveOriginalId,
      drivePreviewId: photo.drivePreviewId ?? old.drivePreviewId,
      pendingUpload: old.pendingUpload || photo.pendingUpload ? { ...old.pendingUpload, ...photo.pendingUpload } : undefined } : photo);
  }
  return [...photos.values()];
}

export function getProjectPhotos(project: Pick<StoredProject, "pages" | "photoLibrary">): ProjectPhoto[] {
  // Placements supply legacy metadata and byte checkpoints, never stale copies
  // of library-only overrides/order/aliases. Keep the original library order.
  const placements = project.pages.flatMap(page => Object.values(page.photos)).map(photo => ({
    blobKey: photo.blobKey, sourceWidth: photo.sourceWidth, sourceHeight: photo.sourceHeight,
    sourceName: photo.sourceName, mimeType: photo.mimeType, fileSize: photo.fileSize,
    driveOriginalId: photo.driveOriginalId, drivePreviewId: photo.drivePreviewId,
  }));
  return mergePhotoLibraries(project.photoLibrary, placements, project.photoLibrary);
}

/** UI grouping never removes original metadata. Invalid/missing/cyclic links
 * fail open in the library: show the entry instead of hiding a photograph. */
export function projectPhotoGroups(project: Pick<StoredProject, "pages" | "photoLibrary">): Array<{ photo: ProjectPhoto; members: ProjectPhoto[] }> {
  const photos = getProjectPhotos(project), byKey = new Map(photos.map(photo => [photo.blobKey, photo]));
  const groups = new Map<string, { photo: ProjectPhoto; members: ProjectPhoto[] }>();
  for (const photo of photos) {
    let root = photo;
    const visited = new Set<string>();
    while (root.duplicateOf) {
      visited.add(root.blobKey);
      const next = byKey.get(root.duplicateOf);
      if (!next || visited.has(next.blobKey)) { root = photo; break; }
      root = next;
    }
    const group = groups.get(root.blobKey) ?? { photo: root, members: [] };
    group.members.push(photo); groups.set(root.blobKey, group);
  }
  return [...groups.values()];
}

export function getVisibleProjectPhotos(project: Pick<StoredProject, "pages" | "photoLibrary">): ProjectPhoto[] {
  return projectPhotoGroups(project).map(group => group.photo);
}

export function hasUnassignedPhotos(project: StoredProject): boolean {
  const placed = new Set(project.pages.flatMap(page => Object.values(page.photos).map(photo => photo.blobKey)));
  return getProjectPhotos(project).some(photo => !placed.has(photo.blobKey));
}

export function preserveProjectLibrary(project: StoredProject, ...others: StoredProject[]): StoredProject {
  return { ...project, photoLibrary: mergePhotoLibraries(...others.map(getProjectPhotos), getProjectPhotos(project)) };
}

/** Explicit metadata edits affect only this project's selected library groups.
 * Placements, crops, original identities and byte-backup checkpoints stay intact. */
export function editProjectPhotoMetadata(project: StoredProject, selectedKeys: readonly string[], edit: PhotoMetadataEdit, timestamp?: string): StoredProject {
  const selected = new Set(selectedKeys);
  const keys = new Set(projectPhotoGroups(project).filter(group => group.members.some(photo => selected.has(photo.blobKey)))
    .flatMap(group => group.members.map(photo => photo.blobKey)));
  let changed = false;
  const photoLibrary = getProjectPhotos(project).map(photo => {
    if (!keys.has(photo.blobKey)) return photo;
    if ("rank" in edit) {
      if ((photo.rank ?? null) === edit.rank) return photo;
      changed = true; return { ...photo, rank: edit.rank };
    }
    const labels = "addLabels" in edit ? normalizePhotoLabels([...(photo.labels ?? []), ...edit.addLabels]) :
      (photo.labels ?? []).filter(label => label !== normalizePhotoLabel(edit.removeLabel));
    if (JSON.stringify(labels) === JSON.stringify(photo.labels ?? [])) return photo;
    changed = true; return { ...photo, labels };
  });
  return changed ? { ...project, photoLibrary, updatedAt: nextProjectEditTime(project, timestamp) } : project;
}
