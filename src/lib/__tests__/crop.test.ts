import { describe, expect, it } from "vitest";
import { coverPlacement, moveCrop, resolveFrames, setCropZoom } from "../crop";
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
    expect(setCropZoom({ positionX: 0, positionY: 0, zoom: 1 }, 0).zoom).toBe(1);
    expect(setCropZoom({ positionX: 0, positionY: 0, zoom: 1 }, 8).zoom).toBe(4);
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
});
