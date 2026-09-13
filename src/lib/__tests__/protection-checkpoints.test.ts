import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyPhotoBackupCheckpoint } from "../photo-backup";
import { getProjectPhotos } from "../project-photo-library";
import { isProjectDirty, reconcileProtectedProject } from "../project-sync";
import { uploadPhotoAssetToDrive } from "../google-drive";
import { loadProjects, saveProjects } from "../storage";
import type { StoredProject } from "../types";

const timestamp = "2026-01-01T00:00:00.000Z";
const serverTime = "2026-01-02T00:00:00.000Z";
const folders = { projectFolderId: "synthetic-folder", originalsFolderId: "synthetic-originals", previewsFolderId: "synthetic-previews", exportsFolderId: "synthetic-exports" };
function project(): StoredProject {
  return { version: 3, id: "synthetic-project", name: "Synthetic", formatId: "instagram-square", activePageId: "synthetic-page",
    createdAt: timestamp, updatedAt: serverTime, cloudSyncedAt: serverTime, revision: 7,
    pages: [{ id: "synthetic-page", templateId: "synthetic-template", selectedFrameId: null, background: "#fff", gutter: 12,
      createdAt: timestamp, updatedAt: serverTime, photos: {
        f1: { frameId: "f1", cloudAssetId: "synthetic-row-1", blobKey: "synthetic-photo-1", sourceWidth: 1200, sourceHeight: 800, crop: { positionX: 0.2, positionY: 0, zoom: 1.5 } },
        f2: { frameId: "f2", cloudAssetId: "synthetic-row-2", blobKey: "synthetic-photo-2", sourceWidth: 1200, sourceHeight: 800, crop: { positionX: 0, positionY: 0, zoom: 0.5 } },
      } }],
  };
}
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No real network in checkpoint regression tests"); }));
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());

