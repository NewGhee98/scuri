export const PHOTO_HOLD_DELAY = 500;
const HOLD_MOVEMENT = 10;

type HoldPointer = { pointerId: number; clientX: number; clientY: number; isPrimary: boolean; button: number };

/** Observe a hold without capturing the pointer or preventing native scrolling. */
export function createPhotoHoldGesture() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { pointerId: number; x: number; y: number } | undefined;
  let suppressedKey: string | undefined;
  const cancel = () => { clearTimeout(timer); timer = undefined; pending = undefined; };
  return {
    begin(event: HoldPointer, key: string, onHold: (key: string) => void) {
      const alreadyHolding = !!pending;
      cancel();
      if (!event.isPrimary || event.button !== 0) return;
      suppressedKey = undefined;
      if (alreadyHolding) return;
      pending = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      timer = setTimeout(() => { timer = undefined; suppressedKey = key; onHold(key); }, PHOTO_HOLD_DELAY);
    },
    move(event: Pick<HoldPointer, "pointerId" | "clientX" | "clientY">) {
      if (pending && (pending.pointerId !== event.pointerId || Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > HOLD_MOVEMENT)) cancel();
    },
    end(pointerId: number) { if (pending?.pointerId === pointerId) cancel(); },
    cancel,
    consumeClick(key: string) {
      if (suppressedKey !== key) return false;
      suppressedKey = undefined;
      return true;
    },
    shouldSuppressContextMenu(key: string) { return !!pending || suppressedKey === key; },
  };
}

/** Translate a drop beside a visible photo to its position in the whole library. */
export function photoDropPosition(source: number, target: number, after: boolean, total: number): number {
  if (source === target) return source;
  return Math.max(1, Math.min(total, target - (source < target ? 1 : 0) + (after ? 1 : 0)));
}

export function galleryDragScrollSpeed(pointerY: number, top: number, bottom: number): number {
  const edge = Math.min(72, Math.max(0, (bottom - top) / 4));
  if (!edge) return 0;
  if (pointerY < top + edge) return -14 * Math.min(1, (top + edge - pointerY) / edge);
  if (pointerY > bottom - edge) return 14 * Math.min(1, (pointerY - bottom + edge) / edge);
  return 0;
}
