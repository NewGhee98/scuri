import { readFileSync } from "node:fs";
import * as React from "react";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as gallery from "../library-gallery";
import * as metadata from "../photo-metadata";
import * as gestures from "../photo-gallery-gestures";
import { DEFAULT_LIBRARY_VIEW, type LibraryRow } from "../photo-library-view";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const pointer = (extra: object = {}) => ({ pointerId: 1, clientX: 120, clientY: 200, isPrimary: true, button: 0,
  pointerType: "touch", preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra });

describe("photo hold selection", () => {
  it("selects after a steady hold, consumes its click, and keeps the next ordinary tap", () => {
    const hold = gestures.createPhotoHoldGesture(), select = vi.fn();
    hold.begin(pointer(), "a", select); vi.advanceTimersByTime(499); expect(select).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(select).toHaveBeenCalledExactlyOnceWith("a");
    hold.end(1); expect(hold.consumeClick("a")).toBe(true); expect(hold.consumeClick("a")).toBe(false);
    hold.begin(pointer(), "a", select); hold.end(1);
    expect(hold.consumeClick("a")).toBe(false);
  });

  it("does not swallow a later tap when the browser omitted the held gesture's click", () => {
    const hold = gestures.createPhotoHoldGesture();
    hold.begin(pointer(), "a", vi.fn()); vi.advanceTimersByTime(500); hold.end(1);
    hold.begin(pointer(), "a", vi.fn()); hold.end(1);
    expect(hold.consumeClick("a")).toBe(false);
  });

  it.each(["movement", "scroll/cancel", "second pointer", "early release"])("cancels on %s without selecting or suppressing taps", cause => {
    const hold = gestures.createPhotoHoldGesture(), select = vi.fn();
    hold.begin(pointer(), "a", select); vi.advanceTimersByTime(300);
    if (cause === "movement") hold.move(pointer({ clientY: 211 }));
    else if (cause === "scroll/cancel") hold.cancel();
    else if (cause === "second pointer") hold.begin(pointer({ pointerId: 2, isPrimary: false }), "b", select);
    else hold.end(1);
    vi.advanceTimersByTime(1000); expect(select).not.toHaveBeenCalled(); expect(hold.consumeClick("a")).toBe(false);
  });

  it("maps filtered drop targets to whole-library positions in either direction", () => {
    expect(gestures.photoDropPosition(2, 8, false, 10)).toBe(7);
    expect(gestures.photoDropPosition(2, 8, true, 10)).toBe(8);
    expect(gestures.photoDropPosition(8, 2, false, 10)).toBe(2);
    expect(gestures.photoDropPosition(8, 2, true, 10)).toBe(3);
    expect(gestures.photoDropPosition(4, 4, true, 10)).toBe(4);
  });

  it("scrolls only near an edge, with bounded speed in either direction", () => {
    expect(gestures.galleryDragScrollSpeed(300, 0, 600)).toBe(0);
    expect(gestures.galleryDragScrollSpeed(20, 0, 600)).toBeLessThan(0);
    expect(gestures.galleryDragScrollSpeed(580, 0, 600)).toBeGreaterThan(0);
    expect(gestures.galleryDragScrollSpeed(900, 0, 600)).toBe(14);
    expect(gestures.galleryDragScrollSpeed(-100, 0, 600)).toBe(-14);
  });
});

type Node = React.ReactElement<Record<string, unknown>>;
function nodes(root: React.ReactNode): Node[] {
  return React.Children.toArray(root).flatMap(child => React.isValidElement(child) ? [child as Node, ...nodes((child.props as { children?: React.ReactNode }).children)] : []);
}

