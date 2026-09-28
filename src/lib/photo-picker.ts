import { DEFAULT_CROP } from "./crop";
import { recordPhotoDeletions } from "./project-photos";
import { getProjectPhotos, projectPhotoGroups } from "./project-photo-library";
import { nextProjectEditTime } from "./project-time";
import type { ProjectPhoto, StoredProject } from "./types";

export interface PhotoPickerIntent { nonce: string; projectId: string; pageId: string; frameId: string; targetKey: string; pageKey: string }
function pageKey(project: StoredProject, pageId: string): string {
  const page = project.pages.find(page => page.id === pageId);
  // Backup acknowledgements may arrive while choosing. Only composition changes
  // invalidate the set of empty destinations, not newly saved Drive references.
  return JSON.stringify(page && [page.templateId, page.templateSnapshot,
    Object.entries(page.photos).sort(([a], [b]) => a.localeCompare(b)).map(([id, photo]) => [id, photo.blobKey, photo.crop])]);
}
function targetKey(project: Pick<StoredProject, "pages">, pageId: string, frameId: string): string | null {
  const page = project.pages.find(page => page.id === pageId);
  if (!page) return null;
  return JSON.stringify([page.templateId, page.templateSnapshot, page.photos[frameId]?.blobKey ?? null, page.photos[frameId]?.crop ?? null]);
}
export function openPhotoPicker(project: StoredProject, pageId: string, frameId: string): PhotoPickerIntent {
  const key = targetKey(project, pageId, frameId);
  if (key === null) throw new Error("The destination page is no longer available.");
  return { nonce: crypto.randomUUID(), projectId: project.id, pageId, frameId, targetKey: key, pageKey: pageKey(project, pageId) };
}
export function isPhotoPickerCurrent(project: Pick<StoredProject, "id" | "pages"> | null, intent: PhotoPickerIntent, frameIds: string[]): boolean {
  return Boolean(project && project.id === intent.projectId && frameIds.includes(intent.frameId) &&
    targetKey(project, intent.pageId, intent.frameId) === intent.targetKey);
}

/** Start at the tapped frame, then fill empty frames in layout order, wrapping. */
export function photoPickerTargets(project: Pick<StoredProject, "id" | "pages">, intent: PhotoPickerIntent, frameIds: string[]): string[] {
  if (!isPhotoPickerCurrent(project, intent, frameIds)) return [];
  const page = project.pages.find(page => page.id === intent.pageId)!;
  const start = frameIds.indexOf(intent.frameId);
  const remaining = [...frameIds.slice(start + 1), ...frameIds.slice(0, start)];
  return [...new Set([intent.frameId, ...remaining.filter(id => !page.photos[id])])];
}

/** Validate the complete batch before producing any changed project. */
export function placeLibraryPhotos(project: StoredProject, intent: PhotoPickerIntent, selected: readonly ProjectPhoto[], frameIds: string[]): StoredProject {
  if (!isPhotoPickerCurrent(project, intent, frameIds) || (selected.length > 1 && pageKey(project, intent.pageId) !== intent.pageKey)) {
    throw new Error("The destination changed. Reopen the photo picker from the intended frame.");
  }
  if (!selected.length) return project;
  const targets = photoPickerTargets(project, intent, frameIds);
  if (selected.length > targets.length) throw new Error(`Choose up to ${targets.length} photos for the available frames.`);
  const groups = projectPhotoGroups(project);
  const selectedGroups = selected.map(photo => groups.find(group => group.members.some(member => member.blobKey === photo.blobKey)));
  if (selectedGroups.some(group => !group)) throw new Error("A selected photo is no longer in the project library.");
  if (new Set(selectedGroups).size !== selected.length) throw new Error("Choose each photo only once.");
  // Each returned value is local until the entire batch succeeds. The caller
  // saves/adopts it once, making the placement a single Undo operation.
  return selected.reduce((current, photo, index) => placeLibraryPhoto(current,
    { ...intent, frameId: targets[index], targetKey: targetKey(current, intent.pageId, targets[index])! }, photo, frameIds), project);
}
export function placeLibraryPhoto(project: StoredProject, intent: PhotoPickerIntent, selected: ProjectPhoto, frameIds: string[]): StoredProject {
  if (!isPhotoPickerCurrent(project, intent, frameIds)) throw new Error("The destination changed. Reopen the photo picker from the intended frame.");
  const photo = getProjectPhotos(project).find(item => item.blobKey === selected.blobKey);
  if (!photo) throw new Error("This photo is no longer in the project library.");
  const page = project.pages.find(page => page.id === intent.pageId)!;
  const previous = page.photos[intent.frameId];
  const group = projectPhotoGroups(project).find(group => group.members.some(member => member.blobKey === photo.blobKey));
  if (previous && group?.members.some(member => member.blobKey === previous.blobKey)) return project;
  const timestamp = nextProjectEditTime(project);
  return { ...project, updatedAt: timestamp,
    pendingDeletions: previous ? recordPhotoDeletions(project.pendingDeletions, page.id, [previous]) : project.pendingDeletions,
    pages: project.pages.map(item => item.id !== page.id ? item : { ...item, updatedAt: timestamp,
      photos: { ...item.photos, [intent.frameId]: { blobKey: photo.blobKey, frameId: intent.frameId, sourceWidth: photo.sourceWidth, sourceHeight: photo.sourceHeight,
        sourceName: photo.sourceName, mimeType: photo.mimeType, fileSize: photo.fileSize, driveOriginalId: photo.driveOriginalId, drivePreviewId: photo.drivePreviewId,
        crop: { ...DEFAULT_CROP } } } }) };
}
