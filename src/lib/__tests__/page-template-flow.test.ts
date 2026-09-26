import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acknowledgeProjectPush, hasUnexplainedPhotoLoss, mergeCloudProjectLibrary } from "../project-sync";
import { applyPhotoBackupCheckpoint } from "../photo-backup";
import { getProjectPhotos, mergePhotoLibraries } from "../project-photo-library";
import { reconcileProjectPages, recordPhotoDeletions, serializePage } from "../project-photos";
import { ProjectHistory, projectContentKey } from "../project-history";
import { nextProjectEditTime } from "../project-time";
import { getBackScreen, MAX_PROJECT_PAGES, sortProjectsByLastEdited } from "../project";
import { DEFAULT_TEMPLATE_FILTERS, filterTemplates, getTemplatesForFormat, TEMPLATES } from "../templates";
import { getFormat } from "../formats";
import { openPhotoPicker, placeLibraryPhoto } from "../photo-picker";
import { WorkspaceSession } from "../workspace";
import { loadProjects, saveProjects } from "../storage";
import { createBlankCustomTemplate } from "../custom-templates";
import { arrangeFrames, setFrameRatio } from "../template-layout";
import type { AppScreen, CustomTemplate, ProjectPage, ProjectPhoto, StoredProject, TemplateDefinition } from "../types";
import { createTextBox } from "../text";

