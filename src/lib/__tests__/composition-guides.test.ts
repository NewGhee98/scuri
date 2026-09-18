import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { drawCompositionGuides } from "../composition-guides";
import type { ResolvedFrame } from "../types";

function context() {
  return { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), clip: vi.fn(), setLineDash: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), setTransform: vi.fn(),
    lineWidth: 0, strokeStyle: "", fillStyle: "" };
}

describe("frame composition guide geometry", () => {
  for (const [width, height] of [[300, 300], [240, 300], [768, 115]]) it(`places thirds and the centre cross inside a ${width} x ${height} frame`, () => {
    const frame: ResolvedFrame = { id: "selected", x: 17, y: 29, width, height, cornerRadius: 8 }, ctx = context();
    drawCompositionGuides(ctx as unknown as CanvasRenderingContext2D, frame);
    const expected = [
      [17 + width / 3, 29], [17, 29 + height / 3], [17 + width * (2 / 3), 29], [17, 29 + height * (2 / 3)],
    ];
    expected.forEach(([x, y], index) => {
      expect(ctx.moveTo.mock.calls[index][0]).toBeCloseTo(x, 10);
      expect(ctx.moveTo.mock.calls[index][1]).toBeCloseTo(y, 10);
    });
    const starts = ctx.moveTo.mock.calls, ends = ctx.lineTo.mock.calls;
    for (const [x, y] of [...starts, ...ends]) {
      expect(x).toBeGreaterThanOrEqual(frame.x); expect(x).toBeLessThanOrEqual(frame.x + frame.width);
      expect(y).toBeGreaterThanOrEqual(frame.y); expect(y).toBeLessThanOrEqual(frame.y + frame.height);
    }
    expect((starts[4][0] + ends[4][0]) / 2).toBe(17 + width / 2);
    expect(starts[4][1]).toBe(29 + height / 2);
    expect(starts[5][0]).toBe(17 + width / 2);
    expect((starts[5][1] + ends[5][1]) / 2).toBe(29 + height / 2);
    expect(ctx.roundRect).toHaveBeenCalledWith(17, 29, width, height, 8);
    expect(ctx.clip).toHaveBeenCalledOnce(); expect(ctx.stroke).toHaveBeenCalledTimes(2);
    expect(ctx.restore).toHaveBeenCalledOnce();
  });
});

// Execute the actual canvas draw effect to test selection/toggle wiring, not a
// copied predicate. Browser QA separately checks the controls and appearance.
const source = readFileSync(new URL("../../components/editor-canvas.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("editor-canvas.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let drawEffect = "";
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0]?.getText(ast).includes("drawCompositionGuides(context")) {
    drawEffect = ts.transpileModule(`const draw = ${node.arguments[0].getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  }
  ts.forEachChild(node, visit);
}
visit(ast);

describe("editor-only guide controls", () => {
  for (const [enabled, selected, rearrange, count] of [[true, "filled", false, 1], [false, "filled", false, 0],
    [true, "empty", false, 0], [true, null, false, 0], [true, "filled", true, 0]] as const) {
    for (const primaryReady of [true, false]) it(`draws ${count} overlay with enabled=${enabled}, selected=${selected}, rearrange=${rearrange}, primaryReady=${primaryReady}`, () => {
      expect(drawEffect).not.toBe("");
      const frames = [{ id: "filled", x: 0, y: 0, width: 300, height: 120, cornerRadius: 0 },
        { id: "empty", x: 0, y: 130, width: 300, height: 120, cornerRadius: 0 }];
      const photo = { previewUrl: "blob:synthetic", fallbackPreviewUrl: "blob:cached-small", sourceWidth: 6400, sourceHeight: 1440,
        crop: { zoom: 0.8765433, positionX: 0, positionY: 0 } };
      const overlay = vi.fn(), drawPhoto = vi.fn(), ctx = context();
      const primary = { complete: primaryReady, naturalWidth: 2200 }, fallback = { complete: true, naturalWidth: 640 };
      const scope = { canvasRef: { current: { style: {}, getContext: () => ctx } }, size: { width: 300, height: 375 },
        window: { devicePixelRatio: 2 }, background: "#ffffff", frames, photos: { filled: photo },
        imageCacheRef: { current: new Map([[photo.previewUrl, primary], [photo.fallbackPreviewUrl, fallback]]) },
        compositionGuides: enabled, selectedFrameId: selected, rearrangeMode: rearrange, swapDragRef: { current: null },
        unavailableFrameIds: [], guides: [], drawCompositionGuides: overlay, drawCroppedPhoto: drawPhoto };
      new Function("scope", `with (scope) { ${drawEffect} return draw(); }`)(scope);
      expect(overlay).toHaveBeenCalledTimes(count);
      if (count) expect(overlay).toHaveBeenCalledWith(ctx, frames[0]);
      expect(drawPhoto.mock.calls[0][1]).toBe(primaryReady ? primary : fallback);
      expect(drawPhoto.mock.calls[0][5]).toBe(photo.crop);
      expect(photo.crop.zoom).toBe(0.8765433);
    });
  }
});
