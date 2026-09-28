import { readFileSync } from "node:fs";
import * as React from "react";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as metadata from "../photo-metadata";
import { libraryRows } from "../photo-library-view";
import { inspectionGesture } from "../photo-inspection";
import { editProjectPhotoMetadata } from "../project-photo-library";
import type { StoredProject } from "../types";
import type { LibraryPhotoViewer } from "../../components/library-photo-viewer";

type Node = React.ReactElement<Record<string, unknown>>;
type Props = React.ComponentProps<typeof LibraryPhotoViewer>;
function nodes(root: React.ReactNode): Node[] {
  return React.Children.toArray(root).flatMap(child => React.isValidElement(child) ?
    [child as Node, ...nodes((child as Node).props.children as React.ReactNode)] : []);
}
function text(root: React.ReactNode): string {
  return React.Children.toArray(root).map(child => React.isValidElement(child) ?
    text((child as Node).props.children as React.ReactNode) : String(child)).join("");
}

// Exercise the real viewer handlers, using the same lightweight hook harness
// as the gallery tests; metadata changes go through the project edit function.
function harness() {
  const slots: unknown[] = [];
  let cursor = 0;
  const hooks = { ...React, useEffect: () => {}, useRef: (value: unknown) => {
    const index = cursor++; return slots[index] ??= { current: value };
  }, useState: (value: unknown) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = value;
    return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
  } };
  const source = readFileSync(new URL("../../components/library-photo-viewer.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  const exports: { LibraryPhotoViewer?: (props: Props) => React.ReactElement } = {};
  const dependencies: Record<string, unknown> = { react: hooks, "next/image": { default: "image" },
    "@/lib/photo-cache-storage": {}, "@/lib/photo-preview-cache": {}, "@/lib/google-drive": {}, "@/lib/storage": {},
    "@/lib/photo-metadata": metadata, "@/lib/photo-inspection": { inspectionGesture },
    "./photo-preview-context": { usePhotoPreviewSession: () => ({ session: null, snapshot: new Map() }) },
    "./action-dialog": { ActionDialog: "action-dialog" }, "./photo-label-input": { PhotoLabelInput: "label-input" },
    "./library-photo-categories.css": {} };
  new Function("require", "exports", `const React = require('react'); ${compiled}`)((name: string) => {
    if (!(name in dependencies)) throw Error(`Missing dependency ${name}`); return dependencies[name];
  }, exports);
  let project: StoredProject = { version: 3, id: "category-test", name: "Categories", formatId: "instagram-square",
    createdAt: "2026-09-28T12:00:00.000Z", updatedAt: "2026-09-28T12:00:00.000Z", activePageId: "", pages: [],
    photoLibrary: [{ blobKey: "one", sourceName: "one.jpg", sourceWidth: 1200, sourceHeight: 800, rank: "hero", labels: ["night", "temple"] }] };
  const onMetadata = vi.fn((edit: metadata.PhotoMetadataEdit) => { project = editProjectPhotoMetadata(project, ["one"], edit); });
  let props: Props = { row: libraryRows(project)[0], index: 0, count: 2, controlsHidden: false, onToggleControls: vi.fn(),
    onBack: vi.fn(), onPrevious: vi.fn(), onNext: vi.fn(), onUse: vi.fn(), onOverride: vi.fn(), onMetadata,
    labelSuggestions: ["night", "people", "temple"] };
  let root: React.ReactElement;
  const render = (change: Partial<Props> = {}) => {
    cursor = 0; props = { ...props, row: libraryRows(project)[0], ...change };
    root = exports.LibraryPhotoViewer!(props);
    return root;
  };
  render();
  return { render, onMetadata, props: () => props, nodes: () => nodes(root),
    find: (predicate: (node: Node) => boolean) => {
      const result = nodes(root).find(predicate); if (!result) throw Error("Expected viewer control missing"); return result;
    }, click: (label: string) => {
      const result = nodes(root).find(node => node.type === "button" && (node.props["aria-label"] === label || text(node.props.children as React.ReactNode) === label));
      if (!result) throw Error(`Missing button ${label}`);
      (result.props.onClick as () => void)(); render();
    } };
}

describe("open-photo categorisation", () => {
  it("offers immediate rank choices and can change or clear rank without opening Info", () => {
    const h = harness();
    expect(h.nodes().some(node => node.type === "aside" && node.props["aria-label"] === "Photo categories")).toBe(true);
    expect(h.nodes().some(node => node.type === "action-dialog")).toBe(false);
    expect(h.find(node => node.type === "button" && text(node.props.children as React.ReactNode) === "Hero").props["aria-pressed"]).toBe(true);
    h.click("Good"); expect(h.props().row.photo.rank).toBe("good");
    h.click("Other"); expect(h.props().row.photo.rank).toBe("other");
    h.click("Unranked"); expect(h.props().row.photo.rank).toBeNull();
    h.click("Hero"); expect(h.props().row.photo.rank).toBe("hero");
    expect(h.onMetadata.mock.calls.map(([edit]) => edit)).toEqual([{ rank: "good" }, { rank: "other" }, { rank: null }, { rank: "hero" }]);
  });

  it("toggles labels independently and keeps applied labels available even without a suggestion", () => {
    const h = harness(); h.render({ labelSuggestions: ["people"] });
    expect(h.find(node => node.props["aria-label"] === "Remove label night").props["aria-pressed"]).toBe(true);
    h.click("Add label people"); expect(h.props().row.labels).toEqual(["night", "people", "temple"]);
    h.click("Remove label night"); expect(h.props().row.labels).toEqual(["people", "temple"]);
    expect(h.props().row.photo.rank).toBe("hero");
    const input = h.find(node => node.type === "label-input");
    (input.props.onAdd as (label: string) => void)("Blue Sky"); h.render();
    expect(h.props().row.labels).toEqual(["blue sky", "people", "temple"]);
  });

  it("keeps categorisation and technical Info usable after an edit moves a photo outside filters", () => {
    const h = harness(); h.click("Info"); h.click("Good"); h.render({ index: -1 });
    expect(h.nodes().some(node => node.type === "action-dialog")).toBe(true);
    expect(h.nodes().some(node => text(node.props.children as React.ReactNode) === "Outside current filters")).toBe(true);
    h.click("Remove label temple");
    expect(h.props().row.labels).toEqual(["night"]);
    const info = h.find(node => node.type === "action-dialog");
    expect(text(info.props.children as React.ReactNode)).toContain("Classification");
    expect(nodes(info.props.children as React.ReactNode).some(node => node.type === "label-input")).toBe(false);
    expect(h.find(node => node.type === "button" && text(node.props.children as React.ReactNode) === "Next").props.disabled).toBe(true);
  });

  it("hides the category panel with controls while preserving image inspection and navigation", () => {
    const h = harness(); h.render({ controlsHidden: true });
    expect(h.nodes().some(node => node.type === "aside")).toBe(false);
    h.click("Show controls"); expect(h.props().onToggleControls).toHaveBeenCalledOnce();
    const image = h.find(node => node.props.className === "library-inspector-image");
    (image.props.onKeyDown as (event: { key: string }) => void)({ key: "ArrowRight" });
    expect(h.props().onNext).toHaveBeenCalledOnce();
    h.render({ controlsHidden: false });
    expect(h.nodes().some(node => node.type === "aside")).toBe(true);
    expect(h.props().row.photo.rank).toBe("hero");
  });
});
