import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PagePreview } from "../../components/page-preview";
import { coverPlacement, DEFAULT_CROP, resolveFrames } from "../crop";
import { createExportFilename, renderComposition, renderPagePreview } from "../export";
import { assessPageExportQuality, exportWidthStep, getExportSize, maximumExportWidth, resolveExportFrames } from "../export-settings";
import { FORMATS, getFormat } from "../formats";
import * as image from "../image";
import { movePageFrame } from "../page-frames";
import { reconcileProjectPages, serializePage } from "../project-photos";
import { TEMPLATES, getTemplate } from "../templates";
import type { PhotoAsset, ProjectPage, TemplateDefinition } from "../types";

vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useState: vi.fn(actual.useState) };
});

const portrait = getFormat("instagram-post");
const square = getFormat("instagram-square");
const squareTemplate = getTemplate("instagram-square-full-frame");
const standardPano = getTemplate("instagram-post-pano-40-9-5");
const ultraPano = getTemplate("instagram-post-ultra-pano-768-115-7");

function filledPage(template: TemplateDefinition, width = 6400, height = 1440, zoom = 1): ProjectPage {
  return {
    id: "synthetic-page", templateId: template.id, templateSnapshot: template, background: "#eeddbb",
    gutter: template.defaultGutter, selectedFrameId: template.frames[0].id, createdAt: "2026-09-18", updatedAt: "2026-09-18",
    photos: Object.fromEntries(template.frames.map(frame => [frame.id, {
      frameId: frame.id, blobKey: "shared-original", sourceBlob: new Blob(["synthetic-original"]), previewUrl: "blob:low-resolution-preview",
      sourceName: "synthetic-panorama.jpg", sourceWidth: width, sourceHeight: height, crop: { positionX: 0.5, positionY: -0.4, zoom },
    } satisfies PhotoAsset])),
  };
}

function mockCanvas() {
  const context = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn(), save: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), clip: vi.fn(), restore: vi.fn() };
  const blob = new Blob(["synthetic-jpeg"], { type: "image/jpeg" });
  const canvas = { width: 0, height: 0, getContext: () => context, toBlob: vi.fn((callback: (value: Blob) => void) => callback(blob)) };
  vi.stubGlobal("document", { createElement: () => canvas });
  return { context, canvas, blob };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("export-only output sizes", () => {
  it.each(FORMATS)("keeps the $aspectRatio page ratio at standard, 2x, 3x and custom widths", format => {
    for (const requested of [format.width, format.width * 2, format.width * 3, 2401, maximumExportWidth(format)]) {
      const size = getExportSize(format, requested);
      expect(Number.isInteger(size.width)).toBe(true);
      expect(Number.isInteger(size.height)).toBe(true);
      expect(size.width * format.height).toBe(size.height * format.width);
      expect(Math.abs(size.width - requested)).toBeLessThanOrEqual(exportWidthStep(format) / 2);
      expect(size.width * size.height).toBeLessThanOrEqual(20_000_000);
      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(8192);
    }
    expect(getExportSize(format)).toEqual({ width: format.width, height: format.height });
    for (const bad of [0, -1, NaN, Infinity, 999_999]) expect(() => getExportSize(format, bad)).toThrow("Choose a width");
  });

  it("supports a 2400x3000 output without changing the 1080x1350 format", () => {
    const before = { ...portrait };
    expect(getExportSize(portrait, 2400)).toEqual({ width: 2400, height: 3000 });
    expect(portrait).toEqual(before);
    expect(() => resolveExportFrames(portrait, standardPano, 0, { width: 2400, height: 2400 })).toThrow("aspect ratio");
  });

  it("keeps legacy filenames and distinguishes larger JPEGs by actual dimensions", () => {
    const legacy = createExportFilename(portrait, 2);
    expect(createExportFilename(portrait, 2, getExportSize(portrait))).toBe(legacy);
    expect(createExportFilename(portrait, 2, getExportSize(portrait, 2400))).toBe(legacy.replace(".jpg", "-2400x3000.jpg"));
  });
});

