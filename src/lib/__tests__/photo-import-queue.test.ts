import { afterEach, describe, expect, it, vi } from "vitest";
import { PhotoImportQueue, fileImportSources } from "../photo-import-queue";
import { fingerprintOriginal } from "../photo-fingerprint";
import { getProjectPhotos } from "../project-photo-library";
import { validateImageFile } from "../image";
import type { StoredProject } from "../types";
const stamp = "2026-09-19T00:00:00.000Z";
function harness(count = 0) {
  let current = true, p: StoredProject | undefined = { version: 3, id: "synthetic", name: "Synthetic queue", formatId: "instagram-post", pages: [], activePageId: null,
    createdAt: stamp, updatedAt: stamp, photoLibrary: Array.from({ length: count }, (_, i) => ({ blobKey: `old-${i}`, sourceWidth: 1, sourceHeight: 1 })) };
  const blobs = new Map<string, Blob>(), commit = vi.fn((project: StoredProject) => { p = project; });
  const save = vi.fn(async (key: string, file: File) => { blobs.set(key, file); });
  const prepare = vi.fn(async (file: File, blobKey: string) => ({ blobKey, sourceWidth: 6400, sourceHeight: 1440, sourceName: file.name, fileSize: file.size }));
  const queue = new PhotoImportQueue({ current: () => current, project: () => p, validate: validateImageFile, fingerprint: fingerprintOriginal, prepare,
    saveOriginal: save, commit, checkpoint: async () => {} });
  queues.push(queue);
  return { queue, commit, save, prepare, blobs, get project() { return p!; }, setCurrent: (value: boolean) => { current = value; }, remove: () => { p = undefined; } };
}
const queues: PhotoImportQueue[] = [];
afterEach(() => { queues.splice(0).forEach(queue => queue.stop()); vi.restoreAllMocks(); });
const file = (name: string, data = "bytes") => new File([data], name, { type: "image/jpeg" });
const finished = async (queue: PhotoImportQueue) => vi.waitFor(() => expect(queue.getSnapshot().every(item => ["imported", "duplicate", "failed", "paused"].includes(item.state))).toBe(true));

