import type { ProjectPhoto, StoredPhotoAsset, StoredProject } from "./types";

export const MAX_PROJECT_PHOTOS = 200;

export function libraryPhoto(photo: ProjectPhoto | StoredPhotoAsset): ProjectPhoto {
  return { blobKey: photo.blobKey, sourceWidth: photo.sourceWidth, sourceHeight: photo.sourceHeight,
    sourceName: photo.sourceName, mimeType: photo.mimeType, fileSize: photo.fileSize,
    driveOriginalId: photo.driveOriginalId, drivePreviewId: photo.drivePreviewId };
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
      drivePreviewId: photo.drivePreviewId ?? old.drivePreviewId } : photo);
  }
  return [...photos.values()];
}

export function getProjectPhotos(project: Pick<StoredProject, "pages" | "photoLibrary">): ProjectPhoto[] {
  return mergePhotoLibraries(project.photoLibrary, project.pages.flatMap(page => Object.values(page.photos)));
}

export function hasUnassignedPhotos(project: StoredProject): boolean {
  const placed = new Set(project.pages.flatMap(page => Object.values(page.photos).map(photo => photo.blobKey)));
  return getProjectPhotos(project).some(photo => !placed.has(photo.blobKey));
}

export function preserveProjectLibrary(project: StoredProject, ...others: StoredProject[]): StoredProject {
  return { ...project, photoLibrary: mergePhotoLibraries(...others.map(getProjectPhotos), getProjectPhotos(project)) };
}
