import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CROP, coverPlacement, resolveFrames, setCropZoom } from "../crop";
import { parseZoomPercent, snapFramePosition, snapPhotoZoom, visiblePhotoBounds } from "../editor-alignment";
import { movePageFrame, reorderPageFrame } from "../page-frames";
import { renderPagePreview, renderComposition } from "../export";
import { drawCroppedPhoto } from "../draw-photo";
import { ProjectHistory } from "../project-history";
import { reconcileProjectPages, serializePage } from "../project-photos";
import { loadProjects, saveProjects } from "../storage";
import { getFormat } from "../formats";
import { getTemplatesForFormat } from "../templates";
import * as image from "../image";
import type { PhotoAsset, ProjectPage, ResolvedFrame, StoredProject, TemplateDefinition } from "../types";

const timestamp = "2026-09-16T10:00:00.000Z";
const frame = (id: string, x = 0, y = 0, width = 400, height = 200): ResolvedFrame => ({ id, x, y, width, height, cornerRadius: 0 });
const photo = (id: string, width = 800, height = 400, zoom = 1): PhotoAsset => ({ frameId: id, blobKey: `synthetic-${id}`,
  sourceBlob: new Blob(["synthetic original"]), previewUrl: `blob:synthetic-${id}`, sourceWidth: width, sourceHeight: height,
  crop: { positionX: 0, positionY: 0, zoom } });
const custom: TemplateDefinition = { id: "synthetic-custom", name: "Synthetic", formatId: "instagram-post", canvasWidth: 1080, canvasHeight: 1350,
  defaultBackground: "#eddcba", defaultGutter: 32, frameInsetMultiplier: 1.3, outerInsetMultiplier: 0.8,
  frames: [{ id: "a", x: 0, y: 0, width: 1, height: 0.4, cornerRadius: 0.07 },
    { id: "b", x: 0, y: 0.6, width: 1, height: 0.4, cornerRadius: 0.12 }] };
