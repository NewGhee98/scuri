import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backUpProjectPhotos } from "../project-photo-backup";
import { DriveRequestError } from "../drive-request";
import { reserveDriveFileIds, uploadReservedDriveFile } from "../drive-resumable";
import { downloadGoogleDrivePhoto, ensureProjectDriveFolders } from "../google-drive";
import { savePhotoBlob } from "../storage";
import { createPhotoPreview } from "../image";
import { applyPhotoBackupCheckpoint } from "../photo-backup";
import { getProjectPhotos } from "../project-photo-library";
import type { PhotoBackupCheckpoint } from "../photo-backup";
import type { StoredProject } from "../types";
import { ProjectSyncQueue } from "../sync-queue";
vi.mock("../google-drive", () => ({ ensureProjectDriveFolders: vi.fn(), downloadGoogleDrivePhoto: vi.fn() }));
vi.mock("../storage", () => ({ savePhotoBlob: vi.fn() }));
vi.mock("../drive-resumable", () => ({ reserveDriveFileIds: vi.fn(), uploadReservedDriveFile: vi.fn() }));
vi.mock("../image", () => ({ createPhotoPreview: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(ensureProjectDriveFolders).mockResolvedValue({ projectFolderId: "folder", originalsFolderId: "originals", previewsFolderId: "previews", exportsFolderId: "exports" });
  let count = 0; vi.mocked(reserveDriveFileIds).mockImplementation(async (_token, countNeeded) => Array.from({ length: countNeeded }, () => `reserved-${++count}`));
  vi.mocked(createPhotoPreview).mockResolvedValue({ blob: new Blob(["preview"], { type: "image/webp" }), width: 6400, height: 1440, previewUrl: "blob:synthetic" });
  vi.mocked(uploadReservedDriveFile).mockImplementation(async options => options.fileId);
  vi.mocked(savePhotoBlob).mockResolvedValue();
});
afterEach(() => vi.useRealTimers());
function harness() {
  let p: StoredProject = { version: 3, id: "p", name: "Synthetic", formatId: "instagram-post", activePageId: null, pages: [], createdAt: "2026-09-19", updatedAt: "2026-09-19",
    photoLibrary: [{ blobKey: "photo", sourceWidth: 6400, sourceHeight: 1440, importedAt: "2026-09-19" }] };
  const checkpoint = vi.fn(async (value: PhotoBackupCheckpoint) => { p = applyPhotoBackupCheckpoint(p, value, "2026-09-19"); return getProjectPhotos(p)[0]; });
  return { options: { project: () => p, token: () => "synthetic", current: () => true, ownerId: "owner", checkpoint,
    source: vi.fn(async (): Promise<Blob | null> => new Blob(["original"], { type: "image/jpeg" })), progress: vi.fn() }, project: () => p };
}
describe("backup independent of composition saves", () => {
  it("reserves all three identities together and keeps each upload confirmation independent", async () => {
    const h = harness();
    vi.mocked(uploadReservedDriveFile).mockImplementation(async options => {
      expect(h.project().photoLibrary![0].pendingUpload).toEqual({ originalId: "reserved-1", previewId: "reserved-2", thumbnailId: "reserved-3" });
      return options.fileId;
    });
    expect(await backUpProjectPhotos(h.options)).toBe(true);
    expect(reserveDriveFileIds).toHaveBeenCalledExactlyOnceWith("synthetic", 3, undefined);
    expect(h.options.checkpoint).toHaveBeenCalledTimes(4); // previously six cloud saves
    expect(h.options.checkpoint.mock.calls.slice(1).map(([checkpoint]) => Object.keys(checkpoint).filter(key => key.endsWith("Id"))))
      .toEqual([["driveFolderId", "driveOriginalId"], ["driveFolderId", "drivePreviewId"], ["driveFolderId", "driveThumbnailId"]]);
  });

  it("reloads a 123-photo project at 6 backed up, reuses old reservations, and completes without touching completed originals", async () => {
    const h = harness(), original = { ...h.project().photoLibrary![0] };
    h.project().photoLibrary = Array.from({ length: 123 }, (_, i) => ({ ...original, blobKey: `photo-${i}`,
      ...(i < 6 ? { driveOriginalId: `original-${i}`, drivePreviewId: `preview-${i}`, driveThumbnailId: `thumbnail-${i}` } : {}),
      ...(i === 6 ? { pendingUpload: { originalId: "previously-reserved-original" } } : {}),
    }));
    // Equivalent to reopening the durable metadata with a fresh Drive token.
    Object.assign(h.project(), JSON.parse(JSON.stringify(h.project())));
    const save = h.options.checkpoint.getMockImplementation()!;
    h.options.checkpoint.mockImplementation(async checkpoint => {
      await save(checkpoint);
      return getProjectPhotos(h.project()).find(photo => photo.blobKey === checkpoint.blobKey)!;
    });
    const completed = structuredClone(h.project().photoLibrary!.slice(0, 6));
    expect(await backUpProjectPhotos(h.options)).toBe(true);
    expect(h.project().id).toBe("p"); expect(h.project().photoLibrary).toHaveLength(123);
    expect(h.project().photoLibrary!.slice(0, 6)).toEqual(completed);
    expect(h.project().photoLibrary!.every(photo => photo.driveOriginalId && photo.drivePreviewId && photo.driveThumbnailId)).toBe(true);
    expect(uploadReservedDriveFile).toHaveBeenCalledTimes(117 * 3);
    expect(h.options.checkpoint).toHaveBeenCalledTimes(117 * 4);
    expect(reserveDriveFileIds).toHaveBeenNthCalledWith(1, "synthetic", 2, undefined);
    expect(vi.mocked(uploadReservedDriveFile).mock.calls[0][0].fileId).toBe("previously-reserved-original");
    expect(vi.mocked(uploadReservedDriveFile).mock.calls.every(([options]) => !/^photo-[0-5]$/.test(options.metadata.appProperties.scuriBlobKey))).toBe(true);
  });

  it("shows early progress and ignores a stalled original read that returns after Retry", async () => {
    vi.useFakeTimers();
    const h = harness(); let lateRead!: (value: Blob) => void;
    h.options.source.mockImplementationOnce(() => new Promise(resolve => { lateRead = resolve; }));
    const queue = new ProjectSyncQueue(async (_id, context) => backUpProjectPhotos({ ...h.options, signal: context.signal,
      current: () => !context.signal.aborted, progress: status => { context.heartbeat(); h.options.progress(status); } }), 0);
    queue.setEnabled(true); queue.enqueue("p", "start");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.options.progress).toHaveBeenCalledWith({ blobKey: "photo", stage: "Preparing Drive folders" });
    expect(h.options.progress).toHaveBeenLastCalledWith({ blobKey: "photo", stage: "Reading original" });
    queue.retry("p", "retry"); await vi.advanceTimersByTimeAsync(1);
    expect(h.project().photoLibrary![0].driveOriginalId).toBe("reserved-1");
    const saved = structuredClone(h.project());
    lateRead(new Blob(["original"])); await vi.advanceTimersByTimeAsync(1);
    expect(h.project()).toEqual(saved); expect(uploadReservedDriveFile).toHaveBeenCalledTimes(3);
    queue.stop();
  });
  it("reports expired access as incomplete and asks to reconnect instead of acknowledging success", async () => {
    const h = harness();
    expect(await backUpProjectPhotos({ ...h.options, token: () => null })).toBe(false);
    expect(h.options.progress).toHaveBeenLastCalledWith(expect.objectContaining({ needsReconnect: true }));
    expect(ensureProjectDriveFolders).not.toHaveBeenCalled();
    expect(uploadReservedDriveFile).not.toHaveBeenCalled();
  });
  it("carries a Drive authentication failure into the recovery action", async () => {
    const h = harness();
    vi.mocked(uploadReservedDriveFile).mockRejectedValue(new DriveRequestError("Reconnect Drive", false, true));
    expect(await backUpProjectPhotos(h.options)).toBe(false);
    expect(h.options.progress).toHaveBeenLastCalledWith(expect.objectContaining({
      needsReconnect: true, error: "Uploading original: Reconnect Drive",
    }));
    expect(h.project().photoLibrary![0].driveOriginalId).toBeUndefined();
    expect(h.project().photoLibrary![0].pendingUpload?.originalId).toBe("reserved-1");
  });
  it("reports missing originals as incomplete and leaves metadata and cloud files untouched", async () => {
    const h = harness(), before = structuredClone(h.project());
    h.options.source.mockResolvedValue(null);
    expect(await backUpProjectPhotos(h.options)).toBe(false);
    expect(h.options.progress).toHaveBeenLastCalledWith(expect.objectContaining({ needsOriginal: true }));
    expect(h.project()).toEqual(before);
    expect(reserveDriveFileIds).not.toHaveBeenCalled(); expect(uploadReservedDriveFile).not.toHaveBeenCalled();
  });
  it("shows a storage-read failure rather than disguising it as a missing file", async () => {
    const h = harness(); h.options.source.mockRejectedValue(new Error("IndexedDB unavailable"));
    expect(await backUpProjectPhotos(h.options)).toBe(false);
    expect(h.options.progress).toHaveBeenLastCalledWith(expect.objectContaining({ error: expect.stringContaining("IndexedDB unavailable"), needsOriginal: true }));
  });
  it("restores an existing Drive original and uploads only missing previews after local bytes are lost", async () => {
    const h = harness(), original = new Blob(["original"], { type: "image/jpeg" });
    h.project().photoLibrary![0].driveOriginalId = "completed-original";
    h.options.source.mockResolvedValue(null); vi.mocked(downloadGoogleDrivePhoto).mockResolvedValue(original);
    // A full device still permits repair of the cloud previews.
    vi.mocked(savePhotoBlob).mockRejectedValue(new Error("Quota exceeded"));
    expect(await backUpProjectPhotos(h.options)).toBe(true);
    expect(downloadGoogleDrivePhoto).toHaveBeenCalledWith("synthetic", "completed-original", undefined);
    expect(uploadReservedDriveFile).toHaveBeenCalledTimes(2);
    expect(vi.mocked(uploadReservedDriveFile).mock.calls.map(([options]) => options.metadata.appProperties.scuriType)).toEqual(["preview", "thumbnail"]);
    expect(h.project().photoLibrary![0].driveOriginalId).toBe("completed-original");
  });
  it("does not adopt a Drive download that differs from the expected original", async () => {
    const h = harness(); Object.assign(h.project().photoLibrary![0], { driveOriginalId: "original-id", fileSize: 100 });
    h.options.source.mockResolvedValue(null); vi.mocked(downloadGoogleDrivePhoto).mockResolvedValue(new Blob(["truncated"]));
    expect(await backUpProjectPhotos(h.options)).toBe(false);
    expect(savePhotoBlob).not.toHaveBeenCalled(); expect(uploadReservedDriveFile).not.toHaveBeenCalled();
    expect(h.options.progress).toHaveBeenLastCalledWith(expect.objectContaining({ error: expect.stringContaining("did not match") }));
  });
  it("falls back to Drive when a local Blob exists but its backing file cannot be read", async () => {
    const h = harness(), stale = new Blob(["original"]);
    h.project().photoLibrary![0].driveOriginalId = "original-id";
    vi.spyOn(stale, "slice").mockImplementation(() => { throw new DOMException("Unreadable file", "NotReadableError"); });
    h.options.source.mockResolvedValue(stale);
    vi.mocked(downloadGoogleDrivePhoto).mockResolvedValue(new Blob(["original"]));
    expect(await backUpProjectPhotos(h.options)).toBe(true);
    expect(downloadGoogleDrivePhoto).toHaveBeenCalledOnce();
    expect(h.project().photoLibrary![0].driveOriginalId).toBe("original-id");
  });
  it("discards late Drive recovery when the workspace changes", async () => {
    const h = harness(); h.project().photoLibrary![0].driveOriginalId = "original-id";
    h.options.source.mockResolvedValue(null);
    vi.mocked(downloadGoogleDrivePhoto).mockImplementation(async () => { h.options.current = () => false; return new Blob(["original"]); });
    expect(await backUpProjectPhotos(h.options)).toBe(false);
    expect(savePhotoBlob).not.toHaveBeenCalled(); expect(uploadReservedDriveFile).not.toHaveBeenCalled();
  });
  it("clears an old missing-original warning when all renditions are already complete", async () => {
    const h = harness(); Object.assign(h.project().photoLibrary![0], { driveOriginalId: "original", drivePreviewId: "preview", driveThumbnailId: "thumb" });
    expect(await backUpProjectPhotos(h.options)).toBe(true);
    expect(h.options.progress).toHaveBeenLastCalledWith({ blobKey: "photo", stage: "Backed up" });
    expect(h.options.source).not.toHaveBeenCalled();
  });
  it("surfaces folder access failure and backs off without creating files or marking photos backed up", async () => {
    const h = harness(); vi.mocked(ensureProjectDriveFolders).mockRejectedValueOnce(new Error("Drive folder access expired"));
    expect(await backUpProjectPhotos(h.options)).toBe(false);
    expect(h.options.progress).toHaveBeenLastCalledWith({ blobKey: "photo", stage: "Backup paused", error: "Drive folder access expired" });
    expect(reserveDriveFileIds).not.toHaveBeenCalled(); expect(uploadReservedDriveFile).not.toHaveBeenCalled();
    expect(h.options.checkpoint).not.toHaveBeenCalled();
  });
  it("requires the cloud-accepted reservation before any byte upload", async () => {
    const h = harness(); h.options.checkpoint.mockRejectedValueOnce(new Error("Cloud revision rejected"));
    expect(await backUpProjectPhotos(h.options)).toBe(false);
    expect(uploadReservedDriveFile).not.toHaveBeenCalled();
    expect(h.options.progress).toHaveBeenLastCalledWith(expect.objectContaining({ stage: "Backup paused" }));
  });
  it("retains a completed original when preview fails and resumes just the missing renditions", async () => {
    const h = harness(); vi.mocked(uploadReservedDriveFile).mockImplementation(async options => {
      if (options.metadata.appProperties.scuriType === "preview") throw new Error("Token expired"); return options.fileId;
    });
    expect(await backUpProjectPhotos(h.options)).toBe(false);
    expect(h.project().photoLibrary![0].driveOriginalId).toBe("reserved-1");
    const prior = vi.mocked(uploadReservedDriveFile).mock.calls.length;
    vi.mocked(uploadReservedDriveFile).mockImplementation(async options => options.fileId);
    expect(await backUpProjectPhotos(h.options)).toBe(true);
    const resumed = vi.mocked(uploadReservedDriveFile).mock.calls.slice(prior).map(([options]) => options.metadata.appProperties.scuriType);
    expect(resumed).toEqual(["preview", "thumbnail"]);
    expect(h.project().photoLibrary![0]).toMatchObject({ driveOriginalId: "reserved-1", drivePreviewId: "reserved-2", driveThumbnailId: "reserved-3" });
  });
  it("reports uploaded metadata pending rather than claiming backup succeeded if its reference save fails", async () => {
    const h = harness(), save = h.options.checkpoint.getMockImplementation()!;
    h.options.checkpoint.mockImplementation(async value => { if (value.driveOriginalId) throw new Error("Reference save unavailable"); return save(value); });
    expect(await backUpProjectPhotos(h.options)).toBe(false);
    expect(h.options.progress.mock.calls.some(([value]) => value.stage === "Uploaded original; metadata pending")).toBe(true);
    expect(h.project().photoLibrary![0].driveOriginalId).toBeUndefined();
    expect(h.project().photoLibrary![0].pendingUpload?.originalId).toBe("reserved-1");
  });
});
