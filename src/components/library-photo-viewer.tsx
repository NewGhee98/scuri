"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { readDerived, writeDerived } from "@/lib/photo-cache-storage";
import { previewStorageKey } from "@/lib/photo-preview-cache";
import { downloadGoogleDrivePhoto } from "@/lib/google-drive";
import { loadPhotoBlob, savePhotoBlob } from "@/lib/storage";
import type { LibraryRow } from "@/lib/photo-library-view";
import type { ProjectPhoto } from "@/lib/types";
import { usePhotoPreviewSession } from "./photo-preview-context";
import { ActionDialog } from "./action-dialog";
import { inspectionGesture } from "@/lib/photo-inspection";

export function LibraryPhotoViewer({ row, ownerId, index, count, onBack, onPrevious, onNext, onUse, onOverride, controlsHidden, onToggleControls }: {
  row: LibraryRow; ownerId?: string | null; index: number; count: number; onBack: () => void; onPrevious: () => void; onNext: () => void;
  onUse?: () => void; onOverride: (value: ProjectPhoto["colourOverride"]) => void;
  controlsHidden: boolean; onToggleControls: () => void;
}) {
  const { session, snapshot } = usePhotoPreviewSession(), photo = row.photo;
  const [image, setImage] = useState<{ url: string; original: boolean; width: number; height: number } | null>(null);
  const [wantOriginal, setWantOriginal] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [detail, setDetail] = useState(false), [retry, setRetry] = useState(0);
  const [info, setInfo] = useState(false);
  const [bounds, setBounds] = useState({ width: 1, height: 1 });
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const area = useRef<HTMLDivElement>(null), pointers = useRef(new Map<number, { x: number; y: number }>());
  const swipe = useRef<{ x: number; y: number; time: number; moved: number } | null>(null);
  const width = photo.sourceWidth || image?.width || 1, height = photo.sourceHeight || image?.height || 1;
  const fit = Math.min(bounds.width / width, bounds.height / height, 1);
  const zoom = detail && image?.original ? 1 / fit : view.zoom;
  const identities = JSON.stringify([photo, ...row.members.filter(item => item.blobKey !== photo.blobKey)].map(item => ({
    blobKey: item.blobKey, sourceWidth: item.sourceWidth, sourceHeight: item.sourceHeight, driveOriginalId: item.driveOriginalId, drivePreviewId: item.drivePreviewId,
  })));
  useEffect(() => {
    const element = area.current; if (!element) return;
    element.focus({ preventScroll: true });
    const observer = new ResizeObserver(([entry]) => setBounds({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => { const url = image?.url; return () => { if (url) URL.revokeObjectURL(url); }; }, [image]);
  useEffect(() => session?.cache.pin(photo.blobKey), [session, photo.blobKey]);
  useEffect(() => {
    if (!session) return;
    let cancelled = false, pendingUrl: string | undefined;
    const abort = new AbortController();
    const isCurrent = session.cache.capture();
    void (async () => {
      await Promise.resolve(); if (cancelled || !isCurrent()) return;
      setLoading(true); setError("");
      const candidates = JSON.parse(identities) as ProjectPhoto[], photo = candidates[0];
      let blob: Blob | null | undefined;
      if (wantOriginal) {
        if (photo.sourceWidth * photo.sourceHeight * 4 > 160 * 1024 * 1024) throw new Error("This original exceeds the detail-view memory budget. Its full resolution is preserved for export; the preview remains available.");
        for (const candidate of candidates) {
          blob = session.getVolatileBlob(candidate.blobKey) ?? await loadPhotoBlob(candidate.blobKey).catch(() => null);
          if (!blob && session.getDriveToken() && candidate.driveOriginalId) {
            blob = await downloadGoogleDrivePhoto(session.getDriveToken()!, candidate.driveOriginalId, abort.signal);
            if (isCurrent()) await savePhotoBlob(candidate.blobKey, blob).catch(() => {});
          }
          if (blob) break;
        }
      } else {
        blob = (await readDerived(previewStorageKey(photo, ownerId, 2200)))?.blob;
        const token = session.getDriveToken();
        if (!blob && token && photo.drivePreviewId) {
          blob = await downloadGoogleDrivePhoto(token, photo.drivePreviewId, abort.signal);
          if (isCurrent()) void writeDerived(previewStorageKey(photo, ownerId, 2200), { blob });
        }
        blob ??= session.cache.getBlob(photo.blobKey);
      }
      if (cancelled || !isCurrent()) return;
      if (!blob) throw new Error(wantOriginal ? "Original unavailable. Reconnect Drive or restore this original, then Retry." : "Preview unavailable. You can request original detail.");
      pendingUrl = URL.createObjectURL(blob);
      const decoded = new window.Image(); decoded.src = pendingUrl;
      await decoded.decode();
      if (cancelled || !isCurrent()) return;
      if (!decoded.naturalWidth || !decoded.naturalHeight) throw new Error("This image could not be decoded.");
      setImage({ url: pendingUrl, original: wantOriginal, width: decoded.naturalWidth, height: decoded.naturalHeight });
      pendingUrl = undefined;
    })().catch(error => { if (!cancelled && isCurrent()) setError(error instanceof Error ? error.message : "Photo could not load."); })
      .finally(() => { if (!cancelled && isCurrent()) setLoading(false); });
    return () => { cancelled = true; abort.abort(); if (pendingUrl) URL.revokeObjectURL(pendingUrl); };
  }, [identities, ownerId, session, wantOriginal, retry]);
  const reset = () => { setDetail(false); setView({ zoom: 1, x: 0, y: 0 }); };
  const points = () => [...pointers.current.values()];
  const url = image?.url ?? snapshot.get(photo.blobKey)?.previewUrl;
  return <section className="library-inspector" data-controls-hidden={controlsHidden} aria-label={`Inspect ${photo.sourceName ?? "photo"}`}>
    <div className="library-inspector-tools">
      <button type="button" className="secondary-button" onClick={onBack}>Back to photos</button>
      <span className="library-inspector-count" aria-label={`Photo ${index + 1} of ${count}`}>{index + 1} / {count}</span>
      <button type="button" className="small-button" aria-haspopup="dialog" onClick={() => setInfo(true)}>Info</button>
      {onUse ? <button className="primary-button" type="button" onClick={onUse}>Use this photo</button> : null}
    </div>
    <div ref={area} className="library-inspector-image" tabIndex={0} aria-label="Photo inspection. Pinch to zoom, drag to pan; swipe at Fit to navigate."
      onKeyDown={event => { if (event.key === "ArrowRight") onNext(); if (event.key === "ArrowLeft") onPrevious(); if (event.key === "0") reset(); if (event.key === "h") onToggleControls(); }}
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        swipe.current = pointers.current.size === 1 ? { x: event.clientX, y: event.clientY, time: event.timeStamp, moved: 0 } : null; }}
      onPointerMove={event => {
        const old = pointers.current.get(event.pointerId); if (!old) return;
        if (swipe.current) swipe.current.moved = Math.max(swipe.current.moved, Math.hypot(event.clientX - swipe.current.x, event.clientY - swipe.current.y));
        const before = points(); pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); const after = points();
        if (after.length === 2) { const distance = (p: { x: number; y: number }[]) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
          const ratio = distance(after) / Math.max(1, distance(before)); setDetail(false);
          setView(value => ({ ...value, zoom: Math.max(1, Math.min(Math.max(8, 1 / fit), (detail && image?.original ? 1 / fit : value.zoom) * ratio)) })); }
        else if (zoom > 1) setView(value => ({ ...value, x: value.x + event.clientX - old.x, y: value.y + event.clientY - old.y }));
      }}
      onPointerUp={event => { pointers.current.delete(event.pointerId);
        if (swipe.current) {
          const dx = event.clientX - swipe.current.x, dy = event.clientY - swipe.current.y;
          const gesture = inspectionGesture(dx, dy, event.timeStamp - swipe.current.time, Math.max(swipe.current.moved, Math.hypot(dx, dy)), zoom);
          if (gesture === "toggle") onToggleControls();
          if (gesture === "previous") onPrevious(); if (gesture === "next") onNext();
        }
        swipe.current = null; }} onPointerCancel={event => { pointers.current.delete(event.pointerId); swipe.current = null; }}>
      {url ? <Image unoptimized draggable={false} src={url} alt={photo.sourceName ?? "Project photo"} width={width} height={height}
        onError={() => { setError("This image could not be decoded. The original and saved placements are unchanged."); setImage(null); }}
        style={{ width: width * fit, height: height * fit,
          transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${zoom})` }} /> : <p>Awaiting preview</p>}
      {!controlsHidden || loading ? <span className="library-image-label" role="status">{image?.original ? "Original" : "Preview"}{loading ? " · Loading…" : ""}</span> : null}
      {error ? <div className="library-image-error" role="status">{error} <button type="button" className="text-button" onPointerDown={event => event.stopPropagation()} onClick={() => setRetry(value => value + 1)}>Retry</button></div> : null}
    </div>
    {controlsHidden ? <button className="library-show-controls small-button" type="button" onClick={onToggleControls}>Show controls</button> : null}
    <div className="library-inspector-navigation">
      <button type="button" className="small-button" disabled={index === 0} onClick={onPrevious}>Previous</button>
      <button type="button" className="small-button" disabled={index + 1 === count} onClick={onNext}>Next</button>
      <div className="library-inspector-scale"><button type="button" className="small-button" aria-pressed={!detail && zoom === 1} onClick={reset}>Fit</button>
        <button type="button" className="small-button" aria-pressed={detail && !!image?.original} onClick={() => { setWantOriginal(true); setDetail(true); setView({ zoom: 1, x: 0, y: 0 }); }}>100%</button></div>
      <button type="button" className="text-button" onClick={() => { onToggleControls(); area.current?.focus(); }}>Hide controls</button>
    </div>
    {info ? <ActionDialog title="Photo info" onClose={() => setInfo(false)}><div className="library-tool-content library-inspector-details">
      <header><h2>Photo info</h2><button type="button" className="small-button" onClick={() => setInfo(false)}>Close</button></header>
      <div><strong>{photo.sourceName ?? "Photo"}</strong><p>{photo.sourceWidth} × {photo.sourceHeight} · {row.uses ? `Used ${row.uses} times` : "Unused"}</p>
        <p>{row.pages.map(page => `Page ${page.pageNumber}${page.count > 1 ? ` (${page.count})` : ""}`).join(" · ")}</p></div>
      <label>Classification <select value={photo.colourOverride ?? "auto"} onChange={event => onOverride(event.target.value === "auto" ? null : event.target.value as "bw" | "colour")}>
        <option value="auto">Auto ({row.colour === "bw" ? "black & white" : row.colour})</option><option value="bw">Black & white</option><option value="colour">Colour</option>
      </select></label>
      <button type="button" className="secondary-button" disabled={loading || image?.original} onClick={() => setWantOriginal(true)}>Original detail</button>
      <label>Inspect zoom <input aria-label="Inspection zoom" type="range" min="1" max={Math.max(8, 1 / fit)} step="0.05" value={zoom}
        onChange={event => { setDetail(false); setView(value => ({ ...value, zoom: Number(event.target.value) })); }} /></label>
      <p className="text-xs text-neutral-600">Inspection zoom does not change any saved crop.</p>
      <p className="text-xs text-neutral-600">Pinch to zoom and drag to pan. At Fit, swipe to browse. Tap the photo to hide or show controls. Keyboard: ← / → to browse, 0 to fit, H to hide controls.</p>
    </div></ActionDialog> : null}
  </section>;
}
