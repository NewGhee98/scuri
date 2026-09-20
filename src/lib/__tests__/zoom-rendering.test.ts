import { afterEach, describe, expect, it, vi } from "vitest";
import { drawCroppedPhoto } from "../draw-photo";
import { renderComposition, renderPagePreview } from "../export";
import * as image from "../image";
import { getFormat } from "../formats";
import { getTemplate } from "../templates";
import type { PhotoAsset, ProjectPage } from "../types";
import { fitCanvas, panCanvas, zoomCanvas } from "../canvas-viewport";
import { serializePage } from "../project-photos";
import { coverPlacement, DEFAULT_CROP, moveCrop, resolveFrames } from "../crop";
import { resolveExportFrames } from "../export-settings";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("shared editor, thumbnail and export drawing", () => {
  it.each([.3, 1, 2])("clips freely moved photos and fills overlapping exposed space at zoom %s at every output size", async zoom => {
    const context = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn(), save: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), clip: vi.fn(), restore: vi.fn() };
    const canvas = { width: 0, height: 0, getContext: () => context, toBlob: (done: (blob: Blob) => void) => done(new Blob(["jpeg"])) };
    vi.stubGlobal("document", { createElement: () => canvas });
    const drawable = {} as CanvasImageSource;
    vi.spyOn(image, "decodeImage").mockResolvedValue({ drawable, width: 800, height: 800, close: vi.fn() });
    const format = getFormat("instagram-square"), base = getTemplate("instagram-square-full-frame");
    const template = { ...base, frames: [{ id: "below", x: 0, y: 0, width: 1, height: 1 }, { id: "above", x: .2, y: .2, width: .6, height: .6 }] };
    const reference = resolveFrames(template, 0), crop = moveCrop(800, 800, reference[1], { ...DEFAULT_CROP, zoom }, 210, -180);
    const original = new Blob(["untouched-synthetic-original"]), photos: Record<string, PhotoAsset> = Object.fromEntries(reference.map(f => [f.id, {
      frameId: f.id, blobKey: "shared-original", sourceBlob: original, previewUrl: "blob:preview", sourceWidth: 800, sourceHeight: 800,
      crop: f.id === "above" ? crop : { ...DEFAULT_CROP } }]));
    const page: ProjectPage = { id: "synthetic", templateId: template.id, templateSnapshot: template, gutter: 0, background: "#eeddaa", selectedFrameId: "above", photos, createdAt: "unchanged", updatedAt: "unchanged" };
    const saved = serializePage(page), expected = coverPlacement(800, 800, reference[1], crop);
    for (const multiple of [1, 2, 3]) {
      const outputSize = { width: 1080 * multiple, height: 1080 * multiple }, frames = resolveExportFrames(format, template, 0, outputSize);
      context.fillRect.mockClear(); context.drawImage.mockClear(); context.roundRect.mockClear(); context.clip.mockClear();
      await renderPagePreview(page, format, template, undefined, outputSize);
      expect(context.drawImage.mock.calls[1][0]).toBe(drawable);
      [expected.x, expected.y, expected.width, expected.height].forEach((v, i) => expect(context.drawImage.mock.calls[1][i + 1]).toBeCloseTo(v * multiple, 8));
      expect(context.roundRect.mock.calls[1]).toEqual([frames[1].x, frames[1].y, frames[1].width, frames[1].height, 0]);
      // The upper frame's background is painted after the lower photo, inside
      // its clip, before its own image. Underlapping photos cannot show through.
      expect(context.fillRect).toHaveBeenCalledTimes(2);
      expect(context.fillRect.mock.calls[1]).toEqual([frames[1].x, frames[1].y, frames[1].width, frames[1].height]);
      expect(context.fillStyle).toBe(page.background);
      expect(context.clip.mock.invocationCallOrder[1]).toBeLessThan(context.fillRect.mock.invocationCallOrder[1]);
      expect(context.drawImage.mock.invocationCallOrder[0]).toBeLessThan(context.fillRect.mock.invocationCallOrder[1]);
      expect(context.fillRect.mock.invocationCallOrder[1]).toBeLessThan(context.drawImage.mock.invocationCallOrder[1]);
      const previewDraws = context.drawImage.mock.calls;
      context.drawImage.mockClear(); await renderComposition({ format, template, ...page, outputSize });
      expect(context.drawImage.mock.calls).toEqual(previewDraws);
      expect(serializePage(page)).toEqual(saved);
    }
    for (const width of [280, 540, 1080]) {
      const frame = resolveFrames(template, 0, width, width)[1]; context.drawImage.mockClear();
      drawCroppedPhoto(context as unknown as CanvasRenderingContext2D, drawable, 800, 800, frame, crop, page.background);
      const call = context.drawImage.mock.calls[0];
      [expected.x, expected.y, expected.width, expected.height].forEach((v, i) => expect(call[i + 1] * 1080 / width).toBeCloseTo(v));
    }
    expect(vi.mocked(image.decodeImage).mock.calls.every(([blob]) => blob === original)).toBe(true);
  });
  it("paints exposed frame space with the page background and preserves legacy drawing", () => {
    const context = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
    const drawable = {} as CanvasImageSource;
    const frame = { id: "f", x: 10, y: 20, width: 400, height: 400, cornerRadius: 0 };
    drawCroppedPhoto(context as unknown as CanvasRenderingContext2D, drawable, 3000, 1000, frame, { zoom: 0.2, positionX: 0, positionY: 0 }, "#eeddbb");
    expect(context.fillStyle).toBe("#eeddbb"); expect(context.fillRect).toHaveBeenCalledWith(10, 20, 400, 400);
    const [, x, y, width, height] = context.drawImage.mock.calls[0];
    expect(x).toBeCloseTo(90); expect(y).toBeCloseTo(180); expect(width).toBeCloseTo(240); expect(height).toBeCloseTo(80);
    context.fillRect.mockClear();
    drawCroppedPhoto(context as unknown as CanvasRenderingContext2D, drawable, 3000, 1000, frame, { zoom: 1, positionX: 0.5, positionY: 0 }, "#eeddbb");
    expect(context.fillRect).not.toHaveBeenCalled();
    expect(context.drawImage).toHaveBeenLastCalledWith(drawable, -190, 20, 1200, 400);
  });
  it("the export path clips the unchanged frame and draws the centred panorama at its saved scale", async () => {
    const context = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn(), save: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), clip: vi.fn(), restore: vi.fn() };
    const canvas = { width: 0, height: 0, getContext: () => context, toBlob: (callback: (value: Blob) => void) => callback(new Blob(["synthetic-export"])) };
    vi.stubGlobal("document", { createElement: () => canvas });
    const drawable = {} as CanvasImageSource;
    vi.spyOn(image, "decodeImage").mockResolvedValue({ drawable, width: 3000, height: 1000, close: vi.fn() });
    const photo: PhotoAsset = { frameId: "photo-1", blobKey: "synthetic", sourceBlob: new Blob(["synthetic"]), previewUrl: "blob:synthetic", sourceWidth: 3000, sourceHeight: 1000,
      crop: { positionX: 0, positionY: 0, zoom: 0.2 } };
    await renderComposition({ format: getFormat("instagram-square"), template: getTemplate("instagram-square-full-frame"), background: "#eeddbb", gutter: 0, photos: { "photo-1": photo } });
    expect(context.roundRect).toHaveBeenCalledWith(0, 0, 1080, 1080, 0);
    const [, x, y, width, height] = context.drawImage.mock.calls[0];
    expect(x).toBeCloseTo(216); expect(y).toBeCloseTo(432); expect(width).toBeCloseTo(648); expect(height).toBeCloseTo(216);
    expect(context.fillStyle).toBe("#eeddbb"); expect(context.clip).toHaveBeenCalledOnce();
  });

  it("page Preview renders full-resolution original bytes, never the display URL or editor guides", async () => {
    const context = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn(), save: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), clip: vi.fn(), restore: vi.fn(), stroke: vi.fn() };
    const canvas = { width: 0, height: 0, getContext: () => context, toBlob: (callback: (value: Blob) => void) => callback(new Blob(["full-resolution-jpeg"])) };
    vi.stubGlobal("document", { createElement: () => canvas });
    const drawable = {} as CanvasImageSource, close = vi.fn();
    vi.spyOn(image, "decodeImage").mockResolvedValue({ drawable, width: 6400, height: 1440, close });
    const sourceBlob = new Blob(["original-only"]);
    const photo: PhotoAsset = { frameId: "photo-1", blobKey: "synthetic", sourceBlob, previewUrl: "blob:low-resolution-display-only",
      sourceWidth: 6400, sourceHeight: 1440, crop: { positionX: 0, positionY: 0, zoom: 0.8765433 } };
    const page: ProjectPage = { id: "p", templateId: "instagram-square-full-frame", background: "#fff", gutter: 0, selectedFrameId: photo.frameId,
      photos: { [photo.frameId]: photo }, createdAt: "2026-09-18", updatedAt: "2026-09-18" };
    // Selection tint must not enter the original-byte renderer used by both
    // clean page previews and downloaded JPEGs, including negative zoom space.
    context.fillRect.mockImplementation(() => expect(context.fillStyle).toBe(page.background));
    await renderPagePreview(page, getFormat("instagram-square"), getTemplate(page.templateId));
    expect(image.decodeImage).toHaveBeenCalledExactlyOnceWith(sourceBlob);
    expect(canvas.width).toBe(1080); expect(canvas.height).toBe(1080);
    expect(context.drawImage.mock.calls[0][0]).toBe(drawable);
    expect(context.stroke).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
    expect(context.fillRect).toHaveBeenCalledTimes(2);
  });

  it("canvas view changes preserve stored crops and produce identical original-quality output geometry", async () => {
    const context = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn(), save: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), clip: vi.fn(), restore: vi.fn() };
    const canvas = { width: 0, height: 0, getContext: () => context, toBlob: (callback: (value: Blob) => void) => callback(new Blob(["jpeg"])) };
    vi.stubGlobal("document", { createElement: () => canvas });
    const drawable = {} as CanvasImageSource, original = new Blob(["original-bytes"]);
    vi.spyOn(image, "decodeImage").mockResolvedValue({ drawable, width: 6400, height: 1440, close: vi.fn() });
    const photo: PhotoAsset = { frameId: "photo-1", blobKey: "synthetic", sourceBlob: original, previewUrl: "blob:tiny",
      sourceWidth: 6400, sourceHeight: 1440, crop: { zoom: .72, positionX: 0, positionY: 0 } };
    const page: ProjectPage = { id: "p", templateId: "instagram-square-full-frame", background: "#202020", gutter: 32,
      photos: { [photo.frameId]: photo }, selectedFrameId: photo.frameId, createdAt: "unchanged", updatedAt: "unchanged" };
    const before = serializePage(page), format = getFormat("instagram-square"), template = getTemplate(page.templateId);
    const output = { width: 3240, height: 3240 }, stage = { width: 800, height: 650 };
    const views = [fitCanvas(stage, output), zoomCanvas(fitCanvas(stage, output), 1, { x: 400, y: 325 }, stage, output)];
    views.push(panCanvas(zoomCanvas(views[1], 4, { x: 300, y: 200 }, stage, output), -400, 900, stage, output));
    const renders = [];
    for (const view of views) {
      expect(view.scale).toBeGreaterThan(0);
      context.roundRect.mockClear(); context.drawImage.mockClear();
      await renderPagePreview(page, format, template, undefined, output);
      renders.push({ width: canvas.width, height: canvas.height, clips: context.roundRect.mock.calls, draws: context.drawImage.mock.calls });
      expect(serializePage(page)).toEqual(before);
    }
    expect(renders[0].width).toBe(3240); expect(renders[0].height).toBe(3240);
    expect(renders[1]).toEqual(renders[0]); expect(renders[2]).toEqual(renders[0]);
    expect(vi.mocked(image.decodeImage).mock.calls.every(([blob]) => blob === original)).toBe(true);
  });
});
