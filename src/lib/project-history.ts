import type { StoredPhotoAsset, StoredProject } from "./types";
import { recordPhotoDeletions } from "./project-photos";
import { nextProjectEditTime } from "./project-time";
import { getProjectPhotos } from "./project-photo-library";

/** Only content belongs in undo history, not sync timestamps/IDs or selection. */
export function projectContentKey(project: StoredProject): string {
  return JSON.stringify([project.name, project.formatId, project.pages.map(page => [page.id, page.templateId,
    page.templateSnapshot, page.background, page.gutter, Object.entries(page.photos).map(([id, photo]) => [id, photo.blobKey, photo.crop])]),
    getProjectPhotos(project).filter(photo => photo.duplicateOf || photo.colourOverride).map(photo => [photo.blobKey, photo.duplicateOf ?? null, photo.colourOverride ?? null]).sort()]);
}

export function restoreProjectContent(latest: StoredProject, target: StoredProject, knownPhotos: Map<string, StoredPhotoAsset>, timestamp: string): StoredProject {
  timestamp = nextProjectEditTime(latest, timestamp);
  const pages = target.pages.map(page => ({ ...page, updatedAt: timestamp, photos: Object.fromEntries(Object.entries(page.photos).map(([id, photo]) => {
    const known = knownPhotos.get(photo.blobKey);
    return [id, { ...photo, driveOriginalId: known?.driveOriginalId ?? photo.driveOriginalId,
      drivePreviewId: known?.drivePreviewId ?? photo.drivePreviewId,
      sourceWidth: known?.sourceWidth || photo.sourceWidth, sourceHeight: known?.sourceHeight || photo.sourceHeight }];
  })) }));
  // Undo is explicit editing intent. Cancel only removals actually restored and
  // record newly removed/replaced assignments against the latest acknowledged state.
  let pending = latest.pendingDeletions && {
    photos: latest.pendingDeletions.photos.filter(entry => pages.find(page => page.id === entry.pageId)?.photos[entry.frameId]?.blobKey !== entry.blobKey),
    pageIds: latest.pendingDeletions.pageIds.filter(id => !pages.some(page => page.id === id)),
  };
  for (const page of latest.pages) {
    const restored = pages.find(item => item.id === page.id);
    const removed = Object.values(page.photos).filter(photo => restored?.photos[photo.frameId]?.blobKey !== photo.blobKey);
    if (removed.length || !restored) pending = recordPhotoDeletions(pending, page.id, removed, !restored);
  }
  const targetPhotos = new Map(getProjectPhotos(target).map(photo => [photo.blobKey, photo]));
  const photoLibrary = getProjectPhotos(latest).map(photo => {
    const target = targetPhotos.get(photo.blobKey);
    if (!target) return photo;
    return { ...photo,
      ...(photo.duplicateOf !== undefined || target.duplicateOf !== undefined ? { duplicateOf: target.duplicateOf ?? null } : {}),
      ...(photo.colourOverride !== undefined || target.colourOverride !== undefined ? { colourOverride: target.colourOverride ?? null } : {}) };
  });
  return { ...latest, name: target.name, formatId: target.formatId, activePageId: target.activePageId, photoLibrary,
    pages, updatedAt: timestamp, pendingDeletions: pending?.photos.length || pending?.pageIds.length ? pending : undefined };
}

export class ProjectHistory {
  private past: StoredProject[] = [];
  private future: StoredProject[] = [];
  private present?: StoredProject;
  private knownPhotos = new Map<string, StoredPhotoAsset>();
  private lastGroup?: string;
  private lastChange = 0;
  constructor(private limit = 40) {}
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  referencedBlobKeys(): Set<string> {
    return new Set([...this.past, ...this.future, ...(this.present ? [this.present] : [])]
      .flatMap(project => project.pages.flatMap(page => Object.values(page.photos).map(photo => photo.blobKey))));
  }

  reset(project?: StoredProject): void {
    this.past = []; this.future = []; this.present = project ? structuredClone(project) : undefined;
    this.knownPhotos.clear(); this.lastGroup = undefined;
    if (project) this.remember(project);
  }
  private remember(project: StoredProject): void {
    for (const page of project.pages) for (const photo of Object.values(page.photos)) {
      const old = this.knownPhotos.get(photo.blobKey);
      this.knownPhotos.set(photo.blobKey, { ...old, ...photo,
        driveOriginalId: photo.driveOriginalId ?? old?.driveOriginalId, drivePreviewId: photo.drivePreviewId ?? old?.drivePreviewId });
    }
  }
  observe(project: StoredProject, group?: string, time = Date.now()): void {
    if (this.present?.id !== project.id) { this.reset(project); return; }
    this.remember(project);
    if (projectContentKey(this.present) !== projectContentKey(project)) {
      if (!group || group !== this.lastGroup || time - this.lastChange > 600) {
        this.past = [...this.past.slice(-(this.limit - 1)), this.present];
      }
      this.future = [];
      this.lastGroup = group;
      this.lastChange = time;
    }
    this.present = structuredClone(project);
    const referenced = this.referencedBlobKeys();
    for (const key of this.knownPhotos.keys()) if (!referenced.has(key)) this.knownPhotos.delete(key);
  }
  travel(direction: "undo" | "redo", latest: StoredProject, timestamp: string): StoredProject | null {
    const source = direction === "undo" ? this.past : this.future;
    const target = source.pop();
    if (!target || target.id !== latest.id) return null;
    this.remember(latest);
    (direction === "undo" ? this.future : this.past).push(structuredClone(latest));
    const restored = restoreProjectContent(latest, target, this.knownPhotos, timestamp);
    this.present = restored;
    this.lastGroup = undefined;
    return restored;
  }
}
