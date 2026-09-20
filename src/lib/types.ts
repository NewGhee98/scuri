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
  /** Optional multiplier for gutters at the outside edge of the canvas. */
  outerInsetMultiplier?: number;
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
  /** Legacy overflow-relative coordinates. Never reinterpret old saved values. */
  positionX: number;
  positionY: number;
  zoom: number;
  /** Opt-in centre offset in frame widths/heights, independent of photo zoom. */
  freePosition?: { x: number; y: number };
}

export interface PhotoAsset {
  cloudAssetId?: string;
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
  /** Database row identity; older cached records used blobKey as the row id. */
  cloudAssetId?: string;
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

/** Project-owned original, independent of any page/frame assignment. */
export type ProjectPhoto = Omit<StoredPhotoAsset, "cloudAssetId" | "frameId" | "crop"> & {
  /** Explicit, exact-file library grouping only. Assignments/bytes keep their
   * original identities. null explicitly undoes grouping; absence is legacy. */
  duplicateOf?: string | null;
  /** Fingerprint of untouched delivered source bytes, never a preview. */
  fingerprint?: string;
  importedAt?: string;
  importOrder?: number;
  colourOverride?: "bw" | "colour" | null;
  driveThumbnailId?: string;
  /** Reserved file IDs are not proof that the bytes were uploaded. */
  pendingUpload?: { originalId?: string; previewId?: string; thumbnailId?: string };
};

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
  /** Assigned photos whose bytes are unavailable. These are never empty frames. */
  unavailablePhotos?: Record<string, StoredPhotoAsset>;
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
  | "photos-pending"
  | "sync-error";

export interface StoredProject {
  version: 3;
  id: string;
  name: string;
  formatId: FormatId;
  activePageId: string | null;
  pages: StoredProjectPage[];
  /** Missing on older projects; their assigned originals seed the library. */
  photoLibrary?: ProjectPhoto[];
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
  /** Local-only, durable intent from explicit remove/replace/page/layout actions.
   * Cleared only after the corresponding cloud push fully succeeds. */
  pendingDeletions?: ProjectDeletions;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDeletions {
  photos: Array<{ pageId: string; frameId: string; blobKey: string }>;
  pageIds: string[];
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
