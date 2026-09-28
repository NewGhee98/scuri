import { describe, expect, it } from "vitest";
import { DEFAULT_LIBRARY_VIEW, filterLibraryRows, libraryRows } from "../photo-library-view";
import { getProjectPhotos, reorderProjectPhotos } from "../project-photo-library";
import { ProjectHistory } from "../project-history";
import { applyPhotoBackupCheckpoint } from "../photo-backup";
import { isStoredProject } from "../project-validation";
import { consolidateLibraryDuplicates } from "../photo-duplicates";
import type { ProjectPhoto, StoredProject } from "../types";

const time = "2026-09-28T10:00:00.000Z", later = "2026-09-28T10:01:00.000Z";
const photo = (blobKey: string, extra: Partial<ProjectPhoto> = {}): ProjectPhoto => ({
  blobKey, sourceName: `${blobKey}.jpg`, sourceWidth: 1200, sourceHeight: 800, ...extra,
});
function project(): StoredProject {
  return { version: 3, id: "custom-order-project", name: "Synthetic order", formatId: "instagram-square",
    createdAt: time, updatedAt: time, activePageId: "page", revision: 1, cloudSyncedAt: time,
    photoLibrary: [photo("first", { importOrder: 0 }), photo("second", { importOrder: 1 }), photo("third", { importOrder: 2 })],
    pages: [{ id: "page", templateId: "instagram-square-full-frame", background: "#fff", gutter: 0,
      selectedFrameId: "photo-1", createdAt: time, updatedAt: time,
      photos: { "photo-1": { ...photo("first"), frameId: "photo-1", crop: { zoom: 0.75, positionX: 0.3, positionY: -0.2 } } } }] };
}
const ordered = (p: StoredProject) => filterLibraryRows(libraryRows(p), { ...DEFAULT_LIBRARY_VIEW, sort: "custom" });
const keys = (p: StoredProject) => ordered(p).map(row => row.photo.blobKey);

