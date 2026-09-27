import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseClient } from "../supabase-client";
import { acknowledgeProjectPush, getProjectBackupCounts, isProjectDirty, mergeCloudProjectLibrary, preserveProtectedLocalEdits, pushProjectToCloud, rowsToStoredProject } from "../project-sync";
import { editProjectPhotoMetadata, getProjectPhotos, getVisibleProjectPhotos, mergePhotoLibraries } from "../project-photo-library";
import { consolidateLibraryDuplicates, scanExactDuplicates } from "../photo-duplicates";
import { reconcileProjectPages, serializePage } from "../project-photos";
import { loadProjects, saveProjects } from "../storage";
import { createProjectBackup, inspectProjectBackup, materializeProjectBackup } from "../project-backup";
import { applyPhotoBackupCheckpoint } from "../photo-backup";
import type { ProjectPhoto, StoredProject } from "../types";

vi.mock("../supabase-client", () => ({ getSupabaseClient: vi.fn(), isSupabaseConfigured: () => true }));
const timestamp = "2026-01-01T00:00:00.000Z", edit = "2026-01-01T00:00:01.000Z", ack = "2026-01-01T00:00:02.000Z";
const assigned = { blobKey: "synthetic-assigned", sourceWidth: 3000, sourceHeight: 1000 };
const loose = { blobKey: "synthetic-unassigned", sourceWidth: 800, sourceHeight: 1200, driveOriginalId: "synthetic-original" };
function source(): StoredProject {
  return { version: 3, id: "synthetic-project", name: "Synthetic library", formatId: "instagram-square", activePageId: "synthetic-page",
    revision: 1, cloudSyncedAt: timestamp, createdAt: timestamp, updatedAt: edit, photoLibrary: [assigned, loose],
    pages: [{ id: "synthetic-page", templateId: "instagram-square-full-frame", background: "#eeddbb", gutter: 0, selectedFrameId: "photo-1",
      photos: { "photo-1": { ...assigned, frameId: "photo-1", crop: { positionX: 0, positionY: 0, zoom: 0.2 } } }, createdAt: timestamp, updatedAt: edit }] };
}
type Row = Record<string, unknown>;
function cloud(supportsLibrary = true, remoteLibrary: ProjectPhoto[] = [loose]) {
  const project = { id: "synthetic-project", owner_id: "synthetic-owner", name: "Synthetic library", format_id: "instagram-square" as const, active_page_id: "synthetic-page",
    revision: 1, drive_folder_id: null, created_at: timestamp, updated_at: timestamp, deleted_at: null, ...(supportsLibrary ? { photo_library: remoteLibrary } : {}) };
  const page = { id: "synthetic-page", project_id: project.id, owner_id: project.owner_id, position: 0, template_id: "instagram-square-full-frame", template_snapshot: null,
    background: "#eeddbb", gutter: 0, selected_frame_id: "photo-1", created_at: timestamp, updated_at: timestamp };
  const asset = { id: "synthetic-row", project_id: project.id, page_id: page.id, owner_id: project.owner_id, frame_id: "photo-1", blob_key: assigned.blobKey,
    drive_file_id: null, drive_preview_id: null, source_filename: null, mime_type: null, width: 3000, height: 1000, file_size: null,
    crop: { positionX: 0, positionY: 0, zoom: 0.2 }, created_at: timestamp, updated_at: timestamp };
  const rows: Record<string, Row[]> = { projects: [project], project_pages: [page], project_assets: [asset] };
  const writes: string[] = [];
  const from = (table: string) => {
    let operation = "select", payload: Row[] = [];
    const filters: Array<[string, unknown]> = [];
    const run = async (single = false) => {
      if (operation !== "select" && payload.some(row => "photo_library" in row) && !supportsLibrary) return { data: null, error: { code: "PGRST204", message: "photo_library column is not in the schema cache" } };
      if (operation !== "select") writes.push(table + ":" + operation);
      const matching = rows[table].filter(row => filters.every(([key, value]) => row[key] === value));
      if (operation === "update") matching.forEach(row => Object.assign(row, payload[0], { revision: Number(row.revision) + 1, updated_at: ack }));
      if (operation === "upsert") for (const row of payload) {
        const existing = rows[table].find(item => item.id === row.id);
        if (existing) Object.assign(existing, row); else rows[table].push(row);
      }
      return { data: structuredClone(single ? matching[0] ?? null : matching), error: null };
    };
    const query = { select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      is: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      update: (value: Row) => { operation = "update"; payload = [value]; return query; },
      insert: (value: Row) => { operation = "insert"; payload = [value]; return query; },
      upsert: (value: Row[]) => { operation = "upsert"; payload = value; return query; },
      maybeSingle: () => run(true), single: () => run(true), then: (resolve: (value: Awaited<ReturnType<typeof run>>) => unknown) => run().then(resolve) };
    return query;
  };
  vi.mocked(getSupabaseClient).mockReturnValue({ from, auth: { getUser: async () => ({ data: { user: { id: "synthetic-owner" } }, error: null }) } } as unknown as ReturnType<typeof getSupabaseClient>);
  return { rows, writes, stored: () => rowsToStoredProject(project, [page], [asset]) };
}
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No real network in library tests"); }));
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
});

