import { describe, expect, it } from "vitest";
import { analysePixels, paletteDistance, rgbToOklab } from "../photo-palette";
import { applyArrangementAsCopy, cropLoss, eligibleArrangementTemplates, meaningfullyDifferent, suggestArrangements, type AnalysedPhoto } from "../arrangements";
import { resolveFrames } from "../crop";
import { getProjectPhotos } from "../project-photo-library";
import { getTemplatesForFormat } from "../templates";
import type { StoredProject, TemplateDefinition } from "../types";

const blue = [25, 80, 170], cream = [230, 210, 170], red = [205, 40, 25];
function pixels(colours: number[][]): Uint8ClampedArray { return new Uint8ClampedArray(colours.flatMap(colour => [...colour, 255])); }
function photo(id: string, width: number, height: number, colour = blue): AnalysedPhoto {
  return { photo: { blobKey: id, sourceWidth: width, sourceHeight: height, sourceName: id }, analysis: analysePixels(pixels([colour]), width, height) };
}
function template(id: string, count: number, direction: "rows" | "columns", gutter = 0): TemplateDefinition {
  return { id, name: id, formatId: "instagram-square", canvasWidth: 1080, canvasHeight: 1080, defaultBackground: "#faf0e0", defaultGutter: gutter,
    frames: Array.from({ length: count }, (_, i) => ({ id: `f${i}`, x: direction === "columns" ? i / count : 0,
      y: direction === "rows" ? i / count : 0, width: direction === "columns" ? 1 / count : 1, height: direction === "rows" ? 1 / count : 1 })) };
}

describe("local perceptual palettes", () => {
  it("extracts dominant colours with proportions rather than average RGB", () => {
    const analysis = analysePixels(pixels([...Array(8).fill(blue), ...Array(2).fill(cream)]), 1000, 500);
    expect(analysis.palette).toHaveLength(2);
    expect(analysis.palette[0].proportion).toBeCloseTo(0.8);
    expect(analysis.palette[1].proportion).toBeCloseTo(0.2);
    expect(analysis.brightness).toBeGreaterThan(0); expect(analysis.brightness).toBeLessThan(1);
    expect(analysis.saturation).toBeGreaterThan(0.3);
    const checker = analysePixels(pixels([[0, 0, 0], [255, 255, 255]]), 2, 1);
    const grey = analysePixels(pixels([[128, 128, 128]]), 1, 1);
    expect(paletteDistance(checker, grey)).toBeGreaterThan(0.2);
  });
  it("distinguishes colour proportions and is deterministic", () => {
    const dominantBlue = analysePixels(pixels([...Array(9).fill(blue), cream]), 10, 1);
    const dominantCream = analysePixels(pixels([blue, ...Array(9).fill(cream)]), 10, 1);
    expect(paletteDistance(dominantBlue, dominantBlue)).toBeCloseTo(0);
    expect(paletteDistance(dominantBlue, dominantCream)).toBeGreaterThan(0.2);
    expect(paletteDistance(dominantCream, dominantBlue)).toBeCloseTo(paletteDistance(dominantBlue, dominantCream));
    expect(analysePixels(pixels([...Array(9).fill(blue), cream]), 10, 1)).toEqual(dominantBlue);
  });
  it("ignores transparent pixels and uses OKLab reference coordinates", () => {
    const a = analysePixels(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 0]), 2, 1);
    expect(a.palette).toHaveLength(1); expect(a.palette[0].rgb).toEqual([255, 0, 0]);
    const lab = rgbToOklab(255, 0, 0);
    expect(lab[0]).toBeCloseTo(0.62796, 4); expect(lab[1]).toBeCloseTo(0.22486, 4); expect(lab[2]).toBeCloseTo(0.12585, 4);
  });
});

