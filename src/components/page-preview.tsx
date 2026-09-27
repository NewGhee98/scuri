"use client";

import Image from "next/image";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { renderPagePreview } from "@/lib/export";
import { assessPageExportQuality, exportWidthStep, getExportSize, maximumExportWidth, type ExportSize } from "@/lib/export-settings";
import { isPageAssigned } from "@/lib/project";
import { applyHydratedPhotos, hydrateProjectPhotos } from "@/lib/project-photos";
import { disposePhotoAsset } from "@/lib/image";
import { PhotoPreviewContext } from "./photo-preview-context";
import type { CanvasFormat, ProjectPage, TemplateDefinition } from "@/lib/types";
import { ExportQualityReview } from "./export-quality-review";
import { CanvasViewport } from "./canvas-viewport";
import { ExportFullscreenViewer } from "./export-fullscreen-viewer";

// Each view owns its image request. Full-screen navigation leaves the ordinary
// viewport mounted, retaining its zoom, pan, focus target and export settings.
function useRenderedPreview(request: { page: ProjectPage | null; template: TemplateDefinition | null; size: ExportSize | null; format: CanvasFormat },
  session: React.ContextType<typeof PhotoPreviewContext>) {
  const [rendered, setRendered] = useState<{ request: typeof request; url?: string; error?: string; checks?: ReturnType<typeof assessPageExportQuality> } | null>(null);
  useEffect(() => {
    let cancelled = false, url: string | undefined;
    const abort = new AbortController();
    // Coalesce width typing without repeatedly decoding large originals.
    const timer = window.setTimeout(() => {
      if (request.page && request.template && request.size) {
        const { page, template, size, format } = request;
        void (async () => {
          const hydrated = await hydrateProjectPhotos([page], () => !cancelled ? session?.getDriveToken() ?? null : null, session?.getVolatileBlob,
            { signal: abort.signal });
          try {
            if (cancelled) return null;
            const readyPage = applyHydratedPhotos([page], hydrated)[0];
            if (Object.keys(readyPage.unavailablePhotos ?? {}).length) throw new Error("Original photos are unavailable. Reconnect Drive or restore the originals to preview this page.");
            return { blob: await renderPagePreview(readyPage, format, template, abort.signal, size),
              checks: assessPageExportQuality(readyPage, format, template, size) };
          } finally { hydrated.forEach(item => disposePhotoAsset(item.photo)); }
        })()
          .then(result => {
            if (cancelled || !result) return;
            url = URL.createObjectURL(result.blob); setRendered({ request, url, checks: result.checks });
          }).catch(error => { if (!cancelled) setRendered({ request, error: error instanceof Error ? error.message : "The preview could not be rendered. Your page is unchanged." }); });
      }
    }, 200);
    return () => { cancelled = true; window.clearTimeout(timer); abort.abort(); if (url) URL.revokeObjectURL(url); };
  }, [request, session]);
  return rendered?.request === request ? rendered : null;
}

