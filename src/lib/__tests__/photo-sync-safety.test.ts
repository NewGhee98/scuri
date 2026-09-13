import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseClient } from "../supabase-client";
import { downloadGoogleDrivePhoto } from "../google-drive";
import { preparePhotoAsset } from "../image";
import { loadPhotoBlob, loadProjects, savePhotoBlob, saveProjects } from "../storage";
import { acknowledgeProjectPush, isProjectDirty, mergeCloudProjectLibrary, pullProjectsFromCloud, pushProjectToCloud, reconcileProtectedProject, resolveProjectConflict, rowsToStoredProject } from "../project-sync";
import { applyPhotoBackupCheckpoint } from "../photo-backup";
import { getProjectPhotos } from "../project-photo-library";
import { applyHydratedPhotos, hydrateProjectPhotos, isPhotoReferencedByAnotherProject, reconcileProjectPages, recordPhotoDeletions, removePagePhoto, serializePage } from "../project-photos";
import { moveLayoutPhoto } from "../project";
import type { StoredPhotoAsset, StoredProject } from "../types";

vi.mock("../supabase-client", () => ({ getSupabaseClient: vi.fn(), isSupabaseConfigured: () => true }));
vi.mock("../google-drive", () => ({ downloadGoogleDrivePhoto: vi.fn() }));
vi.mock("../image", () => ({ preparePhotoAsset: vi.fn() }));
vi.mock("../storage", async (original) => ({ ...await original<typeof import("../storage")>(), loadPhotoBlob: vi.fn(), savePhotoBlob: vi.fn() }));

// In-memory, fabricated rows only. This fake has no Supabase transport, URL,
// credentials, seed/reset SQL, or access to any user's existing project assets.
type Row = Record<string, unknown>;
type Table = "projects" | "project_pages" | "project_assets";
type Mutation = { table: Table; operation: string; filters: Array<[string, unknown]> };
const created = "2026-01-01T00:00:00.000Z";
const edited = "2026-01-01T00:01:00.000Z";
const committed = "2026-01-01T00:02:00.000Z";

