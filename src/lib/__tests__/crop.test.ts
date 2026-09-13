import { describe, expect, it } from "vitest";
import { coverPlacement, moveCrop, resolveFrames, setCropZoom, MIN_ZOOM, minimumPhotoZoom, zoomPercent } from "../crop";
import { getTemplatesForFormat } from "../templates";
import type { ResolvedFrame } from "../types";

const target: ResolvedFrame = { id: "frame", x: 0, y: 0, width: 400, height: 500, cornerRadius: 0 };

describe("cover crop calculations", () => {
  it("scales and centres a landscape image to cover a portrait frame", () => {
    const placement = coverPlacement(1600, 900, target, { positionX: 0, positionY: 0, zoom: 1 });
    expect(placement.height).toBeCloseTo(500);
    expect(placement.width).toBeGreaterThan(400);
    expect(placement.x).toBeCloseTo(-244.444, 2);
    expect(placement.y).toBeCloseTo(0);
  });

  it("constrains dragged positions so the frame stays covered", () => {
    const crop = moveCrop(1600, 900, target, { positionX: 0, positionY: 0, zoom: 1 }, 10000, -10000);
    expect(crop.positionX).toBe(1);
    expect(crop.positionY).toBe(0);
    const placement = coverPlacement(1600, 900, target, crop);
    expect(placement.x + placement.width).toBeGreaterThanOrEqual(target.width);
    expect(placement.y).toBeLessThanOrEqual(target.y);
  });

  it("clamps zoom to the supported range", () => {
    expect(setCropZoom({ positionX: 0, positionY: 0, zoom: 1 }, 0).zoom).toBe(MIN_ZOOM);
    expect(setCropZoom({ positionX: 0, positionY: 0, zoom: 1 }, 8).zoom).toBe(4);
  });
});

describe("zoom below the fill-frame baseline", () => {
  const square: ResolvedFrame = { id: "square", x: 20, y: 30, width: 400, height: 400, cornerRadius: 12 };
  it("reveals a panorama progressively, then fits it entirely with extra space available", () => {
    const place = (zoom: number) => coverPlacement(3000, 1000, square, { positionX: 0, positionY: 0, zoom });
    expect(place(1)).toMatchObject({ x: -380, y: 30, width: 1200, height: 400 });
    expect(place(2 / 3).width).toBeCloseTo(800);
    expect(place(2 / 3).y).toBeCloseTo(30 + 400 / 6);
    expect(place(1 / 3)).toMatchObject({ x: 20, width: 400 });
    expect(place(1 / 3).height).toBeCloseTo(400 / 3);
    expect(place(0.2).x).toBeCloseTo(100); expect(place(0.2).y).toBeCloseTo(190);
    expect(place(0.2).width).toBeCloseTo(240); expect(place(0.2).height).toBeCloseTo(80);
    expect(square).toEqual({ id: "square", x: 20, y: 30, width: 400, height: 400, cornerRadius: 12 });
    expect(zoomPercent(1)).toBe(0); expect(zoomPercent(0.2)).toBe(-80); expect(zoomPercent(2)).toBe(100);
  });
  it("centres below baseline and preserves historic panning at or above baseline", () => {
    const old = { positionX: 0.75, positionY: -0.4, zoom: 2 };
    const placement = coverPlacement(3000, 1000, square, old);
    expect(placement.x).toBe(20 - 1000 + 0.75 * 1000);
    expect(placement.y).toBe(30 - 200 - 0.4 * 200);
    const shrunk = setCropZoom(old, 0.5);
    expect(shrunk).toEqual({ positionX: 0, positionY: 0, zoom: 0.5 });
    expect(moveCrop(3000, 1000, square, shrunk, 100, 100)).toEqual(shrunk);
  });
  it("extends beyond contain-size for extreme panoramas and portraits", () => {
    for (const [width, height] of [[32000, 4], [4, 32000], [500, 500]]) {
      const zoom = minimumPhotoZoom(width, height, square);
      const placed = coverPlacement(width, height, square, { positionX: 0, positionY: 0, zoom });
      expect(placed.width).toBeLessThan(square.width);
      expect(placed.height).toBeLessThan(square.height);
      expect(placed.width / placed.height).toBeCloseTo(width / height);
    }
  });
});

describe("canvas scaling", () => {
  it("scales normalised template frames consistently", () => {
    const template = getTemplatesForFormat("instagram-post").find((item) => item.id.endsWith("hero-trio"));
    expect(template).toBeDefined();
    const full = resolveFrames(template!, template!.defaultGutter, 1080, 1350);
    const preview = resolveFrames(template!, template!.defaultGutter, 360, 450);
    expect(preview[0].x).toBeCloseTo(full[0].x / 3);
    expect(preview[0].width).toBeCloseTo(full[0].width / 3);
    expect(preview[2].height).toBeCloseTo(full[2].height / 3);
  });

  it("can use a wider outside inset without changing the gap between frames", () => {
    const template = getTemplatesForFormat("instagram-post").find((item) => item.id.endsWith("vertical-pair"));
    expect(template).toBeDefined();
    const [top, bottom] = resolveFrames(template!, template!.defaultGutter, 1080, 1350);
    expect(top.x).toBeCloseTo(24);
    expect(top.y).toBeCloseTo(24);
    expect(1080 - (top.x + top.width)).toBeCloseTo(24);
    expect(bottom.y - (top.y + top.height)).toBeCloseTo(24);
    expect(1350 - (bottom.y + bottom.height)).toBeCloseTo(24);
  });
});