function filledPage(template = custom): ProjectPage {
  return { id: "synthetic-page", templateId: template.id, templateSnapshot: structuredClone(template), gutter: template.defaultGutter,
    background: "#eddcba", createdAt: timestamp, updatedAt: timestamp, selectedFrameId: template.frames[0].id,
    photos: Object.fromEntries(template.frames.map((f, i) => [f.id, { ...photo(f.id, 6400, 1440, i % 2 ? 1.72 : 0.673891),
      cloudAssetId: `synthetic-row-${i}`, driveOriginalId: `synthetic-original-${i}`, drivePreviewId: `synthetic-preview-${i}`,
      crop: { positionX: 0.321, positionY: -0.78, zoom: i % 2 ? 1.72 : 0.673891 } }])) };
}
const stored = (page: ProjectPage): StoredProject => ({ version: 3, id: "synthetic-project", name: "Synthetic editing", formatId: "instagram-post",
  activePageId: page.id, pages: [serializePage(page)], createdAt: timestamp, updatedAt: timestamp });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("visible-edge zoom snapping", () => {
  it("aligns differently proportioned stacked photos by their actual visible sides", () => {
    const frames = [frame("a"), frame("b", 0, 300)];
    const photos = { a: photo("a", 800, 400, 0.8), b: photo("b", 1600, 400) };
    const before = structuredClone(photos);
    // The wider photo needs 40% scale to match the 80%-scale photo's visible width.
    const result = snapPhotoZoom(photos, frames, "b", 0.408, 5)!;
    expect(result.crop.zoom).toBeCloseTo(0.4, 12);
    expect(result.guides).toEqual(expect.arrayContaining([{ axis: "x", value: 40 }, { axis: "x", value: 360 }]));
    const a = visiblePhotoBounds(photos.a, frames[0]);
    const b = visiblePhotoBounds({ ...photos.b, crop: result.crop }, frames[1]);
    expect(b.left).toBeCloseTo(a.left); expect(b.right).toBeCloseTo(a.right);
    expect(photos).toEqual(before); // Only the caller's selected crop may be replaced.
  });
  it("aligns top/bottom image edges on side-by-side frames", () => {
    const frames = [frame("a", 0, 0, 200, 400), frame("b", 300, 0, 200, 400)];
    const photos = { a: photo("a", 200, 400, 0.7), b: photo("b", 200, 800) };
    const result = snapPhotoZoom(photos, frames, "b", 0.359, 5)!;
    expect(result.crop.zoom).toBeCloseTo(0.35);
    expect(result.guides).toEqual(expect.arrayContaining([{ axis: "y", value: 60 }, { axis: "y", value: 340 }]));
  });
  it("targets clipped visible edges rather than invisible source edges", () => {
    const frames = [frame("a"), frame("b", 0, 300)];
    const photos = { a: photo("a", 1600, 400, 2), b: photo("b", 1600, 400) };
    expect(visiblePhotoBounds(photos.a, frames[0])).toEqual({ left: 0, right: 400, top: 0, bottom: 200 });
    expect(snapPhotoZoom(photos, frames, "b", 0.51, 5)!.crop.zoom).toBe(0.5);
    expect(snapPhotoZoom(photos, frames, "b", 0.54, 5)!.crop.zoom).toBe(0.54);
  });
  it("releases outside the gentle threshold and honours the toggle/Alt bypass", () => {
    const frames = [frame("a"), frame("b", 0, 300)];
    const photos = { a: photo("a", 800, 400, 0.8), b: photo("b") };
    expect(snapPhotoZoom(photos, frames, "b", 0.819, 5)!.crop.zoom).toBe(0.8);
    expect(snapPhotoZoom(photos, frames, "b", 0.83, 5)!).toEqual({ crop: setCropZoom(DEFAULT_CROP, 0.83), guides: [] });
    expect(snapPhotoZoom(photos, frames, "b", 0.819, -1)!.crop.zoom).toBe(0.819);
    expect(snapPhotoZoom(photos, frames, "b", 1.4, 5)!.crop.zoom).toBe(1.4);
  });
  it("ignores empty/unavailable frames and bounds the selected scale", () => {
    const frames = [frame("a"), frame("b", 0, 300)];
    expect(snapPhotoZoom({ b: photo("b") }, frames, "b", 0.81, 5)!.guides).toEqual([]);
    expect(snapPhotoZoom({ b: photo("b") }, frames, "a", 0.81, 5)).toBeNull();
    expect(snapPhotoZoom({ b: photo("b") }, frames, "b", NaN, 5)).toBeNull();
    expect(snapPhotoZoom({ b: photo("b") }, frames, "b", -1, 5, 0.1)!.crop.zoom).toBe(0.1);
    expect(snapPhotoZoom({ b: photo("b") }, frames, "b", 20, 5)!.crop.zoom).toBe(4);
  });
  it("accepts exact typed negative decimals without snapping or silently clamping", () => {
    expect(parseZoomPercent(" -12.34567% ", 0.1)).toBeCloseTo(0.8765433, 14);
    expect(parseZoomPercent("0", 0.1)).toBe(1);
    expect(parseZoomPercent("300", 0.1)).toBe(4);
    expect(parseZoomPercent("-90", 0.1)).toBeCloseTo(0.1);
    for (const text of ["", "-", "1e3", "abc", "Infinity", "-100", "301", "-91"]) expect(parseZoomPercent(text, 0.1)).toBeNull();
  });
});

