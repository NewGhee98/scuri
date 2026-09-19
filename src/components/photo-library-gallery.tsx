"use client";
import Image from "next/image";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { galleryGeometry, galleryRows, galleryScrollAnchor, visibleGalleryRange } from "@/lib/library-gallery";
import type { LibraryRow, LibraryView } from "@/lib/photo-library-view";
import { usePhotoPreviewSession } from "./photo-preview-context";

export function PhotoLibraryGallery({ rows, view, onView, onInspect, focusPhotoKey, header, empty }: { rows: LibraryRow[]; view: LibraryView;
  onView: (value: LibraryView) => void; onInspect: (key: string) => void; focusPhotoKey?: string; header?: ReactNode; empty?: ReactNode }) {
  const container = useRef<HTMLDivElement>(null), { session, snapshot } = usePhotoPreviewSession();
  const heading = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0, header: 0 });
  const restored = useRef(false);
  const focused = useRef(false);
  const geometry = galleryGeometry(bounds.width, view.size), packed = galleryRows(rows, geometry.columns);
  const range = visibleGalleryRange(view.scrollTop, bounds.height, geometry.rowHeight, packed.length, bounds.header);
  const visible = packed.slice(range.start, range.end);
  const sourcesKey = JSON.stringify(visible.flatMap(row => row.map(item => item.row.photo)));
  const filterKey = JSON.stringify([view.search, view.orientations, view.colours, view.usage, view.sort]);
  useEffect(() => {
    const element = container.current; if (!element) return;
    const resize = new ResizeObserver(() => {
      // A native dialog is initially display:none. Restoring then clamps to zero
      // and its scroll event would overwrite the remembered position.
      const style = getComputedStyle(element);
      const width = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (width > 0 && element.clientHeight > 0)
        setBounds({ width, height: element.clientHeight, header: heading.current?.offsetHeight ?? 0 });
    });
    resize.observe(element); if (heading.current) resize.observe(heading.current);
    return () => resize.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = container.current; if (!element || !bounds.width || !bounds.height) return;
    const anchor = view.anchor;
    const index = anchor ? packed.findIndex(row => row.some(item => item.row.photo.blobKey === anchor)) : -1;
    element.scrollTop = index >= 0 ? bounds.header + index * geometry.rowHeight + (view.anchorOffset ?? 0) : view.scrollTop;
    restored.current = true;
    // Native scrolling already matches this value. Also honour explicit resets
    // when clearing an already-empty filter, without requiring a filter change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds.width, bounds.height, bounds.header, geometry.columns, geometry.rowHeight, filterKey, view.scrollTop]);
  useEffect(() => {
    if (!focusPhotoKey || focused.current || !bounds.width) return;
    const card = [...(container.current?.querySelectorAll<HTMLButtonElement>("[data-photo-key]") ?? [])].find(item => item.dataset.photoKey === focusPhotoKey);
    (card ?? container.current)?.focus({ preventScroll: true }); focused.current = true;
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
    const top = event.currentTarget.scrollTop, anchor = galleryScrollAnchor(top, geometry.rowHeight, bounds.header);
    onView({ ...view, scrollTop: top, anchor: anchor ? packed[anchor.index]?.[0]?.row.photo.blobKey : undefined, anchorOffset: anchor?.offset });
  }}>
    <div ref={heading}>{header}</div>
    {!rows.length ? empty ?? <p className="library-empty">No photos match. Clear filters to see the whole library, including unavailable photos.</p> : null}
    <div style={{ height: range.start * geometry.rowHeight }} aria-hidden="true" />
    {visible.map((items, offset) => <div key={range.start + offset} className="library-gallery-row"
      style={{ height: geometry.rowHeight, gridTemplateColumns: `repeat(${geometry.columns}, minmax(0, 1fr))` }}>
      {items.map(({ row, span }) => <button key={row.photo.blobKey} data-photo-key={row.photo.blobKey} type="button" className="library-photo-card" style={{ gridColumn: `span ${span}` }} onClick={() => onInspect(row.photo.blobKey)}>
        <span className="library-photo-image">{snapshot.get(row.photo.blobKey)?.previewUrl ? <Image unoptimized src={snapshot.get(row.photo.blobKey)!.previewUrl}
          alt={row.photo.sourceName ?? "Project photo"} width={640} height={640} /> : <span>Awaiting preview</span>}</span>
        <span className="library-photo-caption"><span className="library-photo-name" title={row.photo.sourceName}>{row.photo.sourceName ?? "Photo"}</span>
          <span className="library-photo-usage">{row.uses ? `Used ${row.uses}×` : "Unused"}</span></span>
      </button>)}
    </div>)}
    <div style={{ height: Math.max(0, packed.length - range.end) * geometry.rowHeight }} aria-hidden="true" />
  </div>;
}
