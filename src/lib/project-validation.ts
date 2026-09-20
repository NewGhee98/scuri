import { validateTemplate } from "./templates";
import type { StoredProject, StoredPhotoAsset, StoredProjectPage, TemplateDefinition } from "./types";

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const identifier = (value: unknown): value is string => text(value) && !["__proto__", "constructor", "prototype"].includes(value);
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const optionalText = (value: unknown) => value === undefined || typeof value === "string";

export function isStoredPhoto(value: unknown): value is StoredPhotoAsset {
  if (!record(value) || !identifier(value.frameId) || !text(value.blobKey) || !record(value.crop)) return false;
  return finite(value.sourceWidth) && value.sourceWidth >= 0 && finite(value.sourceHeight) && value.sourceHeight >= 0 &&
    [value.crop.positionX, value.crop.positionY].every(finite) && finite(value.crop.zoom) && value.crop.zoom > 0 &&
    (value.crop.freePosition === undefined || (record(value.crop.freePosition) && finite(value.crop.freePosition.x) && finite(value.crop.freePosition.y))) &&
    [value.cloudAssetId, value.driveOriginalId, value.drivePreviewId, value.sourceName, value.mimeType].every(optionalText) &&
    (value.fileSize === undefined || (finite(value.fileSize) && value.fileSize >= 0));
}

export function isProjectPhoto(value: unknown): boolean {
  return record(value) && (value.duplicateOf === undefined || value.duplicateOf === null || text(value.duplicateOf)) &&
    (value.fingerprint === undefined || (typeof value.fingerprint === "string" && /^sha256:\d+:[a-f0-9]{64}$/.test(value.fingerprint))) &&
    (value.importedAt === undefined || date(value.importedAt)) &&
    (value.importOrder === undefined || (finite(value.importOrder) && value.importOrder >= 0)) &&
    (value.colourOverride === undefined || value.colourOverride === null || value.colourOverride === "bw" || value.colourOverride === "colour") &&
    optionalText(value.driveThumbnailId) &&
    (value.pendingUpload === undefined || (record(value.pendingUpload) &&
      [value.pendingUpload.originalId, value.pendingUpload.previewId, value.pendingUpload.thumbnailId].every(optionalText))) &&
    isStoredPhoto({ ...value, frameId: "library-photo", crop: { positionX: 0, positionY: 0, zoom: 1 } });
}

export function isStoredPage(value: unknown): value is StoredProjectPage {
  if (!record(value) || !text(value.id) || !text(value.templateId) || !record(value.photos) ||
      typeof value.background !== "string" || !finite(value.gutter) || value.gutter < 0 ||
      !(value.selectedFrameId === null || typeof value.selectedFrameId === "string") ||
      !date(value.createdAt) || !date(value.updatedAt)) return false;
  if (!Object.entries(value.photos).every(([id, photo]) => isStoredPhoto(photo) && id === photo.frameId)) return false;
  if (value.templateSnapshot !== undefined) {
    try {
      if (!record(value.templateSnapshot) || !Array.isArray(value.templateSnapshot.frames) ||
          !value.templateSnapshot.frames.every(frame => record(frame) && identifier(frame.id)) ||
          typeof value.templateSnapshot.defaultBackground !== "string" || !finite(value.templateSnapshot.defaultGutter) ||
          validateTemplate(value.templateSnapshot as unknown as TemplateDefinition).length) return false;
    } catch { return false; }
  }
  return true;
}

/** Validation is all-or-nothing: never silently drop damaged photo assignments. */
export function isStoredProject(value: unknown): value is StoredProject {
  if (!record(value) || value.version !== 3 || !text(value.id) || typeof value.name !== "string" ||
      !["instagram-post", "instagram-square", "instagram-story"].includes(String(value.formatId)) ||
      !Array.isArray(value.pages) || !value.pages.every(isStoredPage) ||
      new Set(value.pages.map(page => page.id)).size !== value.pages.length ||
      !(value.activePageId === null || typeof value.activePageId === "string") ||
      !date(value.createdAt) || !date(value.updatedAt)) return false;
  if (value.revision !== undefined && (!finite(value.revision) || !Number.isInteger(value.revision) || value.revision < 1)) return false;
  if (value.cloudSyncedAt !== undefined && !date(value.cloudSyncedAt)) return false;
  if (value.photoLibrary !== undefined && (!Array.isArray(value.photoLibrary) || !value.photoLibrary.every(isProjectPhoto) ||
      new Set(value.photoLibrary.map(photo => photo.blobKey)).size !== value.photoLibrary.length)) return false;
  if (!optionalText(value.driveFolderId)) return false;
  if (value.pendingDeletions !== undefined) {
    const removed = value.pendingDeletions;
    if (!record(removed) || !Array.isArray(removed.photos) || !Array.isArray(removed.pageIds) ||
        !removed.pageIds.every(text) || !removed.photos.every(item => record(item) && text(item.pageId) && text(item.frameId) && text(item.blobKey))) return false;
  }
  return true;
}

export function readProjectLibrary(raw: string): StoredProject[] {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("Saved project data is damaged. Its original copy has been retained."); }
  if (!record(value) || value.version !== 1 || !Array.isArray(value.projects) || !value.projects.every(isStoredProject) ||
      new Set(value.projects.map(project => project.id)).size !== value.projects.length) {
    throw new Error("Saved project data is damaged. Its original copy has been retained; restore a project backup or recover this browser's saved data.");
  }
  return value.projects;
}
