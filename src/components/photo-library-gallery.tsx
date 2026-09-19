"use client";
import Image from "next/image";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { galleryGeometry, galleryRows, visibleGalleryRange } from "@/lib/library-gallery";
import type { LibraryRow, LibraryView } from "@/lib/photo-library-view";
import { usePhotoPreviewSession } from "./photo-preview-context";

export function PhotoLibraryGallery({ rows, view, onView, onInspect, focusPhotoKey }: { rows: LibraryRow[]; view: LibraryView;
  onView: (value: LibraryView) => void; onInspect: (key: string) => void; focusPhotoKey?: string }) {
  const container = useRef<HTMLDivElement>(null), { session, snapshot } = usePhotoPreviewSession();
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const restored = useRef(false);
  const focused = useRef(false);
  const geometry = galleryGeometry(bounds.width, view.size), packed = galleryRows(rows, geometry.columns);
  const range = visibleGalleryRange(view.scrollTop, bounds.height, geometry.rowHeight, packed.length);
  const visible = packed.slice(range.start, range.end);
  const sourcesKey = JSON.stringify(visible.flatMap(row => row.map(item => item.row.photo)));
  const filterKey = JSON.stringify([view.search, view.orientations, view.colours, view.usage, view.sort]);
  useEffect(() => {
    const element = container.current; if (!element) return;
    const resize = new ResizeObserver(([entry]) => {
      // A native dialog is initially display:none. Restoring then clamps to zero
      // and its scroll event would overwrite the remembered position.
      if (entry.contentRect.width > 0 && entry.contentRect.height > 0)
        setBounds({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    resize.observe(element); return () => resize.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = container.current; if (!element || !bounds.width || !bounds.height) return;
    const anchor = !focused.current && focusPhotoKey ? focusPhotoKey : view.anchor;
    const index = anchor ? packed.findIndex(row => row.some(item => item.row.photo.blobKey === anchor)) : -1;
    element.scrollTop = index >= 0 ? index * geometry.rowHeight + (view.anchorOffset ?? 0) : view.scrollTop;
    restored.current = true;
    // Restore once on mount or a layout-size change; ordinary scroll stays native.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds.width, bounds.height, geometry.columns, geometry.rowHeight, filterKey]);
  useEffect(() => {
    if (!focusPhotoKey || focused.current || !bounds.width) return;
    const card = [...(container.current?.querySelectorAll<HTMLButtonElement>("[data-photo-key]") ?? [])].find(item => item.dataset.photoKey === focusPhotoKey);
    if (card) { card.focus({ preventScroll: true }); focused.current = true; }
  }, [focusPhotoKey, bounds.width, sourcesKey]);
  useEffect(() => {
    if (!session) return;
    const sources = JSON.parse(sourcesKey) as LibraryRow["photo"][];
    const release = sources.map(photo => session.cache.pin(photo.blobKey));
    sources.forEach(photo => { void session.cache.request(photo, session.getDriveToken, session.getVolatileBlob, -1); });
    return () => release.forEach(fn => fn());
  }, [sourcesKey, session]);
  return <div className="library-gallery-scroll" ref={container} tabIndex={0} aria-label="Project photos. Use Page Up and Page Down to browse." onScroll={event => {
    if (!restored.current || !event.currentTarget.getClientRects().length) return;
    const top = event.currentTarget.scrollTop, index = Math.floor(top / geometry.rowHeight);
    onView({ ...view, scrollTop: top, anchor: packed[index]?.[0]?.row.photo.blobKey, anchorOffset: top % geometry.rowHeight });
  }}>
    {!rows.length ? <p className="library-empty">No photos match. Clear filters to see the whole library, including unavailable photos.</p> : null}
    <div style={{ height: range.start * geometry.rowHeight }} aria-hidden="true" />
    {visible.map((items, offset) => <div key={range.start + offset} className="library-gallery-row"
      style={{ height: geometry.rowHeight, gridTemplateColumns: `repeat(${geometry.columns}, minmax(0, 1fr))` }}>
      {items.map(({ row, span }) => <button key={row.photo.blobKey} data-photo-key={row.photo.blobKey} type="button" className="library-photo-card" style={{ gridColumn: `span ${span}` }} onClick={() => onInspect(row.photo.blobKey)}>
        <span className="library-photo-image">{snapshot.get(row.photo.blobKey)?.previewUrl ? <Image unoptimized src={snapshot.get(row.photo.blobKey)!.previewUrl}
          alt={row.photo.sourceName ?? "Project photo"} width={640} height={640} /> : <span>Awaiting preview</span>}</span>
        <span className="library-photo-name" title={row.photo.sourceName}>{row.photo.sourceName ?? "Photo"}</span>
        <span className="library-photo-meta">{row.uses ? `Used ${row.uses}× · ${row.pages.map(page => `P${page.pageNumber}${page.count > 1 ? ` (${page.count})` : ""}`).join(", ")}` : "Unused"}</span>
        <span className="library-photo-meta">{row.orientation === "awaiting" ? "Awaiting dimensions" : row.orientation} · {row.colour === "bw" ? "Black & white" : row.colour === "awaiting" ? "Awaiting analysis" : row.colour}</span>
      </button>)}
    </div>)}
    <div style={{ height: Math.max(0, packed.length - range.end) * geometry.rowHeight }} aria-hidden="true" />
  </div>;
}
