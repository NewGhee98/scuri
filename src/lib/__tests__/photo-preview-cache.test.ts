import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhotoPreviewCache, displayPagePhotos, SESSION_PREVIEW_LONG_EDGE } from "../photo-preview-cache";
import { createPhotoPreview } from "../image";
import { downloadGoogleDrivePhoto } from "../google-drive";
import { loadPhotoBlob, savePhotoBlob } from "../storage";
import { applyHydratedPhotos, reconcileProjectPages, removePagePhoto, serializePage, updatePagePhotoCrop } from "../project-photos";
import { renderPagePreview } from "../export";
import { getFormat } from "../formats";
import { getTemplate } from "../templates";
import type { PhotoAsset, ProjectPage, StoredPhotoAsset, StoredProject } from "../types";
import { readDerived, writeDerived } from "../photo-cache-storage";
vi.mock("../photo-cache-storage", () => ({ readDerived: vi.fn(), writeDerived: vi.fn() }));

vi.mock("../image", async original => ({ ...await original<typeof import("../image")>(), createPhotoPreview: vi.fn() }));
vi.mock("../google-drive", () => ({ downloadGoogleDrivePhoto: vi.fn() }));
vi.mock("../storage", async original => ({ ...await original<typeof import("../storage")>(), loadPhotoBlob: vi.fn(), savePhotoBlob: vi.fn() }));
const stored: StoredPhotoAsset = { frameId: "photo-1", blobKey: "synthetic-original", driveOriginalId: "original-id", drivePreviewId: "preview-id",
  sourceWidth: 6400, sourceHeight: 1440, crop: { positionX: 0.25, positionY: -0.1, zoom: 0.8765433 } };
const original = new Blob(["synthetic full-resolution original"]);
const thumbnail = new Blob(["small preview"]);
function page(photos: Record<string, StoredPhotoAsset> = { "photo-1": stored }): ProjectPage {
  return { id: "page-a", templateId: "instagram-square-full-frame", photos: {}, unavailablePhotos: photos,
    background: "#eeddbb", gutter: 0, selectedFrameId: "photo-1", createdAt: "2026-09-18", updatedAt: "2026-09-18" };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const caches: PhotoPreviewCache[] = [];
function cache(bytes?: number, entries?: number) { const value = new PhotoPreviewCache(bytes, entries); caches.push(value); return value; }
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readDerived).mockResolvedValue(null);
  vi.mocked(writeDerived).mockResolvedValue();
  vi.mocked(loadPhotoBlob).mockResolvedValue(original);
  let count = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:thumbnail-${++count}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.mocked(createPhotoPreview).mockImplementation(async () => ({ blob: thumbnail, previewUrl: `blob:small-${++count}`, width: 6400, height: 1440 }));
});
afterEach(() => { caches.splice(0).forEach(value => value.clear()); vi.restoreAllMocks(); });