describe("joint photo grouping and template suggestions", () => {
  const wide = template("three-wide", 3, "rows"), tall = template("three-tall", 3, "columns");
  it("places three panoramas in three wide horizontal frames", () => {
    const photos = [photo("a", 3000, 1000), photo("b", 3000, 1000), photo("c", 3000, 1000)];
    const proposals = suggestArrangements({ photos, templates: [tall, wide], formatId: "instagram-square" });
    expect(proposals.length).toBeGreaterThan(0);
    for (const proposal of proposals) {
      expect(proposal.pages).toHaveLength(1); expect(proposal.pages[0].template.id).toBe("three-wide");
      expect(proposal.pages[0].cropLoss).toBeCloseTo(0); expect(proposal.unplaced).toEqual([]);
    }
  });
  it("prefers compatible colours when several panorama groups are possible", () => {
    const photos = [photo("a", 3000, 1000, blue), photo("b", 3000, 1000, red), photo("c", 3000, 1000, blue),
      photo("d", 3000, 1000, red), photo("e", 3000, 1000, blue), photo("f", 3000, 1000, red)];
    const [harmony] = suggestArrangements({ photos, templates: [wide, tall], formatId: "instagram-square" });
    expect(harmony.mode).toBe("colour"); expect(harmony.pages).toHaveLength(2);
    const groups = harmony.pages.map(page => Object.values(page.assignments).sort());
    expect(groups).toContainEqual(["a", "c", "e"]); expect(groups).toContainEqual(["b", "d", "f"]);
  });
  it("scores actual output dimensions and gutters, and admits valid custom layouts", () => {
    const custom = template("custom-wide", 2, "rows", 120);
    const frame = resolveFrames(custom, custom.defaultGutter, 1080, 1080)[0];
    expect(frame.width / frame.height).not.toBe(2);
    expect(cropLoss(frame.width / frame.height, frame.width / frame.height)).toBe(0);
    const proposals = suggestArrangements({ photos: [photo("a", frame.width, frame.height), photo("b", frame.width, frame.height)], templates: [custom], formatId: "instagram-square" });
    expect(proposals[0].pages[0].cropLoss).toBeCloseTo(0);
    expect(eligibleArrangementTemplates([custom, { ...wide, formatId: "instagram-story" }, { ...wide, frames: [] }], "instagram-square")).toEqual([custom]);
  });
  it("places every available photo exactly once and discloses unavailable photos", () => {
    const photos = Array.from({ length: 7 }, (_, i) => photo(`photo-${i}`, 3000, 1000));
    photos.push({ photo: { blobKey: "unavailable", sourceWidth: 400, sourceHeight: 400 } });
    for (const proposal of suggestArrangements({ photos, templates: [wide, tall], formatId: "instagram-square" })) {
      const placed = proposal.pages.flatMap(page => Object.values(page.assignments));
      expect(new Set(placed).size).toBe(7); expect(placed).toHaveLength(7);
      expect(proposal.unplaced).toEqual([{ blobKey: "unavailable", reason: expect.stringContaining("Awaiting analysis") }]);
    }
  });
  it("respects page limits and explicitly retains surplus photos", () => {
    const photos = Array.from({ length: 8 }, (_, i) => photo(`p${i}`, 3000, 1000));
    const [proposal] = suggestArrangements({ photos, templates: [wide], formatId: "instagram-square", maxPages: 2 });
    expect(proposal.pages).toHaveLength(2); expect(proposal.unplaced).toHaveLength(2);
    expect(proposal.unplaced.every(item => item.reason.includes("limit"))).toBe(true);
    expect(suggestArrangements({ photos: [{ photo: photos[0].photo }], templates: [wide], formatId: "instagram-square" })).toEqual([]);
  });
  it("returns genuinely different proposals rather than relabelled page orders", () => {
    const photos = Array.from({ length: 12 }, (_, i) => photo(`p${i}`, i % 2 ? 800 : 2400, 1200, i < 6 ? blue : red));
    const proposals = suggestArrangements({ photos, templates: getTemplatesForFormat("instagram-square"), formatId: "instagram-square" });
    expect(proposals.length).toBeGreaterThanOrEqual(2); expect(proposals.length).toBeLessThanOrEqual(3);
    for (let i = 0; i < proposals.length; i++) for (let j = i + 1; j < proposals.length; j++) expect(meaningfullyDifferent(proposals[i], proposals[j], "instagram-square")).toBe(true);
    expect(meaningfullyDifferent(proposals[0], { ...proposals[0], pages: [...proposals[0].pages].reverse() }, "instagram-square")).toBe(false);
  });
  it("previewing and applying a copy preserve the original and every library member", () => {
    const photos = [photo("a", 3000, 1000), photo("b", 3000, 1000), { photo: photo("missing", 1, 1).photo }];
    const source: StoredProject = { version: 3, id: "source-project", name: "Synthetic", formatId: "instagram-square", activePageId: "original-page", revision: 9,
      createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", photoLibrary: photos.map(p => p.photo),
      pages: [{ id: "original-page", templateId: wide.id, templateSnapshot: wide, background: "#eee", gutter: 0, selectedFrameId: "f0",
        photos: { f0: { ...photos[0].photo, frameId: "f0", crop: { zoom: 0.2, positionX: 0, positionY: 0 } } }, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }] };
    const original = structuredClone(source);
    const [proposal] = suggestArrangements({ photos, templates: [wide], formatId: source.formatId });
    expect(source).toEqual(original);
    let id = 0; const copy = applyArrangementAsCopy(source, proposal, () => `new-${id++}`);
    expect(source).toEqual(original); expect(copy.id).not.toBe(source.id); expect(copy.revision).toBeUndefined();
    expect(copy.pages[0].id).not.toBe("original-page"); expect(getProjectPhotos(copy).map(p => p.blobKey).sort()).toEqual(["a", "b", "missing"]);
    const stale = { ...source, photoLibrary: [...source.photoLibrary!, photo("new-photo", 2, 2).photo] };
    expect(() => applyArrangementAsCopy(stale, proposal)).toThrow("library changed");
    const duplicate = structuredClone(proposal); duplicate.pages[0].assignments.f1 = duplicate.pages[0].assignments.f0;
    expect(() => applyArrangementAsCopy(source, duplicate)).toThrow("repeated photo");
  });
});
