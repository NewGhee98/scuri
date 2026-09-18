import { downloadGoogleDrivePhoto } from "./google-drive";
import { preparePhotoAsset } from "./image";
import { loadPhotoBlob, savePhotoBlob } from "./storage";
import { getProjectPhotos } from "./project-photo-library";
import type { CropState, PhotoAsset, ProjectDeletions, ProjectPage, StoredPhotoAsset, StoredProject, StoredProjectPage } from "./types";

function withStoredMetadata(asset: PhotoAsset, stored: StoredPhotoAsset): PhotoAsset {
  return { ...asset, ...stored,
    sourceName: stored.sourceName ?? asset.sourceName, mimeType: stored.mimeType ?? asset.mimeType,
    fileSize: stored.fileSize ?? asset.fileSize,
    // Actual decoded original dimensions take precedence over nullable/old metadata.
    sourceWidth: asset.sourceWidth, sourceHeight: asset.sourceHeight,
  };
}

export function serializePage(page: ProjectPage): StoredProjectPage {
  const photos = { ...page.unavailablePhotos };
  for (const [frameId, photo] of Object.entries(page.photos)) {
    photos[frameId] = {
      cloudAssetId: photo.cloudAssetId,
      frameId,
      blobKey: photo.blobKey,
      sourceName: photo.sourceName,
      mimeType: photo.mimeType,
      fileSize: photo.fileSize,
      driveOriginalId: photo.driveOriginalId,
      drivePreviewId: photo.drivePreviewId,
      sourceWidth: photo.sourceWidth,
      sourceHeight: photo.sourceHeight,
      crop: photo.crop,
    };
  }
  return {
    id: page.id, templateId: page.templateId, templateSnapshot: page.templateSnapshot,
    background: page.background, gutter: page.gutter, selectedFrameId: page.selectedFrameId,
    photos, createdAt: page.createdAt, updatedAt: page.updatedAt,
  };
}

/** Adopt metadata immediately, before any async byte download. Reuse only matching
 * cached bytes; the incoming Supabase/local record owns placement and crop. */
export function reconcileProjectPages(project: StoredProject, current: ProjectPage[] = []): ProjectPage[] {
  const loaded = new Map(current.flatMap((page) => Object.values(page.photos).map((photo) => [photo.blobKey, photo] as const)));
  return project.pages.map((page) => {
    const photos: ProjectPage["photos"] = {};
    const unavailablePhotos: NonNullable<ProjectPage["unavailablePhotos"]> = {};
    for (const [frameId, stored] of Object.entries(page.photos)) {
      const cached = loaded.get(stored.blobKey);
      if (cached) photos[frameId] = withStoredMetadata(cached, { ...stored, frameId });
      else unavailablePhotos[frameId] = stored;
    }
    return { ...page, photos, unavailablePhotos };
  });
}

export interface HydratedPhoto { pageId: string; photo: PhotoAsset }

/** Failures affect display availability only. The caller retains every stored record. */
export async function hydrateProjectPhotos(pages: ProjectPage[], getDriveToken: () => string | null, getVolatileBlob?: (key: string) => Blob | undefined): Promise<HydratedPhoto[]> {
  const hydrated: HydratedPhoto[] = [];
  for (const page of pages) {
    for (const item of Object.values(page.unavailablePhotos ?? {})) {
      try {
        let blob = await loadPhotoBlob(item.blobKey).catch(() => null);
        blob ??= getVolatileBlob?.(item.blobKey) ?? null;
        const token = getDriveToken();
        if (!blob && token && item.driveOriginalId) {
          blob = await downloadGoogleDrivePhoto(token, item.driveOriginalId).catch(() => null);
          if (blob) await savePhotoBlob(item.blobKey, blob).catch(() => undefined);
        }
        if (!blob) continue;
        const asset = await preparePhotoAsset(blob, item.frameId, item.blobKey);
        hydrated.push({ pageId: page.id, photo: withStoredMetadata(asset, item) });
      } catch {
        // Missing IDB, failed Drive access or image decode must not erase metadata.
      }
    }
  }
  return hydrated;
}

/** A late download must not resurrect a removal, replace a newer photo, or
 * overwrite a crop edited while it was in flight. */
export function applyHydratedPhotos(current: ProjectPage[], hydrated: HydratedPhoto[]): ProjectPage[] {
  let changed = false;
  const next = current.map((page) => {
    const photos = { ...page.photos };
    const unavailablePhotos = { ...page.unavailablePhotos };
    let pageChanged = false;
    for (const result of hydrated) {
      if (result.pageId !== page.id) continue;
      const stored = unavailablePhotos[result.photo.frameId];
      if (!stored || stored.blobKey !== result.photo.blobKey) continue;
      photos[stored.frameId] = withStoredMetadata(result.photo, stored);
      delete unavailablePhotos[stored.frameId];
      pageChanged = changed = true;
    }
    return pageChanged ? { ...page, photos, unavailablePhotos } : page;
  });
  return changed ? next : current;
}

export function removePagePhoto(page: ProjectPage, frameId: string): ProjectPage {
  const photos = { ...page.photos };
  const unavailablePhotos = { ...page.unavailablePhotos };
  delete photos[frameId];
  delete unavailablePhotos[frameId];
  return { ...page, photos, unavailablePhotos };
}

/** Crop edits made against a display preview update metadata only. Hydrating
 * the original later must retain these edits and the original's availability. */
export function updatePagePhotoCrop(page: ProjectPage, frameId: string, crop: CropState): ProjectPage {
  const photo = page.photos[frameId];
  if (photo) return { ...page, photos: { ...page.photos, [frameId]: { ...photo, crop } } };
  const stored = page.unavailablePhotos?.[frameId];
  return stored ? { ...page, unavailablePhotos: { ...page.unavailablePhotos, [frameId]: { ...stored, crop } } } : page;
}

export function recordPhotoDeletions(
  pending: ProjectDeletions | undefined,
  pageId: string,
  photos: StoredPhotoAsset[],
  deletePage = false,
): ProjectDeletions {
  const entries = [...(pending?.photos ?? []), ...photos.map(({ frameId, blobKey }) => ({ pageId, frameId, blobKey }))];
  return {
    photos: [...new Map(entries.map((entry) => [JSON.stringify(entry), entry])).values()],
    pageIds: [...new Set([...(pending?.pageIds ?? []), ...(deletePage ? [pageId] : [])])],
  };
}

/** Conflict/recovery copies may share immutable cached bytes. Removing one
 * project's assignment must not erase the other project's only local original. */
export function isPhotoReferencedByAnotherProject(projects: StoredProject[], projectId: string, blobKey: string): boolean {
  return projects.some((project) => project.id !== projectId && getProjectPhotos(project).some(photo => photo.blobKey === blobKey));
}
