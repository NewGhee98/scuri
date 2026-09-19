import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LIBRARY_VIEW, clearLibraryViews, filterLibraryRows, libraryRows, photoColour, photoOrientation, readLibraryView, rememberLibraryView } from "../photo-library-view";
import { classifyPhotoColour } from "../photo-palette";
import { getProjectPhotos, getVisibleProjectPhotos } from "../project-photo-library";
import { openPhotoPicker, placeLibraryPhoto } from "../photo-picker";
import { applyPhotoBackupCheckpoint } from "../photo-backup";
import { ProjectHistory } from "../project-history";
import { galleryGeometry, galleryRows, visibleGalleryRange } from "../library-gallery";
import { getTemplate } from "../templates";
import { createProjectBackup, inspectProjectBackup, materializeProjectBackup } from "../project-backup";
import { isStoredProject } from "../project-validation";
import { movePagePhoto, reconcileProjectPages, serializePage } from "../project-photos";
import { isPageAssigned } from "../project";
import type { ProjectPhoto, StoredProject } from "../types";

const template = getTemplate("instagram-post-full-frame"), frameId = template.frames[0].id;
const time = "2026-09-19T00:00:00.000Z";
const photo = (key: string, extra: Partial<ProjectPhoto> = {}): ProjectPhoto => ({ blobKey: key, sourceWidth: 6400, sourceHeight: 1440, sourceName: `${key}.jpg`, ...extra });
function project(): StoredProject {
  return { version: 3, id: "synthetic-library", name: "Synthetic only", formatId: template.formatId, createdAt: time, updatedAt: time, activePageId: "p1",
    photoLibrary: [photo("pano10"), photo("pano2"), photo("portrait", { sourceWidth: 800, sourceHeight: 1200 })],
    pages: [{ id: "p1", templateId: template.id, templateSnapshot: template, background: "#eeddbb", gutter: 32, selectedFrameId: frameId, createdAt: time, updatedAt: time,
      photos: { [frameId]: { ...photo("pano10"), frameId, crop: { zoom: 0.756789, positionX: 0, positionY: 0 } } } }] };
}
afterEach(() => { vi.unstubAllGlobals(); clearLibraryViews(); });