// Run the actual component and handlers with deterministic hook/DOM boundaries.
function componentHarness(name = "PhotoLibraryGallery", extra: Record<string, unknown> = {}) {
  const slots: { value?: unknown; deps?: unknown[]; cleanup?: () => void }[] = [];
  let cursor = 0, effects: (() => void)[] = [], resized = () => {};
  const effect = (fn: () => (() => void) | void, deps: unknown[]) => {
    const slot = slots[cursor++] ??= {};
    if (!slot.deps || deps.some((dep, index) => !Object.is(dep, slot.deps![index]))) {
      slot.deps = deps; effects.push(() => { slot.cleanup?.(); slot.cleanup = fn() || undefined; });
    }
  };
  const hooks = { ...React, useRef: (value: unknown) => {
    const slot = slots[cursor++] ??= {}; if (!("value" in slot)) slot.value = { current: value }; return slot.value;
  }, useState: (value: unknown) => {
    const slot = slots[cursor++] ??= {}; if (!("value" in slot)) slot.value = value;
    return [slot.value, (next: unknown) => { slot.value = typeof next === "function" ? next(slot.value) : next; }];
  }, useEffect: effect, useLayoutEffect: effect };
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resized = callback; } observe() {} disconnect() {} });
  vi.stubGlobal("getComputedStyle", () => ({ paddingLeft: "20", paddingRight: "20" }));
  vi.stubGlobal("requestAnimationFrame", () => 1); vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const source = readFileSync(new URL("../../components/photo-library-gallery.tsx", import.meta.url), "utf8") + "\nexport { PhotoPositionInput, PhotoLabelBadges };";
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  const exports: Record<string, (props: object) => Node> = {};
  const dependencies: Record<string, unknown> = { react: hooks, "next/image": { default: () => null },
    "@/lib/library-gallery": gallery, "@/lib/photo-metadata": metadata, "@/lib/photo-gallery-gestures": gestures, "./photo-gallery-controls.css": {},
    "./photo-preview-context": { usePhotoPreviewSession: () => ({ session: null, snapshot: new Map() }) } };
  new Function("require", "exports", `const React = require('react'); ${compiled}`)((name: string) => {
    if (!(name in dependencies)) throw Error(`Missing dependency ${name}`); return dependencies[name];
  }, exports);
  const select = vi.fn(), inspect = vi.fn(), reorder = vi.fn(), toggle = vi.fn();
  const rows = [2, 8].map((position, index) => ({ photo: { blobKey: `p${index}`, sourceName: `Photo ${index}`, rank: "hero" },
    customPosition: position, labels: ["family", "holiday"], orientation: "landscape", uses: 0 })) as LibraryRow[];
  const cards = rows.map((row, index) => ({ dataset: { photoCardKey: row.photo.blobKey, customPosition: String(row.customPosition) },
    getBoundingClientRect: () => ({ left: 20 + index * 250, right: 250 + index * 250, top: 120, bottom: 420, width: 230, height: 300 }) }));
  const captures = new Set<number>();
  const element = { clientWidth: 1100, clientHeight: 700, scrollTop: 0, getClientRects: () => [{}],
    getBoundingClientRect: () => ({ left: 0, right: 1100, top: 0, bottom: 700 }), querySelectorAll: () => cards,
    setPointerCapture: (id: number) => captures.add(id), hasPointerCapture: (id: number) => captures.has(id), releasePointerCapture: (id: number) => captures.delete(id) };
  let root: Node;
  const props = { rows, view: { ...DEFAULT_LIBRARY_VIEW, sort: "custom" }, onView: vi.fn(), onInspect: inspect,
    onStartSelecting: select, onReorder: reorder, totalPhotos: 10, ...extra };
  const render = (changes: Record<string, unknown> = {}) => {
    Object.assign(props, changes); cursor = 0; effects = [];
    for (const card of cards) {
      const row = props.rows.find(row => row.photo.blobKey === card.dataset.photoCardKey);
      if (row) card.dataset.customPosition = String(row.customPosition);
    }
    root = exports[name](props);
    if (name === "PhotoLibraryGallery") {
      (root.props.ref as { current: unknown }).current = element;
      (nodes(root.props.children as React.ReactNode)[0].props.ref as { current: unknown }).current = { offsetHeight: 120 };
    }
    effects.forEach(fn => fn()); return root;
  };
  render(); if (name === "PhotoLibraryGallery") { resized(); render(); }
  const find = (predicate: (node: Node) => boolean) => nodes(root).find(predicate)!;
  const call = (node: Node, handler: string, event: unknown) => (node.props[handler] as (event: unknown) => void)(event);
  return { render, find, call, root: () => root, select, inspect, reorder, toggle, element, rows };
}

