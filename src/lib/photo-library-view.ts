import type { ProjectPhoto, StoredProject } from "./types";
import type { PhotoAnalysis } from "./photo-palette";
import { projectPhotoGroups } from "./project-photo-library";

export type Orientation = "portrait" | "square" | "landscape" | "panorama" | "awaiting";
export type ColourClass = "bw" | "colour" | "uncertain" | "awaiting";
export interface LibraryView {
  search: string; sort: "import" | "filename"; size: "small" | "medium" | "large";
  orientations: Orientation[]; colours: ColourClass[]; usage: "all" | "used" | "unused";
  scrollTop: number; anchor?: string; anchorOffset?: number;
}
export const DEFAULT_LIBRARY_VIEW: LibraryView = { search: "", sort: "import", size: "medium", orientations: [], colours: [], usage: "all", scrollTop: 0 };
export function photoOrientation(photo: Pick<ProjectPhoto, "sourceWidth" | "sourceHeight">): Orientation {
  const { sourceWidth: w, sourceHeight: h } = photo;
  if (!(w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h))) return "awaiting";
  const ratio = w / h;
  return ratio < 0.95 ? "portrait" : ratio <= 1.05 ? "square" : ratio < 2.5 ? "landscape" : "panorama";
}
export function photoColour(photo: ProjectPhoto, analysis?: PhotoAnalysis): ColourClass {
  return photo.colourOverride ?? analysis?.colourClass ?? "awaiting";
}
export function libraryRows(project: Pick<StoredProject, "photoLibrary" | "pages">, analyses: ReadonlyMap<string, PhotoAnalysis> = new Map()) {
  return projectPhotoGroups(project).map((group, index) => {
    const keys = new Set(group.members.map(photo => photo.blobKey));
    const pages = project.pages.flatMap((page, position) => {
      const count = Object.values(page.photos).filter(photo => keys.has(photo.blobKey)).length;
      return count ? [{ pageId: page.id, pageNumber: position + 1, count }] : [];
    });
    return { ...group, index, orientation: photoOrientation(group.photo),
      colour: photoColour(group.photo, group.members.map(photo => analyses.get(photo.blobKey)).find(Boolean)),
      uses: pages.reduce((sum, page) => sum + page.count, 0), pages };
  });
}
export type LibraryRow = ReturnType<typeof libraryRows>[number];
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
export function filterLibraryRows(rows: LibraryRow[], view: LibraryView): LibraryRow[] {
  const search = view.search.trim().toLocaleLowerCase();
  return rows.filter(row => (!search || row.members.some(photo => (photo.sourceName ?? "").toLocaleLowerCase().includes(search))) &&
    (!view.orientations.length || view.orientations.includes(row.orientation)) && (!view.colours.length || view.colours.includes(row.colour)) &&
    (view.usage === "all" || (view.usage === "used" ? row.uses > 0 : row.uses === 0)))
    .sort((a, b) => (view.sort === "filename" ? collator.compare(a.photo.sourceName ?? "", b.photo.sourceName ?? "") :
      (a.photo.importOrder ?? a.index) - (b.photo.importOrder ?? b.index)) || a.index - b.index || a.photo.blobKey.localeCompare(b.photo.blobKey));
}

/** A session cache contains display preferences only, never saved composition. */
const views = new Map<string, LibraryView>();
export function readLibraryView(key: string): LibraryView { return structuredClone(views.get(key) ?? DEFAULT_LIBRARY_VIEW); }
export function rememberLibraryView(key: string, view: LibraryView): void { views.set(key, structuredClone(view)); }
export function clearLibraryViews(): void { views.clear(); }
