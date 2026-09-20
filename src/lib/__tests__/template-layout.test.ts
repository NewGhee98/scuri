import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as layout from "../template-layout";
import { MIN_FRAME_PIXELS, resizeFrame } from "../frame-resize";
import { coverPlacement, DEFAULT_CROP, resolveFrames } from "../crop";
import { resolveExportFrames } from "../export-settings";
import { cacheCustomTemplates, copyAsCustomTemplate, createBlankCustomTemplate, loadCachedCustomTemplates, loadCloudTemplates, saveCloudTemplate } from "../custom-templates";
import { TemplateThumbnail } from "../../components/template-thumbnail";
import { getFormat } from "../formats";
import { TEMPLATES, validateTemplate } from "../templates";
import type { CustomTemplate, FrameMargins, NormalizedFrame } from "../types";

const cloud = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../supabase-client", () => ({ getSupabaseClient: () => cloud.client, isSupabaseConfigured: () => !!cloud.client }));
const size = { width: 1080, height: 1350 };
const ids = (frames: NormalizedFrame[]) => frames.map(f => f.id);
const margin = (value: number): FrameMargins => ({ top: value, right: value, bottom: value, left: value, linked: true });
function frames(count = 5): NormalizedFrame[] {
  return Array.from({ length: count }, (_, i) => ({ id: `frame-${i}`, x: .05 + i * .01, y: .06 + i * .17, width: .8, height: .1 }));
}
function pano(count = 5, ratio = { width: 40, height: 9 }) {
  let f = layout.setFrameRatio(frames(count), ids(frames(count)), ratio, size).frames;
  f = layout.setFrameDimension(f, ids(f), "width", 1016, size).frames;
  f = layout.arrangeFrames(f, ids(f), "vertical", 32, true, size, "stack").frames;
  f = layout.setFrameMargins(f, ids(f), margin(32), size).frames;
  return layout.centreFrameGroup(f, ids(f), size).frames;
}
function expectValid(f: NormalizedFrame[]) {
  for (const frame of f) {
    expect(frame.x).toBeGreaterThanOrEqual(-1e-9); expect(frame.y).toBeGreaterThanOrEqual(-1e-9);
    expect(frame.x + frame.width).toBeLessThanOrEqual(1 + 1e-9); expect(frame.y + frame.height).toBeLessThanOrEqual(1 + 1e-9);
    expect(frame.width * size.width).toBeGreaterThanOrEqual(1 - 1e-6); expect(frame.height * size.height).toBeGreaterThanOrEqual(1 - 1e-6);
  }
}
function expectGaps(f: NormalizedFrame[], gap: number, axis = "vertical") {
  const sorted = [...f].sort((a, b) => a.arrangement!.order - b.arrangement!.order);
  for (let i = 1; i < sorted.length; i++) expect(axis === "vertical"
    ? (sorted[i].y - sorted[i - 1].y - sorted[i - 1].height) * size.height
    : (sorted[i].x - sorted[i - 1].x - sorted[i - 1].width) * size.width).toBeCloseTo(gap, 7);
}
afterEach(() => { vi.unstubAllGlobals(); cloud.client = null; });