describe("gallery component controls", () => {
  it("selects on hold, suppresses release click, then toggles additional photos normally", () => {
    const h = componentHarness();
    const first = () => h.find(node => node.props["data-photo-key"] === "p0");
    h.call(first(), "onPointerDown", pointer()); vi.advanceTimersByTime(500);
    expect(h.select).toHaveBeenCalledExactlyOnceWith("p0");
    h.render({ onToggleSelected: h.toggle, selectedKeys: new Set(["p0"]) });
    h.call(h.root(), "onPointerUp", pointer()); h.call(first(), "onClick", { detail: 1, preventDefault: vi.fn() });
    expect(h.toggle).not.toHaveBeenCalled(); expect(h.inspect).not.toHaveBeenCalled();
    const second = h.find(node => node.props["data-photo-key"] === "p1");
    h.call(second, "onPointerDown", pointer()); h.call(h.root(), "onPointerUp", pointer());
    h.call(second, "onClick", { detail: 1, preventDefault: vi.fn() }); expect(h.toggle).toHaveBeenCalledExactlyOnceWith("p1");
  });

  it("cancels a pending hold on gallery scroll without preventing it", () => {
    const h = componentHarness(), event = pointer();
    h.call(h.find(node => node.props["data-photo-key"] === "p0"), "onPointerDown", event);
    h.call(h.root(), "onScroll", { currentTarget: h.element }); vi.advanceTimersByTime(500);
    expect(h.select).not.toHaveBeenCalled(); expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("commits a handle drag at whole-library position and cancels interrupted drags", () => {
    const h = componentHarness();
    const begin = () => h.call(h.find(node => node.props["aria-label"] === "Drag to reorder Photo 0"), "onPointerDown", pointer({ currentTarget: { focus: vi.fn() } }));
    begin(); h.call(h.root(), "onPointerMove", pointer({ clientX: 450 }));
    h.call(h.root(), "onPointerUp", pointer({ clientX: 450 }));
    expect(h.reorder).toHaveBeenCalledExactlyOnceWith("p0", 8);
    h.reorder.mockClear(); begin(); h.call(h.root(), "onPointerMove", pointer({ clientX: 450 }));
    h.call(h.root(), "onPointerCancel", pointer({ clientX: 450 })); expect(h.reorder).not.toHaveBeenCalled();
    expect(h.element.hasPointerCapture(1)).toBe(false);
  });

  it("keeps reorder controls separate from the photo button and includes every label", () => {
    const h = componentHarness();
    const open = h.find(node => node.props["data-photo-key"] === "p0");
    expect(nodes(open.props.children as React.ReactNode).some(node => node.type === "button" || node.type === "input")).toBe(false);
    expect(open.props["aria-label"]).toContain("Labels: family, holiday");
    const labels = componentHarness("PhotoLabelBadges", { labels: ["family", "holiday", "sunset"] });
    expect(nodes(labels.root()).filter(node => node.props.className === "library-photo-label").map(node => node.props.children)).toEqual(["family", "holiday", "sunset"]);
  });

  it("uses the latest source position when focusing a drag handle committed a numeric draft", () => {
    const h = componentHarness();
    h.call(h.find(node => node.props["aria-label"] === "Drag to reorder Photo 0"), "onPointerDown", pointer({ currentTarget: { focus: vi.fn() } }));
    // The blur edit commits after the pointerdown handler captured the old row.
    h.render({ rows: h.rows.map((row, index) => ({ ...row, customPosition: index === 0 ? 9 : 7 })) });
    h.call(h.root(), "onPointerMove", pointer({ clientX: 320 }));
    h.call(h.root(), "onPointerUp", pointer({ clientX: 320 }));
    expect(h.reorder).toHaveBeenCalledExactlyOnceWith("p0", 7);
  });

  it("commits numeric positions on Enter or blur, clamps to the library, and restores invalid or cancelled drafts", () => {
    const commit = vi.fn(), h = componentHarness("PhotoPositionInput", { position: 2, total: 10, name: "Photo", onCommit: commit });
    const input = () => h.find(node => node.type === "input");
    const draft = (value: string) => { h.call(input(), "onChange", { target: { value } }); h.render(); };
    draft("8"); h.call(input(), "onKeyDown", { key: "Enter", preventDefault: vi.fn() }); h.render({ position: 8 });
    expect(commit).toHaveBeenLastCalledWith(8);
    h.call(input(), "onBlur", {}); expect(commit).toHaveBeenCalledTimes(1);
    draft("999"); h.call(input(), "onBlur", {}); h.render(); expect(commit).toHaveBeenLastCalledWith(10);
    draft("3.5"); h.call(input(), "onBlur", {}); h.render(); expect(commit).toHaveBeenCalledTimes(2); expect(input().props.value).toBe("8");
    draft("5"); h.call(input(), "onKeyDown", { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() }); h.render();
    expect(input().props.value).toBe("8"); h.call(input(), "onBlur", {}); expect(commit).toHaveBeenCalledTimes(2);
  });
});
