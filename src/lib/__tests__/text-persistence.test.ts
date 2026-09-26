import { afterEach, describe, expect, it, vi } from "vitest";
import { createTextBox } from "../text";
import { copyAsCustomTemplate, cacheCustomTemplates, loadCachedCustomTemplates, loadCloudTemplates, saveCloudTemplate } from "../custom-templates";
import { getTemplate } from "../templates";
import { serializePage, reconcileProjectPages, applyHydratedPhotos } from "../project-photos";
import { isStoredProject } from "../project-validation";
import { ProjectHistory, projectContentKey } from "../project-history";
import { rowsToStoredProject } from "../project-sync";
import { createProjectBackup, inspectProjectBackup, materializeProjectBackup } from "../project-backup";
import { getSupabaseClient } from "../supabase-client";
import type { ProjectPage, StoredProject } from "../types";

vi.mock("../supabase-client", () => ({ getSupabaseClient: vi.fn(), isSupabaseConfigured: () => true }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const stamp = "2026-09-25T10:00:00.000Z";
function fixture(): StoredProject {
  const template = { ...getTemplate("instagram-post-vertical-pair"), textLayers: [createTextBox("title")] };
  return { version: 3, id: "synthetic-project", name: "Synthetic text", formatId: template.formatId, activePageId: "page", createdAt: stamp, updatedAt: stamp,
    pages: [{ id: "page", templateId: template.id, templateSnapshot: template, photos: Object.fromEntries(template.frames.map((frame, i) => [frame.id, {
      frameId: frame.id, blobKey: "same-original", sourceWidth: 6400, sourceHeight: 1440, driveOriginalId: "synthetic-drive-id",
      crop: { zoom: i ? .7 : 1.5, positionX: .2, positionY: -.3, ...(i ? { freePosition: { x: .1, y: .2 } } : {}) },
    }])), background: "#ffffff", gutter: 32, selectedFrameId: null, createdAt: stamp, updatedAt: stamp }] };
}
function storage() {
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value) });
}

describe("portable text with independent photo placements", () => {
  it("round-trips text locally and through cloud rows without changing legacy or repeated crops", () => {
    const source = fixture(), before = structuredClone(source), page = source.pages[0];
    expect(isStoredProject(source)).toBe(true);
    const hydrated = reconcileProjectPages(JSON.parse(JSON.stringify(source)), []);
    expect(Object.keys(hydrated[0].unavailablePhotos!)).toHaveLength(2);
    expect(serializePage(hydrated[0])).toEqual(page);
    const remote = rowsToStoredProject({ id: source.id, owner_id: "owner", name: source.name, format_id: source.formatId, active_page_id: page.id,
      drive_folder_id: null, revision: 1, created_at: stamp, updated_at: stamp, deleted_at: null }, [{ id: page.id, project_id: source.id, owner_id: "owner",
      position: 0, template_id: page.templateId, template_snapshot: page.templateSnapshot!, background: page.background, gutter: page.gutter,
      selected_frame_id: null, created_at: stamp, updated_at: stamp }], []);
    expect(remote.pages[0].templateSnapshot?.textLayers).toEqual(page.templateSnapshot?.textLayers);
    const legacy = structuredClone(source); delete legacy.pages[0].templateSnapshot!.textLayers;
    expect(isStoredProject(legacy)).toBe(true);
    expect(source).toEqual(before);
  });

  it("late original hydration preserves edited text and both independent crops", () => {
    const source = fixture(), [page] = reconcileProjectPages(source, []);
    page.templateSnapshot = { ...page.templateSnapshot!, textLayers: [{ ...createTextBox("title"), text: "Edited while offline", x: .15 }] };
    const stored = Object.values(source.pages[0].photos)[0];
    const loaded = { ...stored, crop: { zoom: 1, positionX: 0, positionY: 0 }, sourceBlob: new Blob(["original"]), previewUrl: "blob:synthetic" };
    const result = applyHydratedPhotos([page], [{ pageId: page.id, photo: loaded }]);
    expect(result[0].templateSnapshot?.textLayers).toEqual(page.templateSnapshot.textLayers);
    expect(serializePage(result[0]).photos).toEqual(source.pages[0].photos);
  });

  it("Undo/Redo restores a whole text action without inventing photo deletion intent", () => {
    const source = fixture(), history = new ProjectHistory(); history.reset(source);
    const changed = structuredClone(source);
    changed.pages[0].templateSnapshot!.textLayers![0] = { ...createTextBox("title"), x: .2, width: .6, text: "NEW TITLE", fontSize: 60 };
    history.observe(changed);
    const undone = history.travel("undo", changed, stamp)!;
    expect(projectContentKey(undone)).toEqual(projectContentKey(source));
    expect(undone.pendingDeletions).toBeUndefined();
    const redone = history.travel("redo", undone, stamp)!;
    expect(projectContentKey(redone)).toEqual(projectContentKey(changed));
    expect(redone.pages[0].photos).toEqual(source.pages[0].photos);
  });

  it("backs up/restores text with unavailable originals and retains all placements", async () => {
    const source = fixture(), before = structuredClone(source);
    const backup = await createProjectBackup(source, async () => null);
    const restored = materializeProjectBackup(await inspectProjectBackup(backup.blob));
    expect(restored.project.pages[0].templateSnapshot?.textLayers).toEqual(source.pages[0].templateSnapshot?.textLayers);
    expect(Object.keys(restored.project.pages[0].photos)).toHaveLength(2);
    expect(restored.originals.size).toBe(0); expect(source).toEqual(before);
  });

  it("copies template defaults independently, retains cache text and permits explicit removal", () => {
    storage(); const source = fixture().pages[0].templateSnapshot!;
    const copy = copyAsCustomTemplate(source, []);
    expect(copy.textLayers?.[0].id).not.toBe(source.textLayers![0].id);
    copy.textLayers![0].text = "Template copy";
    expect(source.textLayers![0].text).toBe("Your text");
    cacheCustomTemplates([copy]); expect(loadCachedCustomTemplates()[0].textLayers).toEqual(copy.textLayers);
    copy.textLayers = []; cacheCustomTemplates([copy]); expect(loadCachedCustomTemplates()[0].textLayers).toEqual([]);
    const page: ProjectPage = { ...fixture().pages[0], photos: {}, templateSnapshot: structuredClone(source) };
    copy.textLayers = [createTextBox("later")]; expect(page.templateSnapshot?.textLayers).toEqual(source.textLayers);
  });
});