describe("protection recovery preserves upload checkpoints", () => {
  it.each(["driveOriginalId", "drivePreviewId"] as const)("retains an independent %s checkpoint without creating a recovered copy", field => {
    const remote = project();
    const local = structuredClone(remote);
    delete local.pages[0].photos.f2;
    const saved = applyPhotoBackupCheckpoint(local, { blobKey: "synthetic-photo-1", driveFolderId: folders.projectFolderId, [field]: "synthetic-upload" }, timestamp);
    const before = structuredClone({ remote, saved });
    const { canonical, copy } = reconcileProtectedProject(saved, remote, "unused-copy", timestamp);
    expect(copy).toBeNull();
    expect(canonical.pages[0].photos.f1[field]).toBe("synthetic-upload");
    expect(canonical.photoLibrary?.find(photo => photo.blobKey === "synthetic-photo-1")?.[field]).toBe("synthetic-upload");
    expect(canonical.pages[0].photos.f2).toEqual(remote.pages[0].photos.f2);
    expect(canonical.driveFolderId).toBe(folders.projectFolderId);
    expect(canonical.revision).toBe(remote.revision);
    expect(canonical.cloudSyncedAt).toBe(serverTime);
    expect(isProjectDirty(canonical)).toBe(true); // Even when the client clock is behind the server.
    expect({ remote, saved }).toEqual(before);
  });

  it("matches bytes across frame moves while preserving cloud references, crops and row identities", () => {
    const remote = project();
    const local = structuredClone(remote);
    local.driveFolderId = "synthetic-local-folder";
    local.pages[0].photos.f1.driveOriginalId = "synthetic-local-original";
    local.pages[0].photos.f1.drivePreviewId = "synthetic-local-preview";
    remote.driveFolderId = "synthetic-cloud-folder";
    remote.pages[0].photos.f2 = { ...remote.pages[0].photos.f1, frameId: "f2", cloudAssetId: "synthetic-moved-row", driveOriginalId: "synthetic-cloud-original" };
    remote.pages[0].photos.f1 = { ...local.pages[0].photos.f2, frameId: "f1", cloudAssetId: "synthetic-other-row" };
    const { canonical } = reconcileProtectedProject(local, remote, "synthetic-copy", timestamp);
    expect(canonical.pages[0].photos.f2).toEqual({ ...remote.pages[0].photos.f2, drivePreviewId: "synthetic-local-preview" });
    expect(canonical.pages[0].photos.f1).toEqual(remote.pages[0].photos.f1);
    expect(canonical.driveFolderId).toBe("synthetic-cloud-folder");
  });

  it("retains checkpoints for cloud library-only photos without restoring a placement", () => {
    const remote = project();
    remote.photoLibrary = getProjectPhotos(remote);
    remote.pages[0].photos = {};
    const saved = applyPhotoBackupCheckpoint(remote, { blobKey: "synthetic-photo-1", driveFolderId: folders.projectFolderId,
      driveOriginalId: "synthetic-original", drivePreviewId: "synthetic-preview" }, timestamp);
    const { canonical, copy } = reconcileProtectedProject(saved, remote, "unused-copy", timestamp);
    expect(copy).toBeNull();
    expect(canonical.pages[0].photos).toEqual({});
    expect(canonical.photoLibrary).toHaveLength(2);
    expect(canonical.photoLibrary?.[0]).toMatchObject({ driveOriginalId: "synthetic-original", drivePreviewId: "synthetic-preview" });
  });

  it("keeps local edits separately without copying their crops or new photos into cloud structure", () => {
    const remote = project();
    const saved = applyPhotoBackupCheckpoint(structuredClone(remote), { blobKey: "synthetic-photo-1", driveFolderId: folders.projectFolderId,
      driveOriginalId: "synthetic-original" }, timestamp);
    saved.name = "Synthetic local rename";
    saved.pages[0].photos.f1.crop.zoom = 3;
    saved.pages[0].photos.f2 = { ...saved.pages[0].photos.f2, blobKey: "synthetic-new-photo" };
    saved.pendingDeletions = { photos: [{ pageId: "synthetic-page", frameId: "f2", blobKey: "synthetic-photo-2" }], pageIds: [] };
    const { canonical, copy } = reconcileProtectedProject(saved, remote, "synthetic-copy", timestamp);
    expect(canonical.name).toBe(remote.name);
    expect(canonical.pages[0].photos.f1.crop).toEqual(remote.pages[0].photos.f1.crop);
    expect(canonical.pages[0].photos.f2).toEqual(remote.pages[0].photos.f2);
    expect(getProjectPhotos(canonical).some(photo => photo.blobKey === "synthetic-new-photo")).toBe(false);
    expect(canonical.pendingDeletions).toBeUndefined();
    expect(copy?.id).toBe("synthetic-copy");
    expect(copy?.pages[0].id).not.toBe(remote.pages[0].id);
    expect(copy?.pages[0].photos.f1).toMatchObject({ driveOriginalId: "synthetic-original", crop: { zoom: 3 } });
    expect(copy?.pages[0].photos.f2.blobKey).toBe("synthetic-new-photo");
    expect(copy?.driveFolderId).toBeUndefined(); // A copy gets its own future folder.
    expect(canonical.driveFolderId).toBe(folders.projectFolderId);
  });

  it("leaves an already acknowledged or checkpoint-free remote snapshot clean and unchanged", () => {
    const remote = project();
    remote.driveFolderId = folders.projectFolderId;
    remote.pages[0].photos.f1.driveOriginalId = "synthetic-original";
    remote.pages[0].photos.f1.drivePreviewId = "synthetic-preview";
    const local = structuredClone(remote);
    delete local.pages[0].photos.f2;
    const result = reconcileProtectedProject(local, remote, "unused-copy", timestamp);
    expect(result.canonical).toBe(remote);
    expect(result.copy).toBeNull();
    expect(isProjectDirty(result.canonical)).toBe(false);
    expect(reconcileProtectedProject({ ...remote, driveFolderId: undefined, pages: [] }, remote, "unused-copy").canonical).toBe(remote);
    expect(() => reconcileProtectedProject({ ...local, id: "another-project" }, remote, "unused-copy")).toThrow(/another project/);
  });

  it("does not upload a completed original again after preview failure, protection recovery and reload", async () => {
    const remote = project();
    let saved = structuredClone(remote);
    delete saved.pages[0].photos.f2;
    const uploads: string[] = [];
    let pendingType = "";
    let failPreview = true;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options: RequestInit) => {
      if (options.method === "POST") {
        pendingType = JSON.parse(String(options.body)).appProperties.scuriType;
        uploads.push(pendingType);
        if (pendingType === "preview" && failPreview) return new Response("Synthetic preview failure", { status: 503 });
        return new Response(null, { status: 200, headers: { Location: "https://example.invalid/synthetic-upload" } });
      }
      return Response.json({ id: `synthetic-${pendingType}-file` });
    }));
    const bytes = new Blob(["synthetic image bytes"], { type: "image/jpeg" });
    const upload = () => uploadPhotoAssetToDrive("synthetic-token", folders, saved.id, saved.pages[0].id, saved.pages[0].photos.f1, bytes, bytes,
      async ids => { saved = applyPhotoBackupCheckpoint(saved, { ...ids, blobKey: "synthetic-photo-1", driveFolderId: folders.projectFolderId }, timestamp); });
    await expect(upload()).rejects.toThrow();
    expect(saved.pages[0].photos.f1.driveOriginalId).toBe("synthetic-original-file");
    const restored = reconcileProtectedProject(saved, remote, "unused-copy", timestamp);
    expect(restored.copy).toBeNull();
    saveProjects([restored.canonical]);
    [saved] = loadProjects();
    failPreview = false;
    await upload();
    await upload(); // Subsequent retries use both retained file IDs.
    expect(uploads).toEqual(["original", "preview", "preview"]);
    expect(saved.pages[0].photos.f1).toMatchObject({ driveOriginalId: "synthetic-original-file", drivePreviewId: "synthetic-preview-file" });
    expect(saved.pages[0].photos.f2).toEqual(remote.pages[0].photos.f2);
  });
});
