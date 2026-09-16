import { coverPlacement, MAX_ZOOM, MIN_ZOOM, setCropZoom } from "./crop";
import type { CropState, PhotoAsset, ResolvedFrame } from "./types";

export type AlignmentGuide = { axis: "x" | "y"; value: number };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Edges of the image after clipping to its frame, not the uncropped source. */
export function visiblePhotoBounds(photo: Pick<PhotoAsset, "sourceWidth" | "sourceHeight" | "crop">, frame: ResolvedFrame) {
  const image = coverPlacement(photo.sourceWidth, photo.sourceHeight, frame, photo.crop);
  return { left: Math.max(frame.x, image.x), right: Math.min(frame.x + frame.width, image.x + image.width),
    top: Math.max(frame.y, image.y), bottom: Math.min(frame.y + frame.height, image.y + image.height) };
}

/** Always use the raw gesture value. Feeding the snapped result back into the
 * gesture would make small wheel/pointer movements stick at a snap point. */
export function snapPhotoZoom(photos: Record<string, PhotoAsset>, frames: ResolvedFrame[], frameId: string,
  rawZoom: number, tolerance: number, minimum = MIN_ZOOM): { crop: CropState; guides: AlignmentGuide[] } | null {
  const photo = photos[frameId], frame = frames.find(item => item.id === frameId);
  if (!photo || !frame || photo.sourceWidth <= 0 || photo.sourceHeight <= 0 || !Number.isFinite(rawZoom)) return null;
  const crop = setCropZoom(photo.crop, clamp(rawZoom, minimum, MAX_ZOOM));
  if (crop.zoom > 1) return { crop, guides: [] }; // A covered frame has no moving visible image edge.
  const baseline = coverPlacement(photo.sourceWidth, photo.sourceHeight, frame, { ...crop, zoom: 1, positionX: 0, positionY: 0 });
  const candidates: Array<{ zoom: number; distance: number; guide: AlignmentGuide }> = [];
  for (const other of frames) {
    const target = photos[other.id];
    if (other.id === frameId || !target || target.sourceWidth <= 0 || target.sourceHeight <= 0) continue;
    const bounds = visiblePhotoBounds(target, other);
    for (const axis of ["x", "y"] as const) {
      const extent = axis === "x" ? baseline.width : baseline.height;
      const frameExtent = axis === "x" ? frame.width : frame.height;
      const center = (axis === "x" ? frame.x : frame.y) + frameExtent / 2;
      const edges = axis === "x" ? [bounds.left, bounds.right] : [bounds.top, bounds.bottom];
      for (const side of [-1, 1]) for (const edge of edges) {
        const zoom = (edge - center) * 2 / (side * extent);
        const distance = Math.abs(center + side * extent * crop.zoom / 2 - edge);
        if (zoom >= minimum && zoom <= 1 && extent * zoom <= frameExtent + 1e-8 && distance <= tolerance) {
          candidates.push({ zoom, distance, guide: { axis, value: edge } });
        }
      }
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || Math.abs(a.zoom - crop.zoom) - Math.abs(b.zoom - crop.zoom));
  const nearest = candidates[0];
  if (!nearest) return { crop, guides: [] };
  return { crop: setCropZoom(photo.crop, nearest.zoom),
    guides: candidates.filter(item => Math.abs(item.zoom - nearest.zoom) < 1e-9).map(item => item.guide) };
}

export function snapFramePosition(frame: ResolvedFrame, frames: ResolvedFrame[], rawX: number, rawY: number,
  canvasWidth: number, canvasHeight: number, tolerance: number): { x: number; y: number; guides: AlignmentGuide[] } {
  let x = clamp(rawX, 0, Math.max(0, canvasWidth - frame.width));
  let y = clamp(rawY, 0, Math.max(0, canvasHeight - frame.height));
  const guides: AlignmentGuide[] = [];
  for (const axis of ["x", "y"] as const) {
    const start = axis === "x" ? x : y, extent = axis === "x" ? frame.width : frame.height;
    const limit = axis === "x" ? canvasWidth : canvasHeight;
    const targets = [0, limit, ...frames.filter(item => item.id !== frame.id).flatMap(item =>
      axis === "x" ? [item.x, item.x + item.width] : [item.y, item.y + item.height])];
    let best: { delta: number; value: number } | undefined;
    for (const edge of [start, start + extent]) for (const target of targets) {
      const delta = target - edge;
      if (Math.abs(delta) <= tolerance && start + delta >= -1e-8 && start + delta + extent <= limit + 1e-8 &&
          (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, value: target };
    }
    if (best) {
      if (axis === "x") x = clamp(x + best.delta, 0, Math.max(0, limit - extent));
      else y = clamp(y + best.delta, 0, Math.max(0, limit - extent));
      guides.push({ axis, value: best.value });
    }
  }
  return { x, y, guides };
}

/** Invalid/unfinished input never becomes a crop or a silently clamped value. */
export function parseZoomPercent(text: string, minimum: number): number | null {
  const value = text.trim().replace(/%$/, "").trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return null;
  const zoom = (100 + Number(value)) / 100;
  return Number.isFinite(zoom) && zoom >= minimum && zoom <= MAX_ZOOM && zoom > 0 ? zoom : null;
}
