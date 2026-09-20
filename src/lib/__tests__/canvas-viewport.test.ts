import { readFileSync } from "node:fs";
import * as React from "react";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as viewport from "../canvas-viewport";
import { centreCrop, DEFAULT_CROP, moveCrop } from "../crop";
import { snapFramePosition, snapPhotoPosition, snapPhotoZoom } from "../editor-alignment";
import type { CropState } from "../types";
import { resizeFrame } from "../frame-resize";

const content = { width: 1080, height: 1350 }, stage = { width: 800, height: 650 };
const { fitCanvas, zoomCanvas, panCanvas, resizeViewport, pointInCanvas, CanvasNavigationGesture } = viewport;

afterEach(() => vi.unstubAllGlobals());

describe("canvas view geometry", () => {
  it("fits the entire design with padding, independently of its pixel dimensions", () => {
    for (const size of [content, { width: 3240, height: 4050 }, { width: 2160, height: 2160 }]) {
      const view = fitCanvas(stage, size);
      expect(view.x).toBeGreaterThanOrEqual(24 - 1e-9); expect(view.y).toBeGreaterThanOrEqual(24 - 1e-9);
      expect(view.x * 2 + size.width * view.scale).toBeCloseTo(stage.width);
      expect(view.y * 2 + size.height * view.scale).toBeCloseTo(stage.height);
      expect(view.fit).toBe(true);
    }
  });
  it("holds the inspected point under the zoom anchor and clamps magnification", () => {
    const view = { scale: 1, x: -200, y: -300, fit: false }, anchor = { x: 310, y: 210 };
    const next = zoomCanvas(view, 2.5, anchor, stage, content);
    expect((anchor.x - next.x) / next.scale).toBeCloseTo((anchor.x - view.x) / view.scale);
    expect((anchor.y - next.y) / next.scale).toBeCloseTo((anchor.y - view.y) / view.scale);
    expect(zoomCanvas(view, 99, anchor, stage, content).scale).toBe(4);
    expect(zoomCanvas(view, .001, anchor, stage, content).scale).toBe(.1);
    expect(zoomCanvas(view, NaN, anchor, stage, content)).toBe(view);
  });
  it("reaches all four edges with padding, centres smaller designs, and Fit resets pan", () => {
    const view = zoomCanvas(fitCanvas(stage, content), 3, { x: 400, y: 325 }, stage, content);
    for (const dx of [-1e6, 1e6]) for (const dy of [-1e6, 1e6]) {
      const next = panCanvas(view, dx, dy, stage, content);
      expect(dx > 0 ? next.x : stage.width - next.x - content.width * next.scale).toBeCloseTo(24);
      expect(dy > 0 ? next.y : stage.height - next.y - content.height * next.scale).toBeCloseTo(24);
    }
    const small = zoomCanvas(view, .2, { x: 400, y: 325 }, stage, content);
    expect(panCanvas(small, 1000, -1000, stage, content)).toEqual(small);
    expect(resizeViewport({ ...view, fit: true }, stage, stage, content)).toEqual(fitCanvas(stage, content));
  });
  it("orientation changes retain the inspected centre or re-fit an automatic view", () => {
    const nextStage = { width: 650, height: 800 }, view = { scale: 2, x: -200, y: -300, fit: false };
    const next = resizeViewport(view, stage, nextStage, content);
    expect((nextStage.width / 2 - next.x) / next.scale).toBe((stage.width / 2 - view.x) / view.scale);
    expect((nextStage.height / 2 - next.y) / next.scale).toBe((stage.height / 2 - view.y) / view.scale);
    expect(resizeViewport(fitCanvas(stage, content), stage, nextStage, content)).toEqual(fitCanvas(nextStage, content));
  });
  it("pinches around the fingers, continues panning without a jump, and cancels every active pointer", () => {
    const gesture = new CanvasNavigationGesture(), view = { scale: 1, x: -200, y: -300, fit: false };
    gesture.down(1, { x: 200, y: 200 }); gesture.down(2, { x: 400, y: 200 });
    const next = gesture.move(2, { x: 500, y: 200 }, view, stage, content);
    expect(next.scale).toBe(1.5);
    expect((350 - next.x) / next.scale).toBe((300 - view.x) / view.scale);
    gesture.end(2);
    expect(gesture.move(1, { x: 200, y: 200 }, next, stage, content)).toBe(next);
    expect(gesture.move(1, { x: 210, y: 220 }, next, stage, content)).toEqual({ ...next, x: next.x + 10, y: next.y + 20 });
    gesture.cancel();
    expect(gesture.move(1, { x: 999, y: 999 }, next, stage, content)).toBe(next);
    expect(gesture.pointers.size).toBe(0);
  });
});

