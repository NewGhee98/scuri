import type { NormalizedFrame } from "./types";

export type ResizeHandle = "nw" | "ne" | "sw" | "se";

const MIN_SIZE = 0.045;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Resize a template frame from a corner. Centre-anchored resizing changes the
 * opposite edge by the same amount, so the frame's centre stays in place.
 */
export function resizeFrame(
  frame: NormalizedFrame,
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number,
  fromCenter: boolean,
): NormalizedFrame {
  if (fromCenter) {
    const centreX = frame.x + frame.width / 2;
    const centreY = frame.y + frame.height / 2;
    const widthDelta = handle.includes("e") ? deltaX * 2 : -deltaX * 2;
    const heightDelta = handle.includes("s") ? deltaY * 2 : -deltaY * 2;
    let width = clamp(frame.width + widthDelta, MIN_SIZE, Math.min(centreX, 1 - centreX) * 2);
    let height = clamp(frame.height + heightDelta, MIN_SIZE, Math.min(centreY, 1 - centreY) * 2);

    if (frame.aspectRatioLocked) {
      const ratio = frame.width / frame.height;
      if (Math.abs(deltaX) >= Math.abs(deltaY)) {
        width = clamp(width, MIN_SIZE, Math.min(centreX, 1 - centreX, (centreY * ratio), ((1 - centreY) * ratio)) * 2);
        height = width / ratio;
      } else {
        height = clamp(height, MIN_SIZE, Math.min(centreY, 1 - centreY, centreX / ratio, (1 - centreX) / ratio) * 2);
        width = height * ratio;
      }
    }

    return { ...frame, x: centreX - width / 2, y: centreY - height / 2, width, height };
  }

  let left = frame.x;
  let top = frame.y;
  let right = frame.x + frame.width;
  let bottom = frame.y + frame.height;
  if (handle.includes("w")) left = clamp(frame.x + deltaX, 0, right - MIN_SIZE);
  if (handle.includes("e")) right = clamp(frame.x + frame.width + deltaX, left + MIN_SIZE, 1);
  if (handle.includes("n")) top = clamp(frame.y + deltaY, 0, bottom - MIN_SIZE);
  if (handle.includes("s")) bottom = clamp(frame.y + frame.height + deltaY, top + MIN_SIZE, 1);
  if (frame.aspectRatioLocked) {
    const ratio = frame.width / frame.height;
    const width = right - left;
    const height = bottom - top;
    if (Math.abs(deltaX) >= Math.abs(deltaY)) {
      const adjustedHeight = width / ratio;
      if (handle.includes("n")) top = clamp(bottom - adjustedHeight, 0, bottom - MIN_SIZE);
      else bottom = clamp(top + adjustedHeight, top + MIN_SIZE, 1);
    } else {
      const adjustedWidth = height * ratio;
      if (handle.includes("w")) left = clamp(right - adjustedWidth, 0, right - MIN_SIZE);
      else right = clamp(left + adjustedWidth, left + MIN_SIZE, 1);
    }
  }
  return { ...frame, x: left, y: top, width: right - left, height: bottom - top };
}
