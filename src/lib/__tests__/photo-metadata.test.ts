import { describe, expect, it } from "vitest";
import { PHOTO_RANKS, projectPhotoLabels } from "../photo-metadata";
import { editProjectPhotoMetadata, getProjectPhotos, mergePhotoLibraries } from "../project-photo-library";
import { DEFAULT_LIBRARY_VIEW, filterLibraryRows, libraryRows } from "../photo-library-view";
import { isStoredProject } from "../project-validation";
import { ProjectHistory } from "../project-history";
import { applyPhotoBackupCheckpoint } from "../photo-backup";
import type { ProjectPhoto, StoredProject } from "../types";

const time = "2026-09-27T10:00:00.000Z", later = "2026-09-27T10:01:00.000Z";
const photo = (key: string, extra: Partial<ProjectPhoto> = {}): ProjectPhoto => ({
  blobKey: key, sourceName: `Temple ${key}.jpg`, sourceWidth: 1200, sourceHeight: 800, ...extra,
});
function project(): StoredProject {
  return { version: 3, id: "metadata-project", name: "Synthetic metadata", formatId: "instagram-square",
    createdAt: time, updatedAt: time, activePageId: "page", revision: 1, cloudSyncedAt: time,
    photoLibrary: [photo("used"), photo("loose"), photo("other")],
    pages: [{ id: "page", templateId: "instagram-square-full-frame", background: "#fff", gutter: 0,
      selectedFrameId: "photo-1", createdAt: time, updatedAt: time,
      photos: { "photo-1": { ...photo("used"), frameId: "photo-1", crop: { zoom: 0.75, positionX: 0.3, positionY: -0.2 } } } }] };
}