describe("proportional export geometry", () => {
  it("scales every built-in frame, gutter, border and corner radius without changing the baseline", () => {
    for (const template of TEMPLATES) {
      const format = getFormat(template.formatId);
      const baseline = resolveFrames(template, template.defaultGutter, format.width, format.height);
      expect(resolveExportFrames(format, template, template.defaultGutter, getExportSize(format))).toEqual(baseline);
      for (const multiplier of [2, 3]) {
        const frames = resolveExportFrames(format, template, template.defaultGutter, getExportSize(format, format.width * multiplier));
        frames.forEach((frame, index) => {
          expect(frame.id).toBe(baseline[index].id);
          for (const key of ["x", "y", "width", "height", "cornerRadius"] as const) expect(frame[key]).toBeCloseTo(baseline[index][key] * multiplier, 9);
          for (const crop of [DEFAULT_CROP, { zoom: 0.2765433, positionX: 0.9, positionY: -0.4 }, { zoom: 2.4, positionX: -0.7, positionY: 0.9 }]) {
            const a = coverPlacement(1536, 230, baseline[index], crop), b = coverPlacement(1536, 230, frame, crop);
            for (const key of ["x", "y", "width", "height"] as const) expect(b[key]).toBeCloseTo(a[key] * multiplier, 7);
          }
        });
      }
    }
  });

  it("preserves moved overlapping custom frames, rounded corners and minimum-size frames", () => {
    const template: TemplateDefinition = { ...standardPano, id: "custom", frames: [
      { id: "a", x: 0.1, y: 0.1, width: 0.6, height: 0.5, cornerRadius: 0.2 },
      { id: "b", x: 0.3, y: 0.3, width: 0.5, height: 0.6, cornerRadius: 0.1 },
      { id: "tiny", x: 0.5, y: 0.5, width: 0.00001, height: 0.00001 },
    ] };
    const page = movePageFrame(filledPage(template), template, "a", 30, 50);
    const snapshot = page.templateSnapshot!;
    const before = JSON.stringify(serializePage(page));
    const base = resolveExportFrames(portrait, snapshot, page.gutter, getExportSize(portrait));
    const larger = resolveExportFrames(portrait, snapshot, page.gutter, getExportSize(portrait, 2400));
    larger.forEach((frame, index) => {
      for (const key of ["x", "y", "width", "height", "cornerRadius"] as const) expect(frame[key]).toBeCloseTo(base[index][key] * 2400 / 1080, 9);
    });
    expect(larger.map(frame => frame.id)).toEqual(["a", "b", "tiny"]);
    expect(JSON.stringify(serializePage(page))).toBe(before);
  });
});

