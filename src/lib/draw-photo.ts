import { coverPlacement } from "./crop";
import type { CropState, ResolvedFrame } from "./types";

/** Called inside the existing frame clip by editor, thumbnails and export. */
export function drawCroppedPhoto(context: CanvasRenderingContext2D, image: CanvasImageSource,
  width: number, height: number, frame: ResolvedFrame, crop: CropState, background: string): void {
  const placement = coverPlacement(width, height, frame, crop);
  // Underlapping frames must not show through newly exposed space. Leave
  // legacy >= 1 rendering (including transparent originals) unchanged.
  if (crop.zoom < 1) {
    context.fillStyle = background;
    context.fillRect(frame.x, frame.y, frame.width, frame.height);
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, placement.x, placement.y, placement.width, placement.height);
}
