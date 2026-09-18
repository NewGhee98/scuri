import type { ResolvedFrame } from "./types";

/** Editor-only overlay, fixed to the frame rather than the crop's image bounds. */
export function drawCompositionGuides(context: CanvasRenderingContext2D, frame: ResolvedFrame): void {
  const { x, y, width, height } = frame;
  const cx = x + width / 2, cy = y + height / 2;
  const arm = Math.min(9, width / 12, height / 12);
  context.save();
  context.beginPath(); context.roundRect(x, y, width, height, frame.cornerRadius); context.clip();
  context.setLineDash([]);
  context.beginPath();
  for (const fraction of [1 / 3, 2 / 3]) {
    context.moveTo(x + width * fraction, y); context.lineTo(x + width * fraction, y + height);
    context.moveTo(x, y + height * fraction); context.lineTo(x + width, y + height * fraction);
  }
  context.moveTo(cx - arm, cy); context.lineTo(cx + arm, cy);
  context.moveTo(cx, cy - arm); context.lineTo(cx, cy + arm);
  // A dark under-stroke keeps the fine light lines visible on bright photos.
  context.strokeStyle = "rgba(0, 0, 0, 0.5)"; context.lineWidth = 2.5; context.stroke();
  context.strokeStyle = "rgba(255, 255, 255, 0.9)"; context.lineWidth = 1; context.stroke();
  context.restore();
}