describe("one-file-at-a-time intake", () => {
  it("deduplicates identical bytes with different names in one batch but keeps different bytes with the same name", async () => {
    const h = harness(); h.queue.add("synthetic", fileImportSources([file("one.jpg"), file("different-name.jpg"), file("one.jpg", "different bytes")]));
    await finished(h.queue);
    expect(h.queue.getSnapshot().map(item => item.state)).toEqual(["imported", "duplicate", "imported"]);
    expect(getProjectPhotos(h.project)).toHaveLength(2); expect(h.prepare).toHaveBeenCalledTimes(2);
    expect(getProjectPhotos(h.project)[0].importOrder).toBeLessThan(getProjectPhotos(h.project)[1].importOrder!);
  });
  it("restores an exact missing local original without changing its identity, Drive references or placements", async () => {
    const h = harness(1), original = file("reselected.jpg");
    h.project.photoLibrary![0] = { ...h.project.photoLibrary![0], fingerprint: await fingerprintOriginal(original), driveOriginalId: "completed-original" };
    const before = structuredClone(h.project.pages);
    h.queue.add("synthetic", fileImportSources([original])); await finished(h.queue);
    expect(h.queue.getSnapshot()[0]).toMatchObject({ state: "duplicate", blobKey: "old-0" });
    expect(await h.blobs.get("old-0")!.arrayBuffer()).toEqual(await original.arrayBuffer()); expect(h.project.photoLibrary![0].driveOriginalId).toBe("completed-original");
    expect(h.project.pages).toEqual(before); expect(h.prepare).not.toHaveBeenCalled();
  });
  it("admits the 250th unique photo, rejects the 251st and allows known duplicate reuse at capacity", async () => {
    const h = harness(249), last = file("250.jpg", "last");
    h.queue.add("synthetic", fileImportSources([last, file("251.jpg", "over capacity"), file("copy.jpg", "last")])); await finished(h.queue);
    expect(h.queue.getSnapshot().map(item => item.state)).toEqual(["imported", "failed", "duplicate"]);
    expect(h.project.photoLibrary).toHaveLength(250);
  });
  it("does not guess duplicates by filename for unverified legacy photos", async () => {
    const h = harness(1); h.project.photoLibrary![0].sourceName = "same.jpg";
    h.queue.add("synthetic", fileImportSources([file("same.jpg")])); await finished(h.queue);
    expect(h.project.photoLibrary).toHaveLength(2);
  });
  it("reselects only exact existing originals and refuses an unrelated file with the same name", async () => {
    const h = harness(), original = file("same.jpg", "original");
    h.queue.add("synthetic", fileImportSources([original])); await finished(h.queue);
    const photo = h.project.photoLibrary![0];
    h.project.pages = [{ id: "page", templateId: "instagram-post-full-frame", background: "#ffffff", gutter: 0,
      selectedFrameId: "photo-1", createdAt: stamp, updatedAt: stamp,
      photos: { "photo-1": { ...photo, frameId: "photo-1", crop: { positionX: .2, positionY: -.1, zoom: -.25 } } } }];
    const placements = structuredClone(h.project.pages);
    h.blobs.clear();
    h.queue.add("synthetic", fileImportSources([original, file("same.jpg", "different")]).map(source => ({ ...source, restoreOnly: true })));
    await finished(h.queue);
    expect(h.queue.getSnapshot().slice(1).map(item => item.state)).toEqual(["duplicate", "failed"]);
    expect(h.queue.getSnapshot().at(-1)?.detail).toContain("Nothing was added or replaced");
    expect(h.project.photoLibrary).toHaveLength(1);
    expect(h.project.photoLibrary![0].blobKey).toBe(photo.blobKey);
    expect(h.project.pages).toEqual(placements);
    expect(await h.blobs.get(photo.blobKey)!.text()).toBe("original");
  });
  it("does not publish an unreadable picker file as imported", async () => {
    const h = harness(), unavailable = file("unavailable.jpg");
    vi.spyOn(unavailable, "arrayBuffer").mockRejectedValue(new DOMException("Provider access expired", "NotReadableError"));
    h.queue.add("synthetic", fileImportSources([unavailable])); await finished(h.queue);
    expect(h.queue.getSnapshot()[0]).toMatchObject({ state: "failed", detail: expect.stringContaining("Reselect") });
    expect(h.save).not.toHaveBeenCalled(); expect(h.commit).not.toHaveBeenCalled();
  });
  it("pauses remaining intake on durable-storage failure and retries safely", async () => {
    const h = harness(); h.save.mockRejectedValueOnce(new Error("QuotaExceededError"));
    h.queue.add("synthetic", fileImportSources([file("first.jpg"), file("second.jpg", "2")])); await finished(h.queue);
    expect(h.queue.getSnapshot().map(item => item.state)).toEqual(["failed", "paused"]); expect(h.commit).not.toHaveBeenCalled();
    h.queue.retry(); await finished(h.queue);
    expect(h.project.photoLibrary).toHaveLength(2);
    expect(h.queue.getSnapshot().map(item => item.state)).toEqual(["imported", "imported"]);
  });
  it("cannot commit a late download into another account or a deleted project", async () => {
    for (const remove of [false, true]) {
      const h = harness(); let release!: (file: File) => void;
      h.queue.add("synthetic", [{ id: "provider", name: "late.jpg", file: async () => new Promise(resolve => { release = resolve; }) }]);
      if (remove) h.remove(); else h.setCurrent(false);
      release(file("late.jpg")); await new Promise(resolve => setTimeout(resolve, 10));
      expect(h.commit).not.toHaveBeenCalled(); expect(h.save).not.toHaveBeenCalled();
    }
  });
  it("validates each unsupported source independently and releases provider sessions only after queue completion", async () => {
    const h = harness(), release = vi.fn();
    h.queue.add("synthetic", [ ...fileImportSources([new File(["HEIC"], "unsupported.heic", { type: "image/heic" })]),
      { id: "remote", name: "valid.jpg", file: async () => file("valid.jpg"), release } ]);
    await finished(h.queue); expect(h.queue.getSnapshot().map(item => item.state)).toEqual(["failed", "imported"]); expect(release).toHaveBeenCalledOnce();
  });
});
