import { describe, expect, it } from "vitest";
import { DEFAULT_CROP } from "../crop";
import { openPhotoPicker, photoPickerTargets, placeLibraryPhotos } from "../photo-picker";
import { applyPhotoBackupCheckpoint } from "../photo-backup";
import { getTemplatesForFormat } from "../templates";
import type { ProjectPhoto, StoredProject } from "../types";

const template = getTemplatesForFormat("instagram-post").find(item => item.frames.length === 3)!;
const frames = template.frames.map(frame => frame.id);
const time = "2026-09-28T12:00:00.000Z";
const photos: ProjectPhoto[] = ["first", "second", "third"].map(blobKey => ({ blobKey, sourceName: `${blobKey}.jpg`, sourceWidth: 1200, sourceHeight: 800 }));
function fixture(): StoredProject {
  return { version: 3, id: "batch-project", name: "Synthetic", formatId: "instagram-post", activePageId: "page", createdAt: time, updatedAt: time,
    photoLibrary: structuredClone(photos), pages: [{ id: "page", templateId: template.id, templateSnapshot: template, photos: {},
      selectedFrameId: frames[0], background: "#fff", gutter: 12, createdAt: time, updatedAt: time }] };
}

describe("multi-photo library placement", () => {
  it("starts at the tapped frame and wraps empty frames in layout order", () => {
    const p = fixture(), before = structuredClone(p), intent = openPhotoPicker(p, "page", frames[1]);
    expect(photoPickerTargets(p, intent, frames)).toEqual([frames[1], frames[2], frames[0]]);
    const updated = placeLibraryPhotos(p, intent, photos, frames);
    expect([frames[1], frames[2], frames[0]].map(id => updated.pages[0].photos[id].blobKey)).toEqual(["first", "second", "third"]);
    Object.values(updated.pages[0].photos).forEach(photo => expect(photo.crop).toEqual(DEFAULT_CROP));
    expect(updated.photoLibrary).toEqual(p.photoLibrary); expect(p).toEqual(before);
  });
  it("preserves occupied and unavailable placements outside the explicit target", () => {
    const p = fixture();
    p.pages[0].photos[frames[1]] = { ...photos[2], frameId: frames[1], driveOriginalId: "original", crop: { zoom: .72, positionX: .21, positionY: -.4 } };
    const existing = structuredClone(p.pages[0].photos[frames[1]]), intent = openPhotoPicker(p, "page", frames[0]);
    expect(photoPickerTargets(p, intent, frames)).toEqual([frames[0], frames[2]]);
    const updated = placeLibraryPhotos(p, intent, photos.slice(0, 2), frames);
    expect(updated.pages[0].photos[frames[1]]).toEqual(existing); expect(updated.pendingDeletions).toBeUndefined();
  });
  it("records only the explicit replacement and retains the displaced library photo", () => {
    const p = fixture(); p.pages[0].photos[frames[0]] = { ...photos[2], frameId: frames[0], crop: { ...DEFAULT_CROP } };
    const updated = placeLibraryPhotos(p, openPhotoPicker(p, "page", frames[0]), photos.slice(0, 2), frames);
    expect(updated.pendingDeletions?.photos).toEqual([{ pageId: "page", frameId: frames[0], blobKey: "third" }]);
    expect(updated.photoLibrary).toEqual(p.photoLibrary);
  });
  it("preserves an existing crop when the first selection is the same original or alias", () => {
    const p = fixture(); p.photoLibrary!.push({ ...photos[0], blobKey: "alias", duplicateOf: "first" });
    p.pages[0].photos[frames[0]] = { ...photos[0], frameId: frames[0], crop: { zoom: .65, positionX: .35, positionY: .1 } };
    const updated = placeLibraryPhotos(p, openPhotoPicker(p, "page", frames[0]), [p.photoLibrary![3], photos[1]], frames);
    expect(updated.pages[0].photos[frames[0]]).toEqual(p.pages[0].photos[frames[0]]);
    expect(updated.pages[0].photos[frames[1]].blobKey).toBe("second");
  });
  it.each(["capacity", "missing", "duplicate", "alias"])("rejects %s without a partial placement", reason => {
    const p = fixture(); p.photoLibrary!.push({ ...photos[0], blobKey: "alias", duplicateOf: "first" });
    const intent = openPhotoPicker(p, "page", frames[0]), before = structuredClone(p);
    const selected = reason === "capacity" ? [...photos, photos[0]] : reason === "missing" ? [photos[0], { ...photos[1], blobKey: "gone" }] :
      reason === "alias" ? [photos[0], p.photoLibrary![3]] : [photos[0], photos[0]];
    expect(() => placeLibraryPhotos(p, intent, selected, frames)).toThrow(); expect(p).toEqual(before);
  });
  it("rejects a newly occupied secondary destination but permits backup checkpoints", () => {
    const p = fixture(), intent = openPhotoPicker(p, "page", frames[0]);
    const backed = applyPhotoBackupCheckpoint(p, { blobKey: "first", driveFolderId: "folder", driveOriginalId: "new-original" }, time);
    expect(placeLibraryPhotos(backed, intent, photos.slice(0, 2), frames).pages[0].photos[frames[0]].driveOriginalId).toBe("new-original");
    p.pages[0].photos[frames[1]] = { ...photos[2], frameId: frames[1], crop: { ...DEFAULT_CROP } };
    const before = structuredClone(p);
    expect(() => placeLibraryPhotos(p, intent, photos.slice(0, 2), frames)).toThrow("destination changed"); expect(p).toEqual(before);
  });
});
