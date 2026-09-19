import type { ProjectPhoto, StoredProject } from "./types";
import { nextProjectEditTime } from "./project-time";
import { getProjectPhotos } from "./project-photo-library";

export type PhotoBackupCheckpoint = { blobKey: string; driveOriginalId?: string; drivePreviewId?: string; driveThumbnailId?: string; pendingUpload?: ProjectPhoto["pendingUpload"]; driveFolderId: string };

/** Attach immutable byte IDs to the latest edits, without restoring an old crop
 * or resurrecting a removed/replaced photo. Persist each upload separately. */
export function applyPhotoBackupCheckpoint(project: StoredProject, checkpoint: PhotoBackupCheckpoint, timestamp: string): StoredProject {
  return { ...project, driveFolderId: checkpoint.driveFolderId, updatedAt: nextProjectEditTime(project, timestamp),
    photoLibrary: getProjectPhotos(project).map(photo => photo.blobKey === checkpoint.blobKey ? { ...photo,
      driveOriginalId: checkpoint.driveOriginalId ?? photo.driveOriginalId,
      drivePreviewId: checkpoint.drivePreviewId ?? photo.drivePreviewId,
      driveThumbnailId: checkpoint.driveThumbnailId ?? photo.driveThumbnailId,
      pendingUpload: checkpoint.pendingUpload ? { ...photo.pendingUpload, ...checkpoint.pendingUpload } : photo.pendingUpload } : photo),
    pages: project.pages.map(page => ({ ...page, photos: Object.fromEntries(Object.entries(page.photos).map(([id, photo]) => [id,
      photo.blobKey === checkpoint.blobKey ? { ...photo,
        driveOriginalId: checkpoint.driveOriginalId ?? photo.driveOriginalId,
        drivePreviewId: checkpoint.drivePreviewId ?? photo.drivePreviewId } : photo])) })),
  };
}