function fakeCloud() {
  const project = { id: "test-project", owner_id: "test-owner", name: "Synthetic project", format_id: "instagram-post" as const,
    active_page_id: "test-page", drive_folder_id: "test-folder", revision: 7, created_at: created, updated_at: created, deleted_at: null };
  const page = { id: "test-page", project_id: project.id, owner_id: project.owner_id, position: 0, template_id: "test-template",
    template_snapshot: null, background: "#fff", gutter: 20, selected_frame_id: "frame-1", created_at: created, updated_at: created };
  const assets = [1, 2].map((n) => ({ id: `test-asset-${n}`, project_id: project.id, page_id: page.id, owner_id: project.owner_id,
    frame_id: `frame-${n}`, blob_key: `test-blob-${n}`, drive_file_id: `test-original-${n}`, drive_preview_id: `test-preview-${n}`,
    source_filename: `synthetic-${n}.jpg`, mime_type: "image/jpeg", width: 1200, height: 800, file_size: 123,
    crop: { positionX: 0.2 * n, positionY: -0.1, zoom: 1.5 }, created_at: created, updated_at: created }));
  const initial = rowsToStoredProject(project, [page], assets);
  const rows: Record<Table, Row[]> = structuredClone({ projects: [project], project_pages: [page], project_assets: assets });
  const mutations: Mutation[] = [];
  let failure: { table: Table; operation: string } | undefined;
  let raceOnUpdate = false;
  const from = (table: Table) => {
    let operation = "select";
    let payload: Row[] = [];
    const filters: Array<[string, unknown]> = [];
    const matches = (row: Row) => filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value);
    const run = async (single = false) => {
      if (failure?.table === table && failure.operation === operation) {
        failure = undefined;
        return { data: null, error: new Error("Synthetic transport failure") };
      }
      if (operation !== "select") mutations.push({ table, operation, filters: [...filters] });
      if (raceOnUpdate && table === "projects" && operation === "update") {
        rows.projects[0].revision = Number(rows.projects[0].revision) + 1;
        raceOnUpdate = false;
      }
      let data: Row[] = [];
      if (operation === "select") data = rows[table].filter(matches);
      if (operation === "insert") {
        if (rows[table].some((row) => row.id === payload[0].id)) return { data: null, error: { code: "23505" } };
        data = payload.map((row) => ({ ...row, revision: 1, created_at: created, updated_at: committed, deleted_at: null }));
        rows[table].push(...data);
      }
      if (operation === "update") {
        data = rows[table].filter(matches);
        for (const row of data) Object.assign(row, payload[0], { revision: Number(row.revision) + 1, updated_at: committed });
      }
      if (operation === "upsert") {
        // Model both schema constraints, so replacements/swaps fail if row
        // identity is incorrectly derived from the moving/replaced blob.
        for (const row of payload) {
          if (table === "project_assets" && rows[table].some((other) => other.id !== row.id && other.page_id === row.page_id && other.frame_id === row.frame_id)) {
            return { data: null, error: { code: "23505" } };
          }
        }
        for (const row of payload) {
          const found = rows[table].find((other) => other.id === row.id);
          if (found) Object.assign(found, row);
          else rows[table].push({ ...row, created_at: created, updated_at: committed });
        }
      }
      if (operation === "delete") {
        const removed = rows[table].filter(matches);
        rows[table] = rows[table].filter((row) => !matches(row));
        if (table === "project_pages") rows.project_assets = rows.project_assets.filter((row) => !removed.some((page) => page.id === row.page_id));
        data = removed;
      }
      return { data: structuredClone(single ? data[0] ?? null : data), error: null };
    };
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      is: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      in: (key: string, value: unknown[]) => { filters.push([key, value]); return query; },
      order: () => query,
      insert: (value: Row) => { operation = "insert"; payload = [value]; return query; },
      update: (value: Row) => { operation = "update"; payload = [value]; return query; },
      upsert: (value: Row[]) => { operation = "upsert"; payload = value; return query; },
      delete: () => { operation = "delete"; return query; },
      single: () => run(true),
      maybeSingle: () => run(true),
      then: (resolve: (value: Awaited<ReturnType<typeof run>>) => unknown) => run().then(resolve),
    };
    return query;
  };
  const client = { from, auth: { getUser: async () => ({ data: { user: { id: "test-owner" } }, error: null }) } };
  vi.mocked(getSupabaseClient).mockReturnValue(client as unknown as NonNullable<ReturnType<typeof getSupabaseClient>>);
  return { initial, rows, mutations,
    failNext: (table: Table, operation: string) => { failure = { table, operation }; },
    raceNextUpdate: () => { raceOnUpdate = true; } };
}

