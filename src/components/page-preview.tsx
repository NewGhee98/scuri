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

export function PagePreview({ pages, initialPageId, format, resolveTemplate, outputWidth, onOutputWidthChange, pageNumbers, onExport, onClose }: {
  pages: ProjectPage[]; initialPageId: string | null; format: CanvasFormat;
  resolveTemplate: (page: ProjectPage) => TemplateDefinition; onClose: () => void;
  outputWidth: number; onOutputWidthChange: (width: number) => void;
  pageNumbers: number[]; onExport?: (size: ExportSize) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const session = useContext(PhotoPreviewContext);
  const stage = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const [index, setIndex] = useState(Math.max(0, pages.findIndex(page => page.id === initialPageId)));
  const [detail, setDetail] = useState(false);
  const [custom, setCustom] = useState(![1, 2, 3].some(scale => outputWidth === format.width * scale));
  const sizeResult = useMemo(() => {
    try { return { size: getExportSize(format, outputWidth), error: "" }; }
    catch (error) { return { size: null, error: error instanceof Error ? error.message : "Choose a valid output size." }; }
  }, [format, outputWidth]);
  const size = sizeResult.size;
  const pageIndex = Math.min(index, pages.length - 1);
  const page = pages[pageIndex];
  const template = page ? resolveTemplate(page) : null;
  // An old async result can never appear under a new size/page label.
  const request = useMemo(() => ({ page, template, size, format }), [page, template, size, format]);
  const [rendered, setRendered] = useState<{ request: typeof request; url?: string; error?: string; checks?: ReturnType<typeof assessPageExportQuality> } | null>(null);
  const currentRender = rendered?.request === request ? rendered : null;
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

  useEffect(() => { stage.current?.scrollTo(0, 0); }, [request, detail]);

  useEffect(() => {
    let cancelled = false, url: string | undefined;
    const abort = new AbortController();
    // Coalesce width typing without repeatedly decoding large originals.
    const timer = window.setTimeout(() => {
      if (request.page && request.template && request.size) {
        void (async () => {
          const hydrated = await hydrateProjectPhotos([request.page], () => !cancelled ? session?.getDriveToken() ?? null : null, session?.getVolatileBlob,
            { signal: abort.signal });
          try {
            if (cancelled) return null;
            const readyPage = applyHydratedPhotos([request.page], hydrated)[0];
            if (Object.keys(readyPage.unavailablePhotos ?? {}).length) throw new Error("Original photos are unavailable. Reconnect Drive or restore the originals to preview this page.");
            return { blob: await renderPagePreview(readyPage, request.format, request.template!, abort.signal, request.size!),
              checks: assessPageExportQuality(readyPage, request.format, request.template!, request.size!) };
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

  return <dialog ref={dialog} className="page-preview-dialog" aria-labelledby="page-preview-title"
    onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => {
      // Detail mode leaves arrow keys for scrolling; inputs keep native controls.
      if (detail || (event.target instanceof HTMLElement && event.target.closest("input, select, textarea"))) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); navigate(event.key === "ArrowLeft" ? -1 : 1); }
    }}>
    <header className="grid gap-3 border-b border-black/10 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <div><h2 id="page-preview-title" className="font-semibold">{onExport ? "Review export" : "Export preview"}</h2>
          <p className="text-xs text-neutral-600" aria-live="polite">Page {pageNumbers[pageIndex]} · {size ? `${size.width} × ${size.height} pixels · JPEG` : "Choose an output size"}</p></div>
        <button autoFocus type="button" className="secondary-button" onClick={onClose}>Back to editing</button>
      </div>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="grid gap-1">Output size
          <select className="export-size-input" value={custom ? "custom" : outputWidth / format.width} onChange={event => {
            setCustom(event.target.value === "custom");
            if (event.target.value !== "custom") onOutputWidthChange(format.width * Number(event.target.value));
          }}>
            {[1, 2, 3].map(scale => <option key={scale} value={scale}>{scale === 1 ? "Standard" : `${scale}×`} · {format.width * scale} × {format.height * scale}</option>)}
            <option value="custom">Custom width</option>
          </select>
        </label>
        {custom ? <label className="grid gap-1">Width (pixels)<input className="export-size-input w-32" type="number" inputMode="numeric"
          min={format.width} max={maximumExportWidth(format)} step={exportWidthStep(format)} value={outputWidth || ""}
          aria-invalid={Boolean(sizeResult.error)} aria-describedby="export-size-help" onChange={event => onOutputWidthChange(Number(event.target.value))} /></label> : null}
        <div className="flex gap-2" role="group" aria-label="Preview magnification">
          <button type="button" className="small-button" aria-pressed={!detail} onClick={() => setDetail(false)}>Fit page</button>
          <button type="button" className="small-button" aria-pressed={detail} onClick={() => setDetail(true)}>100% detail</button>
        </div>
      </div>
      <p id="export-size-help" className="text-xs text-neutral-600">{sizeResult.error || `${custom ? `Width rounds to multiples of ${exportWidthStep(format)} to keep ${format.aspectRatio}. ` : ""}Export size only; your layout and crops stay unchanged.${detail ? " Scroll to inspect the image at 100%." : ""}`}</p>
    </header>
    <div className="page-preview-body">
      <div ref={stage} className={`page-preview-stage${detail ? " page-preview-detail" : ""}`} tabIndex={detail ? 0 : undefined} aria-label="Page image preview"
        onPointerDown={event => { if (!detail) swipe.current = { x: event.clientX, y: event.clientY }; }}
        onPointerCancel={() => { swipe.current = null; }} onPointerUp={event => {
          const start = swipe.current; swipe.current = null;
          if (!detail && start && Math.abs(event.clientX - start.x) > 50 && Math.abs(event.clientX - start.x) > Math.abs(event.clientY - start.y) * 1.5) navigate(event.clientX < start.x ? 1 : -1);
        }}>
        {!size ? <p role="status">Choose a valid output size to preview.</p>
          : currentRender?.error ? <p role="alert">{currentRender.error}</p>
          : currentRender?.url ? <Image unoptimized draggable={false} src={currentRender.url} width={size.width} height={size.height}
            style={detail ? { width: size.width, height: size.height } : undefined} alt={`Export preview of page ${pageNumbers[pageIndex]}`} />
          : <p role="status">{unavailable ? "Loading originals for the export preview…" : "Preparing preview…"}</p>}
      </div>
      <aside className="page-preview-quality">{size ? <ExportQualityReview pages={checks} onSelectPage={id => setIndex(Math.max(0, pages.findIndex(item => item.id === id)))} />
        : <p className="text-sm text-neutral-600">Choose a valid output size to check photo quality.</p>}</aside>
    </div>
    <footer className="grid gap-2 border-t border-black/10 p-3 text-center sm:p-4">
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
  </dialog>;
}
