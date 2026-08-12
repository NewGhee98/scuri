import type { AppScreen, ProjectPage, StoredProjectPage, TemplateDefinition } from "./types";

export const MAX_PROJECT_PAGES = 20;

export function getDefaultProjectName(projectNames: string[]): string {
  const names = new Set(projectNames.map((name) => name.trim().toLowerCase()));
  if (!names.has("untitled project")) return "Untitled project";
  let suffix = 2;
  while (names.has(`untitled project ${suffix}`)) suffix += 1;
  return `Untitled project ${suffix}`;
}

export function sortProjectsByLastEdited<T extends { updatedAt: string }>(projects: T[]): T[] {
  return [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getBackScreen(screen: AppScreen): AppScreen {
  if (screen === "projects") return "projects";
  if (screen === "templates") return "templates";
  if (screen === "template-format" || screen === "template-editor") return "templates";
  if (screen === "project" || screen === "format") return "projects";
  return "project";
}

type PageWithPhotos = Pick<ProjectPage | StoredProjectPage, "photos">;

type FramePhoto = { frameId: string };

export function getPagePhotoCount(page: PageWithPhotos): number {
  return Object.keys(page.photos).length;
}

export function getMissingPhotoCount(page: PageWithPhotos, template: TemplateDefinition): number {
  return template.frames.reduce((missing, frame) => missing + (page.photos[frame.id] ? 0 : 1), 0);
}

export function isPageComplete(page: PageWithPhotos, template: TemplateDefinition): boolean {
  return getMissingPhotoCount(page, template) === 0;
}

export function getPhotoFillTargets(
  template: TemplateDefinition,
  photos: PageWithPhotos["photos"],
  tappedFrameId: string,
  selectedPhotoCount: number,
): string[] {
  if (selectedPhotoCount <= 0 || !template.frames.some((frame) => frame.id === tappedFrameId)) return [];
  const otherFrameIds = template.frames.map((frame) => frame.id).filter((frameId) => frameId !== tappedFrameId);
  const emptyFrameIds = otherFrameIds.filter((frameId) => !photos[frameId]);
  const filledFrameIds = otherFrameIds.filter((frameId) => Boolean(photos[frameId]));
  return [tappedFrameId, ...emptyFrameIds, ...filledFrameIds].slice(0, selectedPhotoCount);
}

export function moveLayoutPhoto<T extends FramePhoto>(
  photos: Record<string, T>,
  sourceFrameId: string,
  targetFrameId: string,
): Record<string, T> {
  const sourcePhoto = photos[sourceFrameId];
  if (!sourcePhoto || sourceFrameId === targetFrameId) return photos;

  const targetPhoto = photos[targetFrameId];
  const next = {
    ...photos,
    [targetFrameId]: { ...sourcePhoto, frameId: targetFrameId },
  };
  if (targetPhoto) next[sourceFrameId] = { ...targetPhoto, frameId: sourceFrameId };
  else delete next[sourceFrameId];
  return next;
}

export function moveProjectPage<T extends { id: string }>(pages: T[], sourceId: string, targetId: string): T[] {
  const sourceIndex = pages.findIndex((page) => page.id === sourceId);
  const targetIndex = pages.findIndex((page) => page.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return pages;
  const next = [...pages];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

export function moveProjectPageByOffset<T extends { id: string }>(pages: T[], pageId: string, offset: -1 | 1): T[] {
  const sourceIndex = pages.findIndex((page) => page.id === pageId);
  const targetIndex = sourceIndex + offset;
  if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= pages.length) return pages;
  const target = pages[targetIndex];
  return moveProjectPage(pages, pageId, target.id);
}
