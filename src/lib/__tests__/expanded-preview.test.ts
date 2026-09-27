import { readFileSync } from "node:fs";
import * as React from "react";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as settings from "../export-settings";
import * as project from "../project";
import { applyHydratedPhotos, serializePage } from "../project-photos";
import { getFormat } from "../formats";
import { getTemplate } from "../templates";
import type { ProjectPage } from "../types";

type Node = React.ReactElement<Record<string, unknown>>;
// Execute the real component, including asynchronous effects and their cleanup.
// No browser dependency or duplicate implementation of preview state is used.
function harness() {
  vi.useFakeTimers();
  const slots: { value?: unknown; deps?: unknown[]; cleanup?: () => void }[] = [];
  let cursor = 0, nodes: Node[] = [], effects: (() => void)[] = [];
  const hooks = { ...React, useContext: () => null, useRef: (value: unknown) => {
    const slot = slots[cursor++] ??= {}; slot.value ??= { current: value }; return slot.value;
  }, useState: (value: unknown) => {
    const slot = slots[cursor++] ??= {}; if (!("value" in slot)) slot.value = value;
    return [slot.value, (next: unknown) => { slot.value = typeof next === "function" ? next(slot.value) : next; }];
  }, useMemo: (make: () => unknown, deps: unknown[]) => {
    const slot = slots[cursor++] ??= {};
    if (!slot.deps || deps.some((dep, i) => !Object.is(dep, slot.deps![i]))) { slot.value = make(); slot.deps = deps; }
    return slot.value;
  }, useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
    const slot = slots[cursor++] ??= {};
    if (!slot.deps || deps.some((dep, i) => !Object.is(dep, slot.deps![i]))) {
      slot.deps = deps; effects.push(() => { slot.cleanup?.(); slot.cleanup = effect() || undefined; });
    }
  } };
  const template = getTemplate("instagram-square-full-frame");
  const frame = template.frames[0].id;
  const pages: ProjectPage[] = [1, 2, 3].map(n => ({ id: "page-" + n, templateId: template.id,
    background: "#eeddbb", gutter: 36, selectedFrameId: frame,
    photos: { [frame]: { frameId: frame, blobKey: "original-" + n, sourceBlob: new Blob(["original"]),
      sourceWidth: 3000, sourceHeight: 2000, previewUrl: "blob:thumbnail", crop: { zoom: .75, positionX: .1, positionY: -.2 } } },
    createdAt: "2026-09-27", updatedAt: "2026-09-27" }));
  const renderJpeg = vi.fn(async (page: ProjectPage) => new Blob([page.id], { type: "image/jpeg" }));
  const hydrate = vi.fn(async () => []);
  const createUrl = vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:render-" + createUrl.mock.calls.length);
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const modules: Record<string, unknown> = { react: hooks, "next/image": () => null,
    "@/lib/export": { renderPagePreview: renderJpeg }, "@/lib/export-settings": settings, "@/lib/project": project,
    "@/lib/project-photos": { hydrateProjectPhotos: hydrate, applyHydratedPhotos }, "@/lib/image": { disposePhotoAsset: vi.fn() },
    "./photo-preview-context": { PhotoPreviewContext: {} }, "./export-quality-review": { ExportQualityReview: "quality" },
    "./canvas-viewport": { CanvasViewport: "viewport" }, "./export-fullscreen-viewer": { ExportFullscreenViewer: "fullscreen" } };
  const source = readFileSync(new URL("../../components/page-preview.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  const exports: { PagePreview?: (props: object) => React.ReactNode } = {};
  new Function("require", "exports", "const React = require('react'); " + compiled)((id: string) => {
    if (!(id in modules)) throw new Error("Unexpected import " + id); return modules[id];
  }, exports);
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  vi.stubGlobal("HTMLElement", class {});
  vi.stubGlobal("document", { activeElement: null, body: { style: { overflow: "auto" } } });
  const props = { pages, initialPageId: "page-2", pageNumbers: [1, 2, 3], format: getFormat("instagram-square"),
    resolveTemplate: () => template, outputWidth: 2160, onOutputWidthChange: (width: number) => { props.outputWidth = width; }, onClose: vi.fn() };
  function render() {
    cursor = 0; effects = []; nodes = [];
    const walk = (child: React.ReactNode) => { if (React.isValidElement(child)) { const node = child as Node; nodes.push(node); React.Children.forEach(node.props.children as React.ReactNode, walk); } };
    walk(exports.PagePreview!(props));
    const dialog = nodes.find(node => node.type === "dialog")!;
    (dialog.props.ref as { current: unknown }).current = { showModal: vi.fn() };
    effects.forEach(effect => effect());
  }
  const find = (label: string) => nodes.find(node => node.type === label || node.props.children === label || node.props.className === label)!;
  const call = (label: string, handler: string, ...args: unknown[]) => { (find(label).props[handler] as (...args: unknown[]) => void)(...args); render(); };
  const settle = async () => { await vi.advanceTimersByTimeAsync(250); render(); };
  render();
  return { props, find, call, settle, render, renderJpeg, hydrate, createUrl, revoke, pages,
    unmount: () => slots.forEach(slot => slot.cleanup?.()) };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("expanded export preview", () => {
  it("removes the whole quality column when its details collapse, and restores it from the toolbar", async () => {
    const h = harness(); await h.settle();
    expect(h.find("page-preview-body quality-open")).toBeTruthy(); expect(h.find("aside")).toBeTruthy();
    h.call("quality", "onCollapse");
    expect(h.find("aside")).toBeUndefined(); expect(h.find("page-preview-body")).toBeTruthy();
    h.call("Photo quality", "onClick"); expect(h.find("aside")).toBeTruthy();
    h.unmount();
  });
  it("opens the exact rendered JPEG, browses independently, and restores the previous page and settings", async () => {
    const h = harness(), before = h.pages.map(serializePage); await h.settle();
    const image = h.find("viewport").props.children as Node;
    h.call("Photo quality", "onClick"); h.call("Full screen", "onClick");
    expect(h.find("fullscreen").props.url).toBe(image.props.src);
    expect(h.find("fullscreen").props.size).toEqual({ width: 2160, height: 2160 });
    expect(h.renderJpeg).toHaveBeenCalledTimes(1); // Opening borrows the existing image.
    const ordinaryViewportKey = h.find("viewport").key;
    h.call("fullscreen", "onNavigate", 1); expect(h.find("fullscreen").props.url).toBeUndefined();
    expect(h.find("viewport").key).toBe(ordinaryViewportKey);
    expect((h.find("viewport").props.children as Node).props.src).toBe(image.props.src);
    await h.settle(); expect(h.find("fullscreen").props.pageNumber).toBe(3);
    h.call("fullscreen", "onClose"); await h.settle();
    expect(h.find("fullscreen")).toBeUndefined();
    expect(h.renderJpeg).toHaveBeenCalledTimes(2);
    expect(h.find("viewport").key).toBe(ordinaryViewportKey);
    expect((h.find("viewport").props.children as Node).props.src).toBe(image.props.src);
    expect(h.props.outputWidth).toBe(2160); expect(h.find("aside")).toBeUndefined();
    expect(h.pages.map(serializePage)).toEqual(before); expect(h.props.onClose).not.toHaveBeenCalled();
    h.unmount(); expect(h.revoke.mock.calls.length).toBe(h.createUrl.mock.calls.length);
  });
  it("does not show a stale asynchronous JPEG under another page, including after Close", async () => {
    const h = harness(); await h.settle(); h.call("Full screen", "onClick");
    let resolve!: (value: Blob) => void;
    h.renderJpeg.mockImplementationOnce(() => new Promise<Blob>(done => { resolve = done; }));
    h.call("fullscreen", "onNavigate", 1); await h.settle();
    h.call("fullscreen", "onClose"); await h.settle();
    const image = h.find("viewport").props.children as Node;
    resolve(new Blob(["late page 3"])); await h.settle();
    expect((h.find("viewport").props.children as Node).props.src).toBe(image.props.src);
    expect(h.find("fullscreen")).toBeUndefined(); h.unmount();
  });
  it("keeps originals and crops intact if a full-screen page cannot render, and retains an exit", async () => {
    const h = harness(), before = h.pages.map(serializePage); await h.settle(); h.call("Full screen", "onClick");
    h.renderJpeg.mockRejectedValueOnce(new Error("Original unavailable"));
    h.call("fullscreen", "onNavigate", 1); await h.settle();
    expect(h.find("fullscreen").props.error).toBe("Original unavailable");
    expect(h.find("fullscreen").props.url).toBeUndefined();
    h.call("fullscreen", "onClose"); await h.settle();
    expect(h.find("viewport")).toBeTruthy(); expect(h.pages.map(serializePage)).toEqual(before); h.unmount();
  });
  it("a child dialog cancel cannot close the ordinary preview", () => {
    const h = harness(), event = { target: {}, currentTarget: {}, preventDefault: vi.fn() };
    h.call("dialog", "onCancel", event); expect(h.props.onClose).not.toHaveBeenCalled();
    event.target = event.currentTarget; h.call("dialog", "onCancel", event);
    expect(h.props.onClose).toHaveBeenCalledOnce(); h.unmount();
  });
});