export function PagePreview({ pages, initialPageId, format, resolveTemplate, outputWidth, onOutputWidthChange, pageNumbers, onExport, onClose }: {
  pages: ProjectPage[]; initialPageId: string | null; format: CanvasFormat;
  resolveTemplate: (page: ProjectPage) => TemplateDefinition; onClose: () => void;
  outputWidth: number; onOutputWidthChange: (width: number) => void;
  pageNumbers: number[]; onExport?: (size: ExportSize) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const session = useContext(PhotoPreviewContext);
  const [index, setIndex] = useState(Math.max(0, pages.findIndex(page => page.id === initialPageId)));
  const [custom, setCustom] = useState(![1, 2, 3].some(scale => outputWidth === format.width * scale));
  const [qualityOpen, setQualityOpen] = useState(true);
  // Full-screen browsing has its own cursor; Close restores the ordinary preview.
  const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null);
  const sizeResult = useMemo(() => {
    try { return { size: getExportSize(format, outputWidth), error: "" }; }
    catch (error) { return { size: null, error: error instanceof Error ? error.message : "Choose a valid output size." }; }
  }, [format, outputWidth]);
  const size = sizeResult.size;
  const pageIndex = Math.min(index, pages.length - 1);
  const renderedIndex = Math.min(fullscreenIndex ?? pageIndex, pages.length - 1);
  const page = pages[pageIndex];
  const template = useMemo(() => page ? resolveTemplate(page) : null, [page, resolveTemplate]);
  // An old async result can never appear under a new size/page label.
  const request = useMemo(() => ({ page, template, size, format }), [page, template, size, format]);
  const currentRender = useRenderedPreview(request, session);
  const fullscreenPage = fullscreenIndex !== null && renderedIndex !== pageIndex ? pages[renderedIndex] : null;
  const fullscreenTemplate = useMemo(() => fullscreenPage ? resolveTemplate(fullscreenPage) : null, [fullscreenPage, resolveTemplate]);
  const fullscreenRequest = useMemo(() => ({ page: fullscreenPage, template: fullscreenTemplate, size, format }), [fullscreenPage, fullscreenTemplate, size, format]);
  const otherPageRender = useRenderedPreview(fullscreenRequest, session);
  const fullscreenRender = renderedIndex === pageIndex ? currentRender : otherPageRender;
  const unavailable = Object.keys(page?.unavailablePhotos ?? {}).length;
  const empty = template ? template.frames.filter(frame => !page.photos[frame.id] && !page.unavailablePhotos?.[frame.id]).length : 0;
  const navigate = (offset: number) => setIndex(Math.max(0, Math.min(pages.length - 1, pageIndex + offset)));
  const checks = useMemo(() => size ? pages.map((item, i) => ({ pageId: item.id, pageNumber: pageNumbers[i],
    photos: item === page && currentRender?.checks ? currentRender.checks : assessPageExportQuality(item, format, resolveTemplate(item), size) })) : [], [pages, pageNumbers, format, resolveTemplate, size, page, currentRender]);
  const ready = pages.every(item => isPageAssigned(item, resolveTemplate(item)));

  useEffect(() => {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.showModal();
    return () => { document.body.style.overflow = previousOverflow; focused?.focus(); };
  }, []);



  return <dialog ref={dialog} className="page-preview-dialog" aria-labelledby="page-preview-title"
    onCancel={event => { if (event.target !== event.currentTarget) return; event.preventDefault(); onClose(); }} onKeyDown={event => {
      // Canvas navigation owns its arrow keys; inputs keep native controls.
      if (event.target instanceof HTMLElement && event.target.closest("input, select, textarea, .canvas-viewport")) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); navigate(event.key === "ArrowLeft" ? -1 : 1); }
    }}>
    <header className="page-preview-toolbar">
      <div className="page-preview-heading">
        <div><h2 id="page-preview-title" className="font-semibold">{onExport ? "Review export" : "Export preview"}</h2>
          <p className="text-xs text-neutral-600" aria-live="polite">Page {pageNumbers[pageIndex]} · {size ? `${size.width} × ${size.height} pixels · JPEG` : "Choose an output size"}</p></div>
      </div>
      <div className="page-preview-settings">
        <label>Output size
          <select className="export-size-input" value={custom ? "custom" : outputWidth / format.width} onChange={event => {
            setCustom(event.target.value === "custom");
            if (event.target.value !== "custom") onOutputWidthChange(format.width * Number(event.target.value));
          }}>
            {[1, 2, 3].map(scale => <option key={scale} value={scale}>{scale === 1 ? "Standard" : `${scale}×`} · {format.width * scale} × {format.height * scale}</option>)}
            <option value="custom">Custom width</option>
          </select>
        </label>
        {custom ? <label>Width (pixels)<input className="export-size-input w-32" type="number" inputMode="numeric"
          min={format.width} max={maximumExportWidth(format)} step={exportWidthStep(format)} value={outputWidth || ""}
          aria-invalid={Boolean(sizeResult.error)} aria-describedby="export-size-help" onChange={event => onOutputWidthChange(Number(event.target.value))} /></label> : null}
      </div>
      <div className="page-preview-actions">
        <button type="button" className="small-button" aria-expanded={qualityOpen} aria-controls="preview-photo-quality" onClick={() => setQualityOpen(value => !value)}>Photo quality</button>
        <button type="button" className="small-button" disabled={!currentRender?.url || !size} onClick={() => setFullscreenIndex(pageIndex)}>Full screen</button>
        <details className="preview-help"><summary>Help</summary><p>Export size changes only the output pixels; your layout and crops stay unchanged. Fit shows the complete page. 100% detail uses actual output dimensions. In Full screen, tap or press H for controls, pinch to zoom and drag to pan.</p></details>
        <button autoFocus type="button" className="secondary-button" onClick={onClose}>Back to editing</button>
      </div>
      {sizeResult.error || custom ? <p id="export-size-help" role={sizeResult.error ? "alert" : undefined} className="export-size-help">{sizeResult.error || `Width rounds to multiples of ${exportWidthStep(format)} to keep ${format.aspectRatio}.`}</p> : null}
    </header>
    <div className={`page-preview-body${qualityOpen ? " quality-open" : ""}`}>
      <div className="page-preview-stage" aria-label="Page image preview">
        {!size ? <p role="status">Choose a valid output size to preview.</p>
          : currentRender?.error ? <p role="alert">{currentRender.error}</p>
          : currentRender?.url ? <CanvasViewport key={`${page.id}:${size.width}:${size.height}`} width={size.width} height={size.height} label="Export preview" compact padding={8} className="export-canvas-viewport">
            <Image unoptimized draggable={false} src={currentRender.url} width={size.width} height={size.height}
              style={{ width: size.width, height: size.height }} alt={`Export preview of page ${pageNumbers[pageIndex]}`} />
            </CanvasViewport>
          : <p role="status">{unavailable ? "Loading originals for the export preview…" : "Preparing preview…"}</p>}
      </div>
      {qualityOpen ? <aside className="page-preview-quality" id="preview-photo-quality">{size ? <ExportQualityReview pages={checks}
        onCollapse={() => setQualityOpen(false)} onSelectPage={id => setIndex(Math.max(0, pages.findIndex(item => item.id === id)))} />
        : <p className="text-sm text-neutral-600">Choose a valid output size to check photo quality.</p>}</aside> : null}
    </div>
    <footer className="page-preview-footer">
      {empty > 0 ? <p className="text-xs text-neutral-600">Draft: {empty} empty {empty === 1 ? "frame" : "frames"}. Fill these before exporting this page.</p> : null}
      <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-5">
        <nav aria-label="Preview pages" className="flex items-center justify-center gap-3">
          <button type="button" className="secondary-button" disabled={pageIndex <= 0} onClick={() => navigate(-1)}>Previous</button>
          <span aria-live="polite" className="text-sm tabular-nums">{pageIndex + 1} / {pages.length}</span>
          <button type="button" className="secondary-button" disabled={pageIndex >= pages.length - 1} onClick={() => navigate(1)}>Next</button>
        </nav>
        {onExport ? <button type="button" className="primary-button" disabled={!size || !ready} onClick={() => { if (size) onExport(size); }}>
          {pages.length === 1 ? "Create JPEG" : `Create ${pages.length} JPEGs`}
        </button> : null}
      </div>
    </footer>
    {fullscreenIndex !== null && size ? <ExportFullscreenViewer url={fullscreenRender?.url} error={fullscreenRender?.error} size={size}
      pageNumber={pageNumbers[renderedIndex]} position={renderedIndex} count={pages.length}
      onNavigate={offset => setFullscreenIndex(Math.max(0, Math.min(pages.length - 1, renderedIndex + offset)))}
      onClose={() => setFullscreenIndex(null)} /> : null}
  </dialog>;
}
