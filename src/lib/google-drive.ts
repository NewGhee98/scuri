import type { StoredPhotoAsset } from "./types";

// Google Drive is the high-resolution file warehouse for Scuri: untouched
// full-resolution originals, lightweight previews and optional exports.
// It is deliberately NOT the source of truth for project structure —
// that responsibility belongs to Supabase (see project-sync.ts and
// PROJECT_CONTEXT.md's "Supabase = source of truth for project state").
// This module therefore only knows how to authenticate, organize a private
// per-project folder tree, and upload/download/trash files in it.

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export type DriveSyncState = "disconnected" | "ready" | "syncing" | "synced" | "error";

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
  expires_in?: number;
};

type GoogleTokenClient = {
  callback: (response: GoogleTokenResponse) => void;
  requestAccessToken: (options?: { prompt?: string }) => void;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (options: {
            client_id: string;
            scope: string;
            callback: (response: GoogleTokenResponse) => void;
            error_callback?: (error: unknown) => void;
          }) => GoogleTokenClient;
          revoke: (token: string, callback?: () => void) => void;
        };
      };
    };
  }
}

type DriveFile = {
  id: string;
  name: string;
  mimeType?: string;
  modifiedTime?: string;
  parents?: string[];
  appProperties?: Record<string, string>;
};

type DriveListResponse = { files?: DriveFile[] };

export interface DriveSyncProgress {
  completed: number;
  total: number;
  label: string;
}

/** Folder tree for one project's assets, created lazily under a private "Scuri" folder. */
export interface ProjectDriveFolders {
  projectFolderId: string;
  originalsFolderId: string;
  previewsFolderId: string;
  exportsFolderId: string;
}

export function isGoogleDriveConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID);
}

export function getGoogleDriveClientId(): string | null {
  return process.env.NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID || null;
}

export function requestGoogleDriveAccessToken(prompt = "consent"): Promise<{ accessToken: string; expiresAt: number }> {
  const clientId = getGoogleDriveClientId();
  if (!clientId) return Promise.reject(new Error("Google Drive has not been configured for Scuri yet."));
  if (!window.google?.accounts.oauth2) return Promise.reject(new Error("Google sign-in is still loading. Try again in a moment."));

  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (!response.access_token) {
          reject(new Error(response.error_description || response.error || "Google Drive access was not granted."));
          return;
        }
        const lifetime = Math.max(60, response.expires_in ?? 3600);
        resolve({ accessToken: response.access_token, expiresAt: Date.now() + lifetime * 1000 });
      },
      error_callback: () => reject(new Error("Google Drive sign-in was cancelled or blocked.")),
    });
    client.requestAccessToken({ prompt });
  });
}

export function revokeGoogleDriveAccess(accessToken: string): Promise<void> {
  return new Promise((resolve) => {
    if (!window.google?.accounts.oauth2) {
      resolve();
      return;
    }
    window.google.accounts.oauth2.revoke(accessToken, resolve);
  });
}