describe("library classification, browsing and usage", () => {
  it.each([[949, 1000, "portrait"], [950, 1000, "square"], [1050, 1000, "square"], [1051, 1000, "landscape"], [2499, 1000, "landscape"],
    [2500, 1000, "panorama"], [6400, 1440, "panorama"], [1536, 230, "panorama"], [0, 0, "awaiting"], [NaN, 100, "awaiting"]])("classifies dimensions %s x %s as %s", (w, h, result) => {
    expect(photoOrientation({ sourceWidth: w as number, sourceHeight: h as number })).toBe(result);
  });
  const pixels = (colour: (index: number) => number[]) => new Uint8ClampedArray(Array.from({ length: 1000 }, (_, i) => [...colour(i), 255]).flat());
  it("classifies grayscale, sepia, selective colour and ambiguous low-light samples conservatively", () => {
    expect(classifyPhotoColour(pixels(i => Array(3).fill(20 + i % 210)))).toBe("bw");
    expect(classifyPhotoColour(pixels(i => [130 + i % 60, 85 + i % 60, 35 + i % 60]))).toBe("colour");
    expect(classifyPhotoColour(pixels(i => i < 15 ? [240, 10, 30] : Array(3).fill(30 + i % 180)))).toBe("colour");
    expect(classifyPhotoColour(pixels(() => [2, 2, 2]))).toBe("uncertain");
    expect(classifyPhotoColour(new Uint8ClampedArray([120, 120, 120, 255]))).toBe("uncertain");
    expect(photoColour(photo("offline", { colourOverride: "bw" }))).toBe("bw");
    expect(photoColour(photo("offline", { colourOverride: null }))).toBe("awaiting");
  });
  it("combines categories with AND, alternatives with OR, searches alias names and counts every placement", () => {
    const p = project(); p.photoLibrary!.push(photo("alias", { duplicateOf: "pano10", sourceName: "Horizon 99.jpg" }));
    p.pages[0].photos.extra = { ...p.pages[0].photos[frameId], frameId: "extra", blobKey: "alias", crop: { zoom: 2, positionX: 0.3, positionY: 0 } };
    p.pages.push({ ...p.pages[0], id: "draft", photos: { [frameId]: p.pages[0].photos[frameId] } });
    const before = structuredClone(p), rows = libraryRows(p);
    expect(rows.find(row => row.photo.blobKey === "pano10")).toMatchObject({ uses: 3, pages: [{ pageNumber: 1, count: 2 }, { pageNumber: 2, count: 1 }] });
    const filtered = filterLibraryRows(rows, { ...DEFAULT_LIBRARY_VIEW, search: "HORIZON", orientations: ["portrait", "panorama"], colours: ["awaiting"], usage: "used" });
    expect(filtered.map(row => row.photo.blobKey)).toEqual(["pano10"]);
    expect(filterLibraryRows(rows, { ...DEFAULT_LIBRARY_VIEW, sort: "filename" }).map(row => row.photo.blobKey)).toEqual(["pano2", "pano10", "portrait"]);
    expect(p).toEqual(before);
  });
  it("keeps broken aliases visible and never truncates a legacy library over 250", () => {
    const p = project(); p.photoLibrary = Array.from({ length: 270 }, (_, i) => photo(`legacy-${i}`)); p.pages = [];
    p.photoLibrary[0].duplicateOf = "missing"; p.photoLibrary[1].duplicateOf = "legacy-2"; p.photoLibrary[2].duplicateOf = "legacy-1";
    expect(getVisibleProjectPhotos(p)).toHaveLength(270);
  });
  it("retains separate project/account filter and scroll preferences without touching composition", () => {
    const view = { ...DEFAULT_LIBRARY_VIEW, search: "pano", anchor: "pano2", scrollTop: 730, anchorOffset: 15 };
    rememberLibraryView("owner-a/project-a", view);
    expect(readLibraryView("owner-a/project-a")).toEqual(view);
    expect(readLibraryView("owner-b/project-a").search).toBe("");
    clearLibraryViews(); expect(readLibraryView("owner-a/project-a").search).toBe("");
  });
  it("keeps a 250-photo mixed gallery ordered, virtualised and filterable", () => {
    const p = project(); p.pages = []; p.photoLibrary = Array.from({ length: 250 }, (_, i) => photo(`photo${i}`, {
      sourceWidth: [800, 1000, 1600, 6400, 1536][i % 5], sourceHeight: [1200, 1000, 900, 1440, 230][i % 5], colourOverride: i % 3 ? "colour" : "bw" }));
    const start = performance.now(), rows = libraryRows(p), geometry = galleryGeometry(820, "medium"), packed = galleryRows(rows, geometry.columns);
    for (let i = 0; i < 100; i++) filterLibraryRows(rows, { ...DEFAULT_LIBRARY_VIEW, colours: [i % 2 ? "bw" : "colour"], orientations: ["panorama"] });
    expect(performance.now() - start).toBeLessThan(2000); // generous CI regression gate, not a physical-device claim
    expect(packed.flat().map(item => item.row.photo.blobKey)).toEqual(p.photoLibrary.map(photo => photo.blobKey));
    const range = visibleGalleryRange(1000, 700, geometry.rowHeight, packed.length);
    expect(packed.slice(range.start, range.end).flat().length).toBeLessThan(30);
  });
});