describe("session display previews", () => {
  it("publishes stable immutable snapshots for React without rebuilding them on reads", () => {
    const previews = cache(), empty = previews.getSnapshot(), listener = vi.fn();
    const unsubscribe = previews.subscribe(listener);
    expect(previews.getSnapshot()).toBe(empty);
    previews.rememberThumbnail(stored, thumbnail);
    const loaded = previews.getSnapshot();
    expect(loaded).not.toBe(empty); expect(empty.size).toBe(0);
    expect(loaded.get(stored.blobKey)).toBeDefined(); expect(listener).toHaveBeenCalledOnce();
    expect(previews.getSnapshot()).toBe(loaded);
    previews.clear();
    expect(previews.getSnapshot().size).toBe(0); expect(loaded.size).toBe(1);
    unsubscribe();
  });

  it("reuses one small preview after A -> B -> A navigation without keeping an original in the cache", async () => {
    const previews = cache();
    const first = await previews.request(stored, () => null);
    await previews.request({ ...stored, blobKey: "photo-in-project-b" }, () => null);
    const returning = await previews.request(stored, () => null);
    expect(returning).toBe(first);
    expect(loadPhotoBlob).toHaveBeenCalledTimes(2);
    expect(createPhotoPreview).toHaveBeenCalledWith(original, { longEdge: SESSION_PREVIEW_LONG_EDGE, quality: 0.72 });
    expect(first).not.toHaveProperty("sourceBlob");
    expect(first).not.toHaveProperty("crop");
    expect(first).not.toHaveProperty("frameId");
    expect(savePhotoBlob).not.toHaveBeenCalled();
  });

  it("coalesces concurrent cover/editor/library requests for the same file", async () => {
    const previews = cache(), read = deferred<Blob>();
    vi.mocked(loadPhotoBlob).mockReturnValue(read.promise);
    const cover = previews.request(stored, () => null), editor = previews.request(stored, () => null);
    expect(cover).toBe(editor);
    read.resolve(original); await Promise.all([cover, editor]);
    expect(loadPhotoBlob).toHaveBeenCalledOnce(); expect(createPhotoPreview).toHaveBeenCalledOnce();
  });

  it("limits preview generation to two simultaneous jobs", async () => {
    const previews = cache(), first = deferred<Blob>();
    vi.mocked(loadPhotoBlob).mockReturnValue(first.promise);
    const jobs = ["a", "b", "c", "d"].map(blobKey => previews.request({ ...stored, blobKey }, () => null));
    await vi.waitFor(() => expect(loadPhotoBlob).toHaveBeenCalledTimes(2));
    expect(loadPhotoBlob).toHaveBeenCalledTimes(2);
    first.resolve(original); await Promise.all(jobs);
    expect(createPhotoPreview).toHaveBeenCalledTimes(4);
  });

  it("keeps unavailable assignments with empty IDB and no Drive connection, then allows retry", async () => {
    const previews = cache(), current = page();
    vi.mocked(loadPhotoBlob).mockResolvedValue(null);
    expect(await previews.request(stored, () => null)).toBeNull();
    expect(displayPagePhotos(current, previews)).toEqual({});
    expect(serializePage(current).photos[stored.frameId]).toEqual(stored);
    expect(downloadGoogleDrivePhoto).not.toHaveBeenCalled();
    vi.mocked(downloadGoogleDrivePhoto).mockResolvedValue(thumbnail);
    await previews.request(stored, () => "synthetic-token");
    expect(downloadGoogleDrivePhoto).toHaveBeenCalledWith("synthetic-token", "preview-id");
    expect(displayPagePhotos(current, previews)[stored.frameId].sourceWidth).toBe(6400);
    expect(current.photos).toEqual({});
    expect(savePhotoBlob).not.toHaveBeenCalled();
  });

  it("retains a cached view when local originals and the Drive token subsequently disappear", async () => {
    const previews = cache(); await previews.request(stored, () => null);
    vi.mocked(loadPhotoBlob).mockRejectedValue(new Error("IDB unavailable"));
    const display = displayPagePhotos(page(), previews);
    expect(display[stored.frameId].previewUrl).toBeTruthy();
    expect(await previews.request(stored, () => null)).not.toBeNull();
    expect(loadPhotoBlob).toHaveBeenCalledOnce();
  });

  it("uses volatile original bytes when IndexedDB could not store an upload", async () => {
    const previews = cache();
    await previews.request(stored, () => null, key => key === stored.blobKey ? original : undefined);
    expect(createPhotoPreview).toHaveBeenCalledWith(original, expect.anything());
    expect(loadPhotoBlob).not.toHaveBeenCalled();
  });

  it("uses existing small analysis thumbnails without repeating decoding", async () => {
    const previews = cache(); previews.rememberThumbnail(stored, thumbnail);
    const ready = await previews.request(stored, () => null, undefined, 10);
    expect(ready?.sourceWidth).toBe(6400);
    expect(createPhotoPreview).not.toHaveBeenCalled(); expect(loadPhotoBlob).not.toHaveBeenCalled();
  });

  it("treats a failed Drive preview as unavailable rather than downloading/promoting it as an original", async () => {
    const previews = cache(); vi.mocked(loadPhotoBlob).mockRejectedValue(new Error("IDB unavailable"));
    vi.mocked(downloadGoogleDrivePhoto).mockRejectedValue(new Error("Drive unavailable"));
    expect(await previews.request(stored, () => "synthetic-token")).toBeNull();
    expect(downloadGoogleDrivePhoto).toHaveBeenCalledExactlyOnceWith("synthetic-token", "preview-id");
    expect(savePhotoBlob).not.toHaveBeenCalled(); expect(createPhotoPreview).not.toHaveBeenCalled();
  });

  it("clears cache at a workspace boundary and never lets late decodes repopulate it", async () => {
    const previews = cache(), decode = deferred<Awaited<ReturnType<typeof createPhotoPreview>>>();
    const current = previews.capture();
    vi.mocked(createPhotoPreview).mockReturnValue(decode.promise);
    const loading = previews.request(stored, () => null, () => original);
    await vi.waitFor(() => expect(createPhotoPreview).toHaveBeenCalledOnce());
    previews.rememberThumbnail({ ...stored, blobKey: "already-loaded" }, thumbnail);
    previews.clear();
    decode.resolve({ blob: thumbnail, previewUrl: "blob:late-old-account", width: 6400, height: 1440 });
    expect(await loading).toBeNull(); expect(current()).toBe(false);
    expect(previews.get(stored.blobKey)).toBeUndefined();
    expect(previews.get("already-loaded")).toBeUndefined();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:late-old-account");
    previews.rememberThumbnail(stored, thumbnail);
    expect(previews.get(stored.blobKey)?.previewUrl).not.toBe("blob:late-old-account");
  });

  it("invalidates queued work before it can read a different account's token", async () => {
    const previews = cache(), read = deferred<Blob | null>(), token = vi.fn(() => "new-account-token");
    vi.mocked(loadPhotoBlob).mockReturnValue(read.promise);
    const jobs = ["a", "b", "c"].map(blobKey => previews.request({ ...stored, blobKey }, token));
    await vi.waitFor(() => expect(loadPhotoBlob).toHaveBeenCalledTimes(2));
    previews.clear(); read.resolve(null); await Promise.all(jobs);
    expect(loadPhotoBlob).toHaveBeenCalledTimes(2); expect(token).not.toHaveBeenCalled();
    expect(downloadGoogleDrivePhoto).not.toHaveBeenCalled();
  });

  it("bounds retained preview memory and revokes the least recently requested URL", async () => {
    const previews = cache(thumbnail.size * 2, 2);
    previews.rememberThumbnail({ ...stored, blobKey: "a" }, thumbnail);
    previews.rememberThumbnail({ ...stored, blobKey: "b" }, thumbnail);
    const discarded = previews.get("b")!.previewUrl;
    await previews.request({ ...stored, blobKey: "a" }, () => null, undefined, 10);
    previews.rememberThumbnail({ ...stored, blobKey: "c" }, thumbnail);
    expect(previews.get("a")).toBeDefined(); expect(previews.get("b")).toBeUndefined();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(discarded);
  });
});

