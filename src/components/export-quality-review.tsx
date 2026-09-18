import type { PhotoExportQuality } from "@/lib/export-settings";

export interface PageQualityReview {
  pageId: string;
  pageNumber: number;
  photos: PhotoExportQuality[];
}

export function ExportQualityReview({ pages, onSelectPage }: { pages: PageQualityReview[]; onSelectPage: (id: string) => void }) {
  const checks = pages.flatMap(page => page.photos.map(photo => ({ ...photo, pageId: page.pageId, pageNumber: page.pageNumber })));
  const issues = checks.filter(photo => photo.status !== "sufficient");
  const soft = checks.filter(photo => photo.status === "soft").length;
  return <details className="export-quality-review" open>
    <summary className="font-semibold">Photo quality check{soft ? ` · ${soft} may look soft` : ""}</summary>
    <div className="mt-3 text-xs leading-5 text-neutral-600">
      <p>{issues.length ? "Review these placements at the chosen output size." : checks.length ? "Enough source pixels for every placed photo at this size." : "Add photos to check their resolution."}</p>
      <p className="mt-1">Based on original pixels, crop and zoom. This checks resolution, not focus or compression. Softness warnings never prevent export.</p>
      {issues.length ? <ul className="mt-3 grid gap-3">
        {issues.map(photo => <li key={`${photo.pageId}:${photo.frameId}`}>
          <button type="button" className="text-left font-medium text-neutral-900 underline underline-offset-2" onClick={() => onSelectPage(photo.pageId)}>
            Page {photo.pageNumber} · Frame {photo.frameNumber} · {photo.name}
          </button>
          <p>{photo.status === "unavailable" ? "Original still loading. Restore or reconnect Drive to preview/export this page; its placement is preserved."
            : photo.status === "unknown" ? "Original dimensions could not be checked. Inspect the preview before exporting."
            : `May look soft: enlarged ${photo.enlargement!.toFixed(2)}×. About ${Math.round(photo.visibleSourceWidth!)} × ${Math.round(photo.visibleSourceHeight!)} source pixels cover ${Math.round(photo.visibleOutputWidth!)} × ${Math.round(photo.visibleOutputHeight!)} output pixels. Try a smaller export or less zoom.`}</p>
        </li>)}
      </ul> : null}
    </div>
  </details>;
}