describe("visible frame proportions", () => {
  it.each(layout.FRAME_RATIOS)("uses exact $label in reference pixels on a portrait canvas", ratio => {
    const f = frames(1), before = structuredClone(f);
    const next = layout.setFrameRatio(f, ids(f), ratio, size).frames[0];
    expect(layout.actualFrameRatio(next, size)).toBeCloseTo(ratio.width / ratio.height, 12);
    expect(next.aspectRatioLocked).toBe(true); expect(next.aspectRatio).toEqual({ width: ratio.width, height: ratio.height });
    expect(f).toEqual(before); expectValid([next]);
  });
  it("preserves centre and width when a new ratio fits, and flips without distorting it at bounds", () => {
    const f = [{ id: "a", x: .3, y: .3, width: .3, height: .3 }];
    const next = layout.setFrameRatio(f, ["a"], { width: 40, height: 9 }, size).frames;
    expect(next[0].width).toBe(f[0].width); expect(next[0].x).toBe(f[0].x);
    expect(next[0].y + next[0].height / 2).toBeCloseTo(.45);
    const flipped = layout.flipFrameRatios(next, ["a"], size);
    expect(layout.actualFrameRatio(flipped.frames[0], size)).toBeCloseTo(9 / 40, 12);
    expect(flipped.notice).toMatch(/largest size/); expectValid(flipped.frames);
  });
  it.each(["nw", "ne", "sw", "se"] as const)("keeps legacy locked proportions at every page edge using handle %s", handle => {
    const f = { id: "f", x: .05, y: .8, width: .3, height: .19, aspectRatioLocked: true };
    for (const fromCentre of [false, true]) for (const [dx, dy] of [[4, 3], [-4, 3], [4, -3], [-4, -3]]) {
      const result = resizeFrame(f, handle, dx, dy, fromCentre, size);
      expect(result.width / result.height).toBeCloseTo(f.width / f.height, 10); expectValid([result]);
    }
  });
  it("matches a chosen reference independently of layer order and preserves mixed locks", () => {
    const f: NormalizedFrame[] = [
      { id: "ref", x: .1, y: .1, width: .2, height: .16, aspectRatioLocked: true },
      { id: "wide", x: .5, y: .4, width: .35, height: .05, aspectRatioLocked: true },
      { id: "free", x: .1, y: .7, width: .1, height: .2 },
    ];
    for (const dimension of ["width", "height"] as const) {
      const next = layout.matchFrameDimension(f, ids(f), "ref", dimension, size).frames;
      next.forEach(frame => expect(frame[dimension]).toBeCloseTo(next[0][dimension]));
      next.slice(0, 2).forEach((frame, i) => expect(frame.width / frame.height).toBeCloseTo(f[i].width / f[i].height));
      const other = dimension === "width" ? "height" : "width";
      // Use a width match for the unlocked case: this request fits without limiting the group.
      if (dimension === "width") expect(next[2][other]).toBe(f[2][other]);
      expectValid(next);
    }
  });
  it("rejects invalid and impossibly thin custom ratios without changing any frame", () => {
    const f = frames(1);
    for (const ratio of [{ width: 0, height: 1 }, { width: Infinity, height: 1 }, { width: 1e12, height: 1 }]) {
      expect(layout.setFrameRatio(f, ids(f), ratio, size).frames).toEqual(f);
    }
  });
  it.each(["width", "height"] as const)("limits a typed %s without silently changing the other unlocked dimension", dimension => {
    const f = frames(1), other = dimension === "width" ? "height" : "width";
    const result = layout.setFrameDimension(f, ids(f), dimension, 9000, size);
    expect(result.notice).toMatch(/largest size/); expect(result.frames[0][other]).toBe(f[0][other]);
    expect(result.frames[0][dimension]).toBeCloseTo(1, 8); expectValid(result.frames);
  });
});

