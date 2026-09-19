import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { FRAME_SELECTION_TINT } from "../selection-style";
import { TemplateThumbnail } from "../../components/template-thumbnail";
import { getTemplatesForFormat } from "../templates";
import { drawCroppedPhoto } from "../draw-photo";

// Exercise the real designer render callback and selection handlers without a
// second implementation of the selection/preview conditions or draft changes.
const source = readFileSync(new URL("../../components/template-designer.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("template-designer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = new Map<string, string>();
function compile(name: string, node: ts.Node) {
  callbacks.set(name, ts.transpileModule(`const callback = ${node.getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText);
}
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isArrowFunction(node.initializer)) compile(node.name.text, node.initializer);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "draft.frames.map") compile("renderFrame", node.arguments[0]);
  ts.forEachChild(node, visit);
}
visit(ast);
function callback(name: string, scope: Record<string, unknown>) {
  expect(callbacks.has(name)).toBe(true);
  return new Function("scope", `with (scope) { ${callbacks.get(name)} return callback; }`)(scope);
}
const template = getTemplatesForFormat("instagram-post").find(item => item.frames.length === 5)!;

describe("template selection shading", () => {
  it("shades every selected frame with the shared tint, without changing geometry or the draft", () => {
    const before = structuredClone(template), selectedIds = template.frames.slice(0, 2).map(frame => frame.id);
    const renderFrame = callback("renderFrame", { React, FRAME_SELECTION_TINT, selectedIds, preview: false });
    const markup = renderToStaticMarkup(React.createElement(React.Fragment, null, template.frames.map(renderFrame)));
    expect(markup.match(/class="frame-selection-shade"/g)).toHaveLength(2);
    expect(markup.match(/aria-hidden="true"/g)).toHaveLength(2);
    expect(markup.match(/background:rgba\(64, 139, 205, 0.12\)/g)).toHaveLength(2);
    expect(markup).not.toContain("resize-handle"); // Existing single-frame handles are not duplicated for multi-select.
    expect(template).toEqual(before);
  });

  it("retains all four handles for a single selection and omits all editing decoration in Preview and thumbnails", () => {
    const selectedIds = [template.frames[0].id];
    const render = (preview: boolean) => renderToStaticMarkup(React.createElement(React.Fragment, null,
      template.frames.map(callback("renderFrame", { React, FRAME_SELECTION_TINT, selectedIds, preview }))));
    expect(render(false).match(/data-resize-handle=/g)).toHaveLength(4);
    for (const markup of [render(true), renderToStaticMarkup(React.createElement(TemplateThumbnail, { template }))]) {
      expect(markup).not.toContain("frame-selection-shade");
      expect(markup).not.toContain(FRAME_SELECTION_TINT);
      expect(markup).not.toContain("resize-handle");
      expect(markup).not.toContain('class="designed-frame selected"');
    }
  });

  it("single/multiple selection and a stationary pointer do not edit or autosave the draft", () => {
    for (const multiSelect of [false, true]) {
      const draft = { ...structuredClone(template), updatedAt: "2026-09-20T00:00:00Z", syncState: "synced" };
      const before = structuredClone(draft), draftRef = { current: draft }, interactionRef = { current: null };
      const scope = { draftRef, interactionRef, preview: false, multiSelect, selectedIds: [template.frames[0].id],
        setSelectedIds: vi.fn(), canvasRef: { current: { setPointerCapture: vi.fn() } },
        pointForEvent: () => ({ x: .5, y: .5 }), replaceDraft: vi.fn(), setPast: vi.fn(), setFuture: vi.fn(), setGuides: vi.fn(),
        sameTemplate: (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b) };
      const event = { pointerId: 1, preventDefault: vi.fn(), stopPropagation: vi.fn(),
        target: { closest: (selector: string) => selector === "[data-template-frame-id]" ? { dataset: { templateFrameId: template.frames[1].id } } : null } };
      callback("beginInteraction", scope)(event);
      expect(scope.setSelectedIds).toHaveBeenCalledExactlyOnceWith(multiSelect ? template.frames.slice(0, 2).map(frame => frame.id) : [template.frames[1].id]);
      callback("moveInteraction", scope)(event);
      callback("endInteraction", scope)(event);
      expect(draftRef.current).toBe(draft); expect(draft).toEqual(before);
      expect(scope.replaceDraft).not.toHaveBeenCalled();
      expect(scope.setPast).not.toHaveBeenCalled(); expect(scope.setFuture).not.toHaveBeenCalled();
    }
  });
});

it("page thumbnail drawing ignores selection and leaves negative-zoom background unshaded", () => {
  const source = readFileSync(new URL("../../components/composition-thumbnail.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("composition-thumbnail.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let draw = "";
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0]?.getText(ast).includes('canvas.getContext("2d")')) {
      draw = ts.transpileModule(`const draw = ${node.arguments[0].getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast); expect(draw).not.toBe("");
  const results = [];
  for (const selectedFrameId of ["f", null]) {
    const crop = Object.freeze({ zoom: .4, positionX: 0, positionY: 0 });
    const photo = { previewUrl: "blob:synthetic", sourceWidth: 6400, sourceHeight: 1440, crop };
    const ctx = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(),
      roundRect: vi.fn(), clip: vi.fn(), setTransform: vi.fn(), stroke: vi.fn() };
    ctx.fillRect.mockImplementation(() => expect(ctx.fillStyle).toBe("#181818"));
    const scope = { canvasRef: { current: { getContext: () => ctx } }, width: 280, height: 350, window: { devicePixelRatio: 2 },
      page: { background: "#181818", selectedFrameId }, frames: [{ id: "f", x: 10, y: 20, width: 260, height: 60, cornerRadius: 6 }],
      photos: { f: photo }, cacheRef: { current: new Map([[photo.previewUrl, { complete: true, naturalWidth: 640 }]]) }, drawCroppedPhoto };
    new Function("scope", `with (scope) { ${draw} return draw(); }`)(scope);
    expect(ctx.fillRect).toHaveBeenCalledTimes(2); expect(ctx.stroke).not.toHaveBeenCalled();
    results.push({ draw: ctx.drawImage.mock.calls, fills: ctx.fillRect.mock.calls, clips: ctx.roundRect.mock.calls });
  }
  expect(results[0]).toEqual(results[1]);
});
