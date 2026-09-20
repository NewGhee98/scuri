import { readFileSync } from "node:fs";
import * as React from "react";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as gallery from "../library-gallery";
import { DEFAULT_LIBRARY_VIEW, type LibraryRow, type LibraryView } from "../photo-library-view";

// Run the real component's effects and scroll handler. In particular, count DOM
// scroll writes: writing even an unchanged offset can cancel Safari momentum.
function harness(initial: LibraryView = structuredClone(DEFAULT_LIBRARY_VIEW)) {
  const slots: { value?: unknown; deps?: unknown[]; cleanup?: () => void }[] = [];
  let cursor = 0, effects: (() => void)[] = [], layoutEffects: (() => void)[] = [];
  const effect = (queue: () => typeof effects) => (fn: () => (() => void) | void, deps: unknown[]) => {
    const slot = slots[cursor++] ??= {};
    if (!slot.deps || deps.some((dep, i) => !Object.is(dep, slot.deps![i]))) {
      slot.deps = deps; queue().push(() => { slot.cleanup?.(); slot.cleanup = fn() || undefined; });
    }
  };
  const hooks = { ...React, useRef: (value: unknown) => {
    const slot = slots[cursor++] ??= {}; if (!("value" in slot)) slot.value = { current: value }; return slot.value;
  }, useState: (value: unknown) => {
    const slot = slots[cursor++] ??= {}; if (!("value" in slot)) slot.value = value;
    return [slot.value, (next: unknown) => { slot.value = typeof next === "function" ? next(slot.value) : next; }];
  }, useEffect: effect(() => effects), useLayoutEffect: effect(() => layoutEffects) };
  let resized = () => {};
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resized = callback; }
    observe() {} disconnect() {}
  });
  vi.stubGlobal("getComputedStyle", () => ({ paddingLeft: "20", paddingRight: "20" }));
  const source = readFileSync(new URL("../../components/photo-library-gallery.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  const exports: Record<string, (props: object) => React.ReactElement> = {};
  const dependencies: Record<string, unknown> = { react: hooks, "next/image": { default: () => null },
    "@/lib/library-gallery": gallery, "./photo-preview-context": { usePhotoPreviewSession: () => ({ session: null, snapshot: new Map() }) } };
  new Function("require", "exports", `const React = require('react'); ${compiled}`)((name: string) => {
    if (!(name in dependencies)) throw Error(`Missing dependency ${name}`); return dependencies[name];
  }, exports);
  let top = 0, view = initial, visible = true;
  const writes: number[] = [], updates: LibraryView[] = [];
  const card = { dataset: { photoKey: "photo-6" }, focus: vi.fn() };
  const element = { clientWidth: 1100, clientHeight: 700, getClientRects: () => visible ? [{}] : [],
    querySelectorAll: () => [card], focus: vi.fn(), get scrollTop() { return top; },
    set scrollTop(value: number) { writes.push(value); top = value; } };
  const heading = { offsetHeight: 120 };
  const rows = Array.from({ length: 100 }, (_, index) => ({ photo: { blobKey: `photo-${index}`, sourceName: `Photo ${index}` },
    orientation: "landscape", uses: 0 })) as LibraryRow[];
  type Node = React.ReactElement<Record<string, unknown>>;
  let root: Node;
  const render = (next = view, focusPhotoKey?: string) => {
    view = next; cursor = 0; effects = []; layoutEffects = [];
    root = exports.PhotoLibraryGallery({ rows, view, focusPhotoKey, onInspect: vi.fn(), onView: (value: LibraryView) => updates.push(value) }) as Node;
    (root.props.ref as { current: unknown }).current = element;
    const header = React.Children.toArray(root.props.children as React.ReactNode)[0] as Node;
    (header.props.ref as { current: unknown }).current = heading;
    layoutEffects.forEach(fn => fn()); effects.forEach(fn => fn());
  };
  const measure = () => { resized(); render(); };
  const scroll = (value: number, commit = true) => {
    top = value; (root.props.onScroll as (event: unknown) => void)({ currentTarget: element });
    if (commit && updates.length) render(updates.at(-1));
  };
  render();
  return { render, measure, scroll, element, heading, writes, updates, card, rows,
    nativeTop: (value: number) => { top = value; }, view: () => view, visible: (value: boolean) => { visible = value; } };
}

afterEach(() => vi.unstubAllGlobals());

describe("Project photos native scrolling", () => {
  it("never feeds native scroll echoes back into scrollTop, including fractional momentum offsets", () => {
    const h = harness(); h.measure(); h.writes.length = 0;
    for (const top of [80, 120.25, 350.75, 710.125, 1250, 1680, 2500, 3200, 2990, 1100, 0]) h.scroll(top);
    expect(h.writes).toEqual([]);
    expect(h.view().scrollTop).toBe(0);
    expect(h.updates).toHaveLength(11);
  });

  it("does not rewind the compositor when React commits an earlier scroll update", () => {
    const h = harness(); h.measure(); h.writes.length = 0;
    h.scroll(500, false); h.scroll(700, false); h.nativeTop(760);
    h.render(h.updates[0]); h.render(h.updates[1]);
    expect(h.writes).toEqual([]); expect(h.element.scrollTop).toBe(760);
  });

  it("ignores preview rerenders and height-only resizing during a scroll", () => {
    const h = harness(); h.measure(); h.scroll(1450); h.writes.length = 0;
    h.nativeTop(1480); h.render(); h.element.clientHeight = 620; h.measure();
    expect(h.writes).toEqual([]); expect(h.element.scrollTop).toBe(1480);
  });

  it("honours explicit resets even when no filter value changes", () => {
    const h = harness(); h.measure(); h.scroll(1450); h.writes.length = 0;
    h.render({ ...h.view(), scrollTop: 0, anchor: undefined, anchorOffset: undefined });
    expect(h.writes).toEqual([0]); expect(h.element.scrollTop).toBe(0);
    h.scroll(0); expect(h.writes).toEqual([0]);
  });

  it("preserves the photo anchor after toolbar growth, repacking and thumbnail size changes", () => {
    const h = harness(); h.measure(); h.scroll(800); // photo-8, 20px into its row
    h.writes.length = 0; h.heading.offsetHeight = 170; h.measure();
    expect(h.element.scrollTop).toBe(850);
    h.scroll(850); h.render({ ...h.view(), size: "large" });
    expect(h.element.scrollTop).toBe(1030); // 3 columns, 420px rows
    h.scroll(1030); h.element.clientWidth = 750; h.measure();
    expect(h.element.scrollTop).toBe(1450); // 2 columns, photo-6 now anchors the visible row
    expect(h.rows[8].photo.blobKey).toBe("photo-8");
  });

  it("restores once after a hidden dialog is measured and returns focus without scrolling", () => {
    const initial = { ...structuredClone(DEFAULT_LIBRARY_VIEW), scrollTop: 800, anchor: "photo-8", anchorOffset: 20 };
    const h = harness(initial); h.element.clientWidth = 0; h.element.clientHeight = 0; h.visible(false); h.measure(); h.scroll(0);
    expect(h.writes).toEqual([]); expect(h.updates).toHaveLength(0);
    h.element.clientWidth = 1100; h.element.clientHeight = 700; h.visible(true); h.measure();
    expect(h.element.scrollTop).toBe(800); expect(h.writes).toEqual([800]);
    h.render(initial, "photo-6"); expect(h.card.focus).toHaveBeenCalledWith({ preventScroll: true });
    h.render(initial, "photo-6"); expect(h.writes).toEqual([800]);
    expect(initial).toEqual({ ...DEFAULT_LIBRARY_VIEW, scrollTop: 800, anchor: "photo-8", anchorOffset: 20 });
  });
});
