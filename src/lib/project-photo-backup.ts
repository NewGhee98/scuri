import { reserveDriveFileIds, uploadReservedDriveFile } from "./drive-resumable";
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
  if (!initial || !deps.current() || deps.signal?.aborted) return true;
  const first = getProjectPhotos(initial).find(photo => !photo.driveOriginalId || !photo.drivePreviewId || (photo.importedAt && !photo.driveThumbnailId));
  const canContinue = (blobKey = first?.blobKey) => {
    if (!deps.current() || deps.signal?.aborted) return false;
    if (deps.token()) return true;
    if (blobKey) deps.progress({ blobKey, stage: "Backup paused", needsReconnect: true,
      error: "Reconnect Drive to continue the backup." });
    return false;
  };
  if (!token) { canContinue(); return !first; }
  if (!first) {
    for (const photo of getProjectPhotos(initial)) deps.progress({ blobKey: photo.blobKey, stage: "Backed up" });
    return true;
  }
  let folders: Awaited<ReturnType<typeof ensureProjectDriveFolders>>;
  deps.progress({ blobKey: first.blobKey, stage: "Preparing Drive folders" });
  try { folders = await ensureProjectDriveFolders(token, initial.id, initial.name, initial.driveFolderId, deps.signal); }
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
      deps.progress({ blobKey: photo.blobKey, stage: step });
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
      // One cloud-accepted reservation for this photo's missing renditions.
      // Completed originals and old pending IDs are reused exactly as before.
      const renditions = [
        { kind: "original", completed: "driveOriginalId", pending: "originalId" },
        { kind: "preview", completed: "drivePreviewId", pending: "previewId" },
        ...(photo.importedAt ? [{ kind: "thumbnail", completed: "driveThumbnailId", pending: "thumbnailId" } as const] : []),
      ] as const;
      const missing = renditions.filter(item => !photo![item.completed]);
      const unreserved = missing.filter(item => !photo!.pendingUpload?.[item.pending]);
      const pendingUpload: NonNullable<ProjectPhoto["pendingUpload"]> = { ...photo.pendingUpload };
      if (unreserved.length) {
        step = "Reserving upload identities";
        deps.progress({ blobKey: photo.blobKey, stage: step });
        const ids = await reserveDriveFileIds(deps.token()!, unreserved.length, deps.signal);
        if (!canContinue(photo.blobKey)) return false;
        unreserved.forEach((item, index) => { pendingUpload[item.pending] = ids[index]; });
      }
      step = "Waiting for cloud metadata";
      deps.progress({ blobKey: photo.blobKey, stage: step });
      photo = await deps.checkpoint({ blobKey: photo.blobKey, driveFolderId: folders.projectFolderId, pendingUpload });
      if (!canContinue(photo.blobKey)) return false;
      if (missing.some(item => !photo![item.completed] && !photo!.pendingUpload?.[item.pending])) {
        throw new Error("Upload identities are not saved in the cloud. No file was created.");
      }
      for (const kind of ["original", "preview", "thumbnail"] as const) {
        const completed = kind === "original" ? "driveOriginalId" : kind === "preview" ? "drivePreviewId" : "driveThumbnailId";
        const pending = kind === "original" ? "originalId" : kind === "preview" ? "previewId" : "thumbnailId";
        if (photo[completed] || (kind === "thumbnail" && !photo.importedAt)) continue;
        if (!canContinue(photo.blobKey)) return false;
        const fileId = photo.pendingUpload?.[pending];
        if (!fileId) throw new Error("Upload identity could not be reconciled.");
        step = `Preparing ${kind}`;
        deps.progress({ blobKey: photo.blobKey, stage: step });
        if (kind === "preview" && !preview) { const derived = await createPhotoPreview(source); URL.revokeObjectURL(derived.previewUrl); preview = derived.blob; }
        if (kind === "thumbnail" && !thumbnail) {
          // Use the same two-step rendition pipeline on both first upload and
          // resume, even when the preview's upload already completed.
          if (!preview) { const derived = await createPhotoPreview(source); URL.revokeObjectURL(derived.previewUrl); preview = derived.blob; }
          if (!canContinue(photo.blobKey)) return false;
          const derived = await createPhotoPreview(preview, { longEdge: 640 }); URL.revokeObjectURL(derived.previewUrl); thumbnail = derived.blob;
        }
        if (!canContinue(photo.blobKey)) return false;
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
        if (!canContinue(photo.blobKey)) return false;
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