describe("rank and label persistence and sync", () => {
  const metadata = (p: StoredProject) => getProjectPhotos(p).map(({ blobKey, rank, labels }) => ({ blobKey, rank, labels })).sort((a, b) => a.blobKey.localeCompare(b.blobKey));
  function tagged() {
    const ranked = editProjectPhotoMetadata(source(), [assigned.blobKey, loose.blobKey], { rank: "hero" }, edit);
    return editProjectPhotoMetadata(ranked, [assigned.blobKey, loose.blobKey], { addLabels: [" Temple ", "Night"] }, edit);
  }
  it("saves and reloads metadata, then round-trips through cloud JSON without changing placements or backup counts", async () => {
    const fixture = cloud(), original = tagged();
    saveProjects([original], "synthetic-owner");
    const [reloaded] = loadProjects("synthetic-owner");
    expect(metadata(reloaded)).toEqual(metadata(original));
    const result = await pushProjectToCloud(reloaded);
    expect(result).toMatchObject({ conflict: false, partial: false });
    expect(metadata(fixture.stored())).toEqual(metadata(original));
    expect(fixture.rows.project_assets[0]).toMatchObject({ id: "synthetic-row", blob_key: assigned.blobKey, crop: source().pages[0].photos["photo-1"].crop });
    expect(getProjectBackupCounts(fixture.stored())).toEqual(getProjectBackupCounts(source()));
    expect(fixture.writes.some(write => write.includes("delete"))).toBe(false);
  });
  it("persists explicit clears and accepts them from another device without resurrecting old metadata", async () => {
    const original = tagged(), fixture = cloud(true, getProjectPhotos(original));
    let cleared = editProjectPhotoMetadata(original, [assigned.blobKey, loose.blobKey], { rank: null }, edit);
    for (const label of ["night", "temple"]) cleared = editProjectPhotoMetadata(cleared, [assigned.blobKey, loose.blobKey], { removeLabel: label }, edit);
    const result = await pushProjectToCloud(cleared);
    expect(result).toMatchObject({ conflict: false, partial: false });
    const remote = fixture.stored();
    expect(getProjectPhotos(remote).every(photo => photo.rank === null && photo.labels?.length === 0)).toBe(true);
    const local = { ...original, updatedAt: timestamp };
    const [pulled] = mergeCloudProjectLibrary([local], [remote], () => "unused").projects;
    expect(metadata(pulled)).toEqual(metadata(cleared));
    expect(isProjectDirty(pulled)).toBe(false);
    saveProjects([pulled], "synthetic-owner");
    expect(metadata(loadProjects("synthetic-owner")[0])).toEqual(metadata(cleared));
  });
  it("retains known ranks and labels if an older client omits the fields and queues their restoration", async () => {
    const original = tagged(), fixture = cloud(true, getProjectPhotos(original));
    await pushProjectToCloud(source());
    expect(metadata(fixture.stored())).toEqual(metadata(original));
    const local = { ...original, updatedAt: timestamp }, olderClient = { ...source(), updatedAt: ack, cloudSyncedAt: ack, revision: 2 };
    const merged = mergeCloudProjectLibrary([local], [olderClient], () => "unused");
    expect(metadata(merged.projects[0])).toEqual(metadata(original));
    expect(isProjectDirty(merged.projects[0])).toBe(true);
    expect(merged.metadataRecoveredIds).toEqual([original.id]);
  });
  it("preserves edits and clears made during an in-flight save alongside completed upload references", () => {
    const sent = tagged();
    let latest = editProjectPhotoMetadata(sent, [assigned.blobKey], { rank: null }, ack);
    latest = editProjectPhotoMetadata(latest, [assigned.blobKey], { removeLabel: "temple" }, ack);
    latest = editProjectPhotoMetadata(latest, [loose.blobKey], { addLabels: ["forest"] }, ack);
    const checkpoint = applyPhotoBackupCheckpoint(sent, { blobKey: loose.blobKey, driveOriginalId: "backed-original",
      drivePreviewId: "backed-preview", driveFolderId: "folder" }, ack);
    const acknowledged = acknowledgeProjectPush(latest, sent, { conflict: false, partial: false,
      project: { ...checkpoint, revision: 2, cloudSyncedAt: ack } });
    expect(metadata(acknowledged)).toEqual(metadata(latest));
    expect(getProjectPhotos(acknowledged)[1]).toMatchObject({ drivePreviewId: "backed-preview", labels: ["forest", "night", "temple"] });
    expect(isProjectDirty(acknowledged)).toBe(true);
    expect(acknowledged.pages[0].photos["photo-1"].crop).toEqual(sent.pages[0].photos["photo-1"].crop);
  });
  it("keeps unsynced metadata on a stale pull and preserves it when structural recovery protects remote placements", () => {
    const edited = tagged(), old = source();
    const [pulled] = mergeCloudProjectLibrary([edited], [old], () => "unused").projects;
    expect(metadata(pulled)).toEqual(metadata(edited));
    const missingPlacement = { ...edited, pages: edited.pages.map(page => ({ ...page, photos: {} })) };
    const recovered = preserveProtectedLocalEdits(missingPlacement, old, "recovered")!;
    expect(recovered.id).toBe("recovered");
    expect(metadata(recovered)).toEqual(metadata(edited));
    expect(recovered.revision).toBeUndefined();
  });
  it.each([{ rank: "good" as const }, { rank: null }, { labels: ["temple"] }, { labels: [] }])(
    "never reports metadata as synced on a schema without photo_library: %j", async extra => {
      const fixture = cloud(false), legacy = source();
      legacy.photoLibrary = [{ ...assigned, ...extra }];
      await expect(pushProjectToCloud(legacy)).rejects.toThrow("Cloud photo library setup is required");
      expect(fixture.writes).toEqual([]);
    });
  it("includes metadata in portable backups and preserves it when restoring new project/original identities", async () => {
    const original = tagged();
    const backup = await createProjectBackup(original, async key => new Blob([`synthetic-${key}`], { type: "image/jpeg" }));
    const inspected = await inspectProjectBackup(backup.blob);
    expect(metadata(inspected.project)).toEqual(metadata(original));
    let id = 0; const restored = materializeProjectBackup(inspected, () => `restored-${id++}`);
    expect(restored.project.id).not.toBe(original.id);
    expect(getProjectPhotos(restored.project).every(photo => photo.rank === "hero" && photo.labels?.join(",") === "night,temple")).toBe(true);
    expect(restored.originals.size).toBe(2);
    expect(restored.project.pages[0].photos["photo-1"].crop).toEqual(original.pages[0].photos["photo-1"].crop);
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("library membership and below-baseline crop persistence", () => {
  it("round-trips explicit duplicate grouping in cloud JSON without deleting or reconfiguring a placed asset", async () => {
    const fixture = cloud(), original = source();
    const scan = await scanExactDuplicates(original, async () => new Blob(["identical synthetic original"]));
    const combined = consolidateLibraryDuplicates(original, scan, scan.groups, edit);
    expect(getVisibleProjectPhotos(combined)).toHaveLength(1);
    const result = await pushProjectToCloud(combined);
    expect("partial" in result && result.partial).toBe(false);
    expect(fixture.rows.project_assets).toHaveLength(1);
    expect(fixture.rows.project_assets[0]).toMatchObject({ id: "synthetic-row", blob_key: assigned.blobKey,
      frame_id: "photo-1", crop: original.pages[0].photos["photo-1"].crop });
    expect(getVisibleProjectPhotos(fixture.stored())).toHaveLength(1);
    expect(getProjectPhotos(fixture.stored())).toHaveLength(2);
    expect(getProjectPhotos(fixture.stored()).find(photo => photo.blobKey === loose.blobKey)?.driveOriginalId).toBe(loose.driveOriginalId);
    expect(fixture.writes.some(write => write.includes("delete"))).toBe(false);
  });
  it("never silently drops grouping/undo metadata through the old-schema fallback", async () => {
    const fixture = cloud(false), legacy = source();
    legacy.photoLibrary = [{ ...assigned, duplicateOf: null }];
    await expect(pushProjectToCloud(legacy)).rejects.toThrow("Cloud photo library setup is required");
    expect(fixture.writes).toEqual([]);
  });
  it("round-trips unassigned and unavailable originals and negative-display zoom through cache and reconciliation", () => {
    const original = source(); saveProjects([original], "synthetic-owner");
    const [restored] = loadProjects("synthetic-owner");
    const pages = reconcileProjectPages(restored);
    expect(pages[0].photos).toEqual({});
    expect(pages[0].unavailablePhotos?.["photo-1"].crop.zoom).toBe(0.2);
    expect(serializePage(pages[0])).toEqual(restored.pages[0]);
    expect(getProjectPhotos(restored)).toHaveLength(2);
    expect(loadProjects("other-owner")).toEqual([]);
    expect(mergePhotoLibraries(original.photoLibrary, [])).toEqual(original.photoLibrary);
  });
  it("cloud read and write preserve the library and exact sub-baseline crop", async () => {
    const fixture = cloud();
    expect(getProjectPhotos(fixture.stored())).toHaveLength(2);
    const result = await pushProjectToCloud(source());
    expect("partial" in result && result.partial).toBe(false);
    expect(fixture.rows.project_assets[0].crop).toEqual({ positionX: 0, positionY: 0, zoom: 0.2 });
    expect((fixture.rows.projects[0].photo_library as unknown[])).toHaveLength(2);
    expect(fixture.writes).not.toContain("project_assets:delete");
  });
  it("preserves remote unassigned originals when an older cache omits the library", async () => {
    const fixture = cloud();
    const oldCache = source(); delete oldCache.photoLibrary;
    await pushProjectToCloud(oldCache);
    expect((fixture.rows.projects[0].photo_library as Array<{ blobKey: string }>).map(photo => photo.blobKey)).toContain(loose.blobKey);
    const local = source(); local.updatedAt = timestamp;
    const oldCloud = { ...local, revision: 2, photoLibrary: undefined };
    const [merged] = mergeCloudProjectLibrary([local], [oldCloud], () => "unused").projects;
    expect(getProjectPhotos(merged)).toHaveLength(2); expect(isProjectDirty(merged)).toBe(true);
  });
  it("fails clearly before child writes when unassigned metadata needs the reviewed migration", async () => {
    const fixture = cloud(false);
    await expect(pushProjectToCloud(source())).rejects.toThrow("Cloud photo library setup is required");
    expect(fixture.writes).toEqual([]); expect(fixture.rows.projects[0].revision).toBe(1);
  });
  it("allows existing assigned-only projects to save against the old schema", async () => {
    const fixture = cloud(false);
    const legacy = source(); delete legacy.photoLibrary;
    const result = await pushProjectToCloud(legacy);
    expect("partial" in result && result.partial).toBe(false);
    expect(fixture.rows.projects[0]).not.toHaveProperty("photo_library");
    expect(fixture.rows.project_assets[0].crop).toEqual(legacy.pages[0].photos["photo-1"].crop);
  });
  it("checkpoints unassigned uploads and preserves library additions made during a save", () => {
    const original = source();
    const checkpointed = applyPhotoBackupCheckpoint(original, { blobKey: loose.blobKey, driveOriginalId: "synthetic-new-original", drivePreviewId: "synthetic-preview", driveFolderId: "synthetic-folder" }, ack);
    expect(checkpointed.pages).toEqual(original.pages);
    expect(getProjectBackupCounts(checkpointed)).toEqual({ total: 2, originals: 1, previews: 1 });
    const latest = { ...original, photoLibrary: [...original.photoLibrary!, { ...loose, blobKey: "added-during-save" }] };
    const acknowledged = acknowledgeProjectPush(latest, original, { conflict: false, partial: false, project: { ...checkpointed, revision: 2, cloudSyncedAt: ack } });
    expect(getProjectPhotos(acknowledged)).toHaveLength(3); expect(isProjectDirty(acknowledged)).toBe(true);
    expect(getProjectPhotos(acknowledged).find(photo => photo.blobKey === loose.blobKey)?.drivePreviewId).toBe("synthetic-preview");
  });
  it("portable backup includes unassigned bytes and restores fresh identities without changing crops", async () => {
    const original = source();
    const packageFile = await createProjectBackup(original, async key => new Blob([`synthetic-${key}`], { type: "image/jpeg" }));
    const preview = await inspectProjectBackup(packageFile.blob);
    expect(preview.originals.size).toBe(2);
    let id = 0; const restored = materializeProjectBackup(preview, () => `fresh-${id++}`);
    expect(getProjectPhotos(restored.project)).toHaveLength(2); expect(restored.originals.size).toBe(2);
    expect(getProjectPhotos(restored.project).every(photo => photo.blobKey.startsWith("fresh-") && !photo.driveOriginalId)).toBe(true);
    expect(Object.values(restored.project.pages[0].photos)[0].crop.zoom).toBe(0.2);
    const incomplete = await inspectProjectBackup((await createProjectBackup(original, async () => null)).blob);
    expect(incomplete.missingOriginals).toBe(2); expect(getProjectPhotos(incomplete.project)).toHaveLength(2);
  });
});
