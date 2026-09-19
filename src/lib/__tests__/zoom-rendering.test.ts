import { afterEach, describe, expect, it, vi } from "vitest";
import { drawCroppedPhoto } from "../draw-photo";
import { renderComposition, renderPagePreview } from "../export";
import * as image from "../image";
import { getFormat } from "../formats";
import { getTemplate } from "../templates";
import type { PhotoAsset, ProjectPage } from "../types";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("shared editor, thumbnail and export drawing", () => {
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
});
