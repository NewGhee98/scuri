import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as storage from "../storage";
import * as image from "../image";
import { applyHydratedPhotos, hydrateProjectPhotos, reconcileProjectPages, serializePage } from "../project-photos";
import { preserveProtectedLocalEdits, getProjectSyncStatus, projectHasUnbackedAssets, acknowledgeProjectPush } from "../project-sync";
import { applyPhotoBackupCheckpoint } from "../photo-backup";
import { ProjectSyncQueue } from "../sync-queue";
import { WorkspaceSession } from "../workspace";
import { ProjectHistory } from "../project-history";
import { nextProjectEditTime } from "../project-time";
import { cacheCustomTemplates, loadCachedCustomTemplates, createBlankCustomTemplate } from "../custom-templates";
import type { StoredProject } from "../types";

const created = "2026-01-01T00:00:00.000Z";
const edited = "2026-01-01T00:01:00.000Z";
export function syntheticProject(): StoredProject {
  return { version: 3, id: "synthetic-project", name: "Synthetic project", formatId: "instagram-post",
    activePageId: "synthetic-page", revision: 1, cloudSyncedAt: created, createdAt: created, updatedAt: created,
    pages: [{ id: "synthetic-page", templateId: "synthetic-layout", background: "#ffffff", gutter: 0,
      selectedFrameId: "f1", createdAt: created, updatedAt: created,
      templateSnapshot: { id: "synthetic-layout", name: "Synthetic layout", formatId: "instagram-post", canvasWidth: 1080, canvasHeight: 1350,
        defaultBackground: "#ffffff", defaultGutter: 0, frames: [{ id: "f1", x: 0, y: 0, width: 1, height: 1 }] },
      photos: { f1: { frameId: "f1", blobKey: "synthetic-blob", sourceWidth: 1200, sourceHeight: 800,
        mimeType: "image/jpeg", crop: { positionX: 0.2, positionY: 0, zoom: 1 } } } }],
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No real network in client safety tests"); }));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("protected local edits and hydration", () => {
  it("preserves a rename and new photo without copying an otherwise empty cache", () => {
    const remote = syntheticProject();
    const empty = structuredClone(remote); empty.pages[0].photos = {};
    expect(preserveProtectedLocalEdits(empty, remote, "synthetic-copy")).toBeNull();
    const local = structuredClone(empty); local.name = "Local rename";
    local.pages[0].photos.f2 = { ...remote.pages[0].photos.f1, frameId: "f2", blobKey: "synthetic-new-photo" };
    const copy = preserveProtectedLocalEdits(local, remote, "synthetic-copy")!;
    expect(copy.name).toContain("Local rename");
    expect(copy.pages[0].photos.f2.blobKey).toBe("synthetic-new-photo");
    expect(copy.pages[0].id).not.toBe(remote.pages[0].id);
    expect(remote.pages[0].photos.f1.blobKey).toBe("synthetic-blob");
  });

  it("uses valid decoded dimensions with original crop, including runtime-only originals", async () => {
    vi.spyOn(storage, "loadPhotoBlob").mockRejectedValue(new Error("IDB unavailable"));
    const bytes = new Blob(["synthetic original"], { type: "image/jpeg" });
    vi.spyOn(image, "preparePhotoAsset").mockImplementation(async (sourceBlob, frameId, blobKey = "unused") => ({
      sourceBlob, frameId, blobKey, sourceWidth: 1200, sourceHeight: 800, previewUrl: "blob:synthetic",
      crop: { positionX: 0, positionY: 0, zoom: 1 },
    }));
    const project = syntheticProject(); project.pages[0].photos.f1.sourceWidth = project.pages[0].photos.f1.sourceHeight = 0;
    const pages = reconcileProjectPages(project);
    const hydrated = await hydrateProjectPhotos(pages, () => null, () => bytes);
    const restored = applyHydratedPhotos(pages, hydrated);
    expect(restored[0].photos.f1).toMatchObject({ sourceWidth: 1200, sourceHeight: 800, crop: project.pages[0].photos.f1.crop });
    expect(serializePage(restored[0]).photos.f1.sourceWidth).toBe(1200);
    expect(reconcileProjectPages(project, restored)[0].photos.f1.sourceWidth).toBe(1200);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("backup truth and checkpoints", () => {
  it("never calls a metadata-only save fully synced while originals or previews are missing", () => {
    const project = syntheticProject();
    const context = { online: true, signedIn: true, isSyncing: false, hasError: false, driveConfigured: true, driveTokenValid: true };
    expect(getProjectSyncStatus(project, context)).toBe("photos-pending");
    project.pages[0].photos.f1.driveOriginalId = "synthetic-original";
    expect(projectHasUnbackedAssets(project)).toBe(true);
    expect(getProjectSyncStatus(project, { ...context, driveTokenValid: false })).toBe("drive-reconnect-required");
    project.pages[0].photos.f1.drivePreviewId = "synthetic-preview";
    expect(getProjectSyncStatus(project, context)).toBe("synced");
  });

  it("checkpoints a completed original without replacing a newer crop or resurrecting a removal", () => {
    const project = syntheticProject(); project.pages[0].photos.f1.crop.zoom = 3;
    const checkpoint = { blobKey: "synthetic-blob", driveOriginalId: "synthetic-original", driveFolderId: "synthetic-folder" };
    const saved = applyPhotoBackupCheckpoint(project, checkpoint, edited);
    expect(saved.pages[0].photos.f1.crop.zoom).toBe(3);
    expect(saved.pages[0].photos.f1.driveOriginalId).toBe(checkpoint.driveOriginalId);
    const removed = { ...project, pages: [{ ...project.pages[0], photos: {} }] };
    expect(applyPhotoBackupCheckpoint(removed, checkpoint, edited).pages[0].photos).toEqual({});
  });
});

describe("all-project retry queue", () => {
  it("drains multiple saved projects after reconnect without another edit", async () => {
    vi.useFakeTimers();
    const push = vi.fn().mockResolvedValue(true);
    const queue = new ProjectSyncQueue(push);
    queue.enqueue("synthetic-a", "v1"); queue.enqueue("synthetic-b", "v1");
    await vi.advanceTimersByTimeAsync(5000);
    expect(push).not.toHaveBeenCalled();
    queue.setEnabled(true);
    await vi.runAllTimersAsync();
    expect(push.mock.calls.map(call => call[0])).toEqual(["synthetic-a", "synthetic-b"]);
    queue.enqueue("synthetic-a", "v1");
    await vi.runAllTimersAsync();
    expect(push).toHaveBeenCalledTimes(2);
    queue.stop();
  });

  it("retries an unchanged failed save and preserves an edit made while a save runs", async () => {
    vi.useFakeTimers();
    const push = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const queue = new ProjectSyncQueue(push, 0); queue.setEnabled(true); queue.enqueue("synthetic-a", "v1");
    await vi.advanceTimersByTimeAsync(1); expect(push).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000); expect(push).toHaveBeenCalledTimes(2);
    let finish!: (value: boolean) => void;
    push.mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve; }));
    queue.enqueue("synthetic-a", "v2"); await vi.advanceTimersByTimeAsync(1);
    queue.enqueue("synthetic-a", "v3"); finish(true);
    await vi.runAllTimersAsync(); expect(push).toHaveBeenCalledTimes(4);
    queue.stop();
  });

  it("blocks deleted projects and waits for an issued save before allowing deletion", async () => {
    vi.useFakeTimers();
    let finish!: (value: boolean) => void;
    const push = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const queue = new ProjectSyncQueue(push, 0); queue.setEnabled(true); queue.enqueue("synthetic-a", "v1");
    await vi.advanceTimersByTimeAsync(1);
    let deleted = false;
    const deletion = queue.cancel("synthetic-a").then(() => { deleted = true; });
    queue.enqueue("synthetic-a", "v2");
    expect(deleted).toBe(false); finish(true); await deletion;
    await vi.runAllTimersAsync(); expect(deleted).toBe(true); expect(push).toHaveBeenCalledTimes(1);
    queue.stop();
  });
});

