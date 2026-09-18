import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createExportFilename } from "../export";
import { getFormat } from "../formats";
import { isPageComplete } from "../project";
import { serializePage } from "../project-photos";
import { getTemplate } from "../templates";
import type { ProjectPage } from "../types";

// Execute the real review/export handlers with synthetic pages and controlled
// async renders. Browser QA exercises the React dialog and actual JPEG bytes.
const source = readFileSync(new URL("../../components/layouts-app.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("layouts-app.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers = new Map<string, string>();
function collect(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isArrowFunction(node.initializer)
    && ["reviewExportPages", "exportPages"].includes(node.name.text)) {
    handlers.set(node.name.text, ts.transpileModule(`const callback = (${node.initializer.getText(ast)});`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText);
  }
  ts.forEachChild(node, collect);
}
collect(ast);

function harness() {
  const template = getTemplate("instagram-square-full-frame"), frame = template.frames[0].id;
  const pages: ProjectPage[] = [1, 2, 3].map(number => ({
    id: `page-${number}`, templateId: template.id, background: "#eeddbb", gutter: 24, selectedFrameId: frame,
    photos: number === 2 ? {} : { [frame]: { frameId: frame, blobKey: "synthetic", sourceBlob: new Blob(["original"]),
      previewUrl: "blob:small-preview", sourceWidth: 100, sourceHeight: 100, crop: { zoom: 0.8765433, positionX: 0, positionY: 0 } } },
    createdAt: "2026-09-18", updatedAt: "2026-09-18",
  }));
  const scope = {
    pages, format: getFormat("instagram-square"), projectId: "synthetic", resolvePageTemplate: () => template,
    isPageComplete, createExportFilename, activeProjectRef: { current: { id: "synthetic" } },
    workspaceRef: { current: { capture: () => () => true } },
    setNotice: vi.fn(), setExportReviewIds: vi.fn(), setShowPagePreview: vi.fn(), setBusy: vi.fn(),
    setExportProgress: vi.fn(), clearExportItems: vi.fn(), setExportItems: vi.fn(), setScreen: vi.fn(),
    exportItemsRef: { current: [] }, renderComposition: vi.fn(async () => new Blob(["jpeg"], { type: "image/jpeg" })),
    URL: { createObjectURL: vi.fn(() => "blob:export"), revokeObjectURL: vi.fn() },
  };
  const run = (name: string, ...args: unknown[]) => {
    const callback = new Function("scope", `with (scope) { ${handlers.get(name)}; return callback; }`)(scope);
    return callback(...args);
  };
  return { scope, run };
}
afterEach(() => vi.restoreAllMocks());

describe("export review and generation flow", () => {
  it("reviews complete pages before rendering, keeping drafts and all stored configuration intact", () => {
    const { scope, run } = harness(), before = scope.pages.map(serializePage);
    run("reviewExportPages");
    expect(scope.setExportReviewIds).toHaveBeenCalledWith(["page-1", "page-3"]);
    expect(scope.setShowPagePreview).toHaveBeenCalledWith(true);
    expect(scope.renderComposition).not.toHaveBeenCalled();
    expect(scope.setScreen).not.toHaveBeenCalled();
    expect(scope.pages.map(serializePage)).toEqual(before);
    run("reviewExportPages", ["page-3"]);
    expect(scope.setExportReviewIds).toHaveBeenLastCalledWith(["page-3"]);
  });

  it("exports all reviewed placements at the chosen size in project order, even when source pixels are insufficient", async () => {
    const { scope, run } = harness(), before = scope.pages.map(serializePage);
    const outputSize = { width: 2160, height: 2160 };
    await run("exportPages", outputSize, ["page-3", "page-1"]);
    expect(scope.renderComposition).toHaveBeenCalledTimes(2);
    for (const [options] of scope.renderComposition.mock.calls as unknown as [Record<string, unknown>][]) {
      expect(options.outputSize).toEqual(outputSize);
      expect(options.format).toBe(scope.format);
    }
    const items = scope.setExportItems.mock.calls[0][0];
    expect(items.map((item: { pageNumber: number }) => item.pageNumber)).toEqual([1, 3]);
    expect(items.every((item: { size: unknown; filename: string }) => item.size === outputSize && item.filename.endsWith("-2160x2160.jpg"))).toBe(true);
    expect(scope.setScreen).toHaveBeenCalledWith("export");
    expect(scope.pages.map(serializePage)).toEqual(before);
  });

  it("revalidates missing originals between review and export without deleting their assignment", async () => {
    const { scope, run } = harness();
    run("reviewExportPages", ["page-1"]);
    const page = scope.pages[0], stored = serializePage(page);
    page.unavailablePhotos = stored.photos; page.photos = {};
    await run("exportPages", { width: 2160, height: 2160 }, ["page-1"]);
    expect(scope.renderComposition).not.toHaveBeenCalled();
    expect(scope.setScreen).not.toHaveBeenCalled();
    expect(scope.setNotice).toHaveBeenCalledWith(expect.objectContaining({ kind: "error" }));
    expect(serializePage(page)).toEqual(stored);
  });

  it("discards a late export if the user changes project while originals are rendering", async () => {
    const { scope, run } = harness();
    let finish!: (blob: Blob) => void;
    scope.renderComposition.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = run("exportPages", { width: 2160, height: 2160 }, ["page-1"]);
    scope.activeProjectRef.current = { id: "another-project" };
    finish(new Blob(["jpeg"]));
    await pending;
    expect(scope.setScreen).not.toHaveBeenCalled();
    expect(scope.setExportItems).not.toHaveBeenCalled();
    expect(scope.URL.revokeObjectURL).toHaveBeenCalledWith("blob:export");
    expect(scope.setBusy).toHaveBeenLastCalledWith(null);
  });
});
