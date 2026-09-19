import type { ProjectPhoto, StoredPhotoAsset, StoredProject } from "./types";

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
