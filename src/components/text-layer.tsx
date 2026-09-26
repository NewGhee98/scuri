"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { drawTextLayers, ensureTextFonts, layoutText, moveTextBox } from "@/lib/text";
import { pointInCanvas } from "@/lib/canvas-viewport";
import type { TemplateDefinition, TextBox } from "@/lib/types";

export const EMPTY_TEXT: TextBox[] = [];

/** Draft UI changes never reach autosave or Undo until the action finishes. */
export function useTextEditing(source: TextBox[] | undefined, onCommit: (boxes: TextBox[]) => void) {
  const original = source ?? EMPTY_TEXT;
  const [draft, setDraft] = useState<{ source: TextBox[]; boxes: TextBox[] } | null>(null);
  const latest = useRef<{ source: TextBox[]; boxes: TextBox[] } | null>(null);
  const boxes = draft?.source === original ? draft.boxes : original;
  return { boxes, preview: (next: TextBox[]) => {
      latest.current = { source: original, boxes: next };
      setDraft(latest.current);
    },
    cancel: () => { latest.current = null; setDraft(null); },
    commit: (next?: TextBox[]) => {
      // Native colour/range controls can blur before the preview rerender.
      // Read the latest event value, and never revive a cancelled draft.
      const committed = next ?? (latest.current?.source === original ? latest.current.boxes : original);
      latest.current = null;
      setDraft(null);
      if (JSON.stringify(committed) !== JSON.stringify(original)) onCommit(committed);
    } };
}

export function useTextFonts(boxes: readonly TextBox[], enabled = true) {
  const signature = JSON.stringify(boxes.map(box => [box.font, box.weight, box.italic]));
  const [result, setResult] = useState({ signature: "", ready: false, error: "" });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const request = JSON.parse(signature) as [TextBox["font"], TextBox["weight"], boolean][];
    ensureTextFonts(request.map(([font, weight, italic]) => ({ font, weight, italic, fontSize: 48 }) as TextBox))
      .then(() => { if (!cancelled) setResult({ signature, ready: true, error: "" }); })
      .catch((error: Error) => { if (!cancelled) setResult({ signature, ready: false, error: error.message }); });
    return () => { cancelled = true; };
  }, [signature, enabled, retry]);
  return { ready: !boxes.length || (result.signature === signature && result.ready),
    error: result.signature === signature ? result.error : "", retry: () => setRetry(value => value + 1) };
}

interface TextLayerProps {
  template: Pick<TemplateDefinition, "canvasWidth" | "canvasHeight" | "textLayers">;
  selectedId?: string | null;
  editable?: boolean;
  snap?: boolean;
  onSelect?: (id: string) => void;
  onCommit?: (boxes: TextBox[]) => void;
  cancelKey?: number;
}

