import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consolidateLibraryDuplicates, fingerprintCacheKey, scanExactDuplicates } from "../photo-duplicates";
import { getProjectPhotos, getVisibleProjectPhotos, mergePhotoLibraries, projectPhotoGroups } from "../project-photo-library";
import { ProjectHistory, projectContentKey } from "../project-history";
import { applyPhotoBackupCheckpoint } from "../photo-backup";
import { createProjectBackup, inspectProjectBackup, materializeProjectBackup } from "../project-backup";
import { reconcileProjectPages, serializePage } from "../project-photos";
import { loadProjects, saveProjects } from "../storage";
import { isProjectPhoto } from "../project-validation";
import { acknowledgeProjectPush, mergeCloudProjectLibrary, preserveProtectedLocalEdits } from "../project-sync";
import { applyArrangementAsCopy, suggestArrangements } from "../arrangements";
import { analysePixels } from "../photo-palette";
import { getTemplate } from "../templates";
import type { ProjectPhoto, StoredProject, StoredPhotoAsset } from "../types";

const timestamp = "2026-09-16T10:00:00.000Z", edited = "2026-09-16T10:01:00.000Z", acknowledged = "2026-09-16T10:02:00.000Z";
function project(): StoredProject {
  const originals = ["a", "b", "different", "missing"].map((key): ProjectPhoto => ({ blobKey: `synthetic-${key}`, sourceName: key === "b" ? "copy.jpg" : "same-name.jpg",
    sourceWidth: 6400, sourceHeight: 1440, driveOriginalId: `synthetic-original-${key}`, drivePreviewId: `synthetic-preview-${key}` }));
  const assignment = (index: number, frameId: string, zoom: number): StoredPhotoAsset => ({ ...originals[index], frameId, cloudAssetId: `synthetic-row-${frameId}`,
    crop: { zoom, positionX: 0.731, positionY: -0.27 } });
  return { version: 3, id: "synthetic-project", name: "Synthetic duplicate safety", formatId: "instagram-post", revision: 4, cloudSyncedAt: timestamp,
    activePageId: "synthetic-page", createdAt: timestamp, updatedAt: timestamp, photoLibrary: originals,
    pages: [{ id: "synthetic-page", templateId: "synthetic-three", templateSnapshot: { id: "synthetic-three", name: "Synthetic three", formatId: "instagram-post",
      canvasWidth: 1080, canvasHeight: 1350, defaultBackground: "#ffffff", defaultGutter: 10,
      frames: ["f1", "f2", "f3"].map((id, i) => ({ id, x: 0, y: i / 3, width: 1, height: 1 / 3 })) },
      background: "#ffffff", gutter: 10, selectedFrameId: "f2", createdAt: timestamp, updatedAt: timestamp,
      photos: { f1: assignment(0, "f1", 0.623451), f2: assignment(1, "f2", 1.42), f3: assignment(0, "f3", 0.81912) } }] };
}
const originalBytes = async (photo: ProjectPhoto): Promise<Blob | null> => photo.blobKey.endsWith("missing") ? null
  : new Blob([photo.blobKey.endsWith("different") ? "different original file bytes" : "same original file bytes"], { type: "image/jpeg" });
const values = new Map<string, string>();
const cache = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
beforeEach(() => {
  values.clear(); vi.stubGlobal("localStorage", cache);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No live network in duplicate tests"); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("exact original-file duplicate review", () => {
  it("finds byte-identical files regardless of filename and never treats a matching name/size/palette as proof", async () => {
    const source = project(), before = structuredClone(source), progress = vi.fn();
    const scan = await scanExactDuplicates(source, originalBytes, { onProgress: progress });
    expect(scan.groups).toHaveLength(1);
    expect(scan.groups[0].keys).toEqual(["synthetic-a", "synthetic-b"]);
    expect(scan.groups[0].fingerprint).toMatch(/^sha256:\d+:[a-f0-9]{64}$/);
    expect(scan.unavailable).toEqual(["synthetic-missing"]); expect(scan.checked).toBe(3);
    expect(progress.mock.calls).toEqual([[1, 4], [2, 4], [3, 4], [4, 4]]);
    expect(source).toEqual(before); expect(getVisibleProjectPhotos(source)).toHaveLength(4);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not combine re-encoded or edited bytes even if their byte lengths and dimensions match", async () => {
    const source = project(); source.photoLibrary = source.photoLibrary!.slice(0, 2);
    const scan = await scanExactDuplicates(source, async photo => new Blob([photo.blobKey.endsWith("a") ? "original1" : "original2"]));
    expect(scan.groups).toEqual([]);
  });
  it("leaves every missing original listed, rather than comparing its available preview", async () => {
    const source = project(), before = structuredClone(source);
    const scan = await scanExactDuplicates(source, async () => null);
    expect(scan.checked).toBe(0); expect(scan.unavailable).toHaveLength(4);
    expect(consolidateLibraryDuplicates(source, scan, [])).toBe(source);
    expect(source).toEqual(before); expect(getVisibleProjectPhotos(source)).toHaveLength(4);
  });
  it("caches hashes per account/original identity and tolerates unavailable cache storage", async () => {
    const source = project(), read = vi.fn(originalBytes);
    const first = await scanExactDuplicates(source, read, { cache, ownerId: "synthetic-owner" });
    read.mockClear();
    const second = await scanExactDuplicates(source, read, { cache, ownerId: "synthetic-owner" });
    expect(second.groups).toEqual(first.groups); expect(read).toHaveBeenCalledTimes(1); // Missing originals are retried.
    read.mockClear();
    await scanExactDuplicates(source, read, { cache, ownerId: "different-owner" });
    expect(read).toHaveBeenCalledTimes(4);
    expect(fingerprintCacheKey(source.photoLibrary![0])).not.toBe(fingerprintCacheKey({ ...source.photoLibrary![0], driveOriginalId: "changed-original" }));
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("quota"); } };
    expect((await scanExactDuplicates(source, originalBytes, { cache: broken })).groups).toEqual(first.groups);
  });
  it("cancels between original reads without altering any project", async () => {
    const source = project(), before = structuredClone(source), abort = new AbortController();
    const read = vi.fn(async (photo: ProjectPhoto) => { abort.abort(); return originalBytes(photo); });
    await expect(scanExactDuplicates(source, read, { signal: abort.signal })).rejects.toThrow();
    expect(read).toHaveBeenCalledTimes(1); expect(source).toEqual(before);
  });
});

