import { afterEach, describe, expect, it, vi } from "vitest";
import { createTextBox, drawTextLayers, ensureTextFonts, isTextLayers, layoutText, moveTextBox } from "../text";
import { pointInCanvas } from "../canvas-viewport";
import { renderComposition, renderPagePreview } from "../export";
import { getFormat } from "../formats";
import { getTemplate } from "../templates";
import type { ProjectPage } from "../types";

function drawingContext() {
  return { font: "", fontKerning: "", letterSpacing: "", textAlign: "", textBaseline: "", globalAlpha: 1, fillStyle: "",
    measureText: vi.fn((text: string) => ({ width: Array.from(text).length * 20, fontBoundingBoxAscent: 30, fontBoundingBoxDescent: 10 })),
    save: vi.fn(), restore: vi.fn(), scale: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), fillRect: vi.fn(), fillText: vi.fn() };
}
const size = { width: 1080, height: 1350 };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("reference-space text geometry", () => {
  it("wraps at box width, preserves explicit newlines and measures tracking rather than average width", () => {
    const ctx = drawingContext() as unknown as CanvasRenderingContext2D;
    const box = { ...createTextBox("t"), width: 100 / 1080, text: "AA BB\nCC", letterSpacing: 10, align: "left" as const };
    const layout = layoutText(ctx, box, size);
    expect(layout.lines.map(line => line.text)).toEqual(["AA", "BB", "CC"]);
    expect(layout.lines.map(line => line.width)).toEqual([50, 50, 50]);
    expect(layout.lines[1].baseline - layout.lines[0].baseline).toBeCloseTo(box.fontSize * box.lineHeight);
    expect(layout.lines[0].x).toBeCloseTo(box.x * size.width);
  });

  it("centres/right-aligns each line independently, wraps long words and reports clipping", () => {
    const ctx = drawingContext() as unknown as CanvasRenderingContext2D;
    for (const align of ["left", "center", "right"] as const) {
      const box = { ...createTextBox("t"), text: "ABCDE", width: 60 / 1080, letterSpacing: 0, align, y: .99 };
      const layout = layoutText(ctx, box, size);
      expect(layout.lines.map(line => line.text)).toEqual(["ABC", "DE"]);
      expect(layout.lines[1].x).toBeCloseTo(box.x * 1080 + (align === "left" ? 0 : align === "center" ? 10 : 20));
      expect(layout.overflows).toBe(true);
    }
  });

  it("keeps identical line breaks/baselines across editor, thumbnails and larger exports", () => {
    const box = { ...createTextBox("t"), text: "AOGASHIMA\nNew Season", background: "#112233", opacity: .45 };
    const template = { ...getTemplate("instagram-post-full-frame"), textLayers: [box] };
    const before = structuredClone(template);
    let reference: unknown;
    for (const width of [1080, 180, 280, 2160, 3240]) {
      const ctx = drawingContext();
      drawTextLayers(ctx as unknown as CanvasRenderingContext2D, template, width, width * 1.25);
      expect(ctx.scale).toHaveBeenCalledWith(width / 1080, width / 1080);
      expect(ctx.rect).toHaveBeenCalledWith(0, 0, 1080, 1350);
      expect(ctx.fillRect.mock.calls[0][2]).toBeCloseTo(box.width * 1080);
      expect(ctx.globalAlpha).toBe(.45);
      if (reference) expect(ctx.fillText.mock.calls).toEqual(reference); else reference = ctx.fillText.mock.calls;
    }
    expect(template).toEqual(before);
  });

  it.each([.25, 1, 3])("maps dragging at %sx correctly and permits crossing the gentle centre snap", scale => {
    const box = { ...createTextBox("t"), x: .2, y: .25, width: .4 };
    const rect = { left: -100, top: -50, width: size.width * scale, height: size.height * scale };
    const a = pointInCanvas({ clientX: 100, clientY: 100 }, rect, size);
    const b = pointInCanvas({ clientX: 100 + 108 * scale, clientY: 100 + 135 * scale }, rect, size);
    const moved = moveTextBox(box, box.x + (b.x - a.x) / size.width, box.y + (b.y - a.y) / size.height, 100, size, []);
    expect(moved.box.x).toBeCloseTo(.3); expect(moved.box.y).toBeCloseTo(.35);
    const snapped = moveTextBox(box, .3 + 3 / scale / size.width, box.y, 100, size, [], 5 / scale);
    expect(snapped.box.x).toBeCloseTo(.3); expect(snapped.guides).toContainEqual({ axis: "x", value: .5 });
    expect(moveTextBox(box, .3 + 7 / scale / size.width, box.y, 100, size, [], 5 / scale).box.x).toBeGreaterThan(.3);
    expect(moveTextBox(box, -1, 2, 100, size, []).box).toMatchObject({ x: 0, y: 1 - 100 / size.height });
  });

  it("rejects damaged, unbounded, unknown-font and duplicate-ID metadata; legacy absence is handled by callers", () => {
    const box = createTextBox("t"); expect(isTextLayers([box])).toBe(true); expect(isTextLayers([])).toBe(true);
    for (const patch of [{ width: -1 }, { x: Infinity }, { opacity: 2 }, { fontSize: 0 }, { font: "unknown" }, { italic: true }, { text: "x".repeat(2001) }]) {
      expect(isTextLayers([{ ...box, ...patch }])).toBe(false);
    }
    expect(isTextLayers([box, box])).toBe(false);
    expect(isTextLayers(null)).toBe(false);
  });
});