describe("rows, stacks and minimum margins", () => {
  it("constructs the five-panorama example with 32px gaps, 32px side margins and 39.5px top/bottom whitespace", () => {
    const f = pano(); expect(f).toHaveLength(5); expectGaps(f, 32); expectValid(f);
    for (const frame of f) {
      expect(frame.x * size.width).toBeCloseTo(32, 8);
      expect(frame.width * size.width).toBeCloseTo(1016, 8);
      expect(frame.height * size.height).toBeCloseTo(228.6, 8);
      expect(layout.actualFrameRatio(frame, size)).toBeCloseTo(40 / 9, 12);
    }
    const bounds = layout.frameBounds(f);
    expect(bounds.y * size.height).toBeCloseTo(39.5, 8);
    expect(bounds.y + bounds.height / 2).toBeCloseTo(.5, 12);
  });
  it("keeps exact Ultra Pano proportions for seven strips with symmetric space", () => {
    const f = pano(7, { width: 768, height: 115 }); expectGaps(f, 32); expectValid(f);
    f.forEach(frame => expect(layout.actualFrameRatio(frame, size)).toBeCloseTo(768 / 115, 12));
    expect(layout.frameBounds(f).y * size.height).toBeCloseTo(46.5260416667, 6);
  });
  it("preserves fixed gaps when all members or just one member changes size", () => {
    const f = pano(), unrelated = { id: "unrelated", x: 0, y: 0, width: .02, height: .02 };
    for (const selected of [ids(f), [f[1].id]]) {
      const result = layout.setFrameDimension([...f, unrelated], selected, "width", 750, size);
      const members = layout.arrangementMembers(result.frames, "stack"); expectGaps(members, 32);
      expectValid(result.frames); expect(result.frames.at(-1)).toBe(unrelated);
      members.forEach(frame => expect(layout.actualFrameRatio(frame, size)).toBeCloseTo(40 / 9, 11));
    }
  });
  it("reaches the common valid limit rather than distorting ratios, gaps or matching widths", () => {
    const result = layout.setFrameDimension(pano(), ids(pano()), "width", 9000, size);
    expect(result.notice).toMatch(/largest size/); expectValid(result.frames); expectGaps(result.frames, 32);
    result.frames.forEach(frame => {
      expect(frame.width).toBeCloseTo(result.frames[0].width, 12);
      expect(layout.actualFrameRatio(frame, size)).toBeCloseTo(40 / 9, 12);
    });
  });
  it.each(["horizontal", "vertical"] as const)("allows zero gaps and margins in a %s arrangement", axis => {
    const f = frames(3).map(frame => ({ ...frame, width: .12, height: .12 }));
    const next = layout.arrangeFrames(f, ids(f), axis, 0, true, size, "zero").frames;
    expectGaps(next, 0, axis); expectValid(next);
    const margins = layout.setFrameMargins(next, ids(next), margin(0), size).frames;
    expectGaps(margins, 0, axis); margins.forEach(frame => expect(frame.layoutMargins).toEqual(margin(0)));
  });
  it("rejects impossible gaps atomically and never shrinks frames to hide the conflict", () => {
    const f = pano(), before = structuredClone(f);
    const result = layout.setArrangementGap(f, "stack", 400, size);
    expect(result.frames).toEqual(before); expect(result.notice).toMatch(/previous gap/);
    expect(layout.arrangeFrames(f, ids(f), "vertical", 400, true, size, "other").frames).toEqual(before);
    expect(layout.setFrameMargins(f, ids(f), margin(900), size).frames).toEqual(before);
  });
  it("applies asymmetric margins to the whole arrangement and centres within the available area", () => {
    const f = pano(); const margins = { top: 100, bottom: 200, left: 40, right: 80, linked: false };
    const next = layout.setFrameMargins(f, [f[1].id], margins, size).frames;
    const centred = layout.centreFrameGroup(next, [f[1].id], size).frames;
    expectGaps(centred, 32); expectValid(centred);
    centred.forEach(frame => expect(frame.layoutMargins).toEqual(margins));
    const bounds = layout.frameBounds(centred);
    expect((bounds.x + bounds.width / 2) * size.width).toBeCloseTo(520);
    expect((bounds.y + bounds.height / 2) * size.height).toBeCloseTo(625);
  });
  it("preserves freeform relationships when a margin change requires proportional shrinking", () => {
    const f = [{ id: "a", x: 0, y: 0, width: .2, height: .3 }, { id: "b", x: .6, y: .5, width: .4, height: .5 }];
    const next = layout.setFrameMargins(f, ids(f), margin(100), size).frames;
    const scale = next[0].width / f[0].width;
    expect(next[1].width / f[1].width).toBeCloseTo(scale);
    expect(next[1].x - next[0].x).toBeCloseTo((f[1].x - f[0].x) * scale);
    expect(next[1].y - next[0].y).toBeCloseTo((f[1].y - f[0].y) * scale);
    expectValid(next);
  });
  it("requires release before moving a member independently and only affects explicit group members", () => {
    const f = pano();
    expect(layout.moveFrameGroup(f, [f[0].id], .1, 0, size).frames).toEqual(f);
    expect(layout.arrangeFrames(f, [f[0].id, f[1].id], "horizontal", 0, true, size, "other").frames).toEqual(f);
    const released = layout.releaseArrangement(f, [f[0].id]); expect(released.every(frame => !frame.arrangement)).toBe(true);
    const next = layout.moveFrameGroup(released, [f[0].id], 0, .01, size).frames;
    expect(next[0].y).toBeGreaterThan(f[0].y); expect(next.slice(1)).toEqual(released.slice(1));
  });
  it("deletion closes only the affected stack; duplication uses fresh independent arrangements", () => {
    const f = pano(), next = layout.deleteLayoutFrames(f, [f[2].id], size).frames;
    expectGaps(next, 32); expect(next).toHaveLength(4);
    const one = layout.deleteLayoutFrames(next, ids(next).slice(1), size).frames; expect(one[0].arrangement).toBeUndefined();
    let index = 0; const duplicate = layout.duplicateLayoutFrames(f, ids(f), size, () => `new-${index++}`);
    expect(duplicate.frames.slice(0, 5)).toEqual(f);
    const clones = duplicate.frames.slice(5); expectGaps(clones, 32);
    expect(clones[0].arrangement?.id).not.toBe("stack"); expect(new Set(ids(duplicate.frames)).size).toBe(10);
    const partial = layout.duplicateLayoutFrames(f, [f[1].id], size, () => "one-copy").frames.at(-1)!;
    expect(partial.arrangement).toBeUndefined(); expect(partial.width).toBe(f[1].width);
  });
  it("one-shot arranging does not leave a persistent relationship", () => {
    const f = frames(3), next = layout.arrangeFrames(f, ids(f), "vertical", 0, false, size, "temporary").frames;
    expect(next.every(frame => !frame.arrangement)).toBe(true);
  });
  it("equalises actual edge gaps without changing the cross axis, sizes or end anchors", () => {
    const f = [
      { id: "a", x: .1, y: .1, width: .1, height: .1 },
      { id: "b", x: .2, y: .21, width: .1, height: .2 },
      { id: "c", x: .4, y: .8, width: .1, height: .1 },
    ];
    const next = layout.equaliseFrameSpacing(f, ids(f), "vertical", size).frames;
    expect(next[0].y).toBe(f[0].y); expect(next[2].y).toBeCloseTo(f[2].y);
    expect(next[1].y - next[0].y - next[0].height).toBeCloseTo(next[2].y - next[1].y - next[1].height);
    next.forEach((frame, i) => { expect(frame.x).toBe(f[i].x); expect(frame.height).toBe(f[i].height); });
  });
});