describe("reusable template cloud text", () => {
  function cloud({ missing = false, strip = false, alter = false } = {}) {
    let row: Record<string, unknown> = {};
    const upsert = vi.fn((value: Record<string, unknown>) => {
      row = { ...value };
      // PostgreSQL JSONB does not preserve the submitted object's key order.
      if (Array.isArray(row.text_layers)) row.text_layers = row.text_layers.map(box =>
        Object.fromEntries(Object.entries({ ...box, ...(alter ? { text: "Unexpected server text" } : {}) }).reverse()));
      if (strip) delete row.text_layers; return query;
    });
    const query = { upsert, select: vi.fn(() => query), single: async () => ({ data: row,
      error: missing ? { code: "PGRST204", message: "Missing text_layers" } : null }), order: async () => ({ data: [row], error: null }) };
    vi.mocked(getSupabaseClient).mockReturnValue({ auth: { getUser: async () => ({ data: { user: { id: "owner" } }, error: null }) }, from: () => query } as never);
    return { upsert, row: () => row };
  }
  it("round-trips reordered JSONB text fields and explicit [] deletion through the additive field", async () => {
    const fake = cloud(), draft = copyAsCustomTemplate(fixture().pages[0].templateSnapshot!, []);
    const saved = await saveCloudTemplate(draft); expect(saved.textLayers).toEqual(draft.textLayers);
    expect((await loadCloudTemplates())[0].textLayers).toEqual(draft.textLayers);
    const emptied = await saveCloudTemplate({ ...draft, textLayers: [] });
    expect(emptied.textLayers).toEqual([]); expect(fake.row().text_layers).toEqual([]);
  });
  it("blocks unconfirmed/missing-column text saves while keeping legacy template saves compatible", async () => {
    const draft = copyAsCustomTemplate(fixture().pages[0].templateSnapshot!, []), before = structuredClone(draft);
    for (const options of [{ missing: true }, { strip: true }, { alter: true }]) {
      cloud(options); await expect(saveCloudTemplate(draft)).rejects.toThrow(/local copy|this device/);
    }
    expect(draft).toEqual(before);
    const fake = cloud(); delete draft.textLayers;
    await saveCloudTemplate(draft); expect(fake.upsert.mock.calls[0][0]).not.toHaveProperty("text_layers");
  });
});