describe("page frame movement", () => {
  it("allows overlap, snaps edges gently, releases and clamps to the page", () => {
    const a = frame("a", 30, 20), b = frame("b", 80, 300);
    expect(snapFramePosition(a, [a, b], 78, 250, 1080, 1350, 5)).toEqual({ x: 80, y: 250, guides: [{ axis: "x", value: 80 }] });
    expect(snapFramePosition(a, [a, b], 86, 250, 1080, 1350, 5).x).toBe(86);
    expect(snapFramePosition(a, [a, b], 78, 250, 1080, 1350, -1).x).toBe(78);
    expect(snapFramePosition(a, [a, b], -50, 2000, 1080, 1350, -1)).toEqual({ x: 0, y: 1150, guides: [] });
  });
  it.each([...getTemplatesForFormat("instagram-post"), custom])("preserves $id rendered sizes, assignments, crops and untouched template definitions", template => {
    const original = structuredClone(template), page = filledPage(template), originalPage = serializePage(page);
    const before = resolveFrames(template, page.gutter), selected = before[0];
    const moved = movePageFrame(page, template, selected.id, selected.x + 10, selected.y + 50);
    const after = resolveFrames(moved.templateSnapshot!, moved.gutter);
    expect(moved.photos).toBe(page.photos);
    expect(serializePage(moved).photos).toEqual(originalPage.photos);
    expect(template).toEqual(original); expect(serializePage(page)).toEqual(originalPage);
    after.forEach((f, index) => {
      expect(f.width).toBeCloseTo(before[index].width, 10); expect(f.height).toBeCloseTo(before[index].height, 10);
      expect(f.cornerRadius).toBeCloseTo(before[index].cornerRadius, 10);
      if (index > 0) { expect(f.x).toBeCloseTo(before[index].x, 10); expect(f.y).toBeCloseTo(before[index].y, 10); }
    });
    const b = coverPlacement(6400, 1440, selected, page.photos[selected.id].crop);
    const a = coverPlacement(6400, 1440, after[0], moved.photos[selected.id].crop);
    expect(a.width).toBeCloseTo(b.width, 9); expect(a.height).toBeCloseTo(b.height, 9);
    expect(a.x - after[0].x).toBeCloseTo(b.x - selected.x, 9); expect(a.y - after[0].y).toBeCloseTo(b.y - selected.y, 9);
  });
  it("leaves a no-op untouched, including legacy snapshots and gutter values", () => {
    const page = filledPage(), f = resolveFrames(custom, page.gutter)[0];
    expect(movePageFrame(page, custom, f.id, f.x, f.y)).toBe(page);
    expect(movePageFrame(page, custom, f.id, NaN, 0)).toBe(page);
    expect(movePageFrame(page, custom, "unknown", 20, 30)).toBe(page);
    expect(reorderPageFrame(page, custom, f.id, -1)).toBe(page);
  });
  it("moves/reorders even unavailable assignments without replacing their identities", () => {
    const project = stored(filledPage()), [page] = reconcileProjectPages(project);
    const moved = movePageFrame(page, custom, "a", 40, 600);
    const reordered = reorderPageFrame(moved, moved.templateSnapshot!, "a", 1);
    expect(reordered.templateSnapshot!.frames.map(f => f.id)).toEqual(["b", "a"]);
    expect(reordered.unavailablePhotos).toBe(page.unavailablePhotos);
    expect(serializePage(reordered).photos).toEqual(project.pages[0].photos);
    const frames = resolveFrames(reordered.templateSnapshot!, reordered.gutter);
    expect(frames.find(f => f.id === "a")!.y + frames.find(f => f.id === "a")!.height).toBeGreaterThan(frames.find(f => f.id === "b")!.y);
  });
  it("round-trips moved geometry and exact crops through cache, missing bytes, hydration and undo/redo", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v) });
    const page = filledPage(), original = stored(page), moved = stored(movePageFrame(page, custom, "a", 40, 600));
    saveProjects([moved], "synthetic-owner");
    const [restored] = loadProjects("synthetic-owner");
    expect(restored).toEqual(moved);
    const missing = reconcileProjectPages(restored);
    expect(serializePage(missing[0])).toEqual(moved.pages[0]);
    const hydrated = reconcileProjectPages(restored, [page]);
    expect(serializePage(hydrated[0])).toEqual(moved.pages[0]);
    const history = new ProjectHistory(); history.reset(original); history.observe(moved);
    const undone = history.travel("undo", moved, "2026-09-16T10:01:00Z")!;
    expect(undone.pages[0].photos).toEqual(original.pages[0].photos);
    expect(undone.pages[0].gutter).toBe(original.pages[0].gutter);
    expect(undone.pages[0].templateSnapshot).toEqual(original.pages[0].templateSnapshot);
    expect(undone.pendingDeletions).toBeUndefined();
    expect(history.travel("redo", undone, "2026-09-16T10:02:00Z")!.pages[0].templateSnapshot).toEqual(moved.pages[0].templateSnapshot);
  });
});

