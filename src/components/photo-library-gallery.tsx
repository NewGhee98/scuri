"use client";
import Image from "next/image";
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { galleryGeometry, galleryRows, galleryScrollAnchor, visibleGalleryRange } from "@/lib/library-gallery";
import { createPhotoHoldGesture, galleryDragScrollSpeed, photoDropPosition } from "@/lib/photo-gallery-gestures";
import type { LibraryRow, LibraryView } from "@/lib/photo-library-view";
import { usePhotoPreviewSession } from "./photo-preview-context";
import { PHOTO_RANK_LABELS } from "@/lib/photo-metadata";
import "./photo-gallery-controls.css";

type PhotoDrag = { pointerId: number; key: string; from: number; startX: number; startY: number; x: number; y: number; started: boolean;
  targetKey?: string; position?: number; after?: boolean };
type DropPreview = { key: string; targetKey?: string; position?: number; after?: boolean };

function PhotoLabelBadges({ labels }: { labels: string[] }) {
  const element = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);
  useEffect(() => {
    const root = element.current;
    if (!root) return;
    const measure = () => {
      const chips = [...root.querySelectorAll<HTMLElement>(".library-photo-label")];
      const height = root.clientHeight;
      setOverflow(chips.filter(chip => chip.offsetTop + chip.offsetHeight > height).length);
    };
    const resize = new ResizeObserver(measure); resize.observe(root); measure();
    return () => resize.disconnect();
  }, [labels]);
  return <span className="library-photo-label-overlay" aria-hidden="true" title={labels.join(", ")}>
    <span ref={element} className="library-photo-labels">{labels.map(label => <span className="library-photo-label" key={label}>{label}</span>)}</span>
    {overflow ? <span className="library-photo-label-overflow">+{overflow} more</span> : null}
  </span>;
}

function PhotoPositionInput({ position, total, name, onCommit }: { position: number; total: number; name: string; onCommit: (position: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && /^\d+$/.test(draft.trim())) {
      const next = Math.max(1, Math.min(total, Number(draft)));
      if (Number.isSafeInteger(next) && next !== position) onCommit(next);
    }
    setDraft(null);
  };
  return <label className="library-photo-position">Position
    <input type="text" inputMode="numeric" pattern="[0-9]*" aria-label={`Custom order position for ${name}`}
      value={draft ?? String(position)} onChange={event => setDraft(event.target.value)} onBlur={commit}
      onKeyDown={event => {
        if (event.key === "Enter") { event.preventDefault(); commit(); }
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDraft(null); }
      }} />
  </label>;
}