describe("account boundary and storage failures", () => {
  it("separates local/A/B caches and invalidates old work when changing account", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    storage.saveProjects([syntheticProject()]);
    expect(storage.loadProjects("synthetic-owner-a")).toEqual([]);
    storage.saveProjects([{ ...syntheticProject(), name: "A only" }], "synthetic-owner-a");
    expect(storage.loadProjects("synthetic-owner-b")).toEqual([]);
    expect(storage.loadProjects()[0].name).toBe("Synthetic project");
    expect(storage.loadProjects("synthetic-owner-a")[0].name).toBe("A only");
    cacheCustomTemplates([createBlankCustomTemplate("instagram-post")], "synthetic-owner-a");
    expect(loadCachedCustomTemplates("synthetic-owner-b")).toEqual([]);
    expect(loadCachedCustomTemplates("synthetic-owner-a")).toHaveLength(1);
    const workspace = new WorkspaceSession(); workspace.switchTo("synthetic-owner-a");
    const valid = workspace.capture(); workspace.switchTo(null); workspace.switchTo("synthetic-owner-a");
    expect(valid()).toBe(false);
  });

  it("rejects photos:null and preserves corrupt raw metadata before a replacement library is saved", () => {
    const malformed = syntheticProject(); malformed.pages[0].photos = null as never;
    const raw = JSON.stringify({ version: 1, projects: [malformed] });
    const values = new Map([["layouts.projects.v1", raw]]);
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    expect(() => storage.loadProjects()).toThrow(/damaged/);
    storage.saveProjects([]);
    const recovery = [...values].find(([key]) => key.includes(".recovery."));
    expect(recovery?.[1]).toBe(raw);
  });

  it.each(["commit", "abort"])("waits for the IndexedDB transaction %s after request success", async outcome => {
    const request: Partial<IDBRequest> = {};
    const transaction = { objectStore: () => ({ put: () => request }) } as unknown as IDBTransaction;
    const database = { transaction: () => transaction, close: vi.fn() };
    const open = { result: database } as unknown as IDBOpenDBRequest;
    vi.stubGlobal("window", { indexedDB: {} });
    vi.stubGlobal("indexedDB", { open: () => open });
    let settled = false;
    const pending = storage.savePhotoBlob("synthetic-blob", new Blob(["synthetic"]));
    void pending.then(() => { settled = true; }, () => { settled = true; });
    open.onsuccess!.call(open, {} as Event);
    await Promise.resolve(); await Promise.resolve();
    request.onsuccess!.call(request as IDBRequest, {} as Event);
    await Promise.resolve(); expect(settled).toBe(false);
    if (outcome === "commit") { transaction.oncomplete!.call(transaction, {} as Event); await expect(pending).resolves.toBeUndefined(); }
    else { transaction.onabort!.call(transaction, {} as Event); await expect(pending).rejects.toThrow(/commit/); }
  });
});

