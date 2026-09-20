/** Screen-only geometry. Never serialize this state or pass it to a renderer. */
export interface ViewSize { width: number; height: number }
export interface ViewPoint { x: number; y: number }
export interface CanvasView extends ViewPoint { scale: number; fit: boolean }
export const MAX_VIEW_SCALE = 4;
export const VIEW_PADDING = 24;

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export function fitCanvas(stage: ViewSize, content: ViewSize): CanvasView {
  const scale = Math.min(MAX_VIEW_SCALE, Math.max(1, stage.width - VIEW_PADDING * 2) / content.width,
    Math.max(1, stage.height - VIEW_PADDING * 2) / content.height);
  return { scale, x: (stage.width - content.width * scale) / 2, y: (stage.height - content.height * scale) / 2, fit: true };
}

export function constrainView(view: CanvasView, stage: ViewSize, content: ViewSize): CanvasView {
  const position = (offset: number, available: number, length: number) => length <= available - VIEW_PADDING * 2
    ? (available - length) / 2 : clamp(offset, available - length - VIEW_PADDING, VIEW_PADDING);
  return { ...view, x: position(view.x, stage.width, content.width * view.scale), y: position(view.y, stage.height, content.height * view.scale) };
}

export function zoomCanvas(view: CanvasView, scale: number, anchor: ViewPoint, stage: ViewSize, content: ViewSize, destination = anchor): CanvasView {
  if (!Number.isFinite(scale)) return view;
  const next = clamp(scale, Math.min(.1, fitCanvas(stage, content).scale), MAX_VIEW_SCALE);
  return constrainView({ scale: next, x: destination.x - (anchor.x - view.x) * next / view.scale,
    y: destination.y - (anchor.y - view.y) * next / view.scale, fit: false }, stage, content);
}

export function panCanvas(view: CanvasView, dx: number, dy: number, stage: ViewSize, content: ViewSize): CanvasView {
  return constrainView({ ...view, x: view.x + dx, y: view.y + dy, fit: false }, stage, content);
}

export function resizeViewport(view: CanvasView, previous: ViewSize, stage: ViewSize, content: ViewSize): CanvasView {
  return view.fit ? fitCanvas(stage, content) : zoomCanvas(view, view.scale,
    { x: previous.width / 2, y: previous.height / 2 }, stage, content, { x: stage.width / 2, y: stage.height / 2 });
}

/** Use the transformed DOM bounds, not offsetX or unscaled movementX. */
export function pointInCanvas(point: { clientX: number; clientY: number }, rect: { left: number; top: number; width: number; height: number }, content: ViewSize): ViewPoint {
  return { x: (point.clientX - rect.left) * content.width / rect.width, y: (point.clientY - rect.top) * content.height / rect.height };
}

export class CanvasNavigationGesture {
  readonly pointers = new Map<number, ViewPoint>();
  down(id: number, point: ViewPoint) { if (this.pointers.size < 2) this.pointers.set(id, point); }
  end(id: number) { this.pointers.delete(id); }
  cancel() { this.pointers.clear(); }
  move(id: number, point: ViewPoint, view: CanvasView, stage: ViewSize, content: ViewSize): CanvasView {
    const old = this.pointers.get(id);
    if (!old || (old.x === point.x && old.y === point.y)) return view;
    const before = [...this.pointers.values()];
    this.pointers.set(id, point);
    const after = [...this.pointers.values()];
    if (after.length === 1) return panCanvas(view, point.x - old.x, point.y - old.y, stage, content);
    const centre = ([a, b]: ViewPoint[]) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const distance = ([a, b]: ViewPoint[]) => Math.hypot(b.x - a.x, b.y - a.y);
    return zoomCanvas(view, view.scale * Math.max(1, distance(after)) / Math.max(1, distance(before)), centre(before), stage, content, centre(after));
  }
}