function removePhoto(project: StoredProject, frameId: string): StoredProject {
  const page = project.pages[0];
  return { ...project, updatedAt: edited,
    pendingDeletions: recordPhotoDeletions(project.pendingDeletions, page.id, [page.photos[frameId]]),
    pages: [serializePage(removePagePhoto(reconcileProjectPages(project)[0], frameId))] };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Any accidental real transport in a test fails immediately.
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in sync safety tests"); }));
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  vi.mocked(loadPhotoBlob).mockResolvedValue(null);
  vi.mocked(savePhotoBlob).mockResolvedValue();
  vi.mocked(downloadGoogleDrivePhoto).mockRejectedValue(new Error("Drive unavailable"));
  vi.mocked(preparePhotoAsset).mockImplementation(async (sourceBlob, frameId, blobKey = "test-new-blob") => ({
    sourceBlob, frameId, blobKey, previewUrl: `blob:test-${blobKey}`, sourceWidth: 1200, sourceHeight: 800, crop: { positionX: 0, positionY: 0, zoom: 1 },
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("fresh-device load -> hydrate -> autosave -> push", () => {
  it("retains every assignment, Drive id and crop when renamed before Drive connects", async () => {
    const cloud = fakeCloud();
    const [pulled] = await pullProjectsFromCloud();
    const pages = reconcileProjectPages(pulled);
    expect(pages[0].photos).toEqual({});
    const hydrated = await hydrateProjectPhotos(pages, () => null);
    expect(hydrated).toEqual([]);
    expect(downloadGoogleDrivePhoto).not.toHaveBeenCalled();
    const saved = { ...pulled, name: "Renamed on fresh device", updatedAt: edited, pages: applyHydratedPhotos(pages, hydrated).map(serializePage) };
    saveProjects([saved]);
    const result = await pushProjectToCloud(loadProjects()[0]);
    expect(result).toMatchObject({ conflict: false, partial: false });
    expect(cloud.rows.project_assets[0]).toMatchObject({ blob_key: "test-blob-1", crop: cloud.initial.pages[0].photos["frame-1"].crop });
    expect(cloud.rows.project_assets).toHaveLength(2);
    expect(cloud.mutations.some((op) => op.operation === "delete")).toBe(false);
    expect(cloud.rows.projects[0].name).toBe(saved.name);
    expect(loadProjects()[0].pages[0].photos).toEqual(pulled.pages[0].photos);
  });

  it.each(["Drive disconnected", "Drive download failed", "IDB error", "image decode failed"])("preserves metadata after %s, then hydrates after reconnect", async (scenario) => {
    const { initial } = fakeCloud();
    const pages = reconcileProjectPages(initial);
    const blob = new Blob(["synthetic image bytes"], { type: "image/jpeg" });
    if (scenario === "IDB error") vi.mocked(loadPhotoBlob).mockRejectedValue(new Error("IDB unavailable"));
    if (scenario === "image decode failed") {
      vi.mocked(downloadGoogleDrivePhoto).mockResolvedValue(blob);
      vi.mocked(preparePhotoAsset).mockRejectedValueOnce(new Error("decode failed")).mockRejectedValueOnce(new Error("decode failed"));
    }
    const failed = await hydrateProjectPhotos(pages, () => scenario === "Drive disconnected" ? null : "synthetic-token");
    expect(failed).toEqual([]);
    expect(pages.map(serializePage)).toEqual(initial.pages);
    vi.mocked(downloadGoogleDrivePhoto).mockResolvedValue(blob);
    const restored = applyHydratedPhotos(pages, await hydrateProjectPhotos(pages, () => "synthetic-token"));
    expect(Object.keys(restored[0].photos)).toHaveLength(2);
    expect(restored[0].unavailablePhotos).toEqual({});
    expect(restored.map(serializePage)).toEqual(initial.pages);
    expect(savePhotoBlob).toHaveBeenCalledWith("test-blob-1", blob);
  });

  it("reconciles an already-open empty page when cloud metadata arrives, without waiting for bytes", () => {
    const { initial } = fakeCloud();
    const empty = { ...initial, pages: [{ ...initial.pages[0], photos: {} }] };
    const openPages = reconcileProjectPages(empty);
    const merged = mergeCloudProjectLibrary([empty], [initial], () => "unused").projects[0];
    const reconciled = reconcileProjectPages(merged, openPages);
    expect(reconciled.map(serializePage)).toEqual(initial.pages);
    expect(Object.keys(reconciled[0].unavailablePhotos!)).toHaveLength(2);
  });

  it("never applies late hydration over a removed or replaced photo", async () => {
    const { initial } = fakeCloud();
    const pages = reconcileProjectPages(initial);
    vi.mocked(loadPhotoBlob).mockResolvedValue(new Blob(["synthetic"]));
    const late = await hydrateProjectPhotos(pages, () => null);
    const removed = removePagePhoto(pages[0], "frame-1");
    const replacement: StoredPhotoAsset = { ...initial.pages[0].photos["frame-2"], blobKey: "replacement" };
    removed.unavailablePhotos!["frame-2"] = replacement;
    expect(applyHydratedPhotos([removed], late)[0].photos).toEqual({});
    expect(serializePage(applyHydratedPhotos([removed], late)[0]).photos).toEqual({ "frame-2": replacement });
    expect(applyHydratedPhotos([], late)).toEqual([]);
  });
});

describe("cloud deletion protection and explicit intent", () => {
  it("retains completed uploads through protection, cache/editor restoration and the next cloud push", async () => {
    const cloud = fakeCloud();
    cloud.rows.projects[0].drive_folder_id = null;
    cloud.rows.project_assets[0].drive_file_id = null;
    cloud.rows.project_assets[0].drive_preview_id = null;
    const [remote] = await pullProjectsFromCloud();
    const local = structuredClone(remote);
    delete local.pages[0].photos["frame-2"]; // An incomplete stale snapshot, not user intent.
    const uploaded = applyPhotoBackupCheckpoint(local, { blobKey: "test-blob-1", driveFolderId: "test-new-folder",
      driveOriginalId: "test-new-original", drivePreviewId: "test-new-preview" }, edited);
    const result = await pushProjectToCloud(uploaded);
    expect(result).toMatchObject({ assetProtection: true });
    expect(cloud.mutations).toEqual([]);
    if (!("assetProtection" in result)) throw new Error("Expected synthetic protection result");

    const { canonical, copy } = reconcileProtectedProject(uploaded, result.remote, "unused-copy");
    expect(copy).toBeNull(); // Backup progress alone must not create an empty recovered project.
    expect(canonical.driveFolderId).toBe("test-new-folder");
    expect(canonical.pages[0].photos["frame-1"]).toMatchObject({ driveOriginalId: "test-new-original", drivePreviewId: "test-new-preview" });
    expect(canonical.pages[0].photos["frame-2"]).toEqual(remote.pages[0].photos["frame-2"]);
    expect(canonical.pages[0].photos["frame-1"].crop).toEqual(remote.pages[0].photos["frame-1"].crop);
    expect(isProjectDirty(canonical)).toBe(true);
    expect(canonical.revision).toBe(remote.revision);
    expect(canonical.cloudSyncedAt).toBe(remote.cloudSyncedAt);

    saveProjects([canonical]);
    const [cached] = loadProjects();
    const openPages = reconcileProjectPages(cached);
    expect(openPages.map(serializePage)).toEqual(canonical.pages);
    expect(getProjectPhotos(cached).find(photo => photo.blobKey === "test-blob-1")).toMatchObject({
      driveOriginalId: "test-new-original", drivePreviewId: "test-new-preview" });
    const retried = await pushProjectToCloud(cached);
    expect(retried).toMatchObject({ conflict: false, partial: false });
    expect(cloud.rows.projects[0].drive_folder_id).toBe("test-new-folder");
    expect(cloud.rows.project_assets[0]).toMatchObject({ drive_file_id: "test-new-original", drive_preview_id: "test-new-preview" });
    expect(cloud.rows.project_assets).toHaveLength(2);
    expect(cloud.mutations.some(operation => operation.operation === "delete")).toBe(false);
  });

  it("rejects a queued save owned by a different account before any mutation", async () => {
    const cloud = fakeCloud();
    await expect(pushProjectToCloud(cloud.initial, { ownerId: "another-synthetic-owner", isCurrent: () => true })).rejects.toThrow("account changed");
    expect(cloud.mutations).toEqual([]);
  });

  it("stops child writes if a save is cancelled after the parent request commits", async () => {
    const cloud = fakeCloud();
    const isCurrent = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValue(false);
    const result = await pushProjectToCloud(cloud.initial, { ownerId: "test-owner", isCurrent });
    expect(result).toMatchObject({ conflict: false, partial: true });
    expect(cloud.mutations.every(item => item.table === "projects")).toBe(true);
    expect(cloud.rows.project_assets).toHaveLength(2);
  });
  it.each(["all photos", "one photo", "all pages"])("blocks missing %s before any write", async (missing) => {
    const cloud = fakeCloud();
    const local = structuredClone(cloud.initial);
    if (missing === "all pages") local.pages = [];
    else if (missing === "all photos") local.pages[0].photos = {};
    else delete local.pages[0].photos["frame-1"];
    const before = structuredClone(cloud.rows);
    expect(await pushProjectToCloud(local)).toMatchObject({ assetProtection: true });
    expect(cloud.mutations).toEqual([]);
    expect(cloud.rows).toEqual(before);
  });

  it("fails closed when the preflight asset read fails", async () => {
    const cloud = fakeCloud();
    cloud.failNext("project_assets", "select");
    await expect(pushProjectToCloud(cloud.initial)).rejects.toThrow("Synthetic transport failure");
    expect(cloud.mutations).toEqual([]);
  });

  it("still allows a new, intentionally empty project", async () => {
    const cloud = fakeCloud();
    expect(await pushProjectToCloud({ ...cloud.initial, id: "test-new-empty", revision: undefined, pages: [] })).toMatchObject({ conflict: false, partial: false });
    expect(cloud.rows.project_assets).toHaveLength(2);
    expect(cloud.mutations.some((op) => op.operation === "delete")).toBe(false);
  });

  it("preserves known remote Drive ids when an older cache lacks them", async () => {
    const cloud = fakeCloud();
    const local = structuredClone(cloud.initial);
    delete local.pages[0].photos["frame-1"].driveOriginalId;
    delete local.pages[0].photos["frame-1"].drivePreviewId;
    const result = await pushProjectToCloud(local);
    expect(result).toMatchObject({ conflict: false, partial: false });
    if (!("project" in result)) throw new Error("Expected push");
    expect(result.project.pages[0].photos["frame-1"].driveOriginalId).toBe("test-original-1");
    expect(cloud.rows.project_assets[0].drive_preview_id).toBe("test-preview-1");
  });

  it("allows explicitly removing the last unavailable photo, with durable, narrowly scoped intent", async () => {
    const cloud = fakeCloud();
    // Set up an entirely synthetic one-photo fixture; never a live data reset.
    cloud.rows.project_assets = cloud.rows.project_assets.slice(0, 1);
    const [initial] = await pullProjectsFromCloud();
    const removed = removePhoto(initial, "frame-1");
    saveProjects([removed]);
    const result = await pushProjectToCloud(loadProjects()[0]);
    expect(result).toMatchObject({ conflict: false, partial: false, project: { pendingDeletions: undefined } });
    expect(cloud.rows.project_assets).toEqual([]);
    expect(cloud.rows.project_pages).toHaveLength(1);
    expect(cloud.mutations.filter((op) => op.operation === "delete")).toEqual([{
      table: "project_assets", operation: "delete", filters: [
        ["project_id", "test-project"], ["owner_id", "test-owner"], ["id", "test-asset-1"],
        ["page_id", "test-page"], ["frame_id", "frame-1"], ["blob_key", "test-blob-1"],
      ],
    }]);
  });

  it("does not let a stale deletion remove a different cloud photo from the same frame", async () => {
    const cloud = fakeCloud();
    const removed = removePhoto(cloud.initial, "frame-1");
    cloud.rows.project_assets[0].blob_key = "newer-blob";
    expect(await pushProjectToCloud(removed)).toMatchObject({ assetProtection: true });
    expect(cloud.mutations).toEqual([]);
  });

  it("guards repeated blob keys by placement, not just by overall photo count", async () => {
    const cloud = fakeCloud();
    cloud.rows.project_assets[1].blob_key = "test-blob-1";
    const [local] = await pullProjectsFromCloud();
    delete local.pages[0].photos["frame-1"];
    expect(await pushProjectToCloud(local)).toMatchObject({ assetProtection: true });
    expect(cloud.mutations).toEqual([]);
  });

  it("deletes a page only after its explicitly known assignments, and rejects unseen assignments", async () => {
    const cloud = fakeCloud();
    const page = cloud.initial.pages[0];
    const deletion = { ...cloud.initial, pages: [], pendingDeletions: recordPhotoDeletions(undefined, page.id, Object.values(page.photos), true) };
    const incomplete = { ...deletion, pendingDeletions: recordPhotoDeletions(undefined, page.id, [page.photos["frame-1"]], true) };
    expect(await pushProjectToCloud(incomplete)).toMatchObject({ assetProtection: true });
    expect(cloud.mutations).toEqual([]);
    expect(await pushProjectToCloud(deletion)).toMatchObject({ conflict: false, partial: false });
    expect(cloud.rows.project_pages).toEqual([]);
    expect(cloud.rows.project_assets).toEqual([]);
    expect(cloud.mutations.filter((op) => op.operation === "delete").map((op) => op.table)).toEqual(["project_assets", "project_assets", "project_pages"]);
  });

  it("allows confirmed layout clearing without removing the page", async () => {
    const cloud = fakeCloud();
    const page = cloud.initial.pages[0];
    const cleared = { ...cloud.initial, pendingDeletions: recordPhotoDeletions(undefined, page.id, Object.values(page.photos)),
      pages: [{ ...page, templateId: "replacement-layout", photos: {} }] };
    expect(await pushProjectToCloud(cleared)).toMatchObject({ conflict: false, partial: false });
    expect(cloud.rows.project_assets).toEqual([]);
    expect(cloud.rows.project_pages[0].template_id).toBe("replacement-layout");
  });

  it("does not cascade-delete an unexpected asset referencing a page", async () => {
    const cloud = fakeCloud();
    const page = cloud.initial.pages[0];
    const unexpected = { ...cloud.rows.project_assets[0], id: "unexpected-asset", project_id: "other-project", frame_id: "other-frame" };
    cloud.rows.project_assets.push(unexpected);
    const deletion = { ...cloud.initial, pages: [], pendingDeletions: recordPhotoDeletions(undefined, page.id, Object.values(page.photos), true) };
    expect(await pushProjectToCloud(deletion)).toMatchObject({ conflict: false, partial: true });
    expect(cloud.rows.project_assets).toContainEqual(unexpected);
    expect(cloud.rows.project_pages).toHaveLength(1);
    expect(cloud.mutations.some((op) => op.table === "project_pages" && op.operation === "delete")).toBe(false);
  });

  it("replaces one frame while preserving the other unavailable photo and row uniqueness", async () => {
    const cloud = fakeCloud();
    const replaced = removePhoto(cloud.initial, "frame-1");
    replaced.pages[0].photos["frame-1"] = { ...cloud.initial.pages[0].photos["frame-1"], blobKey: "replacement", driveOriginalId: undefined, drivePreviewId: undefined };
    expect(await pushProjectToCloud(replaced)).toMatchObject({ conflict: false, partial: false });
    expect(cloud.rows.project_assets).toHaveLength(2);
    expect(cloud.rows.project_assets[0]).toMatchObject({ id: "test-asset-1", blob_key: "replacement", drive_file_id: null });
    expect(cloud.rows.project_assets[1]).toMatchObject({ id: "test-asset-2", blob_key: "test-blob-2", drive_file_id: "test-original-2", crop: cloud.initial.pages[0].photos["frame-2"].crop });
  });

  it("swaps two photos without uniqueness conflicts or deleting either asset", async () => {
    const cloud = fakeCloud();
    const page = cloud.initial.pages[0];
    const swapped = { ...cloud.initial, pages: [{ ...page, photos: moveLayoutPhoto(page.photos, "frame-1", "frame-2") }],
      pendingDeletions: recordPhotoDeletions(undefined, page.id, Object.values(page.photos)) };
    expect(await pushProjectToCloud(swapped)).toMatchObject({ conflict: false, partial: false });
    expect(cloud.rows.project_assets.map((row) => row.blob_key)).toEqual(["test-blob-2", "test-blob-1"]);
    expect(cloud.mutations.some((op) => op.operation === "delete")).toBe(false);
  });

  it("retains intent and assets on partial failure; a retry finishes safely", async () => {
    const cloud = fakeCloud();
    const removed = removePhoto(cloud.initial, "frame-1");
    cloud.failNext("project_assets", "upsert");
    const first = await pushProjectToCloud(removed);
    expect(first).toMatchObject({ conflict: false, partial: true });
    if (!("project" in first)) throw new Error("Expected partial push");
    expect(first.project.pendingDeletions).toEqual(removed.pendingDeletions);
    expect(first.project.cloudSyncedAt).toBe(created);
    expect(cloud.rows.project_assets).toHaveLength(2);
    expect(await pushProjectToCloud(first.project)).toMatchObject({ conflict: false, partial: false, project: { pendingDeletions: undefined } });
    expect(cloud.rows.project_assets.map((row) => row.blob_key)).toEqual(["test-blob-2"]);
  });

  it("retains removal intent when the exact asset delete fails", async () => {
    const cloud = fakeCloud();
    const removed = removePhoto(cloud.initial, "frame-1");
    cloud.failNext("project_assets", "delete");
    const result = await pushProjectToCloud(removed);
    expect(result).toMatchObject({ conflict: false, partial: true });
    if (!("project" in result)) throw new Error("Expected partial push");
    expect(result.project.pendingDeletions).toEqual(removed.pendingDeletions);
    expect(cloud.rows.project_assets).toHaveLength(2);
    expect(await pushProjectToCloud(result.project)).toMatchObject({ partial: false });
    expect(cloud.rows.project_assets).toHaveLength(1);
  });

  it("stops before child writes when the revision gate loses a race", async () => {
    const cloud = fakeCloud();
    cloud.raceNextUpdate();
    expect(await pushProjectToCloud(cloud.initial)).toMatchObject({ conflict: true });
    expect(cloud.mutations.every((op) => op.table === "projects")).toBe(true);
    expect(cloud.rows.project_assets).toHaveLength(2);
  });

  it("leaves unrelated project assets untouched", async () => {
    const cloud = fakeCloud();
    const unrelated = { ...cloud.rows.project_assets[0], id: "unrelated-asset", project_id: "unrelated-project", page_id: "unrelated-page" };
    cloud.rows.project_assets.push(unrelated);
    expect(await pushProjectToCloud(removePhoto(cloud.initial, "frame-1"))).toMatchObject({ partial: false });
    expect(cloud.rows.project_assets).toContainEqual(unrelated);
  });
});

describe("asynchronous acknowledgements", () => {
  it("keeps edits and new deletion intent made during a push and keeps the result dirty", () => {
    const { initial } = fakeCloud();
    const sent = removePhoto(initial, "frame-1");
    const latest = { ...removePhoto(sent, "frame-2"), name: "Edited during request", updatedAt: "2026-01-01T00:01:30.000Z" };
    const acknowledged = acknowledgeProjectPush(latest, sent, { conflict: false, partial: false, project: { ...sent, revision: 8, cloudSyncedAt: committed, pendingDeletions: undefined } });
    expect(acknowledged.name).toBe(latest.name);
    expect(acknowledged.pages[0].photos).toEqual({});
    expect(acknowledged.pendingDeletions?.photos).toEqual([{ pageId: "test-page", frameId: "frame-2", blobKey: "test-blob-2" }]);
    expect(Date.parse(acknowledged.updatedAt)).toBeGreaterThan(Date.parse(committed));
    expect(acknowledged.revision).toBe(8);
  });

  it("carries uploaded Drive ids into the open editor so the next autosave cannot erase them", async () => {
    const { initial } = fakeCloud();
    const sent = structuredClone(initial);
    delete sent.pages[0].photos["frame-1"].driveOriginalId;
    delete sent.pages[0].photos["frame-1"].drivePreviewId;
    vi.mocked(loadPhotoBlob).mockResolvedValue(new Blob(["synthetic"]));
    const open = reconcileProjectPages(sent);
    const loaded = applyHydratedPhotos(open, await hydrateProjectPhotos(open, () => null));
    const acknowledged = acknowledgeProjectPush(sent, sent, { conflict: false, partial: false, project: { ...initial, revision: 8, cloudSyncedAt: committed } });
    const reconciled = reconcileProjectPages(acknowledged, loaded);
    expect(reconciled[0].photos["frame-1"].driveOriginalId).toBe("test-original-1");
    expect(reconciled[0].photos["frame-1"].previewUrl).toBe(loaded[0].photos["frame-1"].previewUrl);
    expect(reconciled.map(serializePage)).toEqual(initial.pages);
  });

  it("gives conflict copies new page and asset identities, preserving the canonical project's rows", async () => {
    const cloud = fakeCloud();
    const before = structuredClone(cloud.rows);
    const { duplicate } = resolveProjectConflict(cloud.initial, cloud.initial, "test-copy");
    expect(duplicate.pages[0].id).not.toBe("test-page");
    expect(duplicate.driveFolderId).toBeUndefined();
    expect(isPhotoReferencedByAnotherProject([cloud.initial, duplicate], duplicate.id, "test-blob-1")).toBe(true);
    expect(isPhotoReferencedByAnotherProject([duplicate], duplicate.id, "test-blob-1")).toBe(false);
    expect(await pushProjectToCloud(duplicate)).toMatchObject({ conflict: false, partial: false });
    expect(cloud.rows.project_assets.filter((row) => row.project_id === "test-project")).toEqual(before.project_assets);
    expect(cloud.rows.project_pages.filter((row) => row.project_id === "test-project")).toEqual(before.project_pages);
    expect(cloud.rows.project_assets.filter((row) => row.project_id === "test-copy")).toHaveLength(2);
  });

  it("keeps pending deletion dirty even when the device clock is behind the server", () => {
    const { initial } = fakeCloud();
    const removed = { ...removePhoto(initial, "frame-1"), updatedAt: created, cloudSyncedAt: committed };
    expect(isProjectDirty(removed)).toBe(true);
    const merged = mergeCloudProjectLibrary([removed], [initial], () => "unused").projects[0];
    expect({ ...merged, photoLibrary: undefined }).toEqual(removed);
    expect(merged.photoLibrary).toHaveLength(2); // removed assignment remains a library original
  });

  it("ignores a stale cloud pull that arrives after a newer push acknowledgement", () => {
    const { initial } = fakeCloud();
    const acknowledged = { ...initial, name: "Just saved", revision: 8, updatedAt: committed, cloudSyncedAt: committed };
    const merged = mergeCloudProjectLibrary([acknowledged], [initial], () => "unused").projects[0];
    expect({ ...merged, photoLibrary: undefined }).toEqual(acknowledged);
    expect(merged.photoLibrary).toHaveLength(2);
  });
});
