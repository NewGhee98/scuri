import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TemplateThumbnail } from "../../components/template-thumbnail";
import { coverPlacement, DEFAULT_CROP, moveCrop, resolveFrames, setCropZoom } from "../crop";
import { copyAsCustomTemplate } from "../custom-templates";
import { drawCroppedPhoto } from "../draw-photo";
import { renderComposition } from "../export";
import { getFormat } from "../formats";
import * as image from "../image";
import { reconcileProjectPages, serializePage } from "../project-photos";
import { loadProjects, saveProjects } from "../storage";
import { getTemplate, getTemplatesForFormat } from "../templates";
import type { PhotoAsset, ProjectPage, StoredProject, TemplateDefinition } from "../types";

const groups = [
  { slug: "pano-40-9", label: "Pano · 40:9", count: 5, width: 6400, height: 1440, numerator: 40, denominator: 9 },
  { slug: "ultra-pano-768-115", label: "Ultra Pano · 768:115", count: 7, width: 1536, height: 230, numerator: 768, denominator: 115 },
] as const;
const cases = groups.flatMap(group => [false, true].map(borderless => ({
  ...group, borderless,
  id: `instagram-post-${group.slug}-${group.count}${borderless ? "-borderless" : ""}`,
  name: `${group.count} ${group.label}${borderless ? " · Borderless" : ""}`,
  frameRatio: borderless ? 1080 / (1350 / group.count) : group.numerator / group.denominator,
})));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function filledPage(template: TemplateDefinition, width: number, height: number, zoom = 1): ProjectPage {
  return {
    id: "synthetic-page", templateId: template.id, templateSnapshot: template,
    background: "#eeddbb", gutter: template.defaultGutter, selectedFrameId: null,
    createdAt: "2026-09-15T00:00:00Z", updatedAt: "2026-09-15T00:00:00Z",
    photos: Object.fromEntries(template.frames.map(frame => [frame.id, {
      frameId: frame.id, blobKey: `synthetic-${frame.id}`, sourceBlob: new Blob(["synthetic"]),
      previewUrl: `blob:synthetic-${frame.id}`, sourceWidth: width, sourceHeight: height,
      crop: setCropZoom(DEFAULT_CROP, zoom),
    } satisfies PhotoAsset])),
  };
}

