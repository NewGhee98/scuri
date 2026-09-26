import { readFileSync } from "node:fs";
import * as React from "react";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as layout from "../template-layout";
import * as formats from "../formats";
import * as templates from "../templates";
import * as selection from "../selection-style";
import * as viewport from "../canvas-viewport";
import * as text from "../text";
import { createBlankCustomTemplate } from "../custom-templates";
import type { CustomTemplate } from "../types";

const size = { width: 1080, height: 1350 };
function fixture(): CustomTemplate {
  return { ...createBlankCustomTemplate("instagram-post"), frames: [
    { id: "a", x: .1, y: .1, width: .3, height: .18 },
    { id: "b", x: .5, y: .4, width: .2, height: .1 },
    { id: "c", x: .1, y: .7, width: .4, height: .15 },
  ] };
}

// Exercise the real component and its callbacks with a queued-update hook host.
// Browser QA separately covers DOM layout, native numeric input and touch hit areas.
function harness(initial = fixture(), scale = 1) {
  const slots: { value?: unknown; deps?: unknown[]; cleanup?: () => void }[] = [];
  const pendingUpdates: (() => void)[] = [];
  let cursor = 0, effects: (() => void)[] = [];
  const hooks = { ...React, useRef: (value: unknown) => {
    const slot = slots[cursor++] ??= {}; if (!slot.value) slot.value = { current: value }; return slot.value;
  }, useState: (value: unknown) => {
    const slot = slots[cursor++] ??= {}; if (!("value" in slot)) slot.value = typeof value === "function" ? value() : value;
    // React may evaluate a functional updater after the handler changes a ref.
    // Queue it until render so history tests cannot accidentally rely on eager evaluation.
    return [slot.value, (next: unknown) => { pendingUpdates.push(() => { slot.value = typeof next === "function" ? next(slot.value) : next; }); }];
  }, useMemo: (fn: () => unknown) => fn(), useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
    const slot = slots[cursor++] ??= {};
    if (!slot.deps || deps.some((dep, i) => !Object.is(dep, slot.deps![i]))) {
      slot.deps = deps; effects.push(() => { slot.cleanup?.(); slot.cleanup = effect() || undefined; });
    }
  } };
  const source = readFileSync(new URL("../../components/template-designer.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  const exports: Record<string, (props: object) => React.ReactElement> = {};
  const dependencies: Record<string, unknown> = { react: hooks, "@/lib/template-layout": layout, "@/lib/formats": formats,
    "@/lib/templates": templates, "@/lib/selection-style": selection, "@/lib/canvas-viewport": viewport,
    "@/lib/text": text, "./text-tools": { TextTools: function TextTools() { return null; } },
    "./canvas-viewport": { CanvasViewport: function CanvasViewport() { return null; } } };
  const textModule = {};
  new Function("require", "exports", ts.transpileModule(readFileSync(new URL("../../components/text-layer.tsx", import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText)((name: string) => dependencies[name], textModule);
  dependencies["./text-layer"] = textModule;
  new Function("require", "exports", `const React = require('react'); ${compiled}`)((name: string) => {
    if (!(name in dependencies)) throw Error(`Missing test dependency ${name}`); return dependencies[name];
  }, exports);
  const captures = new Set<number>();
  const canvas = { getBoundingClientRect: () => ({ left: -100, top: -60, width: size.width * scale, height: size.height * scale }),
    setPointerCapture: (id: number) => captures.add(id), hasPointerCapture: (id: number) => captures.has(id), releasePointerCapture: (id: number) => captures.delete(id) };
  vi.stubGlobal("window", { setTimeout: (fn: () => void) => { fn(); return 1; }, clearTimeout: vi.fn() });
  const changed = vi.fn(), saved = vi.fn();
  type Node = React.ReactElement<Record<string, unknown>>;
  let nodes: Node[] = [];
  const walk = (node: React.ReactNode) => { if (React.isValidElement(node)) { const item = node as Node; nodes.push(item); React.Children.forEach(item.props.children as React.ReactNode, walk); } };
  const render = () => {
    pendingUpdates.splice(0).forEach(update => update());
    cursor = 0; effects = []; nodes = [];
    walk(exports.TemplateDesigner({ initialTemplate: initial, onCancel: vi.fn(), onDraftChange: changed, onSave: saved, saving: false }));
    (nodes.find(n => typeof n.props.className === "string" && n.props.className.startsWith("template-design-canvas"))!.props.ref as { current: unknown }).current = canvas;
    effects.forEach(fn => fn());
  };
  const find = (label: string) => {
    const found = nodes.find(n => n.props["aria-label"] === label || n.props.label === label) ?? nodes.find(n => n.props.children === label);
    if (!found) throw Error(`No control: ${label}`); return found;
  };
  const call = (label: string, handler = "onClick", event?: unknown) => { (find(label).props[handler] as (event: unknown) => void)(event); render(); };
  const canvasCall = (handler: string, event: unknown) => {
    const node = nodes.find(n => typeof n.props.className === "string" && n.props.className.startsWith("template-design-canvas"))!;
    (node.props[handler] as (event: unknown) => void)(event); render();
  };
  const pointer = (frameId: string, x = 200, y = 200, handle?: string, shared = false, pointerId = 1) => ({
    pointerId, pointerType: "touch", clientX: -100 + x * scale, clientY: -60 + y * scale,
    preventDefault: vi.fn(), stopPropagation: vi.fn(), target: { closest: (selector: string) =>
      selector === "[data-template-frame-id]" ? (shared ? null : { dataset: { templateFrameId: frameId } })
        : handle ? { dataset: { resizeHandle: handle }, hasAttribute: () => shared } : null },
  });
  const tap = (id: string) => { canvasCall("onPointerDown", pointer(id)); canvasCall("onPointerUp", pointer(id)); };
  const toggle = (label: string, checked: boolean) => {
    const parent = nodes.find(n => n.type === "label" && React.Children.toArray(n.props.children as React.ReactNode).some(c => typeof c === "string" && c.trim() === label))!;
    const input = React.Children.toArray(parent.props.children as React.ReactNode).find(c => React.isValidElement(c) && c.type === "input") as Node;
    (input.props.onChange as (event: unknown) => void)({ target: { checked } }); render();
  };
  render();
  const view = nodes.find(n => n.props.label === "Template canvas")!;
  (view.props.onScaleChange as (scale: number) => void)(scale); render(); changed.mockClear();
  return { call, find, tap, pointer, canvasCall, toggle, changed, saved, render, nodes: () => nodes,
    draft: () => (changed.mock.calls.at(-1)?.[0] ?? initial) as CustomTemplate };
}
afterEach(() => vi.unstubAllGlobals());

describe("template designer selection and edits", () => {
  it("commits the latest native colour event before a rerender and never commits a cancelled draft on blur", () => {
    const initial = fixture(); initial.textLayers = [text.createTextBox("title")];
    const h = harness(initial); h.call("Text");
    const tools = () => h.nodes().find(node => node.props.placeholders === true)!;
    const callbacks = tools().props;
    (callbacks.onPreview as (v: unknown) => void)([{ ...initial.textLayers[0], colour: "#ffffff" }]);
    (callbacks.onCommit as () => void)(); h.render();
    expect(h.draft().textLayers![0].colour).toBe("#ffffff");
    h.call("Undo"); expect(h.draft()).toEqual(initial);
    const canceled = tools().props;
    (canceled.onPreview as (v: unknown) => void)([{ ...initial.textLayers[0], opacity: .2 }]);
    (canceled.onCancel as () => void)();
    (canceled.onCommit as () => void)(); h.render();
    expect(h.draft()).toEqual(initial);
    expect(h.find("Undo").props.disabled).toBe(true);
  });

  it("keeps text slider drafts out of autosave, commits once and restores the complete action with Undo/Redo", () => {
    const initial = fixture(), h = harness(initial);
    h.call("Text");
    const tools = () => h.nodes().find(node => node.props.placeholders === true)!;
    const commit = (boxes: unknown) => { (tools().props.onCommit as (v: unknown) => void)(boxes); h.render(); };
    commit([text.createTextBox("title")]);
    const base = structuredClone(h.draft());
    const preview = (boxes: unknown) => { (tools().props.onPreview as (v: unknown) => void)(boxes); h.render(); };
    preview([{ ...base.textLayers![0], fontSize: 70 }]);
    preview([{ ...base.textLayers![0], fontSize: 80, letterSpacing: 10 }]);
    expect(h.draft()).toEqual(base);
    (tools().props.onCommit as () => void)(); h.render();
    expect(h.draft().textLayers![0]).toMatchObject({ fontSize: 80, letterSpacing: 10 });
    h.call("Undo"); expect(h.draft()).toEqual(base);
    h.call("Redo"); expect(h.draft().textLayers![0].fontSize).toBe(80);
    expect(h.draft().frames).toEqual(initial.frames);
    const beforeCancel = structuredClone(h.draft());
    preview([{ ...base.textLayers![0], x: .2 }]);
    (tools().props.onCancel as () => void)(); h.render();
    expect(h.draft()).toEqual(beforeCancel);
  });

  it("lets an unlocked frame choose its existing proportion as a preset and acquire the lock", () => {
    const initial = fixture(); initial.frames = layout.setFrameRatio(initial.frames, ["a"], { width: 40, height: 9 }, size).frames;
    initial.frames[0].aspectRatioLocked = false; delete initial.frames[0].aspectRatio;
    const h = harness(initial); expect(h.find("Frame proportion").props.value).toBe("current");
    h.call("Frame proportion", "onChange", { target: { value: "5" } });
    expect(h.draft().frames[0].aspectRatioLocked).toBe(true); expect(h.find("Frame proportion").props.value).toBe("5");
    expect(h.draft().frames[0].width).toBe(initial.frames[0].width); expect(h.draft().frames[0].height).toBe(initial.frames[0].height);
  });
  it("toggles frames by touch, records no edit for selection, and exposes four shared handles", () => {
    const initial = fixture(), before = structuredClone(initial), h = harness(initial);
    h.call("Select multiple"); h.tap("b"); h.tap("c"); h.tap("b");
    expect(h.nodes().filter(n => n.props.className === "frame-selection-shade")).toHaveLength(2);
    expect(h.nodes().filter(n => n.props["data-selection-handle"] !== undefined)).toHaveLength(4);
    expect(h.changed).not.toHaveBeenCalled(); expect(h.find("Undo").props.disabled).toBe(true);
    expect(initial).toEqual(before);
    h.call("Done selecting"); h.call("Reference frame", "onChange", { target: { value: "a" } });
    h.call("Same width"); expect(h.draft().frames[2].width).toBeCloseTo(.3);
    expect(h.draft().frames[1]).toEqual(initial.frames[1]);
    h.call("Undo"); expect(h.draft()).toEqual(initial);
  });
  it("applies presets to every selected frame with a single Undo and supports explicit unlock", () => {
    const initial = fixture(), h = harness(initial); h.call("Select all");
    h.call("Frame proportion", "onChange", { target: { value: "5" } });
    h.draft().frames.forEach(frame => { expect(layout.actualFrameRatio(frame, size)).toBeCloseTo(40 / 9, 12); expect(frame.aspectRatioLocked).toBe(true); });
    h.call("Undo"); expect(h.draft()).toEqual(initial); expect(h.find("Undo").props.disabled).toBe(true);
    h.call("Redo"); h.toggle("Lock aspect ratio", false);
    h.draft().frames.forEach(frame => { expect(frame.aspectRatioLocked).toBe(false); expect(frame.aspectRatio).toBeUndefined(); });
    h.call("Undo"); h.draft().frames.forEach(frame => expect(frame.aspectRatioLocked).toBe(true));
  });
  it("arranges, centres, updates exact gaps/margins and restores both metadata and geometry with Undo", () => {
    const h = harness(); h.call("Select all");
    h.call("Frame proportion", "onChange", { target: { value: "5" } });
    h.call("Frame width (px)", "onCommit", 800);
    h.call("Vertical stack"); const arranged = structuredClone(h.draft());
    expect(new Set(arranged.frames.map(f => f.arrangement?.id)).size).toBe(1);
    h.call("Gap (px)", "onCommit", 0); h.draft().frames.forEach(f => expect(f.arrangement?.gap).toBe(0));
    h.call("Undo"); expect(h.draft()).toEqual(arranged);
    h.call("All margins (px)", "onCommit", 32); h.call("Centre group");
    const bounds = layout.frameBounds(h.draft().frames); expect(bounds.x + bounds.width / 2).toBeCloseTo(.5); expect(bounds.y + bounds.height / 2).toBeCloseTo(.5);
    h.call("Save template"); expect(h.saved).toHaveBeenCalledWith(expect.objectContaining({ status: "saved", frames: h.draft().frames }));
    const restored = harness(JSON.parse(JSON.stringify(h.saved.mock.calls[0][0])));
    restored.call("Select arrangement"); restored.call("Frame width (px)", "onCommit", 700);
    restored.draft().frames.forEach(f => expect(f.arrangement?.gap).toBe(32));
    const beforeRelease = structuredClone(restored.draft()); restored.call("Release arrangement");
    expect(restored.draft().frames.every(f => !f.arrangement)).toBe(true);
    restored.call("Undo"); expect(restored.draft()).toEqual(beforeRelease);
  });
  it("keeps preview clean without saving selection, gaps, guides or viewport state into geometry", () => {
    const h = harness(); h.call("Select all"); h.call("Vertical stack");
    const before = structuredClone(h.draft()); h.changed.mockClear();
    h.call("Preview");
    expect(h.nodes().filter(n => n.props.className === "frame-selection-shade" || n.props.className === "template-gap-measure" || n.props["data-resize-handle"])).toHaveLength(0);
    expect(h.changed).not.toHaveBeenCalled(); h.call("Save template");
    expect(h.saved.mock.calls[0][0].frames).toEqual(before.frames);
    expect(h.saved.mock.calls[0][0]).not.toHaveProperty("selectedIds"); expect(h.saved.mock.calls[0][0]).not.toHaveProperty("viewScale");
  });
  it("resizes from a focused handle with the keyboard and keeps the action undoable", () => {
    const initial = fixture(), h = harness(initial);
    h.canvasCall("onKeyDown", { key: "ArrowRight", shiftKey: true, preventDefault: vi.fn(), stopPropagation: vi.fn(),
      target: { closest: () => ({ dataset: { resizeHandle: "se" } }) } });
    expect(h.draft().frames[0].width * size.width).toBeCloseTo(initial.frames[0].width * size.width + 10);
    expect(h.draft().frames.slice(1)).toEqual(initial.frames.slice(1)); h.call("Undo"); expect(h.draft()).toEqual(initial);
  });
  it.each([true, false])("matching-gap drag guides respect Snap=%s and release when dragged through", snap => {
    const initial = fixture(); initial.frames = [100, 232, 400].map((x, i) => ({ id: String(i), x: x / 1080, y: 100 / 1350, width: 100 / 1080, height: 200 / 1350 }));
    const h = harness(initial); h.toggle("Snap", snap);
    h.canvasCall("onPointerDown", h.pointer("2", 450, 200));
    h.canvasCall("onPointerMove", h.pointer("2", 416, 200));
    expect(h.draft().frames[2].x * 1080).toBeCloseTo(snap ? 364 : 366);
    expect(h.nodes().some(n => n.props.className === "matching-gap-guide x")).toBe(snap);
    h.canvasCall("onPointerMove", h.pointer("2", 422, 200));
    expect(h.draft().frames[2].x * 1080).toBeCloseTo(372);
    expect(h.nodes().some(n => n.props.className === "matching-gap-guide x")).toBe(false);
    h.canvasCall("onPointerUp", h.pointer("2", 422, 200)); h.call("Undo"); expect(h.draft()).toEqual(initial);
  });
});

describe.each([.25, 1, 3])("real multi-resize callbacks at %sx viewport scale", scale => {
  it("maps screen movement correctly, ignores a second pointer and commits the continuous gesture as one undo action", () => {
    const initial = fixture(), h = harness(initial, scale); h.call("Select all");
    const bounds = layout.frameBounds(initial.frames), startX = (bounds.x + bounds.width) * size.width, startY = (bounds.y + bounds.height) * size.height;
    h.canvasCall("onPointerDown", h.pointer("a", startX, startY, "se", true));
    h.canvasCall("onPointerDown", h.pointer("b", 100, 100, "nw", false, 2));
    h.canvasCall("onPointerMove", h.pointer("a", startX - 30, startY - 40));
    h.canvasCall("onPointerMove", h.pointer("a", startX - 60, startY - 80));
    h.canvasCall("onPointerUp", h.pointer("a", startX - 60, startY - 80));
    const expected = layout.resizeLayoutSelection(initial.frames, initial.frames.map(f => f.id), "se", -60 / size.width, -80 / size.height, false, size);
    expect(h.draft().frames).toEqual(expected.frames); h.call("Undo"); expect(h.draft()).toEqual(initial);
    expect(h.find("Undo").props.disabled).toBe(true);
  });
  it("cancels an unfinished shared resize and cannot continue on stale pointer movement", () => {
    const initial = fixture(), h = harness(initial, scale); h.call("Select all");
    h.canvasCall("onPointerDown", h.pointer("a", 500, 500, "se", true));
    h.canvasCall("onPointerMove", h.pointer("a", 420, 420)); expect(h.draft().frames).not.toEqual(initial.frames);
    h.canvasCall("onPointerCancel", h.pointer("a", 420, 420)); expect(h.draft()).toEqual(initial);
    h.canvasCall("onPointerMove", h.pointer("a", 300, 300)); expect(h.draft()).toEqual(initial);
    expect(h.find("Undo").props.disabled).toBe(true);
  });
});
