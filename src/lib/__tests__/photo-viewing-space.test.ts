import { describe, expect, it } from "vitest";
import { galleryScrollAnchor, visibleGalleryRange } from "../library-gallery";
import { inspectionGesture } from "../photo-inspection";

describe("scrolling controls with a virtual photo gallery", () => {
  it("does not skip photos while the toolbar or taller active filters are still visible", () => {
    expect(galleryScrollAnchor(40, 330, 120)).toBeUndefined();
    expect(visibleGalleryRange(40, 700, 330, 100, 120).start).toBe(0);
    expect(visibleGalleryRange(0, 600, 330, 100, 800)).toEqual({ start: 0, end: 2 });
  });
  it("restores the same row and offset after header height or viewport changes", () => {
    const anchor = galleryScrollAnchor(1217, 330, 120)!;
    expect(anchor).toEqual({ index: 3, offset: 107 });
    const restoredTop = 176 + anchor.index * 420 + anchor.offset;
    expect(galleryScrollAnchor(restoredTop, 420, 176)).toEqual(anchor);
    const range = visibleGalleryRange(restoredTop, 700, 420, 100, 176);
    expect(range.start).toBeLessThanOrEqual(anchor.index);
    expect(range.end).toBeGreaterThan(anchor.index);
    expect(range.end - range.start).toBeLessThan(10);
  });
  it("includes the last row without losing virtualisation deep in a large library", () => {
    const range = visibleGalleryRange(32700, 420, 330, 100, 120);
    expect(range.end).toBe(100);
    expect(range.start).toBeGreaterThan(90);
  });
});

describe("photo-only inspection gestures", () => {
  it("distinguishes a tap from a long press or a drag returning to its start", () => {
    expect(inspectionGesture(2, 3, 200, 4, 1)).toBe("toggle");
    expect(inspectionGesture(2, 3, 200, 4, 3)).toBe("toggle");
    expect(inspectionGesture(0, 0, 600, 0, 1)).toBeNull();
    expect(inspectionGesture(0, 0, 200, 80, 2)).toBeNull();
  });
  it("only swipes between photos at Fit and leaves detail panning alone", () => {
    expect(inspectionGesture(-100, 12, 300, 101, 1)).toBe("next");
    expect(inspectionGesture(100, 12, 300, 101, 1)).toBe("previous");
    expect(inspectionGesture(-100, 12, 300, 101, 2)).toBeNull();
    expect(inspectionGesture(-100, 100, 300, 141, 1)).toBeNull();
  });
});