describe("built-in panorama geometry", () => {
  it("offers only four panorama choices in the portrait picker, retaining the two exact-layout IDs", () => {
    expect(getTemplatesForFormat("instagram-post").filter(item => item.id.includes("-pano-")).map(item => item.id))
      .toEqual(cases.map(item => item.id));
    for (const item of cases) {
      const template = getTemplate(item.id);
      expect(template.name).toBe(item.name);
      expect(template.frames).toHaveLength(item.count);
      expect(template.canvasWidth).toBe(1080);
      expect(template.canvasHeight).toBe(1350);
      expect(getTemplatesForFormat("instagram-post")).toContain(template);
      expect(getTemplatesForFormat("instagram-square")).not.toContain(template);
      expect(getTemplatesForFormat("instagram-story")).not.toContain(template);
    }
  });

  it.each(cases)("$id has correct ratios, bounds, equal gaps, symmetric margins and a centred stack", item => {
    const template = getTemplate(item.id);
    const frames = resolveFrames(template, template.defaultGutter);
    const first = frames[0], last = frames[frames.length - 1];
    expect(first.y).toBeCloseTo(1350 - last.y - last.height, 9);
    frames.forEach((frame, index) => {
      const normalized = template.frames[index];
      // Check physical ratios, not the misleading width/height of normalized coordinates.
      expect(normalized.width * 1080 / (normalized.height * 1350))
        .toBeCloseTo(item.frameRatio, 12);
      expect(frame.width / frame.height).toBeCloseTo(item.frameRatio, 12);
      expect(frame.x).toBeCloseTo(item.borderless ? 0 : 32, 10);
      expect(1080 - frame.x - frame.width).toBeCloseTo(item.borderless ? 0 : 32, 10);
      expect(frame.width).toBeCloseTo(item.borderless ? 1080 : 1016, 10);
      expect(frame.height).toBeCloseTo(first.height, 10);
      expect(frame.y).toBeGreaterThanOrEqual(0);
      expect(frame.y + frame.height).toBeLessThanOrEqual(1350 + 1e-9);
      expect(frame.cornerRadius).toBe(0);
      if (index > 0) {
        const previous = frames[index - 1];
        expect(frame.y - previous.y - previous.height).toBeCloseTo(item.borderless ? 0 : 32, 9);
      }
    });
    if (item.borderless) {
      expect(first.y).toBe(0);
      expect(last.y + last.height).toBeCloseTo(1350, 9);
      expect(frames.reduce((area, frame) => area + frame.width * frame.height, 0)).toBeCloseTo(1080 * 1350, 8);
    }
  });

  it.each(cases.filter(item => !item.borderless))("$id shows its matching entire source at the unchanged 0% zoom baseline", item => {
    const template = getTemplate(item.id);
    expect(DEFAULT_CROP).toEqual({ zoom: 1, positionX: 0, positionY: 0 });
    for (const frame of resolveFrames(template, template.defaultGutter)) {
      const placed = coverPlacement(item.width, item.height, frame, DEFAULT_CROP);
      expect(placed.x).toBeCloseTo(frame.x, 9);
      expect(placed.y).toBeCloseTo(frame.y, 9);
      expect(placed.width).toBeCloseTo(frame.width, 9);
      expect(placed.height).toBeCloseTo(frame.height, 9);
      expect(placed.overflowX).toBeCloseTo(0, 9);
      expect(placed.overflowY).toBeCloseTo(0, 9);
    }
  });

  it.each(cases.filter(item => item.borderless))("$id fills every row with a centred, unstretched crop and no blank background", item => {
    const template = getTemplate(item.id);
    const expectedWidthLoss = item.count === 5 ? 0.1 : 31 / 192;
    for (const frame of resolveFrames(template, template.defaultGutter)) {
      const placed = coverPlacement(item.width, item.height, frame, DEFAULT_CROP);
      expect(placed.height).toBeCloseTo(frame.height, 9);
      expect(placed.y).toBeCloseTo(frame.y, 9);
      expect(placed.width).toBeGreaterThan(frame.width);
      expect(placed.width / placed.height).toBeCloseTo(item.width / item.height, 12);
      expect(placed.x + placed.width / 2).toBeCloseTo(frame.x + frame.width / 2, 9);
      expect(1 - frame.width / placed.width).toBeCloseTo(expectedWidthLoss, 12);
      // Normal panning can choose either edge without exposing background.
      for (const direction of [-1, 1]) {
        const crop = moveCrop(item.width, item.height, frame, DEFAULT_CROP, direction * 10000, 0);
        const panned = coverPlacement(item.width, item.height, frame, crop);
        expect(panned.x).toBeLessThanOrEqual(frame.x + 1e-9);
        expect(panned.x + panned.width).toBeGreaterThanOrEqual(frame.x + frame.width - 1e-9);
      }
    }
  });

  it.each(cases)("$id keeps its geometry in the real picker preview and at editor/thumbnail/export scales", item => {
    const template = getTemplate(item.id);
    const full = resolveFrames(template, template.defaultGutter);
    const markup = renderToStaticMarkup(createElement(TemplateThumbnail, { template }));
    const rects = [...markup.matchAll(/<rect\s([^>]+)>/g)].slice(1);
    expect(rects).toHaveLength(item.count);
    for (const width of [180, 280, 540, 1080, 2160]) {
      const scaled = resolveFrames(template, template.defaultGutter, width, width * 5 / 4);
      scaled.forEach((frame, index) => {
        for (const key of ["x", "y", "width", "height"] as const) {
          expect(frame[key]).toBeCloseTo(full[index][key] * width / 1080, 9);
          if (width === 180) {
            const value = rects[index][1].match(new RegExp(`\\b${key}="([^"]+)"`))?.[1];
            expect(Number(value)).toBeCloseTo(frame[key], 9);
          }
        }
        expect(frame.width / frame.height).toBeCloseTo(item.frameRatio, 12);
      });
    }
  });
});