describe("shared resize handles", () => {
  it.each(layout.FRAME_RATIOS)("preserves $label even at the smallest size in thumbnails and exports", ratio => {
    const original = layout.setFrameRatio(frames(1), ["frame-0"], ratio, size).frames;
    const smallest = layout.resizeLayoutSelection(original, ["frame-0"], "se", -5, -5, false, size).frames[0];
    expect(Math.min(smallest.width * size.width, smallest.height * size.height)).toBeCloseTo(MIN_FRAME_PIXELS);
    const template = { ...createBlankCustomTemplate("instagram-post"), frames: [smallest] };
    for (const factor of [180 / 1080, 280 / 1080, 1, 3]) {
      const resolved = resolveFrames(template, 0, size.width * factor, size.height * factor)[0];
      expect(resolved.width / resolved.height).toBeCloseTo(ratio.width / ratio.height, 10);
      expect(resolved.width).toBeCloseTo(smallest.width * size.width * factor, 10);
    }
  });
  it.each(["x", "y"] as const)("gently matches actual %s-axis gaps and releases beyond the screen-space tolerance", axis => {
    const dimension = axis === "x" ? size.width : size.height;
    const base = { x: .2, y: .2, width: 100 / size.width, height: 100 / size.height };
    const a = { ...base, id: "a", [axis]: 100 / dimension }, b = { ...base, id: "b", [axis]: 232 / dimension };
    const moving = { ...base, [axis]: 366 / dimension };
    const snap = layout.matchingFrameGap([a, b], moving, axis, 5 / dimension)!;
    expect(snap.gap * dimension).toBeCloseTo(32); expect(snap.delta * dimension).toBeCloseTo(-2);
    expect(layout.matchingFrameGap([a, b], { ...moving, [axis]: 370 / dimension }, axis, 5 / dimension)).toBeNull();
    expect(layout.matchingFrameGap([a], moving, axis, 5 / dimension)).toBeNull();
  });
  it("scales freeform positions, whitespace and mixed proportions together", () => {
    const f = frames(2), before = structuredClone(f), bounds = layout.frameBounds(f);
    const next = layout.resizeFrameGroup(f, ids(f), "se", -.1, -.1, false, size).frames;
    const scale = next[0].width / f[0].width;
    expect(scale).toBeLessThan(1);
    next.forEach((frame, i) => {
      expect(frame.width / frame.height).toBeCloseTo(f[i].width / f[i].height);
      expect(frame.x).toBeCloseTo(bounds.x + (f[i].x - bounds.x) * scale);
      expect(frame.y).toBeCloseTo(bounds.y + (f[i].y - bounds.y) * scale);
    }); expect(f).toEqual(before);
  });
  it.each(["nw", "ne", "sw", "se"] as const)("resizes a fixed-gap stack with %s while respecting bounds", handle => {
    const f = pano();
    for (const centre of [false, true]) for (const delta of [-1, -.05, .05, 1]) {
      const next = layout.resizeLayoutSelection(f, ids(f), handle, delta, delta, centre, size).frames;
      expectValid(next); expectGaps(next, 32);
      next.forEach(frame => expect(layout.actualFrameRatio(frame, size)).toBeCloseTo(40 / 9, 10));
      if (centre) { const bounds = layout.frameBounds(next); expect(bounds.x + bounds.width / 2).toBeCloseTo(.5); expect(bounds.y + bounds.height / 2).toBeCloseTo(.5); }
    }
  });
  it("enforces minimum margins during single and group drags/resizes", () => {
    const f = layout.setFrameMargins(frames(2), ids(frames(2)), margin(60), size).frames;
    for (const selected of [ids(f), [f[0].id]]) {
      const next = layout.resizeLayoutSelection(f, selected, "se", 5, 5, false, size).frames;
      expectValid(next);
      next.forEach(frame => {
        expect((frame.x + frame.width) * size.width).toBeLessThanOrEqual(size.width - 60 + 1e-5);
        expect((frame.y + frame.height) * size.height).toBeLessThanOrEqual(size.height - 60 + 1e-5);
      });
    }
  });
});