// Run the real component handlers with controlled state commits and deferred
// service responses. No copied decision logic, live services or photo bytes.
// Browser QA separately covers React rendering and the actual picker controls.
const source = readFileSync(new URL("../../components/layouts-app.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("layouts-app.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = new Map<string, string>();
function collect(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    let expression = node.initializer;
    if (ts.isCallExpression(expression) && ["useCallback", "useMemo"].includes(expression.expression.getText(ast))) expression = expression.arguments[0];
    if (ts.isArrowFunction(expression)) callbacks.set(node.name.text, ts.transpileModule(`const callback = (${expression.getText(ast)});`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText);
  }
  ts.forEachChild(node, collect);
}
collect(ast);

const timestamp = "2026-09-17T12:00:00.000Z";
const [single, pair] = [1, 2].map(count => getTemplatesForFormat("instagram-post").find(template => template.frames.length === count)!);
function fixture(): StoredProject {
  return { version: 3, id: "synthetic-project", name: "QA only", formatId: "instagram-post", activePageId: "original-page",
    revision: 1, cloudSyncedAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
    pages: [{ id: "original-page", templateId: single.id, templateSnapshot: single, background: "#eeddbb", gutter: single.defaultGutter,
      selectedFrameId: single.frames[0].id, createdAt: timestamp, updatedAt: timestamp,
      photos: { [single.frames[0].id]: { frameId: single.frames[0].id, blobKey: "synthetic-original", cloudAssetId: "synthetic-asset",
        sourceWidth: 6400, sourceHeight: 1440, crop: { zoom: 0.812345, positionX: 0.5, positionY: 0.5 },
        driveOriginalId: "synthetic-drive-original", drivePreviewId: "synthetic-drive-preview" } } }],
  };
}

function harness({ loaded = false, confirm = true, project = fixture(), custom = [] as CustomTemplate[] } = {}) {
  const state = {
    pages: [] as ProjectPage[], activePageId: null as string | null, screen: "project" as AppScreen,
    templatePickerIntent: null as unknown, projectPhotoLibrary: [] as ProjectPhoto[], pendingDeletions: undefined as StoredProject["pendingDeletions"],
    projectId: "", projectName: "", projectCreatedAt: "", projectUpdatedAt: "", formatId: null as StoredProject["formatId"] | null,
    pageTemplateFilters: DEFAULT_TEMPLATE_FILTERS, templateFilters: DEFAULT_TEMPLATE_FILTERS, customTemplates: custom,
    editorSelectedFrameId: null as string | null,
  };
  const refs = { pagesRef: { current: state.pages }, activeProjectRef: { current: null as StoredProject | null },
    projectsRef: { current: [project] }, retainedPhotosRef: { current: new Map() }, historyRef: { current: new ProjectHistory() },
    historyGroupRef: { current: undefined }, templatePickerRef: { current: null } };
  const confirmPrompt = vi.fn(() => confirm), notice = vi.fn();
  const scope: Record<string, unknown> = {
    ...refs, getProjectPhotos, mergePhotoLibraries, reconcileProjectPages, recordPhotoDeletions, serializePage,
    projectContentKey, nextProjectEditTime, MAX_PROJECT_PAGES, sortProjectsByLastEdited, getBackScreen,
    DEFAULT_TEMPLATE_FILTERS, filterTemplates, getTemplatesForFormat, TEMPLATES,
    crypto, now: () => "2026-09-17T12:00:01.000Z", disposePhotoAsset: vi.fn(),
    setHistoryState: vi.fn(), setRearrangeMode: vi.fn(), setNotice: notice, window: { confirm: confirmPrompt },
    setExportWidth: vi.fn(), setExportReviewIds: vi.fn(), getFormat,
    photoPickerRef: { current: null }, setPhotoPickerIntent: vi.fn(), setShowPhotoLibrary: vi.fn(), setChoosePhotoSource: vi.fn(), setSelectExportPages: vi.fn(), setSelectedExportIds: vi.fn(),
    saveWorkspaceProjects: vi.fn(), setProjects: vi.fn(), clearExportItems: vi.fn(), setDraggingPageId: vi.fn(),
    openPhotoPicker, placeLibraryPhoto, photoPickerWorkspaceRef: { current: null }, workspaceRef: { current: new WorkspaceSession() },
    resolvePageTemplate: (page: ProjectPage) => page.templateSnapshot ?? single,
    importQueueRef: { current: { add: vi.fn() } }, navigator: { storage: {} },
  };
  for (const key of Object.keys(state)) {
    Object.defineProperty(scope, key, { get: () => state[key as keyof typeof state] });
    scope[`set${key[0].toUpperCase()}${key.slice(1)}`] = (update: unknown) => {
      const target = state as Record<string, unknown>;
      target[key] = typeof update === "function" ? update(target[key]) : update;
    };
  }
  scope.setScreenState = scope.setScreen;
  Object.defineProperty(scope, "activePage", { get: () => state.pages.find(page => page.id === state.activePageId) ?? null });
  Object.defineProperty(scope, "template", { get: () => state.pages.find(page => page.id === state.activePageId)?.templateSnapshot ?? null });
  for (const name of ["setTemplatePicker", "setScreen", "retainPagePhotos", "updatePage", "buildStoredProject", "persistActiveProject",
    "adoptActiveProject", "addPage", "duplicatePage", "changePageLayout", "selectTemplate", "editPage", "goBack", "openProjects",
    "requestPhoto", "closePhotoLibrary", "chooseLibraryPhoto", "importLibraryPhotos",
    "filteredPageTemplates", "filteredCustomTemplates", "filteredBuiltInTemplates", "selectEditorFrame"]) {
    const js = callbacks.get(name);
    if (js) scope[name] = new Function("scope", `with (scope) { ${js}; return callback; }`)(scope);
  }
  function run<T = void>(name: string, ...args: unknown[]): T {
    expect(typeof scope[name], name).toBe("function");
    return (scope[name] as (...args: unknown[]) => T)(...args);
  }
  Object.defineProperty(scope, "templates", { get: () => new Function("scope", `with (scope) { ${callbacks.get("templates")}; return callback(); }`)(scope) });
  function settle() {
    refs.pagesRef.current = state.pages;
    refs.activeProjectRef.current = run<StoredProject>("buildStoredProject");
    refs.historyRef.current.observe(refs.activeProjectRef.current);
  }
  run("adoptActiveProject", project);
  if (loaded) for (const page of state.pages) {
    page.photos = Object.fromEntries(Object.entries(page.unavailablePhotos ?? {}).map(([id, photo]) =>
      [id, { ...photo, sourceBlob: new Blob(["synthetic bytes"]), previewUrl: "blob:synthetic" }]));
    page.unavailablePhotos = {};
  }
  settle();
  function captureSelection() {
    const renderScope = Object.create(scope);
    Object.defineProperty(renderScope, "templatePickerIntent", { value: state.templatePickerIntent });
    return new Function("scope", `with (scope) { ${callbacks.get("selectTemplate")}; return callback; }`)(renderScope);
  }
  return { state, refs, scope, run, settle, captureSelection, confirmPrompt, notice, original: structuredClone(project) };
}

type Harness = ReturnType<typeof harness>;
it("saving designer ratios and arrangements leaves populated page snapshots and repeated crops unchanged", async () => {
  const custom = { ...createBlankCustomTemplate("instagram-post"), name: "Synthetic reusable layout", status: "saved" as const,
    frames: pair.frames.map(frame => ({ ...frame })) };
  const h = harness({ custom: [custom] }); h.run("addPage"); h.settle(); await h.run("selectTemplate", custom); h.settle();
  const page = h.state.pages.at(-1)!, original = Object.values(fixture().pages[0].photos)[0];
  page.unavailablePhotos = Object.fromEntries(custom.frames.map((frame, i) => [frame.id, { ...original, frameId: frame.id,
    crop: { zoom: i ? .65 : 1.3, positionX: 0, positionY: 0, freePosition: { x: i ? -.2 : .15, y: .12 } } }]));
  h.settle(); const before = h.state.pages.map(serializePage).map(p => structuredClone(p));
  const size = getFormat("instagram-post"), ids = custom.frames.map(frame => frame.id);
  const changedFrames = setFrameRatio(custom.frames, ids, { width: 40, height: 9 }, size).frames;
  const edited = { ...custom, frames: arrangeFrames(changedFrames, ids, "vertical", 32, true, size, "synthetic-stack").frames };
  h.scope.templateCloudConfigured = false;
  h.scope.saveTemplateDraftLocally = vi.fn((draft: CustomTemplate) => { h.state.customTemplates = [draft]; });
  const save = new Function("scope", `with (scope) { ${callbacks.get("saveDesignedTemplate")}; return callback; }`)(h.scope);
  await save(edited);
  expect(h.scope.saveTemplateDraftLocally).toHaveBeenCalled(); expect(h.state.customTemplates[0].frames).not.toEqual(custom.frames);
  expect(h.state.pages.map(serializePage)).toEqual(before);
  expect(page.templateSnapshot!.frames).toEqual(custom.frames);
  expect(page.unavailablePhotos![ids[0]].crop).not.toEqual(page.unavailablePhotos![ids[1]].crop);
});

describe("session-only photo selection", () => {
  it.each([false, true])("does not change composition, edit timestamps, history or autosave inputs (originals loaded: %s)", loaded => {
    const project = fixture();
    const page = project.pages[0], original = Object.values(page.photos)[0];
    page.templateId = pair.id; page.templateSnapshot = pair; page.selectedFrameId = pair.frames[0].id;
    page.photos = Object.fromEntries(pair.frames.map(frame => [frame.id, { ...original, frameId: frame.id, crop: { ...original.crop } }]));
    const h = harness({ project, loaded }), before = h.run<StoredProject>("buildStoredProject"), pages = h.state.pages;
    h.run("selectEditorFrame", pair.frames[1].id);
    expect(h.state.editorSelectedFrameId).toBe(pair.frames[1].id);
    h.run("selectEditorFrame", "stale-frame");
    expect(h.state.editorSelectedFrameId).toBe(pair.frames[1].id);
    expect(h.state.pages).toBe(pages);
    expect(h.run("buildStoredProject")).toEqual(before);
    expect(h.state.projectUpdatedAt).toBe(before.updatedAt);
    expect(h.scope.saveWorkspaceProjects).not.toHaveBeenCalled();
    h.settle();
    expect(h.refs.historyRef.current.canUndo).toBe(false);
    expect(h.refs.historyRef.current.canRedo).toBe(false);
    expect(h.state.pages[0].selectedFrameId).toBe(pair.frames[0].id);
  });
});

describe("production photo picker handlers", () => {
  const candidate = { blobKey: "another-original", sourceWidth: 1536, sourceHeight: 230, sourceName: "other.jpg" };
  function pickerHarness() {
    const p = fixture(); p.photoLibrary = [...getProjectPhotos(p), candidate];
    return harness({ project: p });
  }
  it("cancels without placing and consumes a Use intent once even when clicked twice", () => {
    const h = pickerHarness(), before = h.state.pages.map(serializePage);
    h.run("requestPhoto", single.frames[0].id); h.run("closePhotoLibrary"); h.run("chooseLibraryPhoto", candidate);
    expect(h.state.pages.map(serializePage)).toEqual(before);
    expect(h.scope.saveWorkspaceProjects).not.toHaveBeenCalled();
    h.run("requestPhoto", single.frames[0].id); h.run("chooseLibraryPhoto", candidate); h.run("chooseLibraryPhoto", candidate);
    expect(h.scope.saveWorkspaceProjects).toHaveBeenCalledOnce();
    expect(serializePage(h.state.pages[0]).photos[single.frames[0].id].blobKey).toBe(candidate.blobKey);
  });
  it("rejects a destination edited while the picker is open", () => {
    const h = pickerHarness(); h.run("requestPhoto", single.frames[0].id);
    h.state.pages[0].unavailablePhotos![single.frames[0].id].crop.zoom = .65; h.settle();
    const before = h.state.pages.map(serializePage); h.run("chooseLibraryPhoto", candidate);
    expect(h.state.pages.map(serializePage)).toEqual(before); expect(h.scope.saveWorkspaceProjects).not.toHaveBeenCalled();
    expect(h.notice).toHaveBeenCalledWith(expect.objectContaining({ kind: "error" }));
  });
  it("cannot place in a different account and leaves the current composition intact if durable save fails", () => {
    const h = pickerHarness(), before = h.state.pages.map(serializePage); h.run("requestPhoto", single.frames[0].id);
    (h.scope.workspaceRef as { current: WorkspaceSession }).current.switchTo("different-account"); h.run("chooseLibraryPhoto", candidate);
    expect(h.scope.saveWorkspaceProjects).not.toHaveBeenCalled();
    h.run("requestPhoto", single.frames[0].id);
    vi.mocked(h.scope.saveWorkspaceProjects as () => void).mockImplementation(() => { throw new Error("Quota exceeded"); });
    h.run("chooseLibraryPhoto", candidate); expect(h.state.pages.map(serializePage)).toEqual(before);
  });
  it("pins late import selection to its original project and releases it after an account change", () => {
    const h = pickerHarness(), release = vi.fn(), sources = [{ id: "provider", name: "synthetic.jpg", file: vi.fn(), release }];
    h.refs.activeProjectRef.current = { ...fixture(), id: "now-open-project" };
    h.run("importLibraryPhotos", sources, "synthetic-project", null);
    const add = (h.scope.importQueueRef as { current: { add: ReturnType<typeof vi.fn> } }).current.add;
    expect(add).toHaveBeenCalledWith("synthetic-project", sources);
    (h.scope.workspaceRef as { current: WorkspaceSession }).current.switchTo("different-account");
    h.run("importLibraryPhotos", sources, "synthetic-project", null);
    expect(add).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce();
  });
});
describe("30-page alternatives without duplicate originals", () => {
  it.each([20, 21, 29, 30])("duplicates safely at %s pages and refuses a 31st", async count => {
    const p = fixture(); p.pages = Array.from({ length: count }, (_, i) => ({ ...structuredClone(p.pages[0]), id: `page-${i}` }));
    const h = harness({ project: p }), before = structuredClone(p.pages);
    await h.run("duplicatePage", "page-0"); h.settle();
    expect(h.state.pages).toHaveLength(Math.min(count + 1, 30));
    if (count < 30) {
      const copy = serializePage(h.state.pages[1]).photos[single.frames[0].id];
      expect(copy.blobKey).toBe(before[0].photos[single.frames[0].id].blobKey);
      expect(copy.crop).toEqual(before[0].photos[single.frames[0].id].crop);
      copy.crop.zoom = 3; expect(serializePage(h.state.pages[0]).photos[single.frames[0].id].crop.zoom).toBe(0.812345);
    } else expect(h.state.pages.map(serializePage)).toEqual(before);
  });
});
type Completion = "acknowledgement" | "checkpoint" | "pull";
async function reconcileAfterAdd(h: Harness, completion: Completion) {
  let resolve!: () => void;
  const pending = new Promise<void>(done => { resolve = done; }).then(() => {
    const latest = h.refs.activeProjectRef.current!;
    const incoming = completion === "acknowledgement" ? acknowledgeProjectPush(latest, h.original, {
      conflict: false, partial: false, project: { ...h.original, revision: 2, cloudSyncedAt: "2026-09-17T12:00:01.000Z" },
    }) : completion === "checkpoint" ? applyPhotoBackupCheckpoint(latest, {
      blobKey: "synthetic-original", driveOriginalId: "synthetic-upload-checkpoint", driveFolderId: "synthetic-folder",
    }, "2026-09-17T12:00:01.000Z") : mergeCloudProjectLibrary([latest], [h.original], crypto.randomUUID).projects[0];
    h.run("adoptActiveProject", incoming, completion !== "pull"); h.settle();
  });
  h.run("addPage"); h.settle();
  expect(h.state.screen).toBe("template");
  resolve(); await pending;
  return h.run<StoredProject>("buildStoredProject");
}

afterEach(() => vi.unstubAllGlobals());

describe("page template flow during background reconciliation", () => {
  for (const loaded of [false, true]) for (const completion of ["acknowledgement", "checkpoint", "pull"] as const) {
    for (const chosen of [single, pair]) it(`appends ${chosen.name} after ${completion} with ${loaded ? "loaded" : "unavailable"} originals`, async () => {
      const h = harness({ loaded });
      const beforeChoice = await reconcileAfterAdd(h, completion);
      await h.run("selectTemplate", chosen); h.settle();
      const result = h.run<StoredProject>("buildStoredProject");
      expect(h.confirmPrompt).not.toHaveBeenCalled();
      expect(result.pages).toHaveLength(2);
      expect(result.pages[0]).toEqual(beforeChoice.pages[0]);
      expect(result.pages[1].id).not.toBe(result.pages[0].id);
      expect(result.pages[1].templateId).toBe(chosen.id);
      expect(result.activePageId).toBe(result.pages[1].id);
      expect(result.pendingDeletions).toEqual(beforeChoice.pendingDeletions);
      expect(result.photoLibrary).toEqual(beforeChoice.photoLibrary);
      expect(hasUnexplainedPhotoLoss(result, beforeChoice)).toBe(false);
      expect(result.pages[0].photos[single.frames[0].id].crop).toEqual(h.original.pages[0].photos[single.frames[0].id].crop);
      // Persist and restore through real cache/hydration code, retaining both pages.
      const items = new Map<string, string>();
      const localStorage = { getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => items.set(key, value), removeItem: (key: string) => items.delete(key) };
      vi.stubGlobal("localStorage", localStorage);
      vi.stubGlobal("window", { localStorage });
      saveProjects([result]);
      expect(reconcileProjectPages(loadProjects()[0]).map(serializePage)).toEqual(result.pages);
    });
  }
});

describe("filtered Add page chooser", () => {
  const rounded = TEMPLATES.find(template => template.id === "instagram-post-rounded-stories")!;
  const saved: CustomTemplate = { ...rounded, id: "synthetic-custom-rounded", name: "Custom rounded three", source: "custom", status: "saved",
    syncState: "local", createdAt: timestamp, updatedAt: timestamp };
  const custom: CustomTemplate[] = [saved, { ...saved, id: "synthetic-draft", status: "draft" },
    { ...saved, id: "synthetic-story", formatId: "instagram-story" }];

  it("uses the library filter results for eligible built-ins and saved custom templates", () => {
    const h = harness({ custom }); h.run("addPage");
    h.state.templateFilters = { formatId: "instagram-post", photoCount: 3, edgeStyle: "rounded" };
    h.state.pageTemplateFilters = h.state.templateFilters;
    const library = [...h.run<TemplateDefinition[]>("filteredBuiltInTemplates"), ...h.run<CustomTemplate[]>("filteredCustomTemplates").filter(template => template.status === "saved")];
    expect(h.run<TemplateDefinition[]>("filteredPageTemplates")).toEqual(library);
    expect(library.map(template => template.name)).toEqual(["Rounded stories", "Night frames", "Custom rounded three"]);
    h.state.pageTemplateFilters = { formatId: "instagram-story", photoCount: 3, edgeStyle: "rounded" };
    expect(h.run<TemplateDefinition[]>("filteredPageTemplates")).toEqual(library); // Project format always wins.
    h.state.pageTemplateFilters = { ...h.state.pageTemplateFilters, edgeStyle: "mixed" };
    expect(h.run("filteredPageTemplates")).toEqual([]);
  });

  for (const loaded of [false, true]) it(`browses, combines and cancels filters without changing a project with ${loaded ? "loaded" : "unavailable"} photos`, () => {
    const h = harness({ loaded, custom });
    const before = h.run<StoredProject>("buildStoredProject");
    h.state.templateFilters = { formatId: "instagram-story", photoCount: 2, edgeStyle: "straight" };
    h.run("addPage"); h.settle();
    h.state.pageTemplateFilters = { formatId: "all", photoCount: 3, edgeStyle: "rounded" };
    expect(h.run<TemplateDefinition[]>("filteredPageTemplates")).toHaveLength(3);
    h.settle();
    expect(h.run("buildStoredProject")).toEqual(before);
    h.run("goBack"); h.settle();
    expect(h.run("buildStoredProject")).toEqual(before);
    expect(h.scope.saveWorkspaceProjects).not.toHaveBeenCalled();
    expect(h.confirmPrompt).not.toHaveBeenCalled();
    h.run("addPage");
    expect(h.state.pageTemplateFilters).toEqual(DEFAULT_TEMPLATE_FILTERS);
    expect(h.state.templateFilters).toEqual({ formatId: "instagram-story", photoCount: 2, edgeStyle: "straight" });
  });

  for (const choice of [rounded, saved]) it(`adds filtered ${choice.name} after two populated pages without replacement or crop changes`, async () => {
    const project = fixture();
    project.pages.push({ ...structuredClone(project.pages[0]), id: "second-populated-page" });
    project.pages[1].photos[single.frames[0].id].crop = { zoom: .67, positionX: .3, positionY: .4 };
    const h = harness({ project, custom });
    const before = h.run<StoredProject>("buildStoredProject");
    h.run("addPage");
    h.state.pageTemplateFilters = { formatId: "all", photoCount: 3, edgeStyle: "rounded" };
    h.run("adoptActiveProject", before, true); h.settle(); // A cloud acknowledgement may restore a selected page.
    const candidate = h.run<TemplateDefinition[]>("filteredPageTemplates").find(template => template.id === choice.id)!;
    expect(candidate).toBeDefined();
    await h.run("selectTemplate", candidate); h.settle();
    const result = h.run<StoredProject>("buildStoredProject");
    expect(result.pages).toHaveLength(3);
    expect(result.pages.slice(0, 2)).toEqual(before.pages);
    expect(result.pages[2].templateSnapshot).toEqual(choice);
    expect(result.pages[2].photos).toEqual({});
    expect(result.activePageId).toBe(result.pages[2].id);
    expect(result.photoLibrary).toEqual(before.photoLibrary);
    expect(result.pendingDeletions).toEqual(before.pendingDeletions);
    expect(h.confirmPrompt).not.toHaveBeenCalled();
  });

  it("rejects a stale filtered selection after a project change and reset", async () => {
    const h = harness({ custom }); h.run("addPage"); h.settle();
    h.state.pageTemplateFilters = { formatId: "all", photoCount: 3, edgeStyle: "rounded" };
    const candidate = h.run<TemplateDefinition[]>("filteredPageTemplates")[0], staleClick = h.captureSelection();
    h.run("adoptActiveProject", { ...fixture(), id: "other-project" }); h.settle();
    const other = h.run<StoredProject>("buildStoredProject");
    await staleClick(candidate);
    expect(h.run("buildStoredProject")).toEqual(other);
    h.run("addPage"); h.settle();
    expect(h.state.pageTemplateFilters).toEqual(DEFAULT_TEMPLATE_FILTERS);
    await staleClick(candidate);
    expect(h.run("buildStoredProject")).toEqual(other);
    expect(h.confirmPrompt).not.toHaveBeenCalled();
  });
});

describe("explicit template intent and cancellation", () => {
  it("copies text defaults for a new page without touching populated pages, and later template edits cannot rewrite the page", async () => {
    const project = fixture();
    project.pages[0].templateSnapshot = { ...structuredClone(single), textLayers: [{ ...createTextBox("existing"), text: "Keep my title" }] };
    const before = structuredClone(project.pages[0]), h = harness({ project });
    const candidate = { ...structuredClone(pair), textLayers: [createTextBox("default-title")] };
    h.run("addPage"); h.settle(); await h.run("selectTemplate", candidate); h.settle();
    expect(serializePage(h.state.pages[0])).toEqual(before);
    expect(h.state.pages[1].templateSnapshot?.textLayers).toEqual(candidate.textLayers);
    candidate.textLayers[0].text = "A later template edit";
    expect(h.state.pages[1].templateSnapshot?.textLayers?.[0].text).toBe("Your text");
    expect(h.confirmPrompt).not.toHaveBeenCalled();
  });

  it("keeps page-specific text when deliberately changing only the photo layout", async () => {
    const project = fixture();
    project.pages[0].templateSnapshot = { ...structuredClone(single), textLayers: [{ ...createTextBox("existing"), text: "Keep my title" }] };
    const h = harness({ project }); h.run("changePageLayout"); h.settle();
    await h.run("selectTemplate", { ...pair, textLayers: [createTextBox("other")] }); h.settle();
    expect(h.state.pages[0].templateSnapshot?.textLayers).toEqual(project.pages[0].templateSnapshot.textLayers);
  });

  it("creates a first page and consumes a selection only once before a rerender", async () => {
    const h = harness({ project: { ...fixture(), activePageId: null, pages: [] } });
    h.run("addPage"); h.settle();
    const click = h.captureSelection();
    await click(pair); await click(single); h.settle();
    expect(h.state.pages).toHaveLength(1);
    expect(h.state.pages[0].templateId).toBe(pair.id);
    expect(h.state.templatePickerIntent).toBeNull();
    expect(h.refs.templatePickerRef.current).toBeNull();
  });

  for (const navigation of ["goBack", "openProjects"] as const) it(`invalidates a stale choice after ${navigation} and a later Add page`, async () => {
    const h = harness(); h.run("addPage"); h.settle();
    const oldClick = h.captureSelection();
    h.run(navigation); h.settle();
    await oldClick(pair);
    expect(h.state.pages).toHaveLength(1);
    expect(h.state.templatePickerIntent).toBeNull();
    h.run("addPage"); h.settle();
    await oldClick(pair);
    expect(h.state.pages).toHaveLength(1);
    await h.run("selectTemplate", pair); h.settle();
    expect(h.state.pages).toHaveLength(2);
    expect(h.confirmPrompt).not.toHaveBeenCalled();
  });

  it("invalidates the picker when switching projects, even after returning to the original project", async () => {
    const h = harness(); h.run("addPage"); h.settle();
    const click = h.captureSelection();
    h.run("adoptActiveProject", { ...fixture(), id: "other-project" }); h.settle();
    expect(h.state.screen).toBe("project");
    await click(pair);
    expect(h.state.pages).toHaveLength(1);
    h.run("adoptActiveProject", h.original); h.settle();
    await click(pair);
    expect(h.state.pages.map(serializePage)).toEqual(h.original.pages);
    expect(h.state.templatePickerIntent).toBeNull();
  });

  it("invalidates a picker when the workspace clears the active project", async () => {
    const h = harness(); h.run("addPage"); h.settle();
    const click = h.captureSelection();
    h.run("adoptActiveProject", null);
    await click(pair);
    expect(h.state.pages).toEqual([]);
    expect(h.state.screen).toBe("projects");
    expect(h.state.templatePickerIntent).toBeNull();
  });

  it("keeps intentional layout replacement pinned to its requested page after sync selects another", async () => {
    const project = fixture();
    project.pages.push({ ...structuredClone(project.pages[0]), id: "second-page" });
    const h = harness({ project });
    h.run("changePageLayout"); h.settle();
    h.run("adoptActiveProject", { ...h.refs.activeProjectRef.current!, activePageId: "second-page" }, true); h.settle();
    await h.run("selectTemplate", pair); h.settle();
    expect(h.confirmPrompt).toHaveBeenCalledTimes(1);
    expect(h.state.pages).toHaveLength(2);
    expect(h.state.pages[0].templateId).toBe(pair.id);
    expect(serializePage(h.state.pages[1])).toEqual(project.pages[1]);
    expect(h.state.activePageId).toBe("original-page");
    expect(h.state.pendingDeletions?.photos).toEqual([{ pageId: "original-page", frameId: single.frames[0].id, blobKey: "synthetic-original" }]);
    expect(getProjectPhotos(h.refs.activeProjectRef.current!)[0].driveOriginalId).toBe("synthetic-drive-original");
    const undone = h.refs.historyRef.current.travel("undo", h.refs.activeProjectRef.current!, "2026-09-17T12:00:05.000Z")!;
    expect(undone.pages[0].photos).toEqual(project.pages[0].photos);
    expect(undone.pages[0].templateSnapshot).toEqual(project.pages[0].templateSnapshot);
  });

  it("selecting the current template during deliberate Change layout retains crops and returns to the requested page", async () => {
    const project = fixture(); project.pages.push({ ...structuredClone(project.pages[0]), id: "second-page" });
    const h = harness({ project }); h.run("changePageLayout"); h.settle();
    h.run("adoptActiveProject", { ...h.refs.activeProjectRef.current!, activePageId: "second-page" }, true); h.settle();
    await h.run("selectTemplate", single); h.settle();
    expect(h.state.activePageId).toBe("original-page");
    expect(h.state.pages.map(serializePage)).toEqual(project.pages);
    expect(h.confirmPrompt).not.toHaveBeenCalled();
    expect(h.state.pendingDeletions).toBeUndefined();
  });

  it("cancelling a deliberate replacement leaves every assignment/crop unchanged", async () => {
    const h = harness({ confirm: false }); h.run("changePageLayout"); h.settle();
    await h.run("selectTemplate", pair); h.settle();
    expect(h.state.pages.map(serializePage)).toEqual(h.original.pages);
    expect(h.state.pendingDeletions).toBeUndefined();
    expect(h.state.screen).toBe("template");
    expect(h.state.templatePickerIntent).toMatchObject({ kind: "replace", pageId: "original-page" });
  });

  it("does not replace a fallback page when the requested replacement target disappears", async () => {
    const project = fixture(); project.pages.push({ ...structuredClone(project.pages[0]), id: "second-page" });
    const h = harness({ project }); h.run("changePageLayout"); h.settle();
    h.run("adoptActiveProject", { ...project, activePageId: "second-page", pages: [project.pages[1]] }); h.settle();
    await h.run("selectTemplate", pair); h.settle();
    expect(h.state.pages.map(serializePage)).toEqual([project.pages[1]]);
    expect(h.confirmPrompt).not.toHaveBeenCalled();
    expect(h.state.pendingDeletions).toBeUndefined();
    expect(h.state.screen).toBe("project");
    expect(h.notice).toHaveBeenCalled();
  });

  it("rechecks the page limit if remote pages arrive while Add page is open", async () => {
    const h = harness(); h.run("addPage"); h.settle();
    const incoming = { ...fixture(), pages: Array.from({ length: MAX_PROJECT_PAGES }, (_, i) => ({ ...fixture().pages[0], id: `page-${i}` })) };
    h.run("adoptActiveProject", incoming); h.settle();
    await h.run("selectTemplate", pair); h.settle();
    expect(h.state.pages.map(serializePage)).toEqual(incoming.pages);
    expect(h.state.pendingDeletions).toBeUndefined();
    expect(h.confirmPrompt).not.toHaveBeenCalled();
    expect(h.notice).toHaveBeenCalledWith(expect.objectContaining({ kind: "error" }));
  });

  it("rejects a mismatched format without consuming the add action", async () => {
    const h = harness(); h.run("addPage"); h.settle();
    await h.run("selectTemplate", getTemplatesForFormat("instagram-story")[0]);
    expect(h.state.pages).toHaveLength(1);
    expect(h.state.templatePickerIntent).toMatchObject({ kind: "add" });
    await h.run("selectTemplate", pair); h.settle();
    expect(h.state.pages).toHaveLength(2);
  });
});