export function PhotoLibraryGallery({ rows, view, onView, onInspect, selectedKeys, selectionOrder, showPreviewButtons = false, onToggleSelected, onStartSelecting, onReorder, totalPhotos, focusPhotoKey, header, empty }: { rows: LibraryRow[]; view: LibraryView;
  onView: (value: LibraryView) => void; onInspect: (key: string) => void; focusPhotoKey?: string; header?: ReactNode; empty?: ReactNode;
  selectedKeys?: ReadonlySet<string>; selectionOrder?: ReadonlyMap<string, number>; showPreviewButtons?: boolean;
  onToggleSelected?: (key: string) => void; onStartSelecting?: (key: string) => void;
  onReorder?: (key: string, position: number) => void; totalPhotos?: number }) {
  const container = useRef<HTMLDivElement>(null), { session, snapshot } = usePhotoPreviewSession();
  const heading = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0, header: 0 });
  const restored = useRef(false);
  const focused = useRef(false);
  const hold = useRef(createPhotoHoldGesture());
  const drag = useRef<PhotoDrag | null>(null);
  const currentRows = useRef(rows);
  useLayoutEffect(() => { currentRows.current = rows; }, [rows]);
  const [drop, setDrop] = useState<DropPreview | null>(null);
  const customOrder = view.sort === "custom" && !!onReorder;
  const total = totalPhotos ?? rows.length;
  // View updates from native scrolling are observations, not scroll commands.
  // Keep their identity even if React commits one after the browser has moved on.
  const nativeViews = useRef(new WeakSet<LibraryView>());
  const latestNativeView = useRef<LibraryView | null>(null);
  const restoration = useRef<{ view: LibraryView; columns: number; rowHeight: number; header: number; filterKey: string } | null>(null);
  const geometry = galleryGeometry(bounds.width, view.size), packed = galleryRows(rows, geometry.columns);
  const range = visibleGalleryRange(view.scrollTop, bounds.height, geometry.rowHeight, packed.length, bounds.header);
  const visible = packed.slice(range.start, range.end);
  const sourcesKey = JSON.stringify(visible.flatMap(row => row.map(item => item.row.photo)));
  const filterKey = JSON.stringify([view.search, view.orientations, view.colours, view.usage, view.ranks, view.labels, view.untagged, view.sort]);
  const cancelDrag = () => {
    const active = drag.current; drag.current = null; setDrop(null);
    if (active && container.current?.hasPointerCapture(active.pointerId)) container.current.releasePointerCapture(active.pointerId);
  };
  const updateDrop = () => {
    const active = drag.current, element = container.current;
    if (!active?.started || !element) return;
    // Focusing a handle can commit a dirty position field before this drag moves.
    // Resolve the source from current rows, including those outside the viewport.
    active.from = currentRows.current.find(row => row.photo.blobKey === active.key)?.customPosition ?? active.from;
    const bounds = element.getBoundingClientRect();
    let nearest: { element: HTMLElement; rect: DOMRect; distance: number } | undefined;
    if (active.x >= bounds.left && active.x <= bounds.right && active.y >= bounds.top && active.y <= bounds.bottom) {
      for (const card of element.querySelectorAll<HTMLElement>("[data-photo-card-key]")) {
        const rect = card.getBoundingClientRect();
        if (rect.bottom <= bounds.top || rect.top >= bounds.bottom) continue;
        const distance = Math.hypot(Math.max(rect.left - active.x, 0, active.x - rect.right), Math.max(rect.top - active.y, 0, active.y - rect.bottom));
        if (!nearest || distance < nearest.distance) nearest = { element: card, rect, distance };
      }
    }
    const target = nearest?.element;
    const rect = nearest?.rect;
    active.targetKey = target?.dataset.photoCardKey;
    active.after = rect ? (active.y < rect.top + rect.height * .2 ? false : active.y > rect.bottom - rect.height * .2 ? true : active.x > rect.left + rect.width / 2) : undefined;
    active.position = target ? photoDropPosition(active.from, Number(target.dataset.customPosition), !!active.after, total) : undefined;
    const next = { key: active.key, targetKey: active.targetKey, position: active.position, after: active.after };
    setDrop(previous => previous?.key === next.key && previous?.targetKey === next.targetKey && previous?.position === next.position && previous?.after === next.after ? previous : next);
  };
  const movePointer = (event: PointerEvent<HTMLDivElement>) => {
    hold.current.move(event);
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    active.x = event.clientX; active.y = event.clientY;
    if (!active.started && Math.hypot(active.x - active.startX, active.y - active.startY) > 6) active.started = true;
    updateDrop();
  };
  const finishPointer = (event: PointerEvent<HTMLDivElement>, commit: boolean) => {
    hold.current.end(event.pointerId);
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (commit) { active.x = event.clientX; active.y = event.clientY; updateDrop(); }
    const position = active.position;
    cancelDrag();
    if (commit && active.started && position !== undefined && position !== active.from) onReorder?.(active.key, position);
  };
  useEffect(() => {
    const gesture = hold.current;
    const cancel = () => {
      gesture.cancel(); const active = drag.current; drag.current = null; setDrop(null);
      if (active && container.current?.hasPointerCapture(active.pointerId)) container.current.releasePointerCapture(active.pointerId);
    };
    const otherPointer = (event: globalThis.PointerEvent) => { if (!event.isPrimary) cancel(); };
    const end = (event: globalThis.PointerEvent) => gesture.end(event.pointerId);
    if (typeof window !== "undefined") {
      window.addEventListener("pointerdown", otherPointer, true);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("blur", cancel);
    }
    return () => {
      gesture.cancel(); drag.current = null;
      if (typeof window !== "undefined") {
        window.removeEventListener("pointerdown", otherPointer, true);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("blur", cancel);
      }
    };
  }, []);
  useEffect(() => {
    if (!drop) return;
    let frame = 0;
    const tick = () => {
      const element = container.current, active = drag.current;
      if (!element || !active) return;
      const rect = element.getBoundingClientRect();
      // Only this explicit handle drag may write scrollTop; ordinary swipes stay native.
      const speed = active.x >= rect.left && active.x <= rect.right ? galleryDragScrollSpeed(active.y, rect.top, rect.bottom) : 0;
      if (speed) element.scrollTop += speed;
      updateDrop(); frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // A gesture uses live refs and DOM positions as the virtual rows change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drop?.key, total]);
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
    const previous = restoration.current;
    const reflow = !!previous && (previous.columns !== geometry.columns || previous.rowHeight !== geometry.rowHeight || previous.header !== bounds.header);
    restoration.current = { view, columns: geometry.columns, rowHeight: geometry.rowHeight, header: bounds.header, filterKey };
    if (previous && !reflow && previous.filterKey === filterKey && (previous.view === view || nativeViews.current.has(view))) return;
    const position = reflow && previous?.filterKey === filterKey && nativeViews.current.has(view) ? latestNativeView.current ?? view : view;
    const anchor = position.anchor;
    const index = anchor ? packed.findIndex(row => row.some(item => item.row.photo.blobKey === anchor)) : -1;
    const top = index >= 0 ? bounds.header + index * geometry.rowHeight + (position.anchorOffset ?? 0) : position.scrollTop;
    // Even a same-value assignment can interrupt native touch momentum. Restore
    // only for opening, actual row reflow, or an explicit filter/scroll reset.
    if (Math.abs(element.scrollTop - top) > 0.5) element.scrollTop = top;
    restored.current = true;
    // Preview hydration changes row objects without requesting a restoration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds.width, bounds.height, bounds.header, geometry.columns, geometry.rowHeight, filterKey, view]);
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
  return <div className="library-gallery-scroll" ref={container} tabIndex={0} aria-label="Project photos. Use Page Up and Page Down to browse."
    onPointerMove={movePointer} onPointerUp={event => finishPointer(event, true)} onPointerCancel={event => finishPointer(event, false)}
    onLostPointerCapture={event => { if (drag.current?.pointerId === event.pointerId) cancelDrag(); }}
    onKeyDown={event => { if (event.key === "Escape" && drag.current) { event.preventDefault(); event.stopPropagation(); cancelDrag(); } }}
    onScroll={event => {
    hold.current.cancel();
    if (!restored.current || !event.currentTarget.getClientRects().length) return;
    const top = event.currentTarget.scrollTop, anchor = galleryScrollAnchor(top, geometry.rowHeight, bounds.header);
    const next = { ...view, scrollTop: top, anchor: anchor ? packed[anchor.index]?.[0]?.row.photo.blobKey : undefined, anchorOffset: anchor?.offset };
    nativeViews.current.add(next); latestNativeView.current = next;
    onView(next);
  }}>
    <div ref={heading}>{header}</div>
    {!rows.length ? empty ?? <p className="library-empty">No photos match. Clear filters to see the whole library, including unavailable photos.</p> : null}
    <div style={{ height: range.start * geometry.rowHeight }} aria-hidden="true" />
    {visible.map((items, offset) => <div key={range.start + offset} className="library-gallery-row"
      style={{ height: geometry.rowHeight, gridTemplateColumns: `repeat(${geometry.columns}, minmax(0, 1fr))` }}>
      {items.map(({ row, span }) => <div key={row.photo.blobKey} data-photo-card-key={row.photo.blobKey} data-custom-position={row.customPosition}
        className="library-photo-card library-photo-card-controls" style={{ gridColumn: `span ${span}` }}
        data-selected={onToggleSelected ? !!selectedKeys?.has(row.photo.blobKey) : undefined}
        data-dragging={drop?.key === row.photo.blobKey || undefined}
        data-drop={drop?.targetKey === row.photo.blobKey && drop.key !== row.photo.blobKey ? (drop.after ? "after" : "before") : undefined}>
        <button data-photo-key={row.photo.blobKey} type="button" className="library-photo-open"
        aria-pressed={onToggleSelected ? !!selectedKeys?.has(row.photo.blobKey) : undefined}
        aria-label={`${onToggleSelected ? "Select" : "Open"} ${row.photo.sourceName ?? "photo"}${row.labels?.length ? `. Labels: ${row.labels.join(", ")}` : ""}`}
        onPointerDown={event => {
          if (onStartSelecting) hold.current.begin(event, row.photo.blobKey, onStartSelecting);
        }}
        onPointerLeave={event => { if (event.pointerType === "mouse") hold.current.cancel(); }}
        onContextMenu={event => { if (hold.current.shouldSuppressContextMenu(row.photo.blobKey)) event.preventDefault(); }}
        onDragStart={event => event.preventDefault()}
        onClick={event => {
          if (event.detail !== 0 && hold.current.consumeClick(row.photo.blobKey)) { event.preventDefault(); return; }
          (onToggleSelected ?? onInspect)(row.photo.blobKey);
        }}>
        <span className="library-photo-image">{snapshot.get(row.photo.blobKey)?.previewUrl ? <Image unoptimized src={snapshot.get(row.photo.blobKey)!.previewUrl}
          alt={row.photo.sourceName ?? "Project photo"} width={640} height={640} draggable={false} /> : <span>Awaiting preview</span>}
          {row.photo.rank ? <span className="library-photo-rank" data-rank={row.photo.rank}>{PHOTO_RANK_LABELS[row.photo.rank]}</span> : null}
          {row.labels?.length ? <PhotoLabelBadges labels={row.labels} /> : null}
          {onToggleSelected ? <span className="library-photo-selection" aria-hidden="true">{selectedKeys?.has(row.photo.blobKey) ? selectionOrder?.get(row.photo.blobKey) ?? "✓" : ""}</span> : null}
        </span>
        <span className="library-photo-caption"><span className="library-photo-name" title={row.photo.sourceName}>{row.photo.sourceName ?? "Photo"}</span>
          <span className="library-photo-usage">{row.uses ? `Used ${row.uses}×` : "Unused"}</span></span>
        </button>
        {showPreviewButtons ? <button type="button" className="library-photo-preview" aria-label={`Preview ${row.photo.sourceName ?? "photo"}`}
          onClick={() => onInspect(row.photo.blobKey)}>Preview</button> : null}
        {customOrder ? <div className="library-photo-order-controls">
          <button type="button" className="library-photo-drag" aria-label={`Drag to reorder ${row.photo.sourceName ?? "photo"}`}
            title="Drag to reorder. You can also type a position." onPointerDown={event => {
              hold.current.cancel();
              if (!event.isPrimary || event.button !== 0) { cancelDrag(); return; }
              event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
              drag.current = { pointerId: event.pointerId, key: row.photo.blobKey, from: row.customPosition,
                startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, started: false };
              container.current?.setPointerCapture(event.pointerId);
            }}><span aria-hidden="true">⠿</span></button>
          <PhotoPositionInput position={row.customPosition} total={total} name={row.photo.sourceName ?? "photo"}
            onCommit={position => onReorder?.(row.photo.blobKey, position)} />
        </div> : null}
      </div>)}
    </div>)}
    <div style={{ height: Math.max(0, packed.length - range.end) * geometry.rowHeight }} aria-hidden="true" />
    <span className="library-order-announcement" role="status" aria-live="polite">{drop?.position ? `Move to position ${drop.position} of ${total}` : ""}</span>
  </div>;
}