describe("project-owned photo ranks and labels", () => {
  it("keeps legacy and new photos unranked, with only three assignable ranks", () => {
    const p = project(); delete p.photoLibrary;
    expect(isStoredProject(p)).toBe(true);
    const imported = { ...p, photoLibrary: mergePhotoLibraries(getProjectPhotos(p), [photo("new")]) };
    expect(PHOTO_RANKS).toEqual(["hero", "good", "other"]);
    expect(getProjectPhotos(imported).every(item => item.rank === undefined && item.labels === undefined)).toBe(true);
    expect(filterLibraryRows(libraryRows(imported), { ...DEFAULT_LIBRARY_VIEW, ranks: ["unranked"] })).toHaveLength(2);
    expect(isStoredProject({ ...imported, photoLibrary: [photo("bad", { rank: "best" } as unknown as Partial<ProjectPhoto>)] })).toBe(false);
    expect(isStoredProject({ ...imported, photoLibrary: [photo("bad", { labels: [42] } as unknown as Partial<ProjectPhoto>)] })).toBe(false);
  });

  it("normalizes reusable labels and ignores repeated or empty additions without another edit", () => {
    const p = editProjectPhotoMetadata(project(), ["loose"], { addLabels: [" Temple ", "temple", "  Blue   Sky ", "  ", "Ｔｅｍｐｌｅ"] }, later);
    expect(getProjectPhotos(p).find(item => item.blobKey === "loose")?.labels).toEqual(["blue sky", "temple"]);
    expect(projectPhotoLabels(getProjectPhotos(p))).toEqual(["blue sky", "temple"]);
    expect(editProjectPhotoMetadata(p, ["loose"], { addLabels: ["TEMPLE", ""] })).toBe(p);
    expect(editProjectPhotoMetadata(p, ["missing"], { rank: "hero" })).toBe(p);
    const removed = editProjectPhotoMetadata(p, ["loose"], { removeLabel: " Temple " });
    expect(getProjectPhotos(removed).find(item => item.blobKey === "loose")?.labels).toEqual(["blue sky"]);
  });

  it("bulk adds without replacing individual labels and never edits another project or composition", () => {
    const original = project(), otherProject = { ...original, id: "other-project" }, before = structuredClone(original);
    original.photoLibrary![0] = { ...original.photoLibrary![0], labels: ["people"], driveOriginalId: "original",
      drivePreviewId: "preview", driveThumbnailId: "thumb", pendingUpload: { originalId: "reserved" } };
    original.photoLibrary![1].labels = ["night"];
    const originals = structuredClone(original.photoLibrary);
    const labelled = editProjectPhotoMetadata(original, ["used", "loose"], { addLabels: ["Temple", "NIGHT"] }, later);
    const ranked = editProjectPhotoMetadata(labelled, ["used", "loose"], { rank: "hero" }, later);
    expect(ranked.pages).toBe(original.pages);
    expect(ranked.photoLibrary).toEqual([
      { ...originals![0], labels: ["night", "people", "temple"], rank: "hero" },
      { ...originals![1], labels: ["night", "temple"], rank: "hero" }, originals![2],
    ]);
    expect(original.photoLibrary).toEqual(originals);
    expect(getProjectPhotos(otherProject).every(item => item.rank === undefined)).toBe(true);
    expect(original.pages).toEqual(before.pages);
    expect(ranked.updatedAt > original.updatedAt).toBe(true);
    expect(ranked.pendingDeletions).toBeUndefined();
  });

  it("keeps metadata scoped to the project even when original blob keys are shared", () => {
    const first = project(), second = { ...structuredClone(first), id: "second" };
    const edited = editProjectPhotoMetadata(first, ["used"], { addLabels: ["temple"] });
    expect(projectPhotoLabels(getProjectPhotos(edited))).toEqual(["temple"]);
    expect(projectPhotoLabels(getProjectPhotos(second))).toEqual([]);
    expect(filterLibraryRows(libraryRows(second), { ...DEFAULT_LIBRARY_VIEW, labels: ["temple"] })).toEqual([]);
  });

  it("edits a selected duplicate group while preserving each member's own labels and original identity", () => {
    const p = project();
    p.photoLibrary![0].labels = ["people"];
    p.photoLibrary!.push(photo("alias", { duplicateOf: "used", labels: ["night"], driveOriginalId: "alias-original" }));
    let edited = editProjectPhotoMetadata(p, ["used"], { addLabels: ["temple"] });
    edited = editProjectPhotoMetadata(edited, ["used"], { rank: "good" });
    const row = libraryRows(edited).find(item => item.photo.blobKey === "used")!;
    expect(row.labels).toEqual(["night", "people", "temple"]);
    expect(row.members.map(item => item.rank)).toEqual(["good", "good"]);
    expect(row.members[1]).toMatchObject({ blobKey: "alias", duplicateOf: "used", labels: ["night", "temple"], driveOriginalId: "alias-original" });
    edited = editProjectPhotoMetadata(edited, ["used"], { removeLabel: "night" });
    expect(libraryRows(edited).find(item => item.photo.blobKey === "used")?.labels).toEqual(["people", "temple"]);
    expect(edited.pages).toBe(p.pages);
  });

  it("combines Hero + Temple + Unused with search, orientation and colour, and supports Unranked", () => {
    const p = project();
    p.photoLibrary![0] = photo("used", { rank: "hero", labels: ["temple"], colourOverride: "colour" });
    p.photoLibrary![1] = photo("loose", { rank: "hero", labels: ["temple", "night"], colourOverride: "colour" });
    p.photoLibrary![2] = photo("other", { rank: null, labels: ["temple"], colourOverride: "bw" });
    const rows = libraryRows(p), before = structuredClone(p);
    const view = { ...DEFAULT_LIBRARY_VIEW, ranks: ["hero" as const], labels: ["TEMPLE"], usage: "unused" as const,
      search: "temple", orientations: ["landscape" as const], colours: ["colour" as const] };
    expect(filterLibraryRows(rows, view).map(row => row.photo.blobKey)).toEqual(["loose"]);
    expect(filterLibraryRows(rows, { ...view, labels: ["temple", "people"] })).toEqual([]);
    expect(filterLibraryRows(rows, { ...DEFAULT_LIBRARY_VIEW, ranks: ["unranked"] }).map(row => row.photo.blobKey)).toEqual(["other"]);
    expect(filterLibraryRows(rows, { ...DEFAULT_LIBRARY_VIEW, ranks: ["hero", "unranked"] })).toHaveLength(3);
    expect(p).toEqual(before);
  });

  it("records rank/label edits and clears in Undo while preserving upload checkpoints", () => {
    const p = project(), history = new ProjectHistory(); history.observe(p);
    const labelled = editProjectPhotoMetadata(p, ["used"], { addLabels: ["temple"] });
    history.observe(labelled);
    const ranked = editProjectPhotoMetadata(labelled, ["used"], { rank: "hero" });
    history.observe(ranked);
    const checkpoint = applyPhotoBackupCheckpoint(ranked, { blobKey: "used", driveOriginalId: "original",
      drivePreviewId: "preview", driveThumbnailId: "thumb", driveFolderId: "folder" }, later);
    history.observe(checkpoint);
    const undoneRank = history.travel("undo", checkpoint, later)!;
    expect(getProjectPhotos(undoneRank)[0]).toMatchObject({ rank: null, labels: ["temple"], driveOriginalId: "original", driveThumbnailId: "thumb" });
    const undoneLabels = history.travel("undo", undoneRank, later)!;
    expect(getProjectPhotos(undoneLabels)[0]).toMatchObject({ rank: null, labels: [], driveOriginalId: "original" });
    expect(undoneLabels.pages[0].photos["photo-1"].crop).toEqual(p.pages[0].photos["photo-1"].crop);
    const redone = history.travel("redo", history.travel("redo", undoneLabels, later)!, later)!;
    expect(getProjectPhotos(redone)[0]).toMatchObject({ rank: "hero", labels: ["temple"], driveOriginalId: "original" });
    expect(redone.pendingDeletions).toBeUndefined();
  });
});