describe("font and JPEG contract", () => {
  it("waits for the actual bundled face before rendering and rejects fallback-only results", async () => {
    const ctx = drawingContext(); let load!: (faces: { status: string }[]) => void;
    const ready = new Promise<{ status: string }[]>(resolve => { load = resolve; });
    const create = vi.fn(() => ({ width: 0, height: 0, getContext: () => ctx,
      toBlob: (done: (b: Blob) => void) => done(new Blob(["synthetic JPEG"], { type: "image/jpeg" })) }));
    vi.stubGlobal("document", { fonts: { load: vi.fn(() => ready) }, createElement: create });
    const template = { ...getTemplate("instagram-post-full-frame"), textLayers: [createTextBox("t")] };
    const render = renderComposition({ format: getFormat(template.formatId), template, background: "#fff", gutter: 0, photos: {} });
    await Promise.resolve(); expect(create).not.toHaveBeenCalled();
    load([{ status: "loaded" }]); expect((await render).type).toBe("image/jpeg"); expect(ctx.fillText).toHaveBeenCalled();
    vi.stubGlobal("document", { fonts: { load: vi.fn(async () => []) }, createElement: create });
    create.mockClear();
    await expect(ensureTextFonts(template.textLayers)).rejects.toThrow("substitute font");
    await expect(renderComposition({ format: getFormat(template.formatId), template, background: "#fff", gutter: 0, photos: {} })).rejects.toThrow("Cinzel");
    expect(create).not.toHaveBeenCalled();
  });

  it("preview and export draw the same text at chosen resolution and leave page data untouched", async () => {
    const ctx = drawingContext(); const canvas = { width: 0, height: 0, getContext: () => ctx,
      toBlob: (done: (b: Blob) => void) => done(new Blob(["synthetic JPEG"])) };
    vi.stubGlobal("document", { fonts: { load: async () => [{ status: "loaded" }] }, createElement: () => canvas });
    const template = { ...getTemplate("instagram-post-full-frame"), textLayers: [createTextBox("t")] }, format = getFormat(template.formatId);
    const page: ProjectPage = { id: "page", templateId: template.id, templateSnapshot: template, photos: {}, selectedFrameId: null,
      background: "#ffeedd", gutter: 0, createdAt: "2026-09-25", updatedAt: "2026-09-25" };
    const before = structuredClone(page), outputSize = { width: 2160, height: 2700 };
    await renderPagePreview(page, format, template, undefined, outputSize);
    const calls = ctx.fillText.mock.calls; ctx.fillText.mockClear();
    await renderComposition({ ...page, template, format, outputSize });
    expect(ctx.fillText.mock.calls).toEqual(calls); expect(canvas.width).toBe(2160); expect(canvas.height).toBe(2700);
    expect(page).toEqual(before);
  });
});
