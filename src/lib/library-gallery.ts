import type { LibraryRow, LibraryView } from "./photo-library-view";
export function galleryGeometry(width: number, size: LibraryView["size"]) {
  const target = size === "small" ? 160 : size === "large" ? 320 : 230;
  return { columns: Math.max(1, Math.floor((width + 16) / (target + 16))), rowHeight: target + 100 };
}
export function galleryRows(items: LibraryRow[], columns: number): Array<Array<{ row: LibraryRow; span: number }>> {
  const rows: Array<Array<{ row: LibraryRow; span: number }>> = []; let used = 0;
  for (const row of items) {
    const span = row.orientation === "panorama" ? Math.min(columns, columns <= 3 ? columns : 2) : 1;
    if (!rows.length || used + span > columns) { rows.push([]); used = 0; }
    rows[rows.length - 1].push({ row, span }); used += span;
  }
  return rows;
}
export function visibleGalleryRange(scrollTop: number, height: number, rowHeight: number, count: number, headerHeight = 0) {
  const top = Math.max(0, scrollTop - headerHeight), bottom = Math.max(0, scrollTop + height - headerHeight);
  const overscan = Math.ceil(height / rowHeight);
  return { start: Math.max(0, Math.min(count, Math.floor(top / rowHeight) - overscan)),
    end: Math.min(count, Math.ceil(bottom / rowHeight) + overscan) };
}

/** Scroll anchors refer to photo rows, independent of the scrolling toolbar's height. */
export function galleryScrollAnchor(scrollTop: number, rowHeight: number, headerHeight: number) {
  if (scrollTop < headerHeight) return undefined;
  const top = scrollTop - headerHeight;
  return { index: Math.floor(top / rowHeight), offset: top % rowHeight };
}