describe.each(cases)("$name compatibility", group => {
  const template = getTemplate(group.id);

  it("materializes the same exact geometry when copied into the existing template builder", () => {
    const copy = copyAsCustomTemplate(template, []);
    const original = resolveFrames(template, template.defaultGutter);
    const copied = resolveFrames(JSON.parse(JSON.stringify(copy)), copy.defaultGutter);
    expect(copy.id).not.toBe(template.id);
    copied.forEach((frame, index) => {
      expect(frame.id).not.toBe(original[index].id);
      for (const key of ["x", "y", "width", "height", "cornerRadius"] as const) {
        expect(frame[key]).toBeCloseTo(original[index][key], 9);
      }
    });
  });

  it.each([0.6, 1, 1.75])("saves and restores zoom %s, assignments and geometry, even without local bytes", zoom => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const page = filledPage(template, group.width, group.height, zoom);
    const frame = resolveFrames(template, page.gutter)[0];
    // Exercise normal panning after zoom-in, and centering below baseline.
    page.photos[frame.id].crop = moveCrop(group.width, group.height, frame, page.photos[frame.id].crop, 20, -10);
    const project: StoredProject = {
      version: 3, id: "synthetic-project", name: "Panorama test", formatId: template.formatId,
      activePageId: page.id, pages: [serializePage(page)], createdAt: page.createdAt, updatedAt: page.updatedAt,
    };
    saveProjects([project]);
    const [restored] = loadProjects();
    expect(restored).toEqual(project);
    const [unavailable] = reconcileProjectPages(restored);
    expect(unavailable.photos).toEqual({});
    expect(unavailable.unavailablePhotos).toEqual(project.pages[0].photos);
    expect(serializePage(unavailable)).toEqual(project.pages[0]);
    const [rehydrated] = reconcileProjectPages(restored, [page]);
    expect(rehydrated.photos[frame.id].crop).toEqual(page.photos[frame.id].crop);
    expect(resolveFrames(rehydrated.templateSnapshot!, rehydrated.gutter)).toEqual(resolveFrames(template, page.gutter));
    const placement = coverPlacement(group.width, group.height, frame, rehydrated.photos[frame.id].crop);
    const baseline = coverPlacement(group.width, group.height, frame, DEFAULT_CROP);
    expect(placement.width / baseline.width).toBeCloseTo(zoom, 9);
    expect(placement.height / frame.height).toBeCloseTo(zoom, 9);
    if (zoom < 1) {
      expect(placement.x + placement.width / 2).toBeCloseTo(frame.x + frame.width / 2, 9);
      expect(placement.y + placement.height / 2).toBeCloseTo(frame.y + frame.height / 2, 9);
    }
  });

  it.each([1, 0.6, 1.75])("exports JPEG using the same clipping and photo placement as previews at zoom %s", async zoom => {
    const context = {
      fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn(), save: vi.fn(), beginPath: vi.fn(),
      roundRect: vi.fn(), clip: vi.fn(), restore: vi.fn(),
    };
    const canvas = {
      width: 0, height: 0, getContext: () => context,
      toBlob: vi.fn((callback: (value: Blob) => void) => callback(new Blob(["synthetic-jpeg"], { type: "image/jpeg" }))),
    };
    vi.stubGlobal("document", { createElement: () => canvas });
    const drawable = {} as CanvasImageSource;
    const close = vi.fn();
    vi.spyOn(image, "decodeImage").mockResolvedValue({ drawable, width: group.width, height: group.height, close });
    const page = filledPage(template, group.width, group.height, zoom);
    const result = await renderComposition({ format: getFormat(template.formatId), template, ...page });
    expect(result.type).toBe("image/jpeg");
    expect(canvas.width).toBe(1080); expect(canvas.height).toBe(1350);
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.94);
    expect(context.clip).toHaveBeenCalledTimes(group.count);
    expect(close).toHaveBeenCalledTimes(group.count);
    const full = resolveFrames(template, page.gutter);
    full.forEach(frame => expect(context.roundRect).toHaveBeenCalledWith(frame.x, frame.y, frame.width, frame.height, 0));
    for (const width of [280, 540]) {
      // These are the existing shared resolver/draw calls used by the thumbnail and editor.
      const preview = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
      const scaled = resolveFrames(template, page.gutter, width, width * 5 / 4);
      scaled.forEach(frame => drawCroppedPhoto(preview as unknown as CanvasRenderingContext2D,
        drawable, group.width, group.height, frame, page.photos[frame.id].crop, page.background));
      preview.drawImage.mock.calls.forEach((call, index) => {
        for (let coordinate = 1; coordinate <= 4; coordinate++) {
          expect(call[coordinate] * 1080 / width).toBeCloseTo(context.drawImage.mock.calls[index][coordinate], 9);
        }
      });
    }
    if (zoom === 1) {
      // Bordered sources match their clip; borderless sources cover it with a centred side crop.
      full.forEach((frame, index) => {
        const [, x, y, width, height] = context.drawImage.mock.calls[index];
        expect(y).toBeCloseTo(frame.y, 9); expect(height).toBeCloseTo(frame.height, 9);
        if (group.borderless) {
          expect(x).toBeLessThan(frame.x);
          expect(x + width).toBeGreaterThan(frame.x + frame.width);
          expect(width / height).toBeCloseTo(group.width / group.height, 12);
        } else {
          expect(x).toBeCloseTo(frame.x, 9); expect(width).toBeCloseTo(frame.width, 9);
        }
      });
      expect(context.fillRect).toHaveBeenCalledTimes(1);
    }
  });
});