async function driveFetch<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${DRIVE_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { "Content-Type": "application/json; charset=UTF-8" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(detail?.error?.message || `Google Drive request failed (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function listDriveFiles(accessToken: string, query: string): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    q: `${query} and trashed = false`,
    spaces: "drive",
    pageSize: "1000",
    fields: "files(id,name,mimeType,modifiedTime,parents,appProperties)",
  });
  const data = await driveFetch<DriveListResponse>(accessToken, `/files?${params.toString()}`);
  return data.files ?? [];
}

async function createDriveFile(
  accessToken: string,
  metadata: { name: string; mimeType?: string; parents?: string[]; appProperties?: Record<string, string> },
): Promise<DriveFile> {
  return driveFetch<DriveFile>(accessToken, "/files?fields=id,name,mimeType,modifiedTime,parents,appProperties", {
    method: "POST",
    body: JSON.stringify(metadata),
  });
}

async function ensureFolder(
  accessToken: string,
  name: string,
  appProperties: Record<string, string>,
  parentId?: string,
): Promise<DriveFile> {
  const clauses = Object.entries(appProperties).map(([key, value]) => (
    `appProperties has { key='${escapeDriveQuery(key)}' and value='${escapeDriveQuery(value)}' }`
  ));
  if (parentId) clauses.push(`'${escapeDriveQuery(parentId)}' in parents`);
  const existing = await listDriveFiles(accessToken, `${clauses.join(" and ")} and mimeType = '${FOLDER_MIME_TYPE}'`);
  if (existing[0]) return existing[0];
  return createDriveFile(accessToken, {
    name,
    mimeType: FOLDER_MIME_TYPE,
    parents: parentId ? [parentId] : undefined,
    appProperties,
  });
}

async function startResumableUpload(
  accessToken: string,
  metadata: { name: string; parents?: string[]; appProperties?: Record<string, string> },
  blob: Blob,
  existingFileId?: string,
): Promise<string> {
  const method = existingFileId ? "PATCH" : "POST";
  const target = existingFileId ? `/files/${encodeURIComponent(existingFileId)}` : "/files";
  const response = await fetch(`${DRIVE_UPLOAD_API}${target}?uploadType=resumable&fields=id,name,mimeType,modifiedTime,parents,appProperties`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": blob.type || "application/octet-stream",
      "X-Upload-Content-Length": String(blob.size),
    },
    body: JSON.stringify(metadata),
  });
  if (!response.ok) throw new Error(`Google Drive could not start the upload (${response.status}).`);
  const sessionUrl = response.headers.get("Location");
  if (!sessionUrl) throw new Error("Google Drive did not return an upload session.");
  return sessionUrl;
}

async function uploadBlob(
  accessToken: string,
  metadata: { name: string; parents?: string[]; appProperties?: Record<string, string> },
  blob: Blob,
  existingFileId?: string,
): Promise<DriveFile> {
  const sessionUrl = await startResumableUpload(accessToken, metadata, blob, existingFileId);
  const response = await fetch(sessionUrl, {
    method: "PUT",
    headers: { "Content-Type": blob.type || "application/octet-stream" },
    body: blob,
  });
  if (!response.ok) throw new Error(`Google Drive upload failed (${response.status}).`);
  return response.json() as Promise<DriveFile>;
}

async function trashDriveFile(accessToken: string, fileId: string): Promise<void> {
  await driveFetch<DriveFile>(accessToken, `/files/${encodeURIComponent(fileId)}?fields=id`, {
    method: "PATCH",
    body: JSON.stringify({ trashed: true }),
  });
}

function extensionForMimeType(mimeType?: string): string {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return ".jpg";
}

function safeFilename(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").slice(0, 120) || "Untitled project";
}

async function downloadDriveFile(accessToken: string, fileId: string): Promise<Blob> {
  const response = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Google Drive download failed (${response.status}).`);
  return response.blob();
}

export async function downloadGoogleDrivePhoto(accessToken: string, fileId: string): Promise<Blob> {
  return downloadDriveFile(accessToken, fileId);
}

/**
 * Finds or creates the private "Scuri/Projects/<name>/{Originals,Previews,Exports}"
 * folder tree for one project. The returned `projectFolderId` is what callers
 * should persist as `projects.drive_folder_id` in Supabase so it never needs
 * to be looked up by name/appProperties search again.
 */
export async function ensureProjectDriveFolders(
  accessToken: string,
  projectId: string,
  projectName: string,
  existingFolderId?: string,
): Promise<ProjectDriveFolders> {
  let projectFolder: DriveFile;
  if (existingFolderId) {
    projectFolder = await driveFetch<DriveFile>(
      accessToken,
      `/files/${encodeURIComponent(existingFolderId)}?fields=id,name,mimeType,modifiedTime,parents,appProperties`,
    );
  } else {
    const root = await ensureFolder(accessToken, "Scuri", { scuriType: "root", scuriVersion: "1" });
    const projectsFolder = await ensureFolder(accessToken, "Projects", { scuriType: "projects", scuriVersion: "1" }, root.id);
    projectFolder = await ensureFolder(
      accessToken,
      safeFilename(projectName),
      { scuriType: "project", scuriProjectId: projectId },
      projectsFolder.id,
    );
  }
  const projectFolderName = safeFilename(projectName);
  if (projectFolder.name !== projectFolderName) {
    projectFolder = await driveFetch<DriveFile>(accessToken, `/files/${encodeURIComponent(projectFolder.id)}?fields=id,name,mimeType,modifiedTime,parents,appProperties`, {
      method: "PATCH",
      body: JSON.stringify({ name: projectFolderName }),
    });
  }
  const [originalsFolder, previewsFolder, exportsFolder] = await Promise.all([
    ensureFolder(accessToken, "Originals", { scuriType: "originals", scuriProjectId: projectId }, projectFolder.id),
    ensureFolder(accessToken, "Previews", { scuriType: "previews", scuriProjectId: projectId }, projectFolder.id),
    ensureFolder(accessToken, "Exports", { scuriType: "exports", scuriProjectId: projectId }, projectFolder.id),
  ]);
  return {
    projectFolderId: projectFolder.id,
    originalsFolderId: originalsFolder.id,
    previewsFolderId: previewsFolder.id,
    exportsFolderId: exportsFolder.id,
  };
}

/**
 * Uploads one photo's untouched original (if not already backed up) and a
 * lightweight preview to the given project folders. Originals are treated as
 * immutable once uploaded: if `photo.driveOriginalId` is already set this
 * does not re-upload it, matching "do not recompress/downscale the cloud
 * original" and avoiding pointless re-transfer of large files on retry.
 */
export async function uploadPhotoAssetToDrive(
  accessToken: string,
  folders: ProjectDriveFolders,
  projectId: string,
  photo: Pick<StoredPhotoAsset, "blobKey" | "sourceName" | "mimeType" | "driveOriginalId" | "drivePreviewId">,
  source: Blob,
  preview: Blob,
): Promise<{ driveOriginalId: string; drivePreviewId: string }> {
  let driveOriginalId = photo.driveOriginalId;
  let drivePreviewId = photo.drivePreviewId;

  if (!driveOriginalId) {
    const extension = extensionForMimeType(photo.mimeType || source.type);
    const uploaded = await uploadBlob(accessToken, {
      name: photo.sourceName ? safeFilename(photo.sourceName) : `${photo.blobKey}${extension}`,
      parents: [folders.originalsFolderId],
      appProperties: { scuriType: "original", scuriProjectId: projectId, scuriBlobKey: photo.blobKey },
    }, source);
    driveOriginalId = uploaded.id;
  }

  if (!drivePreviewId) {
    const uploaded = await uploadBlob(accessToken, {
      name: `${photo.blobKey}.webp`,
      parents: [folders.previewsFolderId],
      appProperties: { scuriType: "preview", scuriProjectId: projectId, scuriBlobKey: photo.blobKey },
    }, preview);
    drivePreviewId = uploaded.id;
  }

  return { driveOriginalId, drivePreviewId };
}

/** Moves a project's whole Drive folder (originals, previews, exports) to Trash. */
export async function trashProjectDriveFolder(accessToken: string, driveFolderId: string): Promise<void> {
  await trashDriveFile(accessToken, driveFolderId);
}

export async function uploadExportsToGoogleDrive(
  accessToken: string,
  driveFolderId: string,
  projectId: string,
  exports: Array<{ filename: string; blob: Blob }>,
): Promise<void> {
  const folder = await ensureFolder(accessToken, "Exports", { scuriType: "exports", scuriProjectId: projectId }, driveFolderId);
  for (const item of exports) {
    await uploadBlob(accessToken, {
      name: item.filename,
      parents: [folder.id],
      appProperties: { scuriType: "export", scuriProjectId: projectId },
    }, item.blob);
  }
}
