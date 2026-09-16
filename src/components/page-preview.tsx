"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { renderPagePreview } from "@/lib/export";
import type { CanvasFormat, ProjectPage, TemplateDefinition } from "@/lib/types";

export function PagePreview({ pages, initialPageId, format, resolveTemplate, onClose }: {
  pages: ProjectPage[]; initialPageId: string | null; format: CanvasFormat;
  resolveTemplate: (page: ProjectPage) => TemplateDefinition; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const [index, setIndex] = useState(Math.max(0, pages.findIndex(page => page.id === initialPageId)));
  const [image, setImage] = useState<{ page: ProjectPage; url: string } | null>(null);
  const [error, setError] = useState("");
  const page = pages[Math.min(index, pages.length - 1)];
  const [previousPage, setPreviousPage] = useState(page);
  if (previousPage !== page) { setPreviousPage(page); setImage(null); setError(""); }
  const template = page ? resolveTemplate(page) : null;
  const unavailable = Object.keys(page?.unavailablePhotos ?? {}).length;
  const empty = template ? template.frames.filter(frame => !page.photos[frame.id] && !page.unavailablePhotos?.[frame.id]).length : 0;
  const navigate = (offset: number) => setIndex(current => Math.max(0, Math.min(pages.length - 1, current + offset)));

  useEffect(() => {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.showModal();
    return () => { document.body.style.overflow = previousOverflow; focused?.focus(); };
  }, []);

  useEffect(() => {
    let cancelled = false, url: string | undefined;
    const abort = new AbortController();
    if (page && template && !unavailable) {
      void renderPagePreview(page, format, template, abort.signal)
        .then(blob => {
          if (cancelled) return;
          url = URL.createObjectURL(blob); setImage({ page, url });
        }).catch(() => { if (!cancelled) setError("The preview could not be rendered. Your page is unchanged."); });
    }
    return () => { cancelled = true; abort.abort(); if (url) URL.revokeObjectURL(url); };
  }, [format, page, template, unavailable]);

  return <dialog ref={dialog} className="page-preview-dialog" aria-labelledby="page-preview-title"
    onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); navigate(event.key === "ArrowLeft" ? -1 : 1); }
    }}>
    <header className="flex items-center justify-between gap-4 p-4">
      <div><h2 id="page-preview-title" className="font-semibold">Preview</h2><p className="text-xs text-neutral-500">Page {Math.min(index + 1, pages.length)} of {pages.length} · {format.width} × {format.height}</p></div>
      <button autoFocus type="button" className="secondary-button" onClick={onClose}>Back to editing</button>
    </header>
    <div className="page-preview-stage" onPointerDown={event => { swipe.current = { x: event.clientX, y: event.clientY }; }}
      onPointerCancel={() => { swipe.current = null; }} onPointerUp={event => {
        const start = swipe.current; swipe.current = null;
        if (start && Math.abs(event.clientX - start.x) > 50 && Math.abs(event.clientX - start.x) > Math.abs(event.clientY - start.y) * 1.5) navigate(event.clientX < start.x ? 1 : -1);
      }}>
      {unavailable ? <p role="status">{unavailable} {unavailable === 1 ? "photo is" : "photos are"} still loading. Reconnect Drive or restore the originals to preview this page.</p>
        : error ? <p role="alert">{error}</p>
        : image?.page === page ? <Image unoptimized draggable={false} src={image.url} width={format.width} height={format.height} alt={`Export preview of page ${index + 1}`} />
        : <p role="status">Preparing preview…</p>}
    </div>
    <footer className="grid gap-3 p-4 text-center">
      {empty > 0 ? <p className="text-xs text-neutral-600">Draft: {empty} empty {empty === 1 ? "frame" : "frames"}. Fill these before exporting this page.</p> : null}
      <nav aria-label="Preview pages" className="flex items-center justify-center gap-5">
        <button type="button" className="secondary-button" disabled={index <= 0} onClick={() => navigate(-1)}>Previous</button>
        <span aria-live="polite" className="text-sm tabular-nums">{Math.min(index + 1, pages.length)} / {pages.length}</span>
        <button type="button" className="secondary-button" disabled={index >= pages.length - 1} onClick={() => navigate(1)}>Next</button>
      </nav>
    </footer>
  </dialog>;
}
