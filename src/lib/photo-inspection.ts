/** Only a short, stationary, single-pointer gesture hides the viewer controls. */
export function inspectionGesture(dx: number, dy: number, elapsed: number, moved: number, zoom: number): "toggle" | "previous" | "next" | null {
  if (elapsed < 400 && moved < 8) return "toggle";
  if (zoom <= 1 && Math.abs(dy) < 60) {
    if (dx > 70) return "previous";
    if (dx < -70) return "next";
  }
  return null;
}
