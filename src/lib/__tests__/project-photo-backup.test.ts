import { beforeEach, describe, expect, it, vi } from "vitest";
import { backUpProjectPhotos } from "../project-photo-backup";
import { reserveDriveFileId, uploadReservedDriveFile } from "../drive-resumable";
import { ensureProjectDriveFolders } from "../google-drive";
import { createPhotoPreview } from "../image";
import { applyPhotoBackupCheckpoint } from "../photo-backup";
import { getProjectPhotos } from "../project-photo-library";
import type { PhotoBackupCheckpoint } from "../photo-backup";
import type { StoredProject } from "../types";
vi.mock("../google-drive", () => ({ ensureProjectDriveFolders: vi.fn() }));
vi.mock("../drive-resumable", () => ({ reserveDriveFileId: vi.fn(), uploadReservedDriveFile: vi.fn() }));
vi.mock("../image", () => ({ createPhotoPreview: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(ensureProjectDriveFolders).mockResolvedValue({ projectFolderId: "folder", originalsFolderId: "originals", previewsFolderId: "previews", exportsFolderId: "exports" });
  let count = 0; vi.mocked(reserveDriveFileId).mockImplementation(async () => `reserved-${++count}`);
  vi.mocked(createPhotoPreview).mockResolvedValue({ blob: new Blob(["preview"], { type: "image/webp" }), width: 6400, height: 1440, previewUrl: "blob:synthetic" });
  vi.mocked(uploadReservedDriveFile).mockImplementation(async options => options.fileId);
});
function harness() {
  let p: StoredProject = { version: 3, id: "p", name: "Synthetic", formatId: "instagram-post", activePageId: null, pages: [], createdAt: "2026-09-19", updatedAt: "2026-09-19",
    photoLibrary: [{ blobKey: "photo", sourceWidth: 6400, sourceHeight: 1440, importedAt: "2026-09-19" }] };
  const checkpoint = vi.fn(async (value: PhotoBackupCheckpoint) => { p = applyPhotoBackupCheckpoint(p, value, "2026-09-19"); return getProjectPhotos(p)[0]; });
  return { options: { project: () => p, token: () => "synthetic", current: () => true, ownerId: "owner", checkpoint,
    source: vi.fn(async () => new Blob(["original"], { type: "image/jpeg" })), progress: vi.fn() }, project: () => p };
}
describe("backup independent of composition saves", () => {
  it("surfaces folder access failure and backs off without creating files or marking photos backed up", async () => {
    const h = harness(); vi.mocked(ensureProjectDriveFolders).mockRejectedValueOnce(new Error("Drive folder access expired"));
    expect(await backUpProjectPhotos(h.options)).toBe(false);
    expect(h.options.progress).toHaveBeenLastCalledWith({ blobKey: "photo", stage: "Backup paused", error: "Drive folder access expired" });
    expect(reserveDriveFileId).not.toHaveBeenCalled(); expect(uploadReservedDriveFile).not.toHaveBeenCalled();
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
