import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getSupabaseClient, isSupabaseConfigured } from "./supabase-client";
import { getProjectPhotos, hasUnassignedPhotos, mergePhotoLibraries, preserveProjectLibrary } from "./project-photo-library";
import { isProjectPhoto } from "./project-validation";
import { nextProjectEditTime } from "./project-time";
import type {
  CropState,
  FormatId,
  ProjectCloudSyncState,
  StoredPhotoAsset,
  StoredProject,
  StoredProjectPage,
  TemplateDefinition,
  ProjectPhoto,
} from "./types";

// Supabase is the source of truth for project structure/state; Google Drive
// only stores the untouched full-resolution originals and previews
// referenced by drive_file_id/drive_preview_id below. See
// supabase/migrations/20260831120000_create_projects.sql and
// PROJECT_CONTEXT.md for the architecture this implements.

interface ProjectRow {
  photo_library?: ProjectPhoto[];
  id: string;
  owner_id: string;
  name: string;
  format_id: FormatId;
  active_page_id: string | null;
  drive_folder_id: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface ProjectPageRow {
  id: string;
  project_id: string;
  owner_id: string;
  position: number;
  template_id: string;
  template_snapshot: TemplateDefinition | null;
  background: string;
  gutter: number;
  selected_frame_id: string | null;
  created_at: string;
  updated_at: string;
}

interface ProjectAssetRow {
  id: string;
  project_id: string;
  page_id: string;
  owner_id: string;
  frame_id: string;
  blob_key: string;
  drive_file_id: string | null;
  drive_preview_id: string | null;
  source_filename: string | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  file_size: number | null;
  crop: CropState;
  created_at: string;
  updated_at: string;
}

export interface CloudConflict {
  conflict: true;
  /** The canonical remote project, already reconstructed from Supabase. */
  remote: StoredProject;
}

export interface CloudAssetProtection {
  assetProtection: true;
  /** No Supabase writes were made. Reconcile the open editor with this metadata. */
  remote: StoredProject;
}

export interface CloudPushResult {
  conflict: false;
  project: StoredProject;
  /** True when the project row committed but writing its pages/assets failed (e.g. network drop mid-sync).
   *  Safe to retry: the next push re-gates on the now-current revision and re-upserts idempotently. */
  partial: boolean;
}

export function isProjectCloudConfigured(): boolean {
  return isSupabaseConfigured();
}

/**
 * Projects and custom templates are separate features (separate tables and
 * RLS policies - see supabase/migrations) but deliberately share the same
 * Supabase client/auth session from ./supabase-client, so signing in once
 * covers both.
 */
export function getProjectCloudClient(): SupabaseClient | null {
  return getSupabaseClient();
}

export async function getProjectCloudUser(): Promise<User | null> {
  const client = getProjectCloudClient();
  if (!client) return null;
  const { data, error } = await client.auth.getSession();
  if (error) return null;
  return data.session?.user ?? null;
}

// '*' allows reads against the previous schema while the additive column is
// awaiting review. Only the typed project metadata below is consumed.
const PROJECT_COLUMNS = "*";
const PAGE_COLUMNS = "id, project_id, owner_id, position, template_id, template_snapshot, background, gutter, selected_frame_id, created_at, updated_at";
const ASSET_COLUMNS = "id, project_id, page_id, owner_id, frame_id, blob_key, drive_file_id, drive_preview_id, source_filename, mime_type, width, height, file_size, crop, created_at, updated_at";

function assetRowToStoredPhoto(row: Omit<ProjectAssetRow, "created_at" | "updated_at">): StoredPhotoAsset {
  return {
    cloudAssetId: row.id,
    frameId: row.frame_id,
    blobKey: row.blob_key,
    sourceName: row.source_filename ?? undefined,
    mimeType: row.mime_type ?? undefined,
    fileSize: row.file_size ?? undefined,
    driveOriginalId: row.drive_file_id ?? undefined,
    drivePreviewId: row.drive_preview_id ?? undefined,
    sourceWidth: row.width ?? 0,
    sourceHeight: row.height ?? 0,
    crop: row.crop,
  };
}

function pageRowToStoredPage(row: ProjectPageRow, assets: ProjectAssetRow[]): StoredProjectPage {
  const photos: Record<string, StoredPhotoAsset> = {};
  for (const asset of assets) {
    if (asset.page_id !== row.id) continue;
    photos[asset.frame_id] = assetRowToStoredPhoto(asset);
  }
  return {
    id: row.id,
    templateId: row.template_id,
    templateSnapshot: row.template_snapshot ?? undefined,
    background: row.background,
    gutter: row.gutter,
    selectedFrameId: row.selected_frame_id,
    photos,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowsToStoredProject(
  project: ProjectRow,
  pages: ProjectPageRow[],
  assets: ProjectAssetRow[],
): StoredProject {
  if (project.photo_library !== undefined && (!Array.isArray(project.photo_library) || !project.photo_library.every(isProjectPhoto))) {
    throw new Error("Cloud photo library metadata could not be validated; local photos were retained.");
  }
  const orderedPages = [...pages].sort((a, b) => a.position - b.position);
  return {
    version: 3,
    id: project.id,
    name: project.name,
    formatId: project.format_id,
    activePageId: project.active_page_id,
    pages: orderedPages.map((page) => pageRowToStoredPage(page, assets)),
    photoLibrary: project.photo_library,
    revision: project.revision,
    cloudSyncedAt: project.updated_at,
    driveFolderId: project.drive_folder_id ?? undefined,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  };
}

function storedProjectToRows(project: StoredProject, ownerId: string, remote: StoredProject | null): {
  pages: Omit<ProjectPageRow, "created_at" | "updated_at">[];
  assets: Omit<ProjectAssetRow, "created_at" | "updated_at">[];
} {
  const pages: Omit<ProjectPageRow, "created_at" | "updated_at">[] = [];
  const assets: Omit<ProjectAssetRow, "created_at" | "updated_at">[] = [];
  const remotePhotos = new Map(remote ? getProjectPhotos(remote).map(photo => [photo.blobKey, photo] as const) : []);
  project.pages.forEach((page, index) => {
    pages.push({
      id: page.id,
      project_id: project.id,
      owner_id: ownerId,
      position: index,
      template_id: page.templateId,
      template_snapshot: page.templateSnapshot ?? null,
      background: page.background,
      gutter: page.gutter,
      selected_frame_id: page.selectedFrameId,
    });
    for (const photo of Object.values(page.photos)) {
      const existing = remote?.pages.find((item) => item.id === page.id)?.photos[photo.frameId];
      const knownBytes = remotePhotos.get(photo.blobKey);
      assets.push({
        // Row identity belongs to the slot, independently of the cached blob.
        // Replacements/swaps must not violate unique(page_id, frame_id), and
        // a conflicted copy must never reuse another project's asset row ids.
        id: existing ? existing.cloudAssetId ?? existing.blobKey : crypto.randomUUID(),
        project_id: project.id,
        page_id: page.id,
        owner_id: ownerId,
        frame_id: photo.frameId,
        blob_key: photo.blobKey,
        drive_file_id: photo.driveOriginalId ?? knownBytes?.driveOriginalId ?? null,
        drive_preview_id: photo.drivePreviewId ?? knownBytes?.drivePreviewId ?? null,
        source_filename: photo.sourceName ?? null,
        mime_type: photo.mimeType ?? null,
        width: photo.sourceWidth || null,
        height: photo.sourceHeight || null,
        file_size: photo.fileSize ?? null,
        crop: photo.crop,
      });
    }
  });
  return { pages, assets };
}

/** Absence is not deletion intent, even when some other photos did hydrate.
 * Page loss is checked too because the existing foreign key cascades deletes. */
export function hasUnexplainedPhotoLoss(local: StoredProject, remote: StoredProject): boolean {
  return remote.pages.some((page) => {
    const incoming = local.pages.find((item) => item.id === page.id);
    if (!incoming && !local.pendingDeletions?.pageIds.includes(page.id)) return true;
    return Object.values(page.photos).some((photo) => {
      if (incoming?.photos[photo.frameId]?.blobKey === photo.blobKey) return false;
      return !local.pendingDeletions?.photos.some((removed) =>
        removed.pageId === page.id && removed.frameId === photo.frameId && removed.blobKey === photo.blobKey);
    });
  });
}

async function fetchCloudProject(client: SupabaseClient, projectId: string): Promise<StoredProject | null> {
  const { data: projectRow, error: projectError } = await client
    .from("projects")
    .select(PROJECT_COLUMNS)
    .eq("id", projectId)
    .is("deleted_at", null)
    .maybeSingle();
  if (projectError) throw projectError;
  if (!projectRow) return null;
  const [{ data: pageRows, error: pageError }, { data: assetRows, error: assetError }] = await Promise.all([
    client.from("project_pages").select(PAGE_COLUMNS).eq("project_id", projectId),
    client.from("project_assets").select(ASSET_COLUMNS).eq("project_id", projectId),
  ]);
  if (pageError) throw pageError;
  if (assetError) throw assetError;
  return rowsToStoredProject(projectRow as ProjectRow, (pageRows ?? []) as ProjectPageRow[], (assetRows ?? []) as ProjectAssetRow[]);
}

/** Loads every non-deleted project owned by the signed-in user. */
export async function pullProjectsFromCloud(): Promise<StoredProject[]> {
  const client = getProjectCloudClient();
  if (!client) return [];
  const { data: projectRows, error: projectError } = await client
    .from("projects")
    .select(PROJECT_COLUMNS)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });
  if (projectError) throw projectError;
  const projects = (projectRows ?? []) as ProjectRow[];
  if (!projects.length) return [];

  const projectIds = projects.map((row) => row.id);
  const [{ data: pageRows, error: pageError }, { data: assetRows, error: assetError }] = await Promise.all([
    client.from("project_pages").select(PAGE_COLUMNS).in("project_id", projectIds),
    client.from("project_assets").select(ASSET_COLUMNS).in("project_id", projectIds),
  ]);
  if (pageError) throw pageError;
  if (assetError) throw assetError;
  const pagesByProject = new Map<string, ProjectPageRow[]>();
  for (const page of (pageRows ?? []) as ProjectPageRow[]) {
    const list = pagesByProject.get(page.project_id) ?? [];
    list.push(page);
    pagesByProject.set(page.project_id, list);
  }
  const allAssets = (assetRows ?? []) as ProjectAssetRow[];

  return projects.map((row) => rowsToStoredProject(row, pagesByProject.get(row.id) ?? [], allAssets));
}

/**
 * Pushes one project's full current state to Supabase.
 *
 * After the safety read, the project row is written first, gated by
 * `.eq('revision', project.revision)` (or a plain insert when the project
 * has never been synced). Only once that gate succeeds are pages/assets
 * written. A device rejected at that gate stops before child writes.
 * Separate child writes can still interleave across devices after the gate;
 * this feature does not resolve the previously documented transactional gap.
 * These REST requests are not a database transaction; a partial result
 * retains deletion intent and the committed revision for a checked retry.
 * See CloudConflict / resolveProjectConflict for what happens next.
 */
export async function pushProjectToCloud(project: StoredProject, options?: { ownerId: string; isCurrent: () => boolean }): Promise<CloudConflict | CloudPushResult | CloudAssetProtection> {
  const assertCurrent = () => { if (options && !options.isCurrent()) throw new Error("The workspace changed; this save was stopped."); };
  assertCurrent();
  const client = getProjectCloudClient();
  if (!client) throw new Error("Project cloud storage has not been connected yet.");
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw new Error("Sign in before saving this project to the cloud.");
  const ownerId = userData.user.id;
  if (options && options.ownerId !== ownerId) throw new Error("The signed-in account changed; this save was stopped.");
  assertCurrent();

  // Read before ANY writes (including page deletes which cascade to assets).
  // Fail closed on read errors. Covers empty and partially hydrated old caches.
  const remote = await fetchCloudProject(client, project.id);
  assertCurrent();
  if (remote && hasUnexplainedPhotoLoss(project, remote)) return { assetProtection: true, remote };
  if (remote && remote.revision !== project.revision) return { conflict: true, remote };

  project = preserveProjectLibrary(project, ...(remote ? [remote] : []));

  const projectRowInput = {
    id: project.id,
    owner_id: ownerId,
    name: project.name.trim() || "Untitled project",
    format_id: project.formatId,
    active_page_id: project.activePageId,
    drive_folder_id: project.driveFolderId ?? null,
    photo_library: project.photoLibrary,
  };

  const writeParent = (input: Omit<typeof projectRowInput, "photo_library"> & { photo_library?: ProjectPhoto[] }) => project.revision === undefined
    ? client.from("projects").insert(input).select(PROJECT_COLUMNS).single()
    : client.from("projects").update(input).eq("id", project.id).eq("owner_id", ownerId)
      .eq("revision", project.revision).is("deleted_at", null).select(PROJECT_COLUMNS).maybeSingle();
  let parentResult = await writeParent(projectRowInput);
  if (parentResult.error && ["42703", "PGRST204"].includes(parentResult.error.code) && parentResult.error.message.includes("photo_library")) {
    // A missing-column error commits nothing. Existing assigned-only projects
    // can still save; never acknowledge independent library metadata as synced.
    if (hasUnassignedPhotos(project) || getProjectPhotos(project).some(photo => photo.duplicateOf !== undefined)) throw new Error("Cloud photo library setup is required. Your photos remain in this workspace; download a backup until the reviewed migration is installed.");
    const legacyInput = { ...projectRowInput } as Partial<typeof projectRowInput>;
    delete legacyInput.photo_library;
    assertCurrent();
    parentResult = await writeParent(legacyInput as typeof projectRowInput);
  }
  const { data, error } = parentResult;
  if (project.revision === undefined) {
    if (error) {
      // 23505 = unique_violation: this id already exists remotely (created
      // by another device, or resurrected after a soft delete this device
      // does not know about yet). Either way, do not clobber it.
      if (error.code === "23505") {
        const remote = await fetchCloudProject(client, project.id);
        if (remote) return { conflict: true, remote };
      }
      throw error;
    }
  } else {
    if (error) throw error;
    if (!data) {
      const remote = await fetchCloudProject(client, project.id);
      if (remote) return { conflict: true, remote };
      // The row vanished (deleted elsewhere) rather than being edited elsewhere.
      throw new Error("This project was deleted from another device.");
    }
  }
  const committedRow = data as ProjectRow;

  const syncedProject: StoredProject = {
    ...project,
    revision: committedRow.revision,
    cloudSyncedAt: committedRow.updated_at,
    driveFolderId: committedRow.drive_folder_id ?? undefined,
  };

  try {
    assertCurrent();
    const { pages, assets } = storedProjectToRows(project, ownerId, remote);

    if (pages.length) {
      const { error } = await client.from("project_pages").upsert(pages, { onConflict: "id" });
      if (error) throw error;
    }
    if (assets.length) {
      assertCurrent();
      const { error } = await client.from("project_assets").upsert(assets, { onConflict: "id" });
      if (error) throw error;
    }
    // Only exact, previously observed and explicitly removed assignments.
    // No project-wide or NOT IN deletion, including the empty-project case.
    for (const page of remote?.pages ?? []) {
      assertCurrent();
      const incoming = project.pages.find((item) => item.id === page.id);
      for (const photo of Object.values(page.photos)) {
        assertCurrent();
        if (incoming?.photos[photo.frameId]) continue; // updated in place above
        const { error } = await client.from("project_assets").delete()
          .eq("project_id", project.id).eq("owner_id", ownerId)
          .eq("id", photo.cloudAssetId ?? photo.blobKey).eq("page_id", page.id)
          .eq("frame_id", photo.frameId).eq("blob_key", photo.blobKey);
        if (error) throw error;
      }
      if (!incoming) {
        // Never use the page FK cascade to remove unseen photo assignments.
        const { data: remaining, error: readError } = await client.from("project_assets")
          .select("id").eq("page_id", page.id);
        if (readError) throw readError;
        if (remaining?.length) throw new Error("This page still has cloud photos; reload before deleting it.");
        assertCurrent();
        const { error } = await client.from("project_pages").delete()
          .eq("project_id", project.id).eq("owner_id", ownerId).eq("id", page.id);
        if (error) throw error;
      }
    }
    syncedProject.pages = project.pages.map((page) => ({ ...page, photos: Object.fromEntries(
      assets.filter((asset) => asset.page_id === page.id).map((asset) => [asset.frame_id, assetRowToStoredPhoto(asset)]),
    ) }));
  } catch {
    // The project row is safely committed; only its pages/assets failed to
    // write. Local work is not lost - the caller keeps `syncedProject`
    // (with its advanced revision) and can retry, which idempotently
    // re-upserts the same pages/assets.
    return { conflict: false, project: { ...syncedProject, cloudSyncedAt: project.cloudSyncedAt }, partial: true };
  }

  return { conflict: false, project: { ...syncedProject, pendingDeletions: undefined }, partial: false };
}

/** Soft-deletes a project in Supabase (tombstone, not a hard delete). */
export async function softDeleteCloudProject(projectId: string, options?: { ownerId: string; isCurrent: () => boolean }): Promise<void> {
  const client = getProjectCloudClient();
  if (!client) return;
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw new Error("Sign in before deleting this project from the cloud.");
  if (options && (!options.isCurrent() || options.ownerId !== userData.user.id)) throw new Error("The account changed; deletion was stopped.");
  const { error } = await client
    .from("projects")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", projectId)
    .eq("owner_id", userData.user.id)
    .is("deleted_at", null);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Pure helpers (conflict policy, merge policy, derived sync status) - kept
// free of network/browser globals so they can be unit tested directly.
// ---------------------------------------------------------------------------

/**
 * Safe conflict policy: never silently overwrite. The remote copy becomes
 * canonical under the original id; the device's own unsynced edits are kept
 * as a brand-new, never-synced project so nothing is lost. This mirrors how
 * Dropbox/Google Drive resolve a genuine two-writer conflict, and needs no
 * merge UI.
 */
export function resolveProjectConflict(
  local: StoredProject,
  remote: StoredProject,
  newId: string,
  now = new Date().toISOString(),
): { canonical: StoredProject; duplicate: StoredProject } {
  const pageIds = new Map(local.pages.map((page) => [page.id, crypto.randomUUID()]));
  const duplicate: StoredProject = {
    ...local,
    id: newId,
    name: `${local.name} (conflicted copy)`,
    revision: undefined,
    cloudSyncedAt: undefined,
    driveFolderId: undefined,
    pendingDeletions: undefined,
    activePageId: local.activePageId ? pageIds.get(local.activePageId) ?? null : null,
    pages: local.pages.map((page) => ({ ...page, id: pageIds.get(page.id)! })),
    createdAt: now,
    updatedAt: now,
  };
  return { canonical: remote, duplicate };
}

/** Keep meaningful local work when the absence guard restores remote metadata.
 * An otherwise identical empty cache needs reconciliation, not another project. */
export function preserveProtectedLocalEdits(local: StoredProject, remote: StoredProject, newId: string): StoredProject | null {
  const remotePhotos = new Map(getProjectPhotos(remote).map(photo => [photo.blobKey, photo]));
  const meaningful = getProjectPhotos(local).some(photo => !remotePhotos.has(photo.blobKey) ||
    (photo.duplicateOf !== undefined && photo.duplicateOf !== remotePhotos.get(photo.blobKey)?.duplicateOf)) || local.name !== remote.name || local.pages.some(page => {
    const other = remote.pages.find(item => item.id === page.id);
    return !other || page.templateId !== other.templateId || page.background !== other.background || page.gutter !== other.gutter ||
      JSON.stringify(page.templateSnapshot) !== JSON.stringify(other.templateSnapshot) ||
      Object.values(page.photos).some(photo => {
        const previous = other.photos[photo.frameId];
        return !previous || previous.blobKey !== photo.blobKey || JSON.stringify(previous.crop) !== JSON.stringify(photo.crop);
      });
  });
  if (!meaningful && !local.pendingDeletions?.photos.length && !local.pendingDeletions?.pageIds.length) return null;
  const copy = resolveProjectConflict(local, remote, newId).duplicate;
  return { ...copy, name: `${local.name} (recovered local edits)`.slice(0, 120) };
}

/** Restore cloud structure without discarding completed uploads. Fill missing
 * byte references by immutable blob key; existing cloud references win. Newly
 * retained checkpoints remain dirty until a later metadata push acknowledges them. */
export function reconcileProtectedProject(local: StoredProject, remote: StoredProject, newId: string,
  timestamp = new Date().toISOString()): { canonical: StoredProject; copy: StoredProject | null } {
  if (local.id !== remote.id) throw new Error("Cannot reconcile backup checkpoints from another project.");
  const remotePhotos = getProjectPhotos(remote);
  const backups = new Map(mergePhotoLibraries(getProjectPhotos(local), remotePhotos).map(photo => [photo.blobKey, photo]));
  const driveFolderId = remote.driveFolderId ?? local.driveFolderId;
  let changed = driveFolderId !== remote.driveFolderId;
  const retainUploads = <T extends ProjectPhoto>(photo: T): T => {
    const known = backups.get(photo.blobKey);
    const driveOriginalId = photo.driveOriginalId ?? known?.driveOriginalId;
    const drivePreviewId = photo.drivePreviewId ?? known?.drivePreviewId;
    if (driveOriginalId === photo.driveOriginalId && drivePreviewId === photo.drivePreviewId) return photo;
    changed = true;
    return { ...photo, driveOriginalId, drivePreviewId };
  };
  const photoLibrary = remotePhotos.map(retainUploads);
  const pages = remote.pages.map(page => ({ ...page,
    photos: Object.fromEntries(Object.entries(page.photos).map(([frameId, photo]) => [frameId, retainUploads(photo)])) }));
  const canonical = changed ? { ...remote, driveFolderId, photoLibrary, pages, updatedAt: nextProjectEditTime(remote, timestamp) } : remote;
  return { canonical, copy: preserveProtectedLocalEdits(local, remote, newId) };
}

export function getProjectBackupCounts(project: StoredProject): { total: number; originals: number; previews: number } {
  const photos = getProjectPhotos(project);
  return { total: photos.length, originals: photos.filter(photo => photo.driveOriginalId).length,
    previews: photos.filter(photo => photo.drivePreviewId).length };
}

/** Keep edits made during an async push; merge only acknowledged sync/byte ids.
 * New deletion intent survives an older acknowledgement, including offline retries. */
export function acknowledgeProjectPush(latest: StoredProject, sent: StoredProject, result: CloudPushResult): StoredProject {
  const photoKey = (photo: { pageId: string; frameId: string; blobKey: string }) => JSON.stringify([photo.pageId, photo.frameId, photo.blobKey]);
  const sentDeletions = new Set(sent.pendingDeletions?.photos.map(photoKey));
  const pendingDeletions = result.partial ? latest.pendingDeletions : latest.pendingDeletions && {
    photos: latest.pendingDeletions.photos.filter((photo) => !sentDeletions.has(photoKey(photo))),
    pageIds: latest.pendingDeletions.pageIds.filter((id) => !sent.pendingDeletions?.pageIds.includes(id)),
  };
  const edited = latest.updatedAt !== sent.updatedAt || latest.name !== sent.name ||
    JSON.stringify(latest.photoLibrary) !== JSON.stringify(sent.photoLibrary) ||
    JSON.stringify(latest.pages) !== JSON.stringify(sent.pages) ||
    JSON.stringify(latest.pendingDeletions) !== JSON.stringify(sent.pendingDeletions);
  const acknowledgedPhotos = new Map(result.project.pages.flatMap((page) => Object.values(page.photos).map((photo) => [photo.blobKey, photo] as const)));
  return {
    ...latest,
    photoLibrary: mergePhotoLibraries(getProjectPhotos(result.project), getProjectPhotos(latest)),
    revision: result.project.revision,
    cloudSyncedAt: result.project.cloudSyncedAt,
    driveFolderId: result.project.driveFolderId,
    pendingDeletions: pendingDeletions?.photos.length || pendingDeletions?.pageIds.length ? pendingDeletions : undefined,
    // Server time can be later than an edit made during the request.
    updatedAt: edited ? new Date(Math.max(Date.parse(latest.updatedAt), Date.parse(result.project.cloudSyncedAt ?? latest.updatedAt) + 1)).toISOString() : latest.updatedAt,
    pages: latest.pages.map((page) => ({ ...page, photos: Object.fromEntries(Object.entries(page.photos).map(([frameId, photo]) => {
      const acknowledged = acknowledgedPhotos.get(photo.blobKey);
      const slot = result.project.pages.find((item) => item.id === page.id)?.photos[frameId];
      return [frameId, acknowledged ? {
        ...photo, driveOriginalId: acknowledged.driveOriginalId ?? photo.driveOriginalId,
        drivePreviewId: acknowledged.drivePreviewId ?? photo.drivePreviewId,
        cloudAssetId: slot?.blobKey === photo.blobKey ? slot.cloudAssetId : photo.cloudAssetId,
      } : photo];
    })) })),
  };
}

export function projectHasUnbackedAssets(project: StoredProject): boolean {
  return getProjectPhotos(project).some(photo => !photo.driveOriginalId || !photo.drivePreviewId);
}

export function isProjectDirty(project: StoredProject): boolean {
  if (project.pendingDeletions?.photos.length || project.pendingDeletions?.pageIds.length) return true;
  if (!project.cloudSyncedAt) return true;
  return Date.parse(project.updatedAt) > Date.parse(project.cloudSyncedAt);
}

export interface ProjectSyncContext {
  online: boolean;
  signedIn: boolean;
  isSyncing: boolean;
  hasError: boolean;
  driveConfigured: boolean;
  driveTokenValid: boolean;
}

export function getProjectSyncStatus(project: StoredProject, context: ProjectSyncContext): ProjectCloudSyncState {
  if (context.isSyncing) return "syncing";
  if (context.hasError) return "sync-error";
  if (!context.signedIn) return "local-only";
  const dirty = isProjectDirty(project);
  const unbacked = projectHasUnbackedAssets(project);
  if (!context.online) return dirty || unbacked ? "waiting-for-connection" : "synced";
  if (dirty) return "saved-locally";
  if (context.driveConfigured && !context.driveTokenValid && unbacked) {
    return "drive-reconnect-required";
  }
  if (unbacked) return "photos-pending";
  return "synced";
}

export interface MergedProjectLibrary {
  projects: StoredProject[];
  /** Local-only ids that were dropped because they were confirmed deleted on another device. */
  removedLocalIds: string[];
}

/**
 * Combines a freshly pulled cloud library with the device's local library
 * after sign-in / reconnect. Cloud is authoritative for anything it still
 * has. A local project cloud has never heard of (revision undefined) is
 * always kept, so it can be pushed as new. A previously-synced local project
 * that cloud no longer has is dropped only if the device has no unsynced
 * edits to it (otherwise it is recovered as a new, unsynced project so nil
 * is lost - see "resurrected" below).
 */
export function mergeCloudProjectLibrary(local: StoredProject[], remote: StoredProject[], generateId: () => string): MergedProjectLibrary {
  const remoteById = new Map(remote.map((project) => [project.id, project]));
  const merged = new Map<string, StoredProject>();
  const removedLocalIds: string[] = [];

  for (const project of local) {
    const cloud = remoteById.get(project.id);
    if (cloud) {
      // A pull started before an acknowledged push can arrive afterwards.
      // Never roll the active editor/cache back to that older revision.
      const olderCloud = project.revision !== undefined && cloud.revision !== undefined && project.revision > cloud.revision;
      const chosen = isProjectDirty(project) || olderCloud ? project : cloud;
      const combined = preserveProjectLibrary(chosen, project, cloud);
      // Old clients omit the new column; never let that hide unassigned photos.
      const missingLibrary = getProjectPhotos(project).some(photo => !getProjectPhotos(cloud).some(item => item.blobKey === photo.blobKey &&
        (photo.duplicateOf === undefined || item.duplicateOf !== undefined)));
      if (missingLibrary && !isProjectDirty(combined)) combined.updatedAt = new Date(Math.max(Date.now(), Date.parse(combined.cloudSyncedAt ?? combined.updatedAt) + 1)).toISOString();
      merged.set(project.id, combined);
      continue;
    }
    if (project.revision === undefined) {
      merged.set(project.id, project);
      continue;
    }
    if (!isProjectDirty(project)) {
      removedLocalIds.push(project.id);
      continue;
    }
    const resurrected: StoredProject = { ...resolveProjectConflict(project, project, generateId()).duplicate, name: `${project.name} (recovered)` };
    merged.set(resurrected.id, resurrected);
  }
  for (const project of remote) {
    if (!merged.has(project.id)) merged.set(project.id, project);
  }

  return {
    projects: [...merged.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    removedLocalIds,
  };
}
