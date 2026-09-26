import { reserveDriveFileId, uploadReservedDriveFile } from "./drive-resumable";
import { downloadGoogleDrivePhoto, ensureProjectDriveFolders } from "./google-drive";
import { createPhotoPreview } from "./image";
import { getProjectPhotos } from "./project-photo-library";
import type { PhotoBackupCheckpoint } from "./photo-backup";
import type { ProjectPhoto, StoredProject } from "./types";
import { workspaceKey } from "./workspace";
import { savePhotoBlob } from "./storage";
import { fingerprintOriginal } from "./photo-fingerprint";
import { DriveRequestError } from "./drive-request";

export interface PhotoBackupStatus { blobKey: string; stage: string; sent?: number; total?: number; error?: string; needsOriginal?: boolean; needsReconnect?: boolean }
interface Dependencies {
  project: () => StoredProject | undefined; token: () => string | null; current: () => boolean;
  source: (key: string) => Promise<Blob | null>;
  /** Must durably save locally AND pass the cloud revision gate. */
  checkpoint: (value: PhotoBackupCheckpoint) => Promise<ProjectPhoto>;
  progress: (status: PhotoBackupStatus) => void; ownerId: string; signal?: AbortSignal;
}
/** Separate from metadata scheduling; serial byte transfer, independent
 * rendition checkpoints, no speculative original downloads or file updates. */
