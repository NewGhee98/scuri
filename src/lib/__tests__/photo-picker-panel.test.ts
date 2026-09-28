import { readFileSync } from "node:fs";
import * as React from "react";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as photoLibrary from "../project-photo-library";
import * as metadata from "../photo-metadata";
import * as libraryView from "../photo-library-view";
import { workspaceKey } from "../workspace";
import type { ProjectPhoto, StoredProject } from "../types";
import type { ProjectPhotoPanel } from "../../components/project-photo-panel";

type Props = React.ComponentProps<typeof ProjectPhotoPanel>;
type Node = React.ReactElement<Record<string, unknown>>;
function nodes(root: React.ReactNode): Node[] {
  return React.Children.toArray(root).flatMap(child => React.isValidElement(child) ? [child as Node,
    ...nodes((child as Node).props.children as React.ReactNode), ...nodes((child as Node).props.header as React.ReactNode)] : []);
}
function text(root: React.ReactNode): string {
  return React.Children.toArray(root).map(child => React.isValidElement(child) ? text((child as Node).props.children as React.ReactNode) : String(child)).join("");
}
afterEach(() => libraryView.clearLibraryViews());

function harness(extra: Partial<Props> = {}) {
  const slots: unknown[] = []; let cursor = 0, dirty = false;
  const hooks = { ...React, useEffect: () => {}, useMemo: (fn: () => unknown) => fn(), useRef: (value: unknown) => {
    const index = cursor++; return slots[index] ??= { current: value };
  }, useState: (value: unknown) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof value === "function" ? value() : value;
    return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; dirty = true; }];
  } };
  const source = readFileSync(new URL("../../components/project-photo-panel.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  const exports: { ProjectPhotoPanel?: (props: Props) => React.ReactElement } = {};
  const dependencies: Record<string, unknown> = {
    react: hooks, "./photo-library.css": {}, "@/lib/arrangements": {}, "@/lib/photo-analysis-client": {},
    "@/lib/project-photo-library": photoLibrary, "@/lib/photo-metadata": metadata, "@/lib/photo-library-view": libraryView,
    "@/lib/workspace": { workspaceKey }, "@/lib/formats": {}, "@/lib/crop": {}, "@/lib/photo-import-queue": {},
    "./photo-label-input": { PhotoLabelInput: "label-input" }, "./composition-thumbnail": {}, "./duplicate-photo-review": {},
    "./photo-preview-context": { usePhotoPreviewSession: () => ({ session: null }) },
    "./photo-library-gallery": { PhotoLibraryGallery: "gallery" }, "./library-photo-viewer": { LibraryPhotoViewer: "viewer" },
    "./photo-import-menu": { PhotoImportMenu: "import-menu" }, "./action-dialog": { ActionDialog: "action-dialog" },
  };
  new Function("require", "exports", `const React = require('react'); ${compiled}`)((name: string) => {
    if (!(name in dependencies)) throw Error(`Missing dependency ${name}`); return dependencies[name];
  }, exports);
  const project: StoredProject = { version: 3, id: "picker-panel", name: "Picker", formatId: "instagram-square", activePageId: "",
    createdAt: "2026-09-28T12:00:00.000Z", updatedAt: "2026-09-28T12:00:00.000Z", pages: [],
    photoLibrary: [
      { blobKey: "one", sourceName: "One.jpg", sourceWidth: 1000, sourceHeight: 800, rank: "hero", labels: [] },
      { blobKey: "two", sourceName: "Two.jpg", sourceWidth: 1000, sourceHeight: 800, labels: ["night"] },
      { blobKey: "three", sourceName: "Three.jpg", sourceWidth: 1000, sourceHeight: 800 },
    ] };
  const onChooseMultiple = vi.fn(), onMetadata = vi.fn(), onClose = vi.fn();
  let props: Props = { project, templates: [], accessRevision: 0, busy: false, getVolatileBlob: vi.fn(), getDriveToken: () => null,
    onImport: vi.fn(), onApply: vi.fn(), onChooseMultiple, chooseLimit: 2, onOverride: vi.fn(), onMetadata, onReorder: vi.fn(),
    onCombineDuplicates: vi.fn(), open: true, onOpen: vi.fn(), onClose, imports: [], onRetryImport: vi.fn(), backupStatus: [], onRetryBackup: vi.fn(), ...extra };
  let root: React.ReactElement;
  const render = (changes: Partial<Props> = {}) => {
    props = { ...props, ...changes };
    do { dirty = false; cursor = 0; root = exports.ProjectPhotoPanel!(props); } while (dirty);
  };
  const find = (predicate: (node: Node) => boolean) => { const result = nodes(root).find(predicate); if (!result) throw Error("Missing panel control"); return result; };
  const click = (label: string) => {
    const button = find(node => node.type === "button" && (node.props["aria-label"] === label || text(node.props.children as React.ReactNode) === label));
    if (button.props.disabled) throw Error(`Disabled button: ${label}`);
    (button.props.onClick as () => void)(); render();
  };
  const gallery = () => find(node => node.type === "gallery");
  const select = (key: string, hold = false) => { (gallery().props[hold ? "onStartSelecting" : "onToggleSelected"] as (key: string) => void)(key); render(); };
  const selected = () => [...(gallery().props.selectedKeys as ReadonlySet<string>)];
  render();
  return { render, find, click, gallery, select, selected, props: () => props, project, onChooseMultiple, onMetadata, onClose };
}

describe("Scuri page photo picker", () => {
  it("selects in tap order, enforces capacity, and only submits through explicit Add", () => {
    const h = harness();
    h.select("three"); h.select("one"); h.select("two");
    expect(h.selected()).toEqual(["three", "one"]);
    expect(h.onChooseMultiple).not.toHaveBeenCalled();
    expect([...h.gallery().props.selectionOrder as Map<string, number>]).toEqual([["three", 1], ["one", 2]]);
    expect(text(h.find(node => node.props["aria-label"] === "Add selected photos"))).toContain("Choose up to 2 photos");
    h.select("three"); h.select("two"); h.click("Add 2 photos");
    expect(h.onChooseMultiple.mock.calls[0][0].map((photo: ProjectPhoto) => photo.blobKey)).toEqual(["one", "two"]);
    expect(h.onMetadata).not.toHaveBeenCalled();
  });

  it("lets a one-space picker replace its pending choice without silently placing it", () => {
    const h = harness({ chooseLimit: 1 }); h.select("two"); h.select("one");
    expect(h.selected()).toEqual(["one"]); expect(h.onChooseMultiple).not.toHaveBeenCalled();
    h.click("Add 1 photo"); expect(h.onChooseMultiple.mock.calls[0][0][0].blobKey).toBe("one");
    h.select("one"); expect(h.selected()).toEqual([]);
    expect(h.find(node => node.type === "button" && text(node.props.children as React.ReactNode) === "Add 0 photos").props.disabled).toBe(true);
  });

  it("keeps holding an already selected photo idempotent and allows following taps", () => {
    const h = harness(); h.select("one", true); h.select("one", true); h.select("two");
    expect(h.selected()).toEqual(["one", "two"]);
  });

  it("clears cancelled or parent-dismissed selections before another picker session", () => {
    const h = harness(); h.select("one"); h.click("Cancel");
    expect(h.onClose).toHaveBeenCalledOnce(); expect(h.selected()).toEqual([]);
    h.select("two"); h.render({ open: false }); h.render({ open: true });
    expect(h.selected()).toEqual([]);
  });

  it("retains choices if page capacity shrinks and requires an explicit smaller selection", () => {
    const h = harness(); h.select("one"); h.select("two"); h.render({ chooseLimit: 1 });
    expect(h.selected()).toEqual(["one", "two"]);
    const button = h.find(node => node.type === "button" && text(node.props.children as React.ReactNode) === "Add 2 photos");
    expect(button.props.disabled).toBe(true);
    expect(text(h.find(node => node.props["aria-label"] === "Add selected photos"))).toContain("Reduce your selection");
    (button.props.onClick as () => void)(); expect(h.onChooseMultiple).not.toHaveBeenCalled();
    h.select("two"); h.click("Add 1 photo"); expect(h.onChooseMultiple.mock.calls[0][0][0].blobKey).toBe("one");
  });

  it("clears pending selections and inspection when the destination session changes", () => {
    const h = harness({ chooseSessionKey: "first-frame" }); h.select("one");
    (h.gallery().props.onInspect as (key: string) => void)("two"); h.render();
    expect(h.find(node => node.type === "viewer")).toBeDefined();
    h.render({ chooseSessionKey: "second-frame" }); expect(h.selected()).toEqual([]);
    expect(h.gallery().props.showPreviewButtons).toBe(true);
  });

  it("clears selection when filters change and keeps Untagged exclusive with custom label filters", () => {
    const h = harness(); h.select("one"); h.click("Filters"); h.click("night");
    expect(h.selected()).toEqual([]); expect(h.gallery().props.rows).toHaveLength(1);
    h.click("Untagged");
    expect(h.gallery().props.view).toMatchObject({ untagged: true, labels: [] });
    expect((h.gallery().props.rows as libraryView.LibraryRow[]).map(row => row.photo.blobKey)).toEqual(["one", "three"]);
    h.click("night"); expect(h.gallery().props.view).toMatchObject({ untagged: false, labels: ["night"] });
    h.click("Untagged"); h.click("Clear filters");
    expect(h.gallery().props.view).toMatchObject({ untagged: false, labels: [], ranks: [] });
    expect(h.gallery().props.rows).toHaveLength(3);
  });

  it("excludes a selected photo that becomes hidden after a metadata change", () => {
    const h = harness(); h.click("Filters"); h.click("Untagged"); h.click("Close"); h.select("one"); h.select("three");
    const project = photoLibrary.editProjectPhotoMetadata(h.project, ["one"], { addLabels: ["night"] });
    h.render({ project }); expect(h.selected()).toEqual(["three"]);
    h.click("Add 1 photo"); expect(h.onChooseMultiple.mock.calls[0][0].map((photo: ProjectPhoto) => photo.blobKey)).toEqual(["three"]);
  });

  it("supports preview selection separately and keeps legacy single-photo use intact", () => {
    const h = harness(); expect(h.gallery().props.showPreviewButtons).toBe(true);
    (h.gallery().props.onInspect as (key: string) => void)("two"); h.render();
    let viewer = h.find(node => node.type === "viewer"); expect(viewer.props.useLabel).toBe("Select photo");
    (viewer.props.onUse as () => void)(); h.render(); viewer = h.find(node => node.type === "viewer");
    expect(viewer.props.useLabel).toBe("Deselect photo"); expect(h.onChooseMultiple).not.toHaveBeenCalled();
    (viewer.props.onBack as () => void)(); h.render(); expect(h.selected()).toEqual(["two"]);
    const onChoose = vi.fn(), single = harness({ onChooseMultiple: undefined, onChoose });
    expect(single.gallery().props.onToggleSelected).toBeUndefined();
    (single.gallery().props.onInspect as (key: string) => void)("one"); single.render();
    (single.find(node => node.type === "viewer").props.onUse as () => void)();
    expect(onChoose).toHaveBeenCalledExactlyOnceWith(single.project.photoLibrary![0]);
  });

  it("preserves ordinary library bulk metadata selection and long-press behavior", () => {
    const h = harness({ onChooseMultiple: undefined }); h.select("one", true); h.select("two");
    const select = h.find(node => node.type === "select" && node.props.value === "");
    (select.props.onChange as (event: unknown) => void)({ target: { value: "hero" } });
    expect(h.onMetadata).toHaveBeenCalledExactlyOnceWith(["one", "two"], { rank: "hero" });
  });
});

describe("Untagged library view", () => {
  it("matches missing or empty custom labels independently of rank, including duplicate aliases", () => {
    const h = harness(); const project = structuredClone(h.project);
    project.photoLibrary!.push({ blobKey: "alias", duplicateOf: "one", sourceWidth: 1000, sourceHeight: 800, labels: ["trip"] });
    const rows = libraryView.libraryRows(project);
    expect(libraryView.filterLibraryRows(rows, { ...libraryView.DEFAULT_LIBRARY_VIEW, untagged: true }).map(row => row.photo.blobKey)).toEqual(["three"]);
    expect(libraryView.filterLibraryRows(libraryView.libraryRows(h.project), { ...libraryView.DEFAULT_LIBRARY_VIEW, untagged: true, ranks: ["hero"] }).map(row => row.photo.blobKey)).toEqual(["one"]);
  });

  it("remembers the session filter and clears it with the default view", () => {
    const view = { ...libraryView.DEFAULT_LIBRARY_VIEW, untagged: true };
    libraryView.rememberLibraryView("view", view); expect(libraryView.readLibraryView("view").untagged).toBe(true);
    libraryView.clearLibraryViews(); expect(libraryView.readLibraryView("view").untagged).toBe(false);
  });
});