describe("custom library order", () => {
  it("starts in import order for legacy photos without turning a view change into a saved edit", () => {
    const p = project(), before = structuredClone(p);
    p.photoLibrary = [p.photoLibrary![2], p.photoLibrary![0], p.photoLibrary![1]];
    expect(keys(p)).toEqual(["first", "second", "third"]);
    expect(ordered(p).map(row => row.customPosition)).toEqual([1, 2, 3]);
    expect(p.photoLibrary.every(item => item.customOrder === undefined)).toBe(true);
    expect(p.updatedAt).toBe(before.updatedAt);
    delete p.photoLibrary;
    expect(keys(p)).toEqual(["first"]);
  });

  it("moves backwards and forwards without changing original identities, import order, labels or composition", () => {
    const p = project();
    p.photoLibrary![2] = { ...p.photoLibrary![2], rank: "hero", labels: ["night"], driveOriginalId: "original",
      drivePreviewId: "preview", pendingUpload: { thumbnailId: "reserved" } };
    const before = structuredClone(p);
    const moved = reorderProjectPhotos(p, "third", 1, later);
    expect(keys(moved)).toEqual(["third", "first", "second"]);
    expect(moved.photoLibrary).toEqual(before.photoLibrary!.map((item, index) => ({ ...item, customOrder: [2, 3, 1][index] })));
    expect(moved.pages).toBe(p.pages);
    expect(moved.updatedAt > p.updatedAt).toBe(true);
    expect(moved.pendingDeletions).toBeUndefined();
    expect(p).toEqual(before);
    expect(keys(reorderProjectPhotos(moved, "third", 3))).toEqual(["first", "second", "third"]);
    expect(filterLibraryRows(libraryRows(moved), DEFAULT_LIBRARY_VIEW).map(row => row.photo.blobKey)).toEqual(["first", "second", "third"]);
  });

  it("uses positions across the whole library while filters hide intermediate photos", () => {
    const p = project();
    p.photoLibrary![0].labels = ["night"]; p.photoLibrary![2].labels = ["night"];
    const visible = filterLibraryRows(libraryRows(p), { ...DEFAULT_LIBRARY_VIEW, sort: "custom", labels: ["night"] });
    expect(visible.map(row => row.customPosition)).toEqual([1, 3]);
    const moved = reorderProjectPhotos(p, "first", visible[1].customPosition);
    expect(keys(moved)).toEqual(["second", "third", "first"]);
    expect(ordered(moved).map(row => row.customPosition)).toEqual([1, 2, 3]);
  });

  it("appends new unset photos after saved order and keeps their own import order", () => {
    const p = reorderProjectPhotos(project(), "third", 1);
    p.photoLibrary!.push(photo("newer", { importOrder: 4 }), photo("new", { importOrder: 3 }));
    expect(keys(p)).toEqual(["third", "first", "second", "new", "newer"]);
    const moved = reorderProjectPhotos(p, "newer", 2);
    expect(keys(moved)).toEqual(["third", "newer", "first", "second", "new"]);
    expect(ordered(moved).map(row => row.customPosition)).toEqual([1, 2, 3, 4, 5]);
  });

  it("moves every member of a duplicate group together while retaining their original metadata", () => {
    const p = project();
    p.photoLibrary!.push(photo("alias", { duplicateOf: "third", driveOriginalId: "alias-original", labels: ["people"] }));
    const moved = reorderProjectPhotos(p, "alias", 1);
    expect(keys(moved)).toEqual(["third", "first", "second"]);
    expect(getProjectPhotos(moved)).toHaveLength(4);
    expect(getProjectPhotos(moved).find(item => item.blobKey === "alias")).toMatchObject({
      duplicateOf: "third", driveOriginalId: "alias-original", labels: ["people"], customOrder: 1,
    });
    expect(getProjectPhotos(moved).find(item => item.blobKey === "third")?.customOrder).toBe(1);
    expect(moved.pages).toBe(p.pages);
  });

  it("keeps a newly consolidated group at its earliest saved position", () => {
    const p = reorderProjectPhotos(project(), "third", 1);
    const group = { keys: ["first", "third"], fingerprint: `sha256:3:${"a".repeat(64)}` };
    const consolidated = consolidateLibraryDuplicates(p, { projectId: p.id, groups: [group], checked: 3, unavailable: [] }, [group]);
    expect(keys(consolidated)).toEqual(["first", "second"]);
    expect(getProjectPhotos(consolidated)).toHaveLength(3);
    expect(consolidated.pages).toBe(p.pages);
    expect(keys(reorderProjectPhotos(consolidated, "first", 2))).toEqual(["second", "first"]);
  });

  it("ignores missing keys, fractional/nonfinite positions and unchanged moves; clamps integer bounds", () => {
    const p = project();
    for (const invalid of [NaN, Infinity, -Infinity, 1.5]) expect(reorderProjectPhotos(p, "third", invalid)).toBe(p);
    expect(reorderProjectPhotos(p, "missing", 1)).toBe(p);
    expect(reorderProjectPhotos(p, "first", 1)).toBe(p);
    expect(keys(reorderProjectPhotos(p, "third", -50))).toEqual(["third", "first", "second"]);
    expect(keys(reorderProjectPhotos(p, "first", 999))).toEqual(["second", "third", "first"]);
  });

  it("undoes to explicit import-order fallback and redoes without rolling back upload checkpoints", () => {
    const p = project(), history = new ProjectHistory(); history.observe(p);
    const moved = reorderProjectPhotos(p, "third", 1, later); history.observe(moved);
    const checkpoint = applyPhotoBackupCheckpoint(moved, { blobKey: "third", driveOriginalId: "original",
      drivePreviewId: "preview", driveThumbnailId: "thumb", driveFolderId: "folder" }, later); history.observe(checkpoint);
    const undone = history.travel("undo", checkpoint, later)!;
    expect(keys(undone)).toEqual(["first", "second", "third"]);
    expect(getProjectPhotos(undone).every(item => item.customOrder === null)).toBe(true);
    expect(getProjectPhotos(undone)[2]).toMatchObject({ driveOriginalId: "original", driveThumbnailId: "thumb" });
    const redone = history.travel("redo", undone, later)!;
    expect(keys(redone)).toEqual(["third", "first", "second"]);
    expect(redone.pages[0].photos).toEqual(p.pages[0].photos);
    expect(redone.pendingDeletions).toBeUndefined();
  });

  it("accepts legacy/cleared order and rejects damaged order metadata as a whole project", () => {
    const p = project();
    for (const customOrder of [undefined, null, 1, 250]) expect(isStoredProject({ ...p, photoLibrary: [photo("first", { customOrder })] })).toBe(true);
    for (const customOrder of [-1, 0, 1.5, NaN, Infinity, "1"]) {
      expect(isStoredProject({ ...p, photoLibrary: [photo("first", { customOrder } as Partial<ProjectPhoto>)] })).toBe(false);
    }
  });
});