export async function backUpProjectPhotos(deps: Dependencies): Promise<boolean> {
  const initial = deps.project(), token = deps.token();
  if (!initial || !deps.current()) return true;
  const first = getProjectPhotos(initial).find(photo => !photo.driveOriginalId || !photo.drivePreviewId || (photo.importedAt && !photo.driveThumbnailId));
  const canContinue = (blobKey = first?.blobKey) => {
    if (!deps.current()) return false;
    if (deps.token()) return true;
    if (blobKey) deps.progress({ blobKey, stage: "Backup paused", needsReconnect: true,
      error: "Reconnect Drive to continue the backup." });
    return false;
  };
  if (!token) { canContinue(); return !first; }
  let folders: Awaited<ReturnType<typeof ensureProjectDriveFolders>>;
  try { folders = await ensureProjectDriveFolders(token, initial.id, initial.name, initial.driveFolderId); }
  catch (error) {
    if (first && deps.current()) deps.progress({ blobKey: first.blobKey, stage: "Backup paused",
      ...(error instanceof DriveRequestError && error.needsReconnect ? { needsReconnect: true } : {}),
      error: error instanceof Error ? error.message : "Drive folders are unavailable. Reconnect and retry." });
    return false;
  }
  let success = true;
  for (const original of getProjectPhotos(initial)) {
    if (!canContinue(original.blobKey)) return false;
    let photo = getProjectPhotos(deps.project()!).find(item => item.blobKey === original.blobKey);
    if (!photo) continue;
    if (photo.driveOriginalId && photo.drivePreviewId && (!photo.importedAt || photo.driveThumbnailId)) {
      deps.progress({ blobKey: photo.blobKey, stage: "Backed up" }); continue;
    }
    let preview: Blob | undefined, thumbnail: Blob | undefined;
    let step = "Reading original";
    try {
      let source: Blob | null = null, sourceError: unknown;
      try {
        source = await deps.source(photo.blobKey);
        if (source) {
          if (!source.size || (photo.fileSize !== undefined && source.size !== photo.fileSize) ||
            (photo.fingerprint && await fingerprintOriginal(source) !== photo.fingerprint)) {
            throw new Error("Stored original bytes did not match this photo");
          }
          // Legacy originals may have no checksum. Blob metadata alone is not
          // proof that its backing file can still be read.
          if (!photo.fingerprint) await source.slice(0, 1).arrayBuffer();
        }
      } catch (error) { sourceError = error; source = null; }
      if (!canContinue(photo.blobKey)) return false;
      if (!source && photo.driveOriginalId) {
        deps.progress({ blobKey: photo.blobKey, stage: "Restoring original from Drive" });
        step = "Restoring original from Drive";
        source = await downloadGoogleDrivePhoto(deps.token()!, photo.driveOriginalId, deps.signal);
        if (!canContinue(photo.blobKey)) return false;
        if ((photo.fileSize !== undefined && source.size !== photo.fileSize) ||
          (photo.fingerprint && await fingerprintOriginal(source) !== photo.fingerprint)) {
          throw new Error("The Drive download did not match this original. Existing files are unchanged.");
        }
        if (!deps.current()) return false;
        // Local cache failure must not block rebuilding missing Drive previews.
        await savePhotoBlob(photo.blobKey, source).catch(() => {});
      }
      if (!canContinue(photo.blobKey)) return false;
      if (!source) {
        success = false;
        deps.progress({ blobKey: photo.blobKey, stage: "Original unavailable on this device", needsOriginal: true,
          error: sourceError instanceof Error ? `Local photo storage could not be read: ${sourceError.message}. Reselect the original to resume.`
            : "No local original or completed Drive backup is available. Reselect the original to resume." });
        continue;
      }
      const placedPage = deps.project()!.pages.find(page => Object.values(page.photos).some(item => item.blobKey === photo!.blobKey));
      const placement = placedPage && Object.values(placedPage.photos).find(item => item.blobKey === photo!.blobKey);
      for (const kind of ["original", "preview", "thumbnail"] as const) {
        const completed = kind === "original" ? "driveOriginalId" : kind === "preview" ? "drivePreviewId" : "driveThumbnailId";
        const pending = kind === "original" ? "originalId" : kind === "preview" ? "previewId" : "thumbnailId";
        if (photo[completed] || (kind === "thumbnail" && !photo.importedAt)) continue;
        if (!canContinue(photo.blobKey)) return false;
        step = `Saving ${kind} upload identity`;
        let fileId = photo.pendingUpload?.[pending];
        if (!fileId) {
          deps.progress({ blobKey: photo.blobKey, stage: `Saving ${kind} upload identity` });
          const reserved = await reserveDriveFileId(deps.token()!);
          photo = await deps.checkpoint({ blobKey: photo.blobKey, driveFolderId: folders.projectFolderId, pendingUpload: { [pending]: reserved } });
          fileId = photo.pendingUpload?.[pending];
          if (!fileId) throw new Error("Upload identity is not saved in the cloud. No file was created.");
        } else {
          // A restored/local checkpoint is not proof that the cloud accepted it.
          photo = await deps.checkpoint({ blobKey: photo.blobKey, driveFolderId: folders.projectFolderId, pendingUpload: { [pending]: fileId } });
          fileId = photo.pendingUpload?.[pending];
          if (!fileId) throw new Error("Upload identity could not be reconciled.");
        }
        if (photo[completed]) continue;
        step = `Preparing ${kind}`;
        if (kind === "preview" && !preview) { const derived = await createPhotoPreview(source); URL.revokeObjectURL(derived.previewUrl); preview = derived.blob; }
        if (kind === "thumbnail" && !thumbnail) { const derived = await createPhotoPreview(preview ?? source, { longEdge: 640 }); URL.revokeObjectURL(derived.previewUrl); thumbnail = derived.blob; }
        const blob = kind === "original" ? source : kind === "preview" ? preview! : thumbnail!;
        const identity: Record<string, string> = { scuriProjectId: initial.id, scuriBlobKey: photo.blobKey, scuriType: kind };
        if (placedPage && placement) { identity.scuriPageId = placedPage.id; identity.scuriFrameId = placement.frameId; }
        step = `Uploading ${kind}`;
        const id = await uploadReservedDriveFile({ fileId, blob, token: deps.token, current: deps.current, signal: deps.signal,
          journalKey: workspaceKey(`scuri.upload.${initial.id}.${photo.blobKey}.${kind}`, deps.ownerId),
          metadata: { name: kind === "original" ? (photo.sourceName ?? `${photo.blobKey}.jpg`).replace(/[\\/:*?"<>|]/g, "-").slice(0, 120) : `${photo.blobKey}.${kind}.webp`,
            parents: [kind === "original" ? folders.originalsFolderId : folders.previewsFolderId], appProperties: identity },
          progress: (sent, total) => deps.progress({ blobKey: original.blobKey, stage: `Uploading ${kind}`, sent, total }),
          retrying: (attempt, delay) => deps.progress({ blobKey: original.blobKey,
            stage: `Connection interrupted; retrying ${kind} in ${delay / 1000}s (attempt ${attempt}/3)` }),
        });
        deps.progress({ blobKey: photo.blobKey, stage: `Uploaded ${kind}; metadata pending` });
        step = `Saving ${kind} backup confirmation`;
        photo = await deps.checkpoint({ blobKey: photo.blobKey, driveFolderId: folders.projectFolderId, [completed]: id });
      }
      deps.progress({ blobKey: photo.blobKey, stage: "Backed up" });
    } catch (error) {
      success = false;
      if (!deps.current()) return false;
      const message = error && typeof error === "object" && "message" in error && typeof error.message === "string"
        ? error.message : "Retry backup";
      deps.progress({ blobKey: photo.blobKey, stage: "Backup paused",
        ...(error instanceof DriveRequestError && error.needsReconnect ? { needsReconnect: true } : {}),
        error: `${step}: ${message}` });
      // Auth/quota/network issues should back off, not issue hundreds of errors.
      break;
    }
  }
  return success;
}
