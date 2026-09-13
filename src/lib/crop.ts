import type { CropState, NormalizedFrame, ResolvedFrame, TemplateDefinition } from "./types";

export const DEFAULT_CROP: CropState = { positionX: 0, positionY: 0, zoom: 1 };
// Stored zoom remains a scale factor: 1 is the historic fill-frame baseline.
export const MIN_ZOOM = Number.EPSILON;
export const MAX_ZOOM = 4;

export const zoomPercent = (zoom: number): number => (zoom - 1) * 100;

/** The slider always extends beyond contain-size, even for extreme panoramas. */
export function minimumPhotoZoom(width: number, height: number, frame: ResolvedFrame): number {
  const cover = Math.max(frame.width / width, frame.height / height);
  const contain = Math.min(frame.width / width, frame.height / height);
  return Math.max(MIN_ZOOM, Math.min(0.1, contain / cover / 4));
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function resolveFrames(
  template: TemplateDefinition,
  gutter: number,
  canvasWidth = template.canvasWidth,
  canvasHeight = template.canvasHeight,
): ResolvedFrame[] {
  const scaleX = canvasWidth / template.canvasWidth;
  const scaledGutter = gutter * scaleX;
  const multiplier = template.frameInsetMultiplier ?? 1;
  const innerInset = (scaledGutter * multiplier) / 2;
  const outerInset = (scaledGutter * (template.outerInsetMultiplier ?? multiplier)) / 2;

  return template.frames.map((item: NormalizedFrame) => {
    const cellX = item.x * canvasWidth;
    const cellY = item.y * canvasHeight;
    const cellWidth = item.width * canvasWidth;
    const cellHeight = item.height * canvasHeight;
    const leftInset = item.x === 0 ? outerInset : innerInset;
    const rightInset = item.x + item.width === 1 ? outerInset : innerInset;
    const topInset = item.y === 0 ? outerInset : innerInset;
    const bottomInset = item.y + item.height === 1 ? outerInset : innerInset;
    const width = Math.max(1, cellWidth - leftInset - rightInset);
    const height = Math.max(1, cellHeight - topInset - bottomInset);
    return {
      id: item.id,
      x: cellX + leftInset,
      y: cellY + topInset,
      width,
      height,
      cornerRadius: Math.min(Math.max(0, item.cornerRadius ?? 0), 0.5) * Math.min(
        width,
        height,
      ),
    };
  });
}

export interface CoverPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  overflowX: number;
  overflowY: number;
}

export function coverPlacement(
  sourceWidth: number,
  sourceHeight: number,
  target: ResolvedFrame,
  crop: CropState,
): CoverPlacement {
  if (sourceWidth <= 0 || sourceHeight <= 0 || target.width <= 0 || target.height <= 0) {
    throw new Error("Image and frame dimensions must be positive.");
  }
  const zoom = clamp(crop.zoom, MIN_ZOOM, MAX_ZOOM);
  const scale = Math.max(target.width / sourceWidth, target.height / sourceHeight) * zoom;
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  const overflowX = Math.max(0, width - target.width);
  const overflowY = Math.max(0, height - target.height);
  const positionX = zoom < 1 ? 0 : clamp(crop.positionX, -1, 1);
  const positionY = zoom < 1 ? 0 : clamp(crop.positionY, -1, 1);

  return {
    x: target.x + (target.width - width) / 2 + (positionX * overflowX) / 2,
    y: target.y + (target.height - height) / 2 + (positionY * overflowY) / 2,
    width,
    height,
    scale,
    overflowX,
    overflowY,
  };
}

export function moveCrop(
  sourceWidth: number,
  sourceHeight: number,
  target: ResolvedFrame,
  crop: CropState,
  deltaX: number,
  deltaY: number,
): CropState {
  if (crop.zoom < 1) return { positionX: 0, positionY: 0, zoom: clamp(crop.zoom, MIN_ZOOM, MAX_ZOOM) };
  const placement = coverPlacement(sourceWidth, sourceHeight, target, crop);
  return {
    zoom: clamp(crop.zoom, MIN_ZOOM, MAX_ZOOM),
    positionX: placement.overflowX > 0 ? clamp(crop.positionX + (2 * deltaX) / placement.overflowX, -1, 1) : 0,
    positionY: placement.overflowY > 0 ? clamp(crop.positionY + (2 * deltaY) / placement.overflowY, -1, 1) : 0,
  };
}

export function setCropZoom(crop: CropState, zoom: number): CropState {
  return {
    positionX: zoom < 1 ? 0 : clamp(crop.positionX, -1, 1),
    positionY: zoom < 1 ? 0 : clamp(crop.positionY, -1, 1),
    zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM),
  };
}
