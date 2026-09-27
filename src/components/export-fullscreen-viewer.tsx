"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { CanvasViewport } from "./canvas-viewport";
import type { ExportSize } from "@/lib/export-settings";

/** Displays the preview's existing rendered JPEG. It never renders a composition. */
export function ExportFullscreenViewer({ url, error, size, pageNumber, position, count, onNavigate, onClose }: {
  url?: string; error?: string; size: ExportSize; pageNumber: number; position: number; count: number;
  onNavigate: (offset: number) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    return () => { if (focused?.isConnected) focused.focus(); };
  }, []);
  useEffect(() => { dialog.current?.querySelector<HTMLElement>(".canvas-viewport-stage")?.focus({ preventScroll: true }); }, [url]);
  return <dialog ref={dialog} className="export-fullscreen-dialog" aria-label={`Full screen export preview, page ${pageNumber}`}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onKeyDown={event => event.stopPropagation()}>
    {url ? <CanvasViewport key={`${pageNumber}:${size.width}:${size.height}`} width={size.width} height={size.height}
      label="Full screen export" immersive padding={0} overlayActions={<>
        <button type="button" onClick={onClose}>Close</button>
        <button type="button" aria-label="Previous page" disabled={position <= 0} onClick={() => onNavigate(-1)}>←</button>
        <span className="export-fullscreen-page" aria-live="polite">{position + 1} / {count}</span>
        <button type="button" aria-label="Next page" disabled={position >= count - 1} onClick={() => onNavigate(1)}>→</button>
      </>}>
      <Image unoptimized draggable={false} src={url} width={size.width} height={size.height}
        style={{ width: size.width, height: size.height }} alt={`Rendered export of page ${pageNumber}`} />
    </CanvasViewport> : <div className="export-fullscreen-message">
      <p role={error ? "alert" : "status"}>{error || "Preparing export preview…"}</p>
      {error ? <div><button type="button" className="small-button" disabled={position <= 0} onClick={() => onNavigate(-1)}>Previous page</button>
        <button type="button" className="small-button" disabled={position >= count - 1} onClick={() => onNavigate(1)}>Next page</button></div> : null}
      <button type="button" className="small-button" onClick={onClose}>Close</button>
    </div>}
  </dialog>;
}
