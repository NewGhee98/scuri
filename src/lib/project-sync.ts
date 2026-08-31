import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getSupabaseClient, isSupabaseConfigured } from "./supabase-client";
import type {
  CropState,
  FormatId,
  ProjectCloudSyncState,
  StoredPhotoAsset,
  StoredProject,
  StoredProjectPage,
  TemplateDefinition,
} from "./types";

// Supabase is the source of truth for project structure/state; Google Drive
// only stores the untouched full-resolution originals and previews
// referenced by drive_file_id/drive_preview_id below. See
// supabase/migrations/20260831120000_create_projects.sql and
// PROJECT_CONTEXT.md for the architecture this implements.

interface ProjectRow {
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

const PROJECT_COLUMNS = "id, owner_id, name, format_id, active_page_id, drive_folder_id, revision, created_at, updated_at, deleted_at";
const PAGE_COLUMNS = "id, project_id, owner_id, position, template_id, template_snapshot, background, gutter, selected_frame_id, created_at, updated_at";
const ASSET_COLUMNS = "id, project_id, page_id, owner_id, frame_id, blob_key, drive_file_id, drive_preview_id, source_filename, mime_type, width, height, file_size, crop, created_at, updated_at";

function assetRowToStoredPhoto(row: ProjectAssetRow): StoredPhotoAsset {
  return {
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
  const orderedPages = [...pages].sort((a, b) => a.position - b.position);
  return {
    version: 3,
    id: project.id,
    name: project.name,
    formatId: project.format_id,
    activePageId: project.active_page_id,
    pages: orderedPages.map((page) => pageRowToStoredPage(page, assets)),
    revision: project.revision,
    cloudSyncedAt: project.updated_at,
    driveFolderId: project.drive_folder_id ?? undefined,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  };
}

function storedProjectToRows(project: StoredProject, ownerId: string): {
  pages: Omit<ProjectPageRow, "created_at" | "updated_at">[];
  assets: Omit<ProjectAssetRow, "created_at" | "updated_at">[];
} {
  const pages: Omit<ProjectPageRow, "created_at" | "updated_at">[] = [];
  const assets: Omit<ProjectAssetRow, "created_at" | "updated_at">[] = [];
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
      assets.push({
        id: photo.blobKey,
        project_id: project.id,
        page_id: page.id,
        owner_id: ownerId,
        frame_id: photo.frameId,
        blob_key: photo.blobKey,
        drive_file_id: photo.driveOriginalId ?? null,
        drive_preview_id: photo.drivePreviewId ?? null,
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
 * Concurrency: the project row is written first, gated by
 * `.eq('revision', project.revision)` (or a plain insert when the project
 * has never been synced). Only once that gate succeeds are pages/assets
 * written — so a device that loses the race never overwrites the winner's
 * data, it simply detects a conflict and stops before touching anything.
 * See CloudConflict / resolveProjectConflict for what happens next.
 */
export async function pushProjectToCloud(project: StoredProject): Promise<CloudConflict | CloudPushResult> {
  const client = getProjectCloudClient();
  if (!client) throw new Error("Project cloud storage has not been connected yet.");
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw new Error("Sign in before saving this project to the cloud.");
  const ownerId = userData.user.id;

  const projectRowInput = {
    id: project.id,
    owner_id: ownerId,
    name: project.name.trim() || "Untitled project",
    format_id: project.formatId,
    active_page_id: project.activePageId,
    drive_folder_id: project.driveFolderId ?? null,
  };

  let committedRow: ProjectRow;
  if (project.revision === undefined) {
    const { data, error } = await client.from("projects").insert(projectRowInput).select(PROJECT_COLUMNS).single();
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
    committedRow = data as ProjectRow;
  } else {
    const { data, error } = await client
      .from("projects")
      .update(projectRowInput)
      .eq("id", project.id)
      .eq("owner_id", ownerId)
      .eq("revision", project.revision)
      .is("deleted_at", null)
      .select(PROJECT_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      const remote = await fetchCloudProject(client, project.id);
      if (remote) return { conflict: true, remote };
      // The row vanished (deleted elsewhere) rather than being edited elsewhere.
      throw new Error("This project was deleted from another device.");
    }
    committedRow = data as ProjectRow;
  }

  const syncedProject: StoredProject = {
    ...project,
    revision: committedRow.revision,
    cloudSyncedAt: committedRow.updated_at,
    driveFolderId: committedRow.drive_folder_id ?? undefined,
  };

  try {
    const { pages, assets } = storedProjectToRows(project, ownerId);
    const pageIds = pages.map((page) => page.id);
    const assetIds = assets.map((asset) => asset.id);

    if (pages.length) {
      const { error } = await client.from("project_pages").upsert(pages, { onConflict: "id" });
      if (error) throw error;
    }
    {
      let query = client.from("project_pages").delete().eq("project_id", project.id);
      query = pageIds.length ? query.not("id", "in", `(${pageIds.join(",")})`) : query;
      const { error } = await query;
      if (error) throw error;
    }

    if (assets.length) {
      const { error } = await client.from("project_assets").upsert(assets, { onConflict: "id" });
      if (error) throw error;
    }
    {
      let query = client.from("project_assets").delete().eq("project_id", project.id);
      query = assetIds.length ? query.not("id", "in", `(${assetIds.join(",")})`) : query;
      const { error } = await query;
      if (error) throw error;
    }
  } catch {
    // The project row is safely committed; only its pages/assets failed to
    // write. Local work is not lost - the caller keeps `syncedProject`
    // (with its advanced revision) and can retry, which idempotently
    // re-upserts the same pages/assets.
    return { conflict: false, project: syncedProject, partial: true };
  }

  return { conflict: false, project: syncedProject, partial: false };
}

/** Soft-deletes a project in Supabase (tombstone, not a hard delete). */
export async function softDeleteCloudProject(projectId: string): Promise<void> {
  const client = getProjectCloudClient();
  if (!client) return;
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw new Error("Sign in before deleting this project from the cloud.");
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
  const duplicate: StoredProject = {
    ...local,
    id: newId,
    name: `${local.name} (conflicted copy)`,
    revision: undefined,
    cloudSyncedAt: undefined,
    createdAt: now,
    updatedAt: now,
  };
  return { canonical: remote, duplicate };
}

export function projectHasUnbackedAssets(project: StoredProject): boolean {
  return project.pages.some((page) => Object.values(page.photos).some((photo) => !photo.driveOriginalId));
}

function isProjectDirty(project: StoredProject): boolean {
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
  if (!context.online) return dirty ? "waiting-for-connection" : "synced";
  if (dirty) return "saved-locally";
  if (context.driveConfigured && !context.driveTokenValid && projectHasUnbackedAssets(project)) {
    return "drive-reconnect-required";
  }
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
      merged.set(project.id, isProjectDirty(project) ? project : cloud);
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
    const resurrected: StoredProject = { ...project, id: generateId(), name: `${project.name} (recovered)`, revision: undefined, cloudSyncedAt: undefined };
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