describe("session project undo", () => {
  it("creates a dirty edit when the device clock is behind its last cloud acknowledgement", () => {
    const project = syntheticProject(); project.cloudSyncedAt = edited;
    expect(Date.parse(nextProjectEditTime(project, created))).toBeGreaterThan(Date.parse(edited));
  });
  it("undoes and redoes photo removal, keeping fresh sync state and explicit intent", () => {
    const initial = syntheticProject();
    const history = new ProjectHistory(); history.observe(initial);
    const removed = structuredClone(initial); removed.pages[0].photos = {}; removed.updatedAt = edited;
    removed.pendingDeletions = { photos: [{ pageId: initial.pages[0].id, frameId: "f1", blobKey: "synthetic-blob" }], pageIds: [] };
    history.observe(removed);
    const restored = history.travel("undo", removed, edited)!;
    expect(restored.pages[0].photos.f1.blobKey).toBe("synthetic-blob");
    expect(restored.pendingDeletions).toBeUndefined();
    const acknowledged = acknowledgeProjectPush(restored, removed, { conflict: false, partial: false, project: { ...removed, revision: 2, cloudSyncedAt: edited } });
    expect(acknowledged.pages[0].photos.f1).toBeDefined();
    history.observe(acknowledged);
    const redone = history.travel("redo", acknowledged, "2026-01-01T00:02:00.000Z")!;
    expect(redone.revision).toBe(2);
    expect(redone.pages[0].photos).toEqual({});
    expect(redone.pendingDeletions?.photos[0].blobKey).toBe("synthetic-blob");
  });

  it("groups a crop gesture and keeps upload IDs learned after the history snapshot", () => {
    const initial = syntheticProject(); const history = new ProjectHistory(); history.observe(initial);
    const first = structuredClone(initial); first.pages[0].photos.f1.crop.zoom = 2; history.observe(first, "crop", 1000);
    const last = structuredClone(first); last.pages[0].photos.f1.crop.zoom = 3; history.observe(last, "crop", 1200);
    last.pages[0].photos.f1.driveOriginalId = "synthetic-uploaded";
    history.observe(last);
    const restored = history.travel("undo", last, edited)!;
    expect(restored.pages[0].photos.f1.crop.zoom).toBe(1);
    expect(restored.pages[0].photos.f1.driveOriginalId).toBe("synthetic-uploaded");
    expect(history.canUndo).toBe(false);
  });
});