describe("persistence and common rendering", () => {
  function template(): CustomTemplate { return { ...createBlankCustomTemplate("instagram-post"), name: "Exact stacks", status: "saved", frames: pano() }; }
  it("round-trips all editing metadata through the actual local cache and cloud frame JSON", async () => {
    const value = template(), storage = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, text: string) => storage.set(key, text) });
    cacheCustomTemplates([value], "synthetic-owner"); expect(loadCachedCustomTemplates("synthetic-owner")[0]).toEqual(value);
    let row: Record<string, unknown> = {};
    const table = { upsert: vi.fn((data: unknown) => { row = JSON.parse(JSON.stringify(data)); return table; }), select: vi.fn(() => table),
      single: async () => ({ data: row, error: null }), order: async () => ({ data: [row], error: null }) };
    cloud.client = { auth: { getUser: async () => ({ data: { user: { id: "synthetic-owner" } }, error: null }) }, from: (name: string) => { expect(name).toBe("templates"); return table; } };
    const saved = await saveCloudTemplate(value);
    expect(saved.frames).toEqual(value.frames); expect(saved.defaultGutter).toBe(0);
    expect((await loadCloudTemplates())[0].frames).toEqual(value.frames);
    const next = layout.setFrameDimension(saved.frames, ids(saved.frames), "width", 900, size).frames; expectGaps(next, 32);
  });
  it("copies metadata with new identities and preserves rendered positions", () => {
    const original = template(), copied = copyAsCustomTemplate(original, []);
    expect(copied.frames[0].arrangement?.id).not.toBe(original.frames[0].arrangement?.id);
    expect(new Set(copied.frames.map(f => f.arrangement?.id)).size).toBe(1);
    copied.frames.forEach((frame, i) => {
      expect(frame.id).not.toBe(original.frames[i].id); expect(frame.aspectRatio).toEqual({ width: 40, height: 9 });
      expect(frame.width).toBeCloseTo(original.frames[i].width, 12);
    }); expectGaps(copied.frames, 32);
  });
  it("keeps every previous built-in unchanged when copied or inspected", () => {
    for (const original of TEMPLATES) {
      const before = structuredClone(original), copy = copyAsCustomTemplate(original, []);
      const copiedFrames = resolveFrames(copy, 0);
      expect(original).toEqual(before); expect(validateTemplate(copy)).toEqual([]);
      resolveFrames(original, original.defaultGutter).forEach((f, i) => {
        const actual = copiedFrames[i];
        for (const key of ["x", "y", "width", "height", "cornerRadius"] as const) {
          expect(actual[key], `${original.id}: ${key}`).toBeCloseTo(f[key], 10);
        }
      });
    }
  });
  it.each([{ width: 40, height: 9, count: 5, originalWidth: 6400, originalHeight: 1440 },
    { width: 768, height: 115, count: 7, originalWidth: 1536, originalHeight: 230 }])("renders uncropped $width:$height consistently at thumbnail, editor and larger export sizes", ratio => {
    const value = { ...template(), frames: pano(ratio.count, ratio) }, before = JSON.stringify(value);
    const reference = resolveFrames(value, 0);
    for (const factor of [180 / 1080, 1, 2, 3]) {
      const rendered = factor < 1 ? resolveFrames(value, 0, size.width * factor, size.height * factor)
        : resolveExportFrames(getFormat("instagram-post"), value, 0, { width: size.width * factor, height: size.height * factor });
      rendered.forEach((f, i) => {
        expect(f.width / f.height).toBeCloseTo(ratio.width / ratio.height, 12);
        expect(f.x / factor).toBeCloseTo(reference[i].x, 9); expect(f.y / factor).toBeCloseTo(reference[i].y, 9);
        expect(f.width / factor).toBeCloseTo(reference[i].width, 9); expect(f.height / factor).toBeCloseTo(reference[i].height, 9);
        const placement = coverPlacement(ratio.originalWidth, ratio.originalHeight, f, DEFAULT_CROP);
        expect(placement.width).toBeCloseTo(f.width, 9); expect(placement.height).toBeCloseTo(f.height, 9);
      });
    }
    const markup = renderToStaticMarkup(createElement(TemplateThumbnail, { template: value }));
    expect(markup).not.toContain("arrangement"); expect(markup).not.toContain("template-gap-measure"); expect(markup).not.toContain("resize-handle");
    expect(JSON.stringify(value)).toBe(before);
  });
});