describe("export-faithful read-only preview", () => {
  it("stops obsolete previews between decodes and releases the decoded original", async () => {
    const context = { fillRect: vi.fn(), drawImage: vi.fn() }, toBlob = vi.fn();
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => context, toBlob }) });
    const abort = new AbortController(), close = vi.fn();
    const decode = vi.spyOn(image, "decodeImage").mockImplementation(async () => {
      abort.abort(); return { drawable: {} as CanvasImageSource, width: 6400, height: 1440, close };
    });
    const page = filledPage(), before = serializePage(page);
    await expect(renderPagePreview(page, getFormat("instagram-post"), custom, abort.signal)).rejects.toThrow();
    expect(decode).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1);
    expect(context.drawImage).not.toHaveBeenCalled(); expect(toBlob).not.toHaveBeenCalled();
    expect(serializePage(page)).toEqual(before);
  });
  it("uses identical JPEG geometry/order for moved overlapping frames, editor and thumbnails without editing a page", async () => {
    const context = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn(), save: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), clip: vi.fn(), restore: vi.fn() };
    const canvas = { width: 0, height: 0, getContext: () => context,
      toBlob: vi.fn((done: (blob: Blob) => void) => done(new Blob(["synthetic-jpeg"], { type: "image/jpeg" }))) };
    vi.stubGlobal("document", { createElement: () => canvas });
    const drawable = {} as CanvasImageSource, close = vi.fn();
    vi.spyOn(image, "decodeImage").mockResolvedValue({ drawable, width: 6400, height: 1440, close });
    const moved = movePageFrame(filledPage(), custom, "a", 40, 600);
    const page = reorderPageFrame(moved, moved.templateSnapshot!, "a", 1), original = structuredClone(page);
    const template = page.templateSnapshot!, format = getFormat("instagram-post");
    const preview = await renderPagePreview(page, format, template);
    const previewDraws = structuredClone(context.drawImage.mock.calls);
    const previewClips = structuredClone(context.roundRect.mock.calls);
    context.drawImage.mockClear(); context.roundRect.mockClear();
    const exported = await renderComposition({ format, template, ...page });
    expect(exported.type).toBe("image/jpeg"); expect(preview.type).toBe("image/jpeg");
    expect(context.drawImage.mock.calls).toEqual(previewDraws); expect(context.roundRect.mock.calls).toEqual(previewClips);
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.94);
    expect(page).toEqual(original);
    for (const width of [280, 540]) {
      const ctx = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
      resolveFrames(template, page.gutter, width, width * 5 / 4).forEach(f => drawCroppedPhoto(ctx as unknown as CanvasRenderingContext2D,
        drawable, 6400, 1440, f, page.photos[f.id].crop, page.background));
      ctx.drawImage.mock.calls.forEach((call, i) => {
        for (let coordinate = 1; coordinate <= 4; coordinate++) expect(call[coordinate] * 1080 / width).toBeCloseTo(previewDraws[i][coordinate], 8);
      });
    }
  });
  it("refuses a misleading preview if an assigned photo is unavailable", async () => {
    const [page] = reconcileProjectPages(stored(filledPage())), before = structuredClone(page);
    const decode = vi.spyOn(image, "decodeImage");
    await expect(renderPagePreview(page, getFormat("instagram-post"), custom)).rejects.toThrow("unavailable");
    expect(page).toEqual(before); expect(decode).not.toHaveBeenCalled();
  });
});
