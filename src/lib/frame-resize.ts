import type { NormalizedFrame } from "./types";

export type ResizeHandle = "nw" | "ne" | "sw" | "se";

// The smallest template thumbnail is 180px wide for a 1080px reference canvas.
// Six reference pixels keep both axes above its existing one-pixel render floor.
export const MIN_FRAME_PIXELS = 6;

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
  canvas = { width: 1080, height: 1350 },
): NormalizedFrame {
  const minWidth = MIN_FRAME_PIXELS / canvas.width, minHeight = MIN_FRAME_PIXELS / canvas.height;
  if (frame.aspectRatioLocked) {
    // Clamp one shared factor, never the two dimensions independently at a bound.
    const multiplier = fromCenter ? 2 : 1;
    const widthDelta = (handle.includes("e") ? deltaX : -deltaX) * multiplier;
    const heightDelta = (handle.includes("s") ? deltaY : -deltaY) * multiplier;
    const requested = Math.abs(deltaX * canvas.width) >= Math.abs(deltaY * canvas.height)
      ? (frame.width + widthDelta) / frame.width : (frame.height + heightDelta) / frame.height;
    const centreX = frame.x + frame.width / 2, centreY = frame.y + frame.height / 2;
    const maxWidth = fromCenter ? Math.min(centreX, 1 - centreX) * 2 : handle.includes("e") ? 1 - frame.x : frame.x + frame.width;
    const maxHeight = fromCenter ? Math.min(centreY, 1 - centreY) * 2 : handle.includes("s") ? 1 - frame.y : frame.y + frame.height;
    const factor = clamp(requested, Math.max(minWidth / frame.width, minHeight / frame.height), Math.min(maxWidth / frame.width, maxHeight / frame.height));
    const width = frame.width * factor, height = frame.height * factor;
    return { ...frame, width, height,
      x: fromCenter ? centreX - width / 2 : handle.includes("w") ? frame.x + frame.width - width : frame.x,
      y: fromCenter ? centreY - height / 2 : handle.includes("n") ? frame.y + frame.height - height : frame.y };
  }
  if (fromCenter) {
    const centreX = frame.x + frame.width / 2;
    const centreY = frame.y + frame.height / 2;
    const widthDelta = handle.includes("e") ? deltaX * 2 : -deltaX * 2;
    const heightDelta = handle.includes("s") ? deltaY * 2 : -deltaY * 2;
    const width = clamp(frame.width + widthDelta, minWidth, Math.min(centreX, 1 - centreX) * 2);
    const height = clamp(frame.height + heightDelta, minHeight, Math.min(centreY, 1 - centreY) * 2);

    return { ...frame, x: centreX - width / 2, y: centreY - height / 2, width, height };
  }

  let left = frame.x;
  let top = frame.y;
  let right = frame.x + frame.width;
  let bottom = frame.y + frame.height;
  if (handle.includes("w")) left = clamp(frame.x + deltaX, 0, right - minWidth);
  if (handle.includes("e")) right = clamp(frame.x + frame.width + deltaX, left + minWidth, 1);
  if (handle.includes("n")) top = clamp(frame.y + deltaY, 0, bottom - minHeight);
  if (handle.includes("s")) bottom = clamp(frame.y + frame.height + deltaY, top + minHeight, 1);
  return { ...frame, x: left, y: top, width: right - left, height: bottom - top };
}