describe("explicit pinned placement and backwards-compatible persistence", () => {
  it("keeps preview-only pages complete and rearranges repeated placements with their independent crops", () => {
    const p = project();
    const page = reconcileProjectPages(p)[0];
    expect(Object.keys(page.photos)).toHaveLength(0);
    expect(isPageAssigned(page, template)).toBe(true);
    const other = { ...p.pages[0].photos[frameId], frameId: "other", crop: { zoom: 1.8, positionX: 0.2, positionY: -0.3 } };
    page.unavailablePhotos!.other = other;
    const before = structuredClone(page), swapped = movePagePhoto(page, frameId, "other");
    expect(serializePage(swapped).photos[frameId].crop).toEqual(other.crop);
    expect(serializePage(swapped).photos.other.crop).toEqual(before.unavailablePhotos![frameId].crop);
    expect(Object.keys(swapped.photos)).toHaveLength(0);
    expect(page).toEqual(before);
    expect(movePagePhoto(page, "missing", "other")).toBe(page);
  });
  it("swaps a loaded original and metadata-only placement without promoting a preview to original", () => {
    const p = project(), page = reconcileProjectPages(p)[0], original = p.pages[0].photos[frameId];
    const bytes = new Blob(["synthetic original"], { type: "image/jpeg" });
    page.photos.loaded = { ...original, frameId: "loaded", blobKey: "different", sourceBlob: bytes, previewUrl: "blob:synthetic", crop: { zoom: 2, positionX: 0.2, positionY: 0 } };
    const swapped = movePagePhoto(page, "loaded", frameId);
    expect(swapped.photos[frameId].sourceBlob).toBe(bytes);
    expect(swapped.unavailablePhotos!.loaded.blobKey).toBe(original.blobKey);
    expect(swapped.unavailablePhotos!.loaded.crop).toEqual(original.crop);
    expect(swapped.photos.loaded).toBeUndefined();
    expect(swapped.unavailablePhotos![frameId]).toBeUndefined();
  });
  it("only places on Use, same-photo reselection preserves crops, backup updates do not invalidate the target", () => {
    const p = project(), before = structuredClone(p), intent = openPhotoPicker(p, "p1", frameId);
    expect(p).toEqual(before);
    expect(placeLibraryPhoto(p, intent, p.photoLibrary![0], [frameId])).toBe(p);
    const checkpoint = applyPhotoBackupCheckpoint(p, { blobKey: "pano10", driveFolderId: "folder", driveOriginalId: "original" }, time);
    const placed = placeLibraryPhoto(checkpoint, intent, p.photoLibrary![1], [frameId]);
    expect(placed.pages[0].photos[frameId].blobKey).toBe("pano2");
    expect(placed.pendingDeletions?.photos).toEqual([{ pageId: "p1", frameId, blobKey: "pano10" }]);
    expect(getProjectPhotos(placed).map(photo => photo.blobKey)).toContain("pano10");
    expect(p).toEqual(before);
  });
  it.each(["project", "page", "frame", "crop", "replacement", "template"])("rejects a stale %s target without any edits", change => {
    const p = project(), intent = openPhotoPicker(p, "p1", frameId), next = structuredClone(p);
    let frames = [frameId];
    if (change === "project") next.id = "different";
    if (change === "page") next.pages = [];
    if (change === "frame") frames = [];
    if (change === "crop") next.pages[0].photos[frameId].crop.zoom = 2;
    if (change === "replacement") next.pages[0].photos[frameId].blobKey = "portrait";
    if (change === "template") next.pages[0].templateId = "changed";
    const before = structuredClone(next);
    expect(() => placeLibraryPhoto(next, intent, p.photoLibrary![1], frames)).toThrow("destination changed");
    expect(next).toEqual(before);
  });
  it("undoes classification without losing later upload checkpoints, and ignores stale placement copies", () => {
    const p = project(), history = new ProjectHistory(); history.observe(p);
    const classified = { ...p, photoLibrary: p.photoLibrary!.map(photo => ({ ...photo, colourOverride: "bw" as const })) }; history.observe(classified);
    const backed = applyPhotoBackupCheckpoint(classified, { blobKey: "pano10", driveOriginalId: "new-original", driveThumbnailId: "new-thumb", driveFolderId: "folder" }, time);
    const undone = history.travel("undo", backed, time)!;
    expect(getProjectPhotos(undone)[0]).toMatchObject({ colourOverride: null, driveOriginalId: "new-original", driveThumbnailId: "new-thumb" });
    Object.assign(undone.pages[0].photos[frameId], { colourOverride: "bw" });
    expect(getProjectPhotos(undone)[0].colourOverride).toBeNull();
  });
  it("round-trips 30 pages, repeated crops, aliases and optional metadata, clearing all imported Drive authority", async () => {
    const p = project(); p.pages = Array.from({ length: 30 }, (_, i) => ({ ...structuredClone(p.pages[0]), id: `p${i + 1}` }));
    p.photoLibrary![0] = { ...p.photoLibrary![0], fingerprint: `sha256:3:${"a".repeat(64)}`, importOrder: 1, importedAt: time, colourOverride: "bw",
      driveThumbnailId: "thumb", pendingUpload: { originalId: "reserved" } };
    p.photoLibrary!.push(photo("alias", { duplicateOf: "pano10" }));
    expect(isStoredProject(p)).toBe(true);
    const backup = await createProjectBackup(p, async () => new Blob(["abc"], { type: "image/jpeg" }));
    const inspected = await inspectProjectBackup(backup.blob), restored = materializeProjectBackup(inspected);
    expect(restored.project.pages).toHaveLength(30);
    expect(restored.project.pages.map(page => page.photos[frameId].crop)).toEqual(p.pages.map(page => page.photos[frameId].crop));
    expect(restored.project.photoLibrary![0]).toMatchObject({ colourOverride: "bw", importOrder: 1 });
    expect(restored.project.photoLibrary!.every(photo => !photo.driveOriginalId && !photo.drivePreviewId && !photo.driveThumbnailId && !photo.pendingUpload)).toBe(true);
    expect(restored.project.photoLibrary!.at(-1)?.duplicateOf).toBe(restored.project.photoLibrary![0].blobKey);
  });
});
