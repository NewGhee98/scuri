export type FormatId = "instagram-post" | "instagram-square" | "instagram-story";

export interface CanvasFormat {
  id: FormatId;
  name: string;
  shortLabel: string;
  aspectRatio: string;
  width: number;
  height: number;
  description: string;
}

export interface NormalizedFrame {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  cornerRadius?: number;
  aspectRatioLocked?: boolean;
}

export interface TemplateDefinition {
  id: string;
  name: string;
  formatId: FormatId;
  canvasWidth: number;
  canvasHeight: number;
  defaultBackground: string;
  defaultGutter: number;
  frameInsetMultiplier?: number;
  frames: NormalizedFrame[];
}

export interface ResolvedFrame {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  cornerRadius: number;
}

export type TemplateSyncState = "local" | "pending" | "synced" | "error";

export interface CustomTemplate extends TemplateDefinition {
  source: "custom";
  status: "draft" | "saved";
  sourceTemplateId?: string;
  createdAt: string;
  updatedAt: string;
  syncState: TemplateSyncState;
}

export interface CropState {
  positionX: number;
  positionY: number;
  zoom: number;
}

export interface PhotoAsset {
  frameId: string;
  blobKey: string;
  sourceBlob: Blob;
  previewUrl: string;
  sourceName?: string;
  mimeType?: string;
  fileSize?: number;
  /** Google Drive file id of the untouched full-resolution original. */
  driveOriginalId?: string;
  /** Google Drive file id of the lightweight preview. */
  drivePreviewId?: string;
  sourceWidth: number;
  sourceHeight: number;
  crop: CropState;
}

export interface StoredPhotoAsset {
  frameId: string;
  blobKey: string;
  sourceName?: string;
  mimeType?: string;
  fileSize?: number;
  driveOriginalId?: string;
  drivePreviewId?: string;
  sourceWidth: number;
  sourceHeight: number;
  crop: CropState;
}

export type AppScreen =
  | "projects"
  | "project"
  | "format"
  | "template"
  | "editor"
  | "export"
  | "templates"
  | "template-format"
  | "template-editor";

export interface ProjectPage {
  id: string;
  templateId: string;
  templateSnapshot?: TemplateDefinition;
  background: string;
  gutter: number;
  selectedFrameId: string | null;
  photos: Record<string, PhotoAsset>;
  createdAt: string;
  updatedAt: string;
}

export interface StoredProjectPage {
  id: string;
  templateId: string;
  templateSnapshot?: TemplateDefinition;
  background: string;
  gutter: number;
  selectedFrameId: string | null;
  photos: Record<string, StoredPhotoAsset>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Cloud sync status for a project, derived (never stored) from local/remote
 * state by `getProjectSyncStatus` in `project-sync.ts`. See
 * PROJECT_CONTEXT.md's "Supabase = source of truth for project state"
 * section for the architecture this supports.
 */
export type ProjectCloudSyncState =
  | "local-only"
  | "saved-locally"
  | "syncing"
  | "synced"
  | "waiting-for-connection"
  | "drive-reconnect-required"
  | "sync-error";

export interface StoredProject {
  version: 3;
  id: string;
  name: string;
  formatId: FormatId;
  activePageId: string | null;
  pages: StoredProjectPage[];
  /**
   * Last Supabase `projects.revision` this device knows it is in sync with.
   * Undefined means this project has never been pushed to Supabase. Used as
   * the optimistic-concurrency predicate on every push; see
   * `pushProjectToCloud` in project-sync.ts.
   */
  revision?: number;
  /** ISO timestamp of the last confirmed successful push to or pull from Supabase. */
  cloudSyncedAt?: string;
  /** Google Drive folder holding this project's originals/previews/exports. */
  driveFolderId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredProjectLibrary {
  version: 1;
  projects: StoredProject[];
}

export interface LegacyStoredMultiPageProject {
  version: 2;
  id: string;
  name: string;
  screen: Exclude<AppScreen, "projects">;
  formatId: FormatId | null;
  activePageId: string | null;
  pages: StoredProjectPage[];
  createdAt: string;
  updatedAt: string;
}

export interface LegacyStoredProject {
  version: 1;
  screen: Exclude<AppScreen, "project" | "projects">;
  formatId: FormatId | null;
  templateId: string | null;
  background: string;
  gutter: number;
  selectedFrameId: string | null;
  photos: Record<string, StoredPhotoAsset>;
  updatedAt: string;
}