// Execute actual editing callbacks with transformed DOM bounds. This catches
// integration errors that a second, test-only implementation of the math misses.
function callbacks(file: string) {
  const source = readFileSync(new URL(`../../components/${file}.tsx`, import.meta.url), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functions = new Map<string, string>();
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const fn = ts.isCallExpression(node.initializer) && node.initializer.expression.getText(ast) === "useCallback" ? node.initializer.arguments[0] : node.initializer;
      if (ts.isArrowFunction(fn)) functions.set(node.name.text, ts.transpileModule(`const fn = ${fn.getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText);
    }
    if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, ts.transpileModule(`${node.getText(ast)}; const fn = ${node.name.text};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return (name: string, scope: Record<string, unknown>) => { expect(functions.has(name)).toBe(true); return new Function("scope", `with(scope) { ${functions.get(name)} return fn; }`)(scope); };
}

describe.each([.25, 1, 3])("editing at %sx canvas scale", scale => {
  const rect = { left: -170, top: -80, width: content.width * scale, height: content.height * scale };
  const eventAt = (x: number, y: number) => ({ pointerId: 1, clientX: rect.left + x * scale, clientY: rect.top + y * scale,
    currentTarget: { getBoundingClientRect: () => rect }, preventDefault: vi.fn(), altKey: true });
  it("maps a crop drag and frame drag to the same design distance", () => {
    const run = callbacks("editor-canvas"), frame = { id: "f", x: 100, y: 100, width: 400, height: 400, cornerRadius: 0 };
    const scope = { size: content, format: content, pointInCanvas, viewScaleRef: { current: scale },
      pointersRef: { current: new Map([[1, { x: 200, y: 200 }]]) }, frameDragRef: { current: { pointerId: 1, start: { x: 200, y: 200 }, frame } },
      dragRef: { current: { pointerId: 1, frameId: "f", last: { x: 200, y: 200 }, distance: 0 } }, pinchRef: { current: null }, swapDragRef: { current: null },
      frames: [frame], photos: { f: { sourceWidth: 1600, sourceHeight: 800, crop: { zoom: 1, positionX: 0, positionY: 0 } } },
      moveFrameMode: false, snapEnabled: true, snapFramePosition, snapPhotoPosition, moveCrop, onCropChange: vi.fn(), onFrameMove: vi.fn(), onGuidesChange: vi.fn(),
      canvasPoint: (event: unknown) => run("canvasPoint", scope)(event) };
    run("handlePointerMove", scope)(eventAt(240, 220));
    expect(scope.onCropChange).toHaveBeenCalledWith("f", { zoom: 1, positionX: 0, positionY: 0, freePosition: { x: .1, y: .05 } });
    scope.moveFrameMode = true;
    run("handlePointerMove", scope)(eventAt(260, 230));
    expect(scope.onFrameMove).toHaveBeenCalledWith("f", 160, 130);
  });
  it("maps normalized template movement and resizing, with cancellation restoring the original draft", () => {
    const run = callbacks("template-designer"), frame = { id: "f", x: .2, y: .2, width: .3, height: .2 };
    const before = { frames: [frame], updatedAt: "unchanged", syncState: "synced" };
    const scope = { pointInCanvas, canvasRef: { current: { getBoundingClientRect: () => rect, hasPointerCapture: () => false } },
      draftRef: { current: before }, interactionRef: { current: { pointerId: 1, mode: "resize", frameId: "f", handle: "se", before, start: { x: .5, y: .4 }, selectedIds: ["f"] } as unknown },
      resizeFromCenter: false, resizeFrame, snapEnabled: false, setGuides: vi.fn(), setPast: vi.fn(), setFuture: vi.fn(),
      clamp: (n: number, min: number, max: number) => Math.min(max, Math.max(min, n)),
      pointForEvent: (event: unknown) => run("pointForEvent", scope)(event),
      updateFrames: (...args: unknown[]) => run("updateFrames", scope)(...args),
      replaceDraft: (next: typeof before) => { scope.draftRef.current = next; },
      sameTemplate: (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b) };
    run("moveInteraction", scope)(eventAt(.6 * content.width, .45 * content.height));
    expect(scope.draftRef.current.frames[0].width).toBeCloseTo(.4);
    expect(scope.draftRef.current.frames[0].height).toBeCloseTo(.25);
    run("cancelInteraction", scope)();
    expect(scope.draftRef.current).toBe(before); expect(scope.interactionRef.current).toBeNull(); expect(scope.setPast).not.toHaveBeenCalled();
    scope.interactionRef.current = { pointerId: 1, mode: "move", frameId: "f", before, start: { x: .2, y: .2 }, selectedIds: ["f"] };
    run("moveInteraction", scope)(eventAt(.25 * content.width, .3 * content.height));
    expect(scope.draftRef.current.frames[0].x).toBeCloseTo(.25); expect(scope.draftRef.current.frames[0].y).toBeCloseTo(.3);
  });
});

// Render the real viewport with a tiny hook host, so mode, pointer capture,
// cancellation and toolbar callbacks are tested without a browser dependency.
function viewHarness(editable = true) {
  const slots: { value?: unknown; deps?: unknown[]; cleanup?: () => void }[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  const captures = new Set<number>();
  const element = { clientWidth: 800, clientHeight: 650, getBoundingClientRect: () => ({ left: 20, top: 30 }),
    focus: vi.fn(), setPointerCapture: (id: number) => captures.add(id), hasPointerCapture: (id: number) => captures.has(id), releasePointerCapture: (id: number) => captures.delete(id),
    addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const hooks = { ...React, useId: () => "view-help", useRef: (value: unknown) => {
    const slot = slots[cursor++] ??= {}; if (!slot.value) slot.value = { current: value }; return slot.value;
  }, useState: (value: unknown) => {
    const slot = slots[cursor++] ??= {}; if (!("value" in slot)) slot.value = value;
    return [slot.value, (next: unknown) => { slot.value = next; }];
  }, useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
    const slot = slots[cursor++] ??= {};
    if (!slot.deps || deps.some((dep, i) => !Object.is(dep, slot.deps![i]))) {
      slot.deps = deps; effects.push(() => { slot.cleanup?.(); slot.cleanup = effect() || undefined; });
    }
  } };
  const source = readFileSync(new URL("../../components/canvas-viewport.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  const exports: Record<string, (props: object) => React.ReactElement> = {};
  new Function("require", "exports", `const React = require('react'); ${compiled}`)((name: string) => name === "react" ? hooks : viewport, exports);
  const onInteractionCancel = vi.fn(), onScaleChange = vi.fn();
  type Node = React.ReactElement<Record<string, unknown>>;
  let nodes: Node[] = [];
  const walk = (node: React.ReactNode) => { if (React.isValidElement(node)) { const item = node as Node; nodes.push(item); React.Children.forEach(item.props.children as React.ReactNode, walk); } };
  const render = () => {
    cursor = 0; effects = []; nodes = [];
    walk(exports.CanvasViewport({ ...content, label: "Test", editable, onInteractionCancel, onScaleChange, children: React.createElement("canvas") }));
    const stageNode = nodes.find(node => node.props["aria-label"] === "Test viewport")!;
    (stageNode.props.ref as { current: unknown }).current = element;
    effects.forEach(effect => effect());
  };
  const find = (label: string) => nodes.find(node => node.props["aria-label"] === label || node.props.children === label)!;
  const call = (label: string, handler: string, event?: object) => { (find(label).props[handler] as (event?: object) => void)(event); render(); };
  const transform = () => (nodes.find(node => node.props.className === "canvas-viewport-content")!.props.style as React.CSSProperties).transform;
  const pointer = (id: number, x: number, y: number) => ({ pointerId: id, clientX: x + 20, clientY: y + 30, currentTarget: element, preventDefault: vi.fn(), stopPropagation: vi.fn() });
  render(); render(); onInteractionCancel.mockClear(); onScaleChange.mockClear();
  return { call, find, transform, pointer, captures, onInteractionCancel, onScaleChange };
}

describe("viewport gesture ownership", () => {
  it("preserves modal Escape while idle and cancels a live navigation gesture", () => {
    const h = viewHarness(false), event = { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() };
    h.call("Test viewport", "onKeyDownCapture", event); expect(event.preventDefault).not.toHaveBeenCalled();
    h.call("Test viewport", "onPointerDownCapture", h.pointer(1, 200, 200));
    h.call("Test viewport", "onKeyDownCapture", event); expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(h.captures.size).toBe(0);
  });
  it("Edit leaves photo gestures alone; Navigate captures them, retains view on mode changes and Fit resets it", () => {
    const h = viewHarness(), original = h.transform(), event = h.pointer(1, 200, 200);
    h.call("Test viewport", "onPointerDownCapture", event); expect(event.stopPropagation).not.toHaveBeenCalled();
    h.call("Navigate", "onClick"); h.call("Canvas at 100%", "onClick");
    h.call("Test viewport", "onPointerDownCapture", event); expect(event.stopPropagation).toHaveBeenCalled();
    h.call("Test viewport", "onPointerMoveCapture", h.pointer(1, 150, 170));
    const enlarged = h.transform(); expect(enlarged).not.toBe(original);
    h.call("Edit", "onClick"); expect(h.transform()).toBe(enlarged); expect(h.captures.size).toBe(0);
    h.call("Navigate", "onClick"); expect(h.transform()).toBe(enlarged);
    h.call("Test viewport", "onPointerMoveCapture", h.pointer(1, 100, 100)); expect(h.transform()).toBe(enlarged);
    h.call("Fit", "onClick"); expect(h.transform()).toBe(original);
  });
  it("a cancelled pinch releases both pointers and cannot continue on a stale move", () => {
    const h = viewHarness(false);
    h.call("100% detail", "onClick");
    h.call("Test viewport", "onPointerDownCapture", h.pointer(1, 200, 200));
    h.call("Test viewport", "onPointerDownCapture", h.pointer(2, 400, 200));
    h.call("Test viewport", "onPointerMoveCapture", h.pointer(2, 550, 200));
    const enlarged = h.transform(); expect(enlarged).toContain("scale(1.75)");
    h.call("Test viewport", "onPointerCancelCapture", h.pointer(1, 200, 200)); expect(h.captures.size).toBe(0);
    h.call("Test viewport", "onPointerMoveCapture", h.pointer(2, 700, 300)); expect(h.transform()).toBe(enlarged);
  });
  it("view controls never call a composition mutation and numeric zoom remains bounded", () => {
    const h = viewHarness();
    h.call("Zoom canvas in", "onClick"); h.call("Zoom canvas out", "onClick");
    h.call("Canvas at 100%", "onClick"); expect(h.transform()).toContain("scale(1)");
    h.call("Navigate", "onClick");
    for (let i = 0; i < 12; i++) h.call("Zoom canvas in", "onClick");
    expect(h.transform()).toContain("scale(4)");
    expect(h.onScaleChange).toHaveBeenLastCalledWith(4);
    // This component receives no page, crop, template, persistence or Undo setter.
    expect(h.onInteractionCancel).toHaveBeenCalled();
  });
});

it("cancelling an editor gesture cannot complete a swap, open the picker or apply a stale crop/frame move", () => {
  const run = callbacks("editor-canvas");
  for (const mode of ["photo", "frame", "swap"]) {
    const scope = { pointersRef: { current: new Map([[1, { x: 20, y: 20 }]]) },
      dragRef: { current: { frameId: "f", last: { x: 20, y: 20 }, distance: 0 } },
      pinchRef: { current: { frameId: "f", startDistance: 100, startZoom: 1 } },
      swapDragRef: { current: mode === "swap" ? { pointerId: 1, sourceFrameId: "f", targetFrameId: "other" } : null },
      frameDragRef: { current: mode === "frame" ? { pointerId: 1 } : null }, wheelRef: { current: { frameId: "f" } },
      canvasRef: { current: { hasPointerCapture: () => true, releasePointerCapture: vi.fn() } },
      moveFrameMode: mode === "frame", setSwapTargetFrameId: vi.fn(), onGuidesChange: vi.fn(),
      onMovePhoto: vi.fn(), onRequestPhoto: vi.fn(), onCropChange: vi.fn(), onFrameMove: vi.fn() };
    run("cancelInteraction", scope)();
    const event = { pointerId: 1, preventDefault: vi.fn() };
    run("handlePointerMove", scope)(event); run("endPointer", scope)(event, true);
    expect(scope.pointersRef.current.size).toBe(0); expect(scope.pinchRef.current).toBeNull();
    for (const action of [scope.onMovePhoto, scope.onRequestPhoto, scope.onCropChange, scope.onFrameMove]) expect(action).not.toHaveBeenCalled();
  }
});

describe("free photo gesture integration", () => {
  const run = callbacks("editor-canvas");
  function harness(scale = 1, snap = true) {
    const frame = { id: "f", x: 100, y: 100, width: 400, height: 300, cornerRadius: 0 };
    const photos = { f: { blobKey: "synthetic", sourceWidth: 800, sourceHeight: 600, crop: { ...DEFAULT_CROP, zoom: .5 } as CropState } };
    const target = { getBoundingClientRect: () => ({ left: -100, top: -200, width: 1080 * scale, height: 1350 * scale }),
      focus: vi.fn(), setPointerCapture: vi.fn(), hasPointerCapture: () => false };
    const scope = { photos, frames: [frame], selectedFrameId: "f", size: content, format: content, viewScaleRef: { current: scale },
      pointersRef: { current: new Map() }, dragRef: { current: null as unknown }, pinchRef: { current: null as unknown },
      frameDragRef: { current: null }, swapDragRef: { current: null }, wheelRef: { current: null }, canvasRef: { current: target },
      moveFrameMode: false, rearrangeMode: false, snapEnabled: snap, unavailableFrameIds: [],
      pointInCanvas, moveCrop, snapPhotoPosition, setSwapTargetFrameId: vi.fn(), onSelectFrame: vi.fn(), onGuidesChange: vi.fn(),
      onRequestPhoto: vi.fn(), onMovePhoto: vi.fn(),
      onCropChange: vi.fn((id: string, crop: CropState) => { photos.f.crop = crop; }),
      onZoomChange: vi.fn((id: string, zoom: number, tolerance: number) => { photos.f.crop = snapPhotoZoom(photos, [frame], id, zoom, tolerance)!.crop; }),
      hitTest: (frames: typeof frame[], point: { x: number; y: number }) => frames.find(f => point.x >= f.x && point.x <= f.x + f.width && point.y >= f.y && point.y <= f.y + f.height),
      pointerDistance: ([a, b]: { x: number; y: number }[]) => Math.hypot(a.x - b.x, a.y - b.y),
      canvasPoint: (event: unknown): { x: number; y: number } => run("canvasPoint", scope)(event) };
    const event = (pointerId: number, x: number, y: number, altKey = false) => ({ pointerId, clientX: -100 + x * scale, clientY: -200 + y * scale,
      currentTarget: target, altKey, preventDefault: vi.fn() });
    return { scope, photos, event, call: (name: string, ...args: unknown[]) => run(name, scope)(...args) };
  }

  it.each([.25, 1, 3])("passes through centre using small pointer deltas at %sx viewport scale", scale => {
    const h = harness(scale);
    h.call("handlePointerDown", h.event(1, 200, 200));
    for (let i = 1; i <= 12; i++) h.call("handlePointerMove", h.event(1, 200 + i / scale, 200 - i / scale));
    expect(h.photos.f.crop.freePosition!.x * 400 * scale).toBeCloseTo(12);
    expect(h.photos.f.crop.freePosition!.y * 300 * scale).toBeCloseTo(-12);
    expect(h.photos.f.crop.zoom).toBe(.5);
    expect(h.scope.onRequestPhoto).not.toHaveBeenCalled(); expect(h.scope.onMovePhoto).not.toHaveBeenCalled();
  });

  it("does not lose rapid deltas before React rerenders, and Snap off/Alt permits exact small moves", () => {
    for (const snap of [true, false]) {
      const h = harness(1, snap), original = h.photos.f.crop;
      h.scope.onCropChange.mockImplementation(() => undefined); // no props update between events
      h.call("handlePointerDown", h.event(1, 200, 200));
      for (let i = 1; i <= 10; i++) h.call("handlePointerMove", h.event(1, 200 + i, 200 + i, true));
      expect(h.scope.onCropChange).toHaveBeenLastCalledWith("f", { ...original, freePosition: { x: expect.closeTo(.025), y: expect.closeTo(10 / 300) } });
      expect(h.photos.f.crop).toBe(original);
    }
    const h = harness(1, false);
    h.call("handlePointerDown", h.event(1, 200, 200)); h.call("handlePointerMove", h.event(1, 201, 199));
    expect(h.photos.f.crop.freePosition).toEqual({ x: 1 / 400, y: -1 / 300 });
  });

  it("continues one-finger positioning after pinch, even when the second finger started outside a frame", () => {
    const h = harness(1, false);
    h.call("handlePointerDown", h.event(1, 200, 200));
    h.call("handlePointerMove", h.event(1, 240, 220));
    const offset = h.photos.f.crop.freePosition;
    h.call("handlePointerDown", h.event(2, 600, 220)); // page background
    h.call("handlePointerMove", h.event(2, 780, 220));
    expect(h.photos.f.crop.zoom).toBe(.75); expect(h.photos.f.crop.freePosition).toEqual(offset);
    h.call("endPointer", h.event(2, 780, 220), true);
    h.call("handlePointerMove", h.event(1, 260, 205));
    expect(h.photos.f.crop.freePosition!.x).toBeCloseTo(.15);
    expect(h.photos.f.crop.freePosition!.y).toBeCloseTo(5 / 300);
    h.call("cancelInteraction"); const crop = h.photos.f.crop;
    h.call("handlePointerMove", h.event(1, 900, 900)); expect(h.photos.f.crop).toBe(crop);
  });

  it("selection alone does not opt a legacy crop into new geometry", () => {
    const h = harness(), crop = h.photos.f.crop;
    h.call("handlePointerDown", h.event(1, 200, 200)); h.call("endPointer", h.event(1, 200, 200), true);
    expect(h.photos.f.crop).toBe(crop); expect(h.scope.onCropChange).not.toHaveBeenCalled();
  });

  it("Centre and Reset use distinct Undo groups and Centre preserves zoom", () => {
    const app = callbacks("layouts-app"), selectedPhoto = { crop: moveCrop(800, 600, { id: "f", x: 0, y: 0, width: 400, height: 300, cornerRadius: 0 }, { ...DEFAULT_CROP, zoom: .37125 }, 70, -30) };
    const scope = { selectedFrameId: "f", selectedPhoto, centreCrop, DEFAULT_CROP, updateCrop: vi.fn(), setAlignmentGuides: vi.fn() };
    app("centreSelected", scope)(); app("resetSelected", scope)();
    expect(scope.updateCrop).toHaveBeenNthCalledWith(1, "f", expect.objectContaining({ zoom: .37125, freePosition: { x: 0, y: 0 } }), "centre-photo");
    expect(scope.updateCrop).toHaveBeenNthCalledWith(2, "f", DEFAULT_CROP, "reset-photo");
  });
});