describe("advisory photo resolution assessment", () => {
  it("distinguishes the user's two panorama source sizes at 2x export", () => {
    const standard = filledPage(standardPano, 6400, 1440);
    const ultra = filledPage(ultraPano, 1536, 230);
    expect(assessPageExportQuality(standard, portrait, standardPano, getExportSize(portrait, 2160)).every(p => p.status === "sufficient")).toBe(true);
    const checks = assessPageExportQuality(ultra, portrait, ultraPano, getExportSize(portrait, 2160));
    expect(checks).toHaveLength(7);
    for (const check of checks) {
      expect(check.status).toBe("soft");
      expect(check.enlargement).toBeCloseTo(2032 / 1536);
      expect(check.visibleSourceWidth).toBeCloseTo(1536);
      expect(check.visibleSourceHeight).toBeCloseTo(230);
      expect(check.visibleOutputWidth).toBeCloseTo(2032);
    }
    expect(assessPageExportQuality(ultra, portrait, ultraPano, getExportSize(portrait)).every(p => p.status === "sufficient")).toBe(true);
  });

  it("checks the cropped source region, rather than the total number of source pixels", () => {
    const page = filledPage(squareTemplate, 3000, 1000);
    page.gutter = 0;
    const [check] = assessPageExportQuality(page, square, squareTemplate, getExportSize(square));
    expect(check.status).toBe("soft");
    expect(check.enlargement).toBeCloseTo(1.08);
    expect(check.visibleSourceWidth).toBeCloseTo(1000);
    expect(check.visibleSourceHeight).toBeCloseTo(1000);
    expect(check.visibleOutputWidth).toBe(1080);
  });

  it("does not count negative-zoom background bands as pixels needing source detail", () => {
    const page = filledPage(squareTemplate, 3000, 1000, 1 / 3);
    page.gutter = 0;
    const [check] = assessPageExportQuality(page, square, squareTemplate, getExportSize(square));
    expect(check.status).toBe("sufficient");
    expect(check.enlargement).toBeCloseTo(0.36);
    expect(check.visibleSourceWidth).toBeCloseTo(3000);
    expect(check.visibleSourceHeight).toBeCloseTo(1000);
    expect(check.visibleOutputWidth).toBeCloseTo(1080);
    expect(check.visibleOutputHeight).toBeCloseTo(360);
  });

  it("assesses repeated placements of the same photo separately, including saved zoom", () => {
    const template = { ...squareTemplate, frames: [{ ...squareTemplate.frames[0], id: "a" }, { ...squareTemplate.frames[0], id: "b" }] };
    const page = filledPage(template, 2000, 2000);
    page.gutter = 0;
    page.photos.b.crop = { zoom: 2, positionX: -1, positionY: 1 };
    const checks = assessPageExportQuality(page, square, template, getExportSize(square));
    expect(checks.map(photo => photo.status)).toEqual(["sufficient", "soft"]);
    expect(checks[1].visibleSourceWidth).toBeCloseTo(1000);
    expect(checks[1].visibleSourceHeight).toBeCloseTo(1000);
  });

  it("keeps unavailable assignments distinct from empty frames and uncheckable dimensions", () => {
    const page = filledPage(standardPano);
    const ids = standardPano.frames.map(frame => frame.id);
    page.unavailablePhotos = { [ids[0]]: serializePage(page).photos[ids[0]] };
    delete page.photos[ids[0]];
    delete page.photos[ids[1]];
    page.photos[ids[2]].sourceWidth = 0;
    page.photos[ids[3]].sourceHeight = NaN;
    const checks = assessPageExportQuality(page, portrait, standardPano, getExportSize(portrait));
    expect(checks.map(photo => photo.status)).toEqual(["unavailable", "unknown", "unknown", "sufficient"]);
    expect(checks.map(photo => photo.frameNumber)).toEqual([1, 3, 4, 5]);
    expect(page.unavailablePhotos[ids[0]].blobKey).toBe("shared-original");
  });

  it("never changes the saved crop/arrangement or timestamps when checking sizes", () => {
    const page = filledPage(standardPano, 6400, 1440, 0.8765433);
    const before = serializePage(page);
    for (const width of [1080, 2160, 3240, 2400]) assessPageExportQuality(page, portrait, standardPano, getExportSize(portrait, width));
    const restored = reconcileProjectPages({ version: 3, id: "synthetic", name: "Synthetic", formatId: portrait.id,
      activePageId: page.id, pages: [before], createdAt: page.createdAt, updatedAt: page.updatedAt }, [page]);
    expect(serializePage(page)).toEqual(before);
    expect(serializePage(restored[0])).toEqual(before);
  });
});

