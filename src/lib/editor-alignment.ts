import { coverPlacement, MAX_ZOOM, MIN_ZOOM, setCropZoom, withFreePosition } from "./crop";
import type { CropState, PhotoAsset, ResolvedFrame } from "./types";

export type AlignmentGuide = { axis: "x" | "y"; value: number };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Edges of the image after clipping to its frame, not the uncropped source. */
export function visiblePhotoBounds(photo: Pick<PhotoAsset, "sourceWidth" | "sourceHeight" | "crop">, frame: ResolvedFrame) {
  const image = coverPlacement(photo.sourceWidth, photo.sourceHeight, frame, photo.crop);
  return { left: Math.max(frame.x, image.x), right: Math.min(frame.x + frame.width, image.x + image.width),
    top: Math.max(frame.y, image.y), bottom: Math.min(frame.y + frame.height, image.y + image.height) };
}

/** Snap the raw, accumulated gesture offset, never the prior snapped output. */
export function snapPhotoPosition(crop: CropState, frame: ResolvedFrame, tolerance: number): { crop: CropState; guides: AlignmentGuide[] } {
  if (!crop.freePosition || tolerance < 0) return { crop, guides: [] };
  const { x, y } = crop.freePosition, guides: AlignmentGuide[] = [];
  const snapX = Math.abs(x * frame.width) <= tolerance, snapY = Math.abs(y * frame.height) <= tolerance;
  if (snapX) guides.push({ axis: "x", value: frame.x + frame.width / 2 });
  if (snapY) guides.push({ axis: "y", value: frame.y + frame.height / 2 });
  return { crop: { ...crop, freePosition: { x: snapX ? 0 : x, y: snapY ? 0 : y } }, guides };
}

/** Always use the raw gesture value. Feeding the snapped result back into the
 * gesture would make small wheel/pointer movements stick at a snap point. */
export function snapPhotoZoom(photos: Record<string, Pick<PhotoAsset, "sourceWidth" | "sourceHeight" | "crop">>, frames: ResolvedFrame[], frameId: string,
  rawZoom: number, tolerance: number, minimum = MIN_ZOOM): { crop: CropState; guides: AlignmentGuide[] } | null {
  const photo = photos[frameId], frame = frames.find(item => item.id === frameId);
  if (!photo || !frame || photo.sourceWidth <= 0 || photo.sourceHeight <= 0 || !Number.isFinite(rawZoom)) return null;
  const crop = setCropZoom(withFreePosition(photo.sourceWidth, photo.sourceHeight, frame, photo.crop), clamp(rawZoom, minimum, MAX_ZOOM));
  const baseline = coverPlacement(photo.sourceWidth, photo.sourceHeight, frame, { ...crop, zoom: 1, positionX: 0, positionY: 0 });
  const visible = visiblePhotoBounds({ ...photo, crop }, frame);
  if (visible.left >= visible.right || visible.top >= visible.bottom) return { crop, guides: [] };
  const candidates: Array<{ zoom: number; distance: number; guide: AlignmentGuide }> = [];
  for (const other of frames) {
    const target = photos[other.id];
    if (other.id === frameId || !target || target.sourceWidth <= 0 || target.sourceHeight <= 0) continue;
    const bounds = visiblePhotoBounds(target, other);
    if (bounds.left >= bounds.right || bounds.top >= bounds.bottom) continue;
    for (const axis of ["x", "y"] as const) {
      const extent = axis === "x" ? baseline.width : baseline.height;
      const frameExtent = axis === "x" ? frame.width : frame.height;
      const start = axis === "x" ? frame.x : frame.y;
      const center = start + frameExtent * (0.5 + crop.freePosition![axis]);
      const edges = axis === "x" ? [bounds.left, bounds.right] : [bounds.top, bounds.bottom];
      for (const side of [-1, 1]) for (const edge of edges) {
        const zoom = (edge - center) * 2 / (side * extent);
        const rawEdge = center + side * extent * crop.zoom / 2;
        const distance = Math.abs(rawEdge - edge);
        if (zoom >= minimum && zoom <= MAX_ZOOM && edge >= start && edge <= start + frameExtent &&
            rawEdge >= start - tolerance - 1e-8 && rawEdge <= start + frameExtent + tolerance + 1e-8 && distance <= tolerance) {
          candidates.push({ zoom, distance, guide: { axis, value: edge } });
        }
      }
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || Math.abs(a.zoom - crop.zoom) - Math.abs(b.zoom - crop.zoom));
  const nearest = candidates[0];
  if (!nearest) return { crop, guides: [] };
  return { crop: setCropZoom(crop, nearest.zoom),
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