describe("preview display never owns assignments, crops or original availability", () => {
  it("restores persistent previews after reload without reading or downloading originals", async () => {
    const disk = new Map<string, Blob>();
    vi.mocked(writeDerived).mockImplementation(async (key, value) => { if (value.blob) disk.set(key, value.blob); });
    vi.mocked(readDerived).mockImplementation(async key => disk.has(key) ? { blob: disk.get(key), bytes: 10, touched: 1 } : null);
    const first = cache(); first.setWorkspace("owner-a"); await first.request(stored, () => null); first.clear();
    vi.mocked(loadPhotoBlob).mockClear(); vi.mocked(createPhotoPreview).mockClear();
    const next = cache(); next.setWorkspace("owner-a"); expect(await next.request(stored, () => null)).not.toBeNull();
    expect(loadPhotoBlob).not.toHaveBeenCalled(); expect(createPhotoPreview).not.toHaveBeenCalled();
    const other = cache(); other.setWorkspace("owner-b"); vi.mocked(loadPhotoBlob).mockResolvedValue(null);
    expect(await other.request(stored, () => null)).toBeNull();
  });
  it("upgrades 320px to 640px and retains the old URL until its consumers release it", async () => {
    const previews = cache(), release = previews.pin(stored.blobKey);
    previews.rememberThumbnail(stored, thumbnail, 320); const old = previews.get(stored.blobKey)!.previewUrl;
    const ready = await previews.request(stored, () => null);
    expect(ready?.previewUrl).not.toBe(old); expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(old);
    release(); expect(URL.revokeObjectURL).toHaveBeenCalledWith(old);
  });
  it("bounds a fresh 250-photo session and only requests Drive previews", async () => {
    const previews = cache(); vi.mocked(loadPhotoBlob).mockResolvedValue(null); vi.mocked(downloadGoogleDrivePhoto).mockResolvedValue(thumbnail);
    await Promise.all(Array.from({ length: 250 }, (_, i) => previews.request({ ...stored, blobKey: `synthetic-${i}`, drivePreviewId: `preview-${i}` }, () => "synthetic-token")));
    expect(downloadGoogleDrivePhoto).toHaveBeenCalledTimes(250);
    expect(vi.mocked(downloadGoogleDrivePhoto).mock.calls.every(([, id]) => id.startsWith("preview-"))).toBe(true);
    expect(previews.getSnapshot().size).toBeLessThan(150);
    expect(savePhotoBlob).not.toHaveBeenCalled();
    previews.clear(); expect(previews.getSnapshot().size).toBe(0);
  });
  it("reopens saved metadata immediately with separate crops for repeat placements", async () => {
    const previews = cache(); await previews.request(stored, () => null);
    const current = page({ left: { ...stored, frameId: "left" }, right: { ...stored, frameId: "right", crop: { ...stored.crop, zoom: 1.25 } } });
    const project: StoredProject = { version: 3, id: "project-a", name: "Synthetic A", formatId: "instagram-square", activePageId: current.id,
      pages: [serializePage(current)], createdAt: current.createdAt, updatedAt: current.updatedAt };
    const restored = reconcileProjectPages(project)[0], view = displayPagePhotos(restored, previews);
    expect(view.left.previewUrl).toBe(view.right.previewUrl);
    expect(view.left.crop.zoom).toBe(0.8765433); expect(view.right.crop.zoom).toBe(1.25);
    expect(serializePage(restored)).toEqual(project.pages[0]);
    expect(restored.photos).toEqual({});
  });

  it("preserves preview-only crop edits through serialization and late original hydration", async () => {
    const previews = cache(); await previews.request(stored, () => null);
    const crop = { positionX: -0.35, positionY: 0.125, zoom: 0.7123456 };
    const edited = updatePagePhotoCrop(page(), stored.frameId, crop);
    expect(displayPagePhotos(edited, previews)[stored.frameId].crop).toEqual(crop);
    expect(edited.photos).toEqual({}); expect(serializePage(edited).photos[stored.frameId].crop).toEqual(crop);
    const full: PhotoAsset = { ...stored, sourceBlob: original, previewUrl: "blob:full-quality" };
    const hydrated = applyHydratedPhotos([edited], [{ pageId: edited.id, photo: full }])[0];
    expect(hydrated.photos[stored.frameId].crop).toEqual(crop);
    expect(hydrated.photos[stored.frameId].sourceBlob).toBe(original);
    expect(displayPagePhotos(hydrated, previews)[stored.frameId].previewUrl).toBe("blob:full-quality");
  });

  it("never resurrects removed or replaced assignments from a preview cache hit", async () => {
    const previews = cache(); await previews.request(stored, () => null);
    const removed = removePagePhoto(page(), stored.frameId);
    expect(displayPagePhotos(removed, previews)).toEqual({});
    expect(updatePagePhotoCrop(removed, stored.frameId, stored.crop)).toBe(removed);
    const replacement = page({ [stored.frameId]: { ...stored, blobKey: "replacement" } });
    expect(displayPagePhotos(replacement, previews)).toEqual({});
    const old: PhotoAsset = { ...stored, sourceBlob: original, previewUrl: "blob:old" };
    expect(applyHydratedPhotos([replacement], [{ pageId: replacement.id, photo: old }])[0]).toBe(replacement);
  });

  it("requires originals for full-resolution page Preview even while a display preview is visible", async () => {
    const previews = cache(); await previews.request(stored, () => null);
    const current = page();
    expect(displayPagePhotos(current, previews)[stored.frameId]).toBeDefined();
    await expect(renderPagePreview(current, getFormat("instagram-square"), getTemplate(current.templateId))).rejects.toThrow("Assigned photos are unavailable");
  });
});