describe("settings-aware original-byte JPEG rendering", () => {
  it("renders preview and export with identical custom output geometry, without mutating the page", async () => {
    const { canvas, context, blob } = mockCanvas();
    const page = filledPage(ultraPano, 1536, 230, 0.8765433);
    const before = serializePage(page);
    const close = vi.fn(), drawable = {} as CanvasImageSource;
    const decode = vi.spyOn(image, "decodeImage").mockResolvedValue({ width: 1536, height: 230, drawable, close });
    const size = getExportSize(portrait, 2400);
    expect(await renderPagePreview(page, portrait, ultraPano, undefined, size)).toBe(blob);
    expect(canvas.width).toBe(2400); expect(canvas.height).toBe(3000);
    const previewFrames = [...context.roundRect.mock.calls], previewDraws = [...context.drawImage.mock.calls];
    context.roundRect.mockClear(); context.drawImage.mockClear();
    expect(await renderComposition({ format: portrait, template: ultraPano, ...page, outputSize: size })).toBe(blob);
    expect(context.roundRect.mock.calls).toEqual(previewFrames);
    expect(context.drawImage.mock.calls).toEqual(previewDraws);
    for (const [source] of decode.mock.calls) expect(source).toBeInstanceOf(Blob);
    expect(decode.mock.calls.map(([source]) => source)).toEqual([...Object.values(page.photos), ...Object.values(page.photos)].map(photo => photo.sourceBlob));
    expect(close).toHaveBeenCalledTimes(14);
    expect(canvas.toBlob).toHaveBeenLastCalledWith(expect.any(Function), "image/jpeg", 0.94);
    expect(serializePage(page)).toEqual(before);
  });

  it("does not block a low-resolution original from exporting", async () => {
    const { blob } = mockCanvas();
    const page = filledPage(squareTemplate, 100, 100);
    vi.spyOn(image, "decodeImage").mockResolvedValue({ width: 100, height: 100, drawable: {} as CanvasImageSource, close: vi.fn() });
    expect(assessPageExportQuality(page, square, squareTemplate, getExportSize(square, 2160))[0].status).toBe("soft");
    await expect(renderPagePreview(page, square, squareTemplate, undefined, getExportSize(square, 2160))).resolves.toBe(blob);
  });

  it("still refuses missing originals and invalid geometry, rather than exporting a cached preview", async () => {
    const { context } = mockCanvas();
    const page = filledPage(squareTemplate);
    const id = squareTemplate.frames[0].id;
    page.unavailablePhotos = { [id]: serializePage(page).photos[id] };
    delete page.photos[id];
    await expect(renderPagePreview(page, square, squareTemplate, undefined, getExportSize(square, 2160))).rejects.toThrow("unavailable");
    await expect(renderComposition({ format: square, template: squareTemplate, ...page, outputSize: { width: 2160, height: 1080 } })).rejects.toThrow("aspect ratio");
    expect(context.drawImage).not.toHaveBeenCalled();
  });

  it("closes a decoded original when the size/page changes during an in-flight preview", async () => {
    mockCanvas();
    const abort = new AbortController(), close = vi.fn();
    vi.spyOn(image, "decodeImage").mockImplementation(async () => {
      abort.abort(new Error("Superseded preview"));
      return { width: 100, height: 100, drawable: {} as CanvasImageSource, close };
    });
    await expect(renderPagePreview(filledPage(squareTemplate), square, squareTemplate, abort.signal, getExportSize(square, 2160))).rejects.toThrow("Superseded preview");
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("export review presentation", () => {
  function markup(page: ProjectPage, width: number) {
    return renderToStaticMarkup(createElement(PagePreview, { pages: [page], initialPageId: page.id, format: square,
      resolveTemplate: () => squareTemplate, outputWidth: width, onOutputWidthChange: vi.fn(), pageNumbers: [7], onExport: vi.fn(), onClose: vi.fn() }));
  }
  it("names the actual page/frame, shows selected dimensions and leaves export enabled for softness warnings", () => {
    const html = markup(filledPage(squareTemplate, 100, 100), 2160);
    expect(html).toContain("2160 × 2160 pixels");
    expect(html).toContain("Page 7 · Frame 1");
    expect(html).toContain("synthetic-panorama.jpg");
    expect(html).toContain("May look soft");
    expect(html).toContain("100% detail");
    const action = html.match(/<button[^>]*>Create JPEG<\/button>/)?.[0];
    expect(action).toBeDefined();
    expect(action).not.toContain("disabled");
  });
  it("disables invalid output dimensions and never reports unavailable originals as sufficient", () => {
    expect(markup(filledPage(squareTemplate), 99999).match(/<button[^>]*>Create JPEG<\/button>/)?.[0]).toContain("disabled");
    const page = filledPage(squareTemplate), id = squareTemplate.frames[0].id;
    page.unavailablePhotos = { [id]: serializePage(page).photos[id] }; delete page.photos[id];
    const html = markup(page, 1080);
    expect(html).toContain("Original still loading");
    expect(html).not.toContain("Enough source pixels");
    expect(html.match(/<button[^>]*>Create JPEG<\/button>/)?.[0]).toContain("disabled");
  });
  it("keeps page labels and navigation in bounds if the reviewed page list shrinks", () => {
    vi.mocked(React.useState).mockReturnValueOnce([5, vi.fn()]);
    const html = markup(filledPage(squareTemplate), 1080);
    expect(html).toContain("Page 7 · 1080 × 1080");
    expect(html.match(/<button[^>]*>Previous<\/button>/)?.[0]).toContain("disabled");
    expect(html.match(/<button[^>]*>Next<\/button>/)?.[0]).toContain("disabled");
  });
});