/** Canvas pixels for artwork, DOM targets for accessible touch editing. */
export function TextLayer({ template, selectedId, editable = false, snap = true, onSelect, onCommit, cancelKey = 0 }: TextLayerProps) {
  const source = template.textLayers ?? EMPTY_TEXT;
  const [dragged, setDragged] = useState<{ source: TextBox[]; box: TextBox; guides: { axis: "x" | "y"; value: number }[] } | null>(null);
  const drag = useRef<{ pointerId: number; before: TextBox; source: TextBox[]; start: { x: number; y: number }; height: number; element: HTMLElement } | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const movedRef = useRef<TextBox | null>(null);
  const boxes = useMemo(() => dragged?.source === source ? source.map(box => box.id === dragged.box.id ? dragged.box : box) : source, [dragged, source]);
  const fonts = useTextFonts(boxes);
  const [bounds, setBounds] = useState<{ id: string; x: number; y: number; width: number; height: number; overflows: boolean }[]>([]);
  const size = useMemo(() => ({ width: template.canvasWidth, height: template.canvasHeight }), [template.canvasWidth, template.canvasHeight]);

  useEffect(() => {
    const active = drag.current;
    drag.current = null; movedRef.current = null;
    if (active?.element.hasPointerCapture(active.pointerId)) active.element.releasePointerCapture(active.pointerId);
    // Ignore stale draft pixels immediately; cancellation never edits the source.
    queueMicrotask(() => setDragged(null));
  }, [cancelKey, editable, source]);

  useEffect(() => {
    const canvas = canvasRef.current, context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    // Bound preview memory; viewport magnification never requests photo originals.
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size.width * ratio); canvas.height = Math.round(size.height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (!fonts.ready) return;
    drawTextLayers(context, { ...template, textLayers: boxes });
    const next = boxes.map(box => ({ id: box.id, ...layoutText(context, box, size) }));
    // Layout is derived, never saved to the composition.
    queueMicrotask(() => setBounds(next));
  }, [boxes, fonts.ready, size, template]);

  const cancel = () => {
    const active = drag.current; drag.current = null; movedRef.current = null; setDragged(null);
    if (active?.element.hasPointerCapture(active.pointerId)) active.element.releasePointerCapture(active.pointerId);
  };
  const finish = (event: React.PointerEvent) => {
    const active = drag.current;
    if (active?.pointerId !== event.pointerId) return;
    const box = movedRef.current;
    cancel();
    if (box && active.source === source && JSON.stringify(box) !== JSON.stringify(active.before)) {
      onCommit?.(source.map(item => item.id === box.id ? box : item));
    }
  };
  return <div ref={layerRef} className="text-layer" aria-label={editable ? "Text boxes" : undefined}>
    <canvas ref={canvasRef} className="text-artwork" aria-hidden="true" style={{ width: size.width, height: size.height }} />
    {!fonts.ready && source.length ? <div className="text-font-status" role="status">{fonts.error || "Loading text fonts…"}
      {fonts.error ? <button type="button" onClick={fonts.retry}>Retry fonts</button> : null}</div> : null}
    {editable && fonts.ready ? bounds.map(bound => {
      const box = boxes.find(item => item.id === bound.id); if (!box) return null;
      return <button key={box.id} type="button" className={`text-hit-target${box.id === selectedId ? " selected" : ""}`}
        style={{ left: bound.x, top: bound.y, width: bound.width, height: Math.max(1, bound.height) }}
        aria-label={`Move text: ${box.text || "Empty text box"}`} aria-pressed={box.id === selectedId}
        onClick={event => { event.stopPropagation(); onSelect?.(box.id); }}
        onPointerDown={event => {
          event.stopPropagation(); event.preventDefault();
          if (drag.current) { cancel(); return; }
          event.currentTarget.focus({ preventScroll: true }); onSelect?.(box.id);
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { pointerId: event.pointerId, before: box, source, height: bound.height,
            start: pointInCanvas(event, layerRef.current!.getBoundingClientRect(), size), element: event.currentTarget };
        }}
        onPointerMove={event => {
          event.stopPropagation(); const active = drag.current;
          if (active?.pointerId !== event.pointerId || active.source !== source) return;
          const rect = layerRef.current!.getBoundingClientRect(), point = pointInCanvas(event, rect, size);
          if (point.x === active.start.x && point.y === active.start.y) return;
          const moved = moveTextBox(active.before, active.before.x + (point.x - active.start.x) / size.width,
            active.before.y + (point.y - active.start.y) / size.height, active.height, size, source,
            snap && !event.altKey ? 5 * size.width / rect.width : 0);
          movedRef.current = moved.box; setDragged({ source, ...moved });
        }} onPointerUp={event => { event.stopPropagation(); finish(event); }}
        onPointerCancel={cancel} onLostPointerCapture={event => { if (drag.current?.pointerId === event.pointerId) cancel(); }}
        onKeyDown={event => {
          if (event.key === "Escape") { event.stopPropagation(); cancel(); return; }
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
          event.stopPropagation(); event.preventDefault();
          const step = event.shiftKey ? 10 : 1;
          const moved = moveTextBox(box, box.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0) / size.width,
            box.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0) / size.height, bound.height, size, source);
          onCommit?.(source.map(item => item.id === box.id ? moved.box : item));
        }}>
        {selectedId === box.id ? <span className="text-selection-label">Text{bound.overflows ? " · extends past page" : ""}</span> : null}
      </button>;
    }) : null}
    {editable && dragged?.source === source ? dragged.guides.map(guide => <span key={guide.axis} className={`snap-guide ${guide.axis}`}
      style={guide.axis === "x" ? { left: `${guide.value * 100}%` } : { top: `${guide.value * 100}%` }} />) : null}
  </div>;
}
