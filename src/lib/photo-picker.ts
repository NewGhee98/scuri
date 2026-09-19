import { DEFAULT_CROP } from "./crop";
import { recordPhotoDeletions } from "./project-photos";
import { getProjectPhotos, projectPhotoGroups } from "./project-photo-library";
import { nextProjectEditTime } from "./project-time";
import type { ProjectPhoto, StoredProject } from "./types";

export interface PhotoPickerIntent { nonce: string; projectId: string; pageId: string; frameId: string; targetKey: string }
function targetKey(project: StoredProject, pageId: string, frameId: string): string | null {
  const page = project.pages.find(page => page.id === pageId);
  if (!page) return null;
  return JSON.stringify([page.templateId, page.templateSnapshot, page.photos[frameId]?.blobKey ?? null, page.photos[frameId]?.crop ?? null]);
}
export function openPhotoPicker(project: StoredProject, pageId: string, frameId: string): PhotoPickerIntent {
  const key = targetKey(project, pageId, frameId);
  if (key === null) throw new Error("The destination page is no longer available.");
  return { nonce: crypto.randomUUID(), projectId: project.id, pageId, frameId, targetKey: key };
}
export function isPhotoPickerCurrent(project: StoredProject | null, intent: PhotoPickerIntent, frameIds: string[]): boolean {
  return Boolean(project && project.id === intent.projectId && frameIds.includes(intent.frameId) &&
    targetKey(project, intent.pageId, intent.frameId) === intent.targetKey);
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