describe("explicit consolidation preserves every image configuration", () => {
  it("combines library cards only on Apply and preserves repeated placements, crops, IDs, originals and page timestamps", async () => {
    const source = project(), before = structuredClone(source), scan = await scanExactDuplicates(source, originalBytes);
    expect(consolidateLibraryDuplicates(source, scan, [])).toBe(source);
    const result = consolidateLibraryDuplicates(source, scan, scan.groups, edited);
    expect(result.pages).toBe(source.pages); expect(result.pages).toEqual(before.pages);
    expect(result.pendingDeletions).toBeUndefined(); expect(result.revision).toBe(4);
    expect(getVisibleProjectPhotos(result).map(photo => photo.blobKey)).toEqual(["synthetic-a", "synthetic-different", "synthetic-missing"]);
    expect(getProjectPhotos(result)).toHaveLength(4); // Every immutable original reference is retained.
    expect(projectPhotoGroups(result)[0].members.map(photo => photo.blobKey)).toEqual(["synthetic-a", "synthetic-b"]);
    expect(getProjectPhotos(result).map(photo => [photo.blobKey, photo.driveOriginalId, photo.drivePreviewId]))
      .toEqual(getProjectPhotos(before).map(photo => [photo.blobKey, photo.driveOriginalId, photo.drivePreviewId]));
    expect(source).toEqual(before);
  });
  it("rejects stale project/library review and unverified or repeated keys", async () => {
    const source = project(), scan = await scanExactDuplicates(source, originalBytes);
    expect(() => consolidateLibraryDuplicates({ ...source, id: "another-project" }, scan, scan.groups)).toThrow("project changed");
    const combined = consolidateLibraryDuplicates(source, scan, scan.groups);
    expect(() => consolidateLibraryDuplicates(combined, scan, scan.groups)).toThrow("library changed");
    expect(() => consolidateLibraryDuplicates(source, scan, [{ ...scan.groups[0], keys: ["synthetic-a", "synthetic-different"] }])).toThrow();
    const repeated = { ...scan.groups[0], keys: ["synthetic-a", "synthetic-a"] };
    expect(() => consolidateLibraryDuplicates(source, { ...scan, groups: [repeated] }, [repeated])).toThrow();
  });
  it("preserves grouping through cache, fresh-device hydration and older metadata merges", async () => {
    const source = project(), scan = await scanExactDuplicates(source, originalBytes);
    const result = consolidateLibraryDuplicates(source, scan, scan.groups, edited);
    saveProjects([result], "synthetic-owner"); const [restored] = loadProjects("synthetic-owner");
    expect(restored).toEqual(result);
    expect(getVisibleProjectPhotos(restored)).toHaveLength(3);
    expect(reconcileProjectPages(restored).map(serializePage)).toEqual(source.pages);
    const merged = mergePhotoLibraries(result.photoLibrary, source.photoLibrary);
    expect(merged.find(photo => photo.blobKey === "synthetic-b")?.duplicateOf).toBe("synthetic-a");
    const oldCloud = { ...source, cloudSyncedAt: acknowledged, updatedAt: acknowledged, revision: 5 };
    const local = { ...result, cloudSyncedAt: edited };
    const pulled = mergeCloudProjectLibrary([local], [oldCloud], () => "unused").projects[0];
    expect(getVisibleProjectPhotos(pulled)).toHaveLength(3);
    expect(Date.parse(pulled.updatedAt)).toBeGreaterThan(Date.parse(pulled.cloudSyncedAt!));
    expect(pulled.pages).toEqual(oldCloud.pages);
  });
  it("undo/redo changes only grouping intent and keeps uploads completed after cleanup", async () => {
    const source = project(), scan = await scanExactDuplicates(source, originalBytes);
    const result = consolidateLibraryDuplicates(source, scan, scan.groups, edited);
    const history = new ProjectHistory(); history.reset(source); history.observe(result);
    const latest = applyPhotoBackupCheckpoint(result, { blobKey: "synthetic-missing", driveOriginalId: "new-checkpoint", driveFolderId: "synthetic-folder" }, acknowledged);
    const undone = history.travel("undo", latest, acknowledged)!;
    expect(getVisibleProjectPhotos(undone)).toHaveLength(4); expect(undone.pages[0].photos).toEqual(source.pages[0].photos);
    expect(undone.photoLibrary!.find(photo => photo.blobKey === "synthetic-b")?.duplicateOf).toBeNull();
    expect(undone.photoLibrary!.find(photo => photo.blobKey === "synthetic-missing")?.driveOriginalId).toBe("new-checkpoint");
    expect(undone.pendingDeletions).toBeUndefined();
    expect(projectContentKey(undone)).toBe(projectContentKey(source));
    const saved = acknowledgeProjectPush(undone, result, { conflict: false, partial: false, project: { ...result, revision: 5, cloudSyncedAt: acknowledged } });
    expect(getVisibleProjectPhotos(saved)).toHaveLength(4); // An older in-flight Apply save cannot resurrect grouping.
    expect(saved.photoLibrary!.find(photo => photo.blobKey === "synthetic-b")?.duplicateOf).toBeNull();
    const redone = history.travel("redo", saved, acknowledged)!;
    expect(getVisibleProjectPhotos(redone)).toHaveLength(3); expect(redone.pages[0].photos).toEqual(source.pages[0].photos);
    const recovery = preserveProtectedLocalEdits(result, source, "synthetic-recovered");
    expect(recovery).not.toBeNull(); expect(getVisibleProjectPhotos(recovery!)).toHaveLength(3);
  });
  it("retains all originals in portable backup and remaps group references only in the explicit new copy", async () => {
    const source = project(), scan = await scanExactDuplicates(source, originalBytes);
    const combined = consolidateLibraryDuplicates(source, scan, scan.groups, edited);
    const backup = await inspectProjectBackup((await createProjectBackup(combined, async key => originalBytes({ blobKey: key, sourceWidth: 1, sourceHeight: 1 }))).blob);
    expect(backup.originals.size).toBe(3); expect(backup.missingOriginals).toBe(1);
    let id = 0; const restored = materializeProjectBackup(backup, () => `synthetic-fresh-${id++}`);
    expect(getVisibleProjectPhotos(restored.project)).toHaveLength(3); expect(getProjectPhotos(restored.project)).toHaveLength(4);
    const [group] = projectPhotoGroups(restored.project);
    expect(group.members).toHaveLength(2); expect(group.members[1].duplicateOf).toBe(group.photo.blobKey);
    expect(group.photo.blobKey).not.toBe("synthetic-a");
    expect(Object.values(restored.project.pages[0].photos).map(photo => photo.crop)).toEqual(Object.values(source.pages[0].photos).map(photo => photo.crop));
  });
  it("keeps malformed/dangling group links visible and accepts backward-compatible metadata", () => {
    const source = project();
    expect(source.photoLibrary!.every(isProjectPhoto)).toBe(true);
    expect(isProjectPhoto({ ...source.photoLibrary![0], duplicateOf: 5 })).toBe(false);
    source.photoLibrary![0].duplicateOf = "synthetic-b"; source.photoLibrary![1].duplicateOf = "synthetic-a";
    source.photoLibrary![2].duplicateOf = "no-such-original";
    expect(getVisibleProjectPhotos(source)).toHaveLength(4);
  });
  it("uses each combined library photo once in suggestions and retains all underlying originals in the new copy", async () => {
    const source = project(), scan = await scanExactDuplicates(source, originalBytes);
    const combined = consolidateLibraryDuplicates(source, scan, scan.groups, edited);
    const analysis = analysePixels(new Uint8ClampedArray([120, 150, 160, 255]), 6400, 1440);
    const photos = getVisibleProjectPhotos(combined).map(photo => ({ photo, analysis: photo.blobKey.endsWith("missing") ? undefined : analysis }));
    const [proposal] = suggestArrangements({ formatId: source.formatId, photos, templates: [getTemplate("instagram-post-full-frame")] });
    let id = 0; const copy = applyArrangementAsCopy(combined, proposal, () => `synthetic-copy-${id++}`);
    expect(copy.pages.flatMap(page => Object.values(page.photos).map(photo => photo.blobKey))).toEqual(expect.arrayContaining(["synthetic-a", "synthetic-different"]));
    expect(copy.pages.flatMap(page => Object.values(page.photos))).toHaveLength(2);
    expect(getProjectPhotos(copy)).toHaveLength(4); expect(getVisibleProjectPhotos(copy)).toHaveLength(3);
    expect(combined.pages).toBe(source.pages);
  });
});
