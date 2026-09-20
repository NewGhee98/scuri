import { describe, expect, it } from "vitest";
import { centreCrop, coverPlacement, DEFAULT_CROP, moveCrop, setCropZoom, withFreePosition } from "../crop";
import { snapPhotoPosition, snapPhotoZoom } from "../editor-alignment";
import { isStoredPhoto } from "../project-validation";
import type { CropState, ResolvedFrame } from "../types";

const frame: ResolvedFrame = { id: "f", x: 30, y: 60, width: 400, height: 300, cornerRadius: 12 };
const center = (width: number, height: number, crop: CropState) => {
  const p = coverPlacement(width, height, frame, crop);
  return { x: p.x + p.width / 2, y: p.y + p.height / 2 };
};

describe("free positioning with legacy crop compatibility", () => {
  it.each([.2, 1, 2.5])("moves both axes independently at zoom %s, including exact-fit/smaller images", zoom => {
    for (const [width, height] of [[800, 600], [6400, 1440], [600, 1800]]) {
      const crop = { ...DEFAULT_CROP, zoom }, before = coverPlacement(width, height, frame, crop);
      for (const [dx, dy] of [[57, 0], [0, -81], [-64, 77]]) {
        const moved = moveCrop(width, height, frame, crop, dx, dy), after = coverPlacement(width, height, frame, moved);
        expect(after.x).toBeCloseTo(before.x + dx); expect(after.y).toBeCloseTo(before.y + dy);
        expect(after.width).toBe(before.width); expect(after.height).toBe(before.height);
        expect(moved.zoom).toBe(zoom); expect(crop).toEqual({ ...DEFAULT_CROP, zoom });
      }
    }
  });

  it("renders untouched legacy crops exactly by their original overflow rules", () => {
    for (const zoom of [.001, .25, .999, 1, 1.75, 4]) for (const positionX of [-2, -.37, 0, .81, 2]) {
      const crop = { zoom, positionX, positionY: -positionX }, before = JSON.stringify(crop);
      const p = coverPlacement(6400, 1440, frame, crop), scale = Math.max(400 / 6400, 300 / 1440) * zoom;
      const w = 6400 * scale, h = 1440 * scale, clamp = (n: number) => Math.max(-1, Math.min(1, n));
      expect(p.x).toBe(30 + (400 - w) / 2 + (zoom < 1 ? 0 : clamp(positionX)) * Math.max(0, w - 400) / 2);
      expect(p.y).toBe(60 + (300 - h) / 2 + (zoom < 1 ? 0 : clamp(-positionX)) * Math.max(0, h - 300) / 2);
      expect(JSON.stringify(crop)).toBe(before);
      const editable = withFreePosition(6400, 1440, frame, crop);
      const converted = coverPlacement(6400, 1440, frame, editable);
      expect(converted.x).toBeCloseTo(p.x, 10); expect(converted.y).toBeCloseTo(p.y, 10);
    }
  });

  it("holds a deliberately chosen legacy or new image centre across zoom and baseline crossings", () => {
    for (const crop of [{ positionX: .67, positionY: -.42, zoom: 2.1 },
      moveCrop(6400, 1440, frame, { ...DEFAULT_CROP, zoom: .15 }, -80, 72)]) {
      const photos = { f: { sourceWidth: 6400, sourceHeight: 1440, crop } };
      const original = center(6400, 1440, crop);
      for (const zoom of [.04, .5, 1, 3]) {
        // This is the shared slider, numeric, wheel, pinch and keyboard path.
        const next = snapPhotoZoom(photos, [frame], "f", zoom, -1)!;
        expect(center(6400, 1440, next.crop).x).toBeCloseTo(original.x);
        expect(center(6400, 1440, next.crop).y).toBeCloseTo(original.y);
        photos.f.crop = next.crop;
      }
    }
  });

  it("Centre retains exact zoom, while Reset returns the fill baseline", () => {
    const crop = moveCrop(800, 600, frame, { ...DEFAULT_CROP, zoom: .731254 }, 67, -89);
    const centred = centreCrop(crop);
    expect(centred.zoom).toBe(crop.zoom); expect(center(800, 600, centred)).toEqual({ x: 230, y: 210 });
    expect(centreCrop(centred)).toBe(centred);
    expect(center(800, 600, DEFAULT_CROP)).toEqual({ x: 230, y: 210 });
    expect(DEFAULT_CROP.zoom).toBe(1); expect(DEFAULT_CROP.freePosition).toBeUndefined();
  });

  it("ignores stationary/invalid edits and validates optional persisted offsets", () => {
    const crop = { positionX: .123, positionY: -.456, zoom: .77 };
    expect(moveCrop(800, 600, frame, crop, 0, 0)).toBe(crop);
    expect(moveCrop(800, 600, frame, crop, NaN, 3)).toBe(crop);
    expect(setCropZoom(crop, NaN)).toBe(crop);
    const photo = { frameId: "f", blobKey: "synthetic", sourceWidth: 800, sourceHeight: 600, crop };
    expect(isStoredPhoto(photo)).toBe(true);
    expect(isStoredPhoto({ ...photo, crop: { ...crop, freePosition: { x: 1.5, y: -.23 } } })).toBe(true);
    for (const freePosition of [null, { x: 1 }, { x: NaN, y: 0 }, { x: 0, y: Infinity }, []]) {
      expect(isStoredPhoto({ ...photo, crop: { ...crop, freePosition } })).toBe(false);
    }
  });
});

describe("gentle centre and visible-edge snapping", () => {
  it("snaps each centre axis within five screen pixels and can be dragged through", () => {
    for (const scale of [.25, 1, 3]) {
      const tolerance = 5 / scale;
      let raw = moveCrop(800, 600, frame, { ...DEFAULT_CROP, zoom: .5 }, -6 / scale, 30 / scale);
      for (let step = 1; step <= 12; step++) {
        raw = moveCrop(800, 600, frame, raw, 1 / scale, 0);
        const snapped = snapPhotoPosition(raw, frame, tolerance);
        expect(snapped.crop.freePosition!.y).toBe(raw.freePosition!.y);
        if (step < 11) expect(snapped.crop.freePosition!.x).toBeCloseTo(0);
        if (step === 12) expect(snapped.crop.freePosition!.x).toBeGreaterThan(0);
        expect(snapPhotoPosition(raw, frame, -1)).toEqual({ crop: raw, guides: [] });
      }
      const near = moveCrop(800, 600, frame, DEFAULT_CROP, 2 / scale, -3 / scale);
      expect(snapPhotoPosition(near, frame, tolerance)).toMatchObject({ crop: { freePosition: { x: 0, y: 0 } },
        guides: [{ axis: "x", value: 230 }, { axis: "y", value: 210 }] });
    }
  });

  it("zoom snapping follows shifted visible edges without moving the selected centre", () => {
    const frames = [frame, { ...frame, id: "other", y: 500 }];
    const crop = moveCrop(800, 600, frame, { ...DEFAULT_CROP, zoom: .8 }, 40, 0);
    const photos = { f: { sourceWidth: 800, sourceHeight: 600, crop },
      other: { sourceWidth: 800, sourceHeight: 600, crop: { ...DEFAULT_CROP, zoom: .6 } } };
    const snapped = snapPhotoZoom(photos, frames, "f", .81, 5)!;
    expect(snapped.crop.zoom).toBeCloseTo(.8); // shifted left edge = other left edge
    expect(snapped.crop.freePosition).toEqual(crop.freePosition);
    expect(snapped.guides).toContainEqual({ axis: "x", value: 110 });
  });
});
