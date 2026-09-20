"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CanvasNavigationGesture, MAX_VIEW_SCALE, fitCanvas, panCanvas, resizeViewport, zoomCanvas, type CanvasView } from "@/lib/canvas-viewport";

interface CanvasViewportProps {
  width: number; height: number; label: string; children: ReactNode;
  editable?: boolean; className?: string;
  onScaleChange?: (scale: number) => void;
  onInteractionCancel?: () => void;
}

function cancelNavigation(gesture: CanvasNavigationGesture, stage: HTMLDivElement | null) {
  const ids = [...gesture.pointers.keys()];
  gesture.cancel();
  for (const id of ids) if (stage?.hasPointerCapture(id)) stage.releasePointerCapture(id);
}

/** Owns only the view: children retain their original design coordinates. */
export function CanvasViewport({ width, height, label, children, editable = false, className = "", onScaleChange, onInteractionCancel }: CanvasViewportProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const metrics = useRef({ width: 1, height: 1 });
  const gesture = useRef(new CanvasNavigationGesture());
  const [view, setView] = useState<CanvasView>({ scale: 1, x: 0, y: 0, fit: true });
  const viewRef = useRef(view);
  const [minimumScale, setMinimumScale] = useState(.1);
  const [navigation, setNavigation] = useState(!editable);
  const [percent, setPercent] = useState<string | null>(null);
  const helpId = useId();
  const content = { width, height };
  const callbacks = useRef({ onScaleChange, onInteractionCancel });
  useEffect(() => { callbacks.current = { onScaleChange, onInteractionCancel }; }, [onScaleChange, onInteractionCancel]);

  const updateView = (next: CanvasView) => { viewRef.current = next; setView(next); };
  const cancelGesture = () => cancelNavigation(gesture.current, stageRef.current);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const navigationGesture = gesture.current;
    const resize = () => {
      const next = { width: stage.clientWidth, height: stage.clientHeight };
      if (!next.width || !next.height) return;
      cancelNavigation(navigationGesture, stage);
      callbacks.current.onInteractionCancel?.();
      const value = resizeViewport(viewRef.current, metrics.current, next, { width, height });
      metrics.current = next; viewRef.current = value; setView(value);
      setMinimumScale(Math.min(.1, fitCanvas(next, { width, height }).scale));
    };
    resize();
    const observer = new ResizeObserver(resize); observer.observe(stage);
    const blur = () => { cancelNavigation(navigationGesture, stage); callbacks.current.onInteractionCancel?.(); };
    window.addEventListener("blur", blur);
    return () => { observer.disconnect(); window.removeEventListener("blur", blur); cancelNavigation(navigationGesture, stage); };
  }, [width, height]);

  useEffect(() => { onScaleChange?.(view.scale); }, [view.scale, onScaleChange]);

  // Native non-passive wheel listener prevents browser page zoom only in Navigate.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !navigation) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); event.stopPropagation();
      cancelNavigation(gesture.current, stage);
      const rect = stage.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? metrics.current.height : 1);
      const next = event.ctrlKey || event.metaKey
        ? zoomCanvas(viewRef.current, viewRef.current.scale * Math.exp(-Math.max(-100, Math.min(100, delta)) * .01),
          { x: event.clientX - rect.left, y: event.clientY - rect.top }, metrics.current, { width, height })
        : panCanvas(viewRef.current, -event.deltaX, -delta, metrics.current, { width, height });
      viewRef.current = next; setView(next);
    };
    stage.addEventListener("wheel", wheel, { passive: false, capture: true });
    return () => stage.removeEventListener("wheel", wheel, { capture: true });
  }, [navigation, width, height]);

  const changeZoom = (scale: number) => {
    cancelGesture(); onInteractionCancel?.(); setPercent(null);
    updateView(zoomCanvas(viewRef.current, scale, { x: metrics.current.width / 2, y: metrics.current.height / 2 }, metrics.current, content));
  };
  const fit = () => { cancelGesture(); onInteractionCancel?.(); setPercent(null); updateView(fitCanvas(metrics.current, content)); };
  const commitPercent = () => { if (percent !== null && percent.trim() && Number(percent) > 0) changeZoom(Number(percent) / 100); else setPercent(null); };
  const localPoint = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const stop = (event: React.PointerEvent<HTMLDivElement>) => { event.preventDefault(); event.stopPropagation(); };

  return <div className={`canvas-viewport ${className}`}>
    <div className="canvas-view-tools" role="group" aria-label={`${label} view controls`}>
      {editable ? <div className="canvas-view-modes" role="group" aria-label="Canvas interaction">
        {[false, true].map(value => <button key={String(value)} type="button" aria-pressed={navigation === value} onClick={() => {
          cancelGesture(); onInteractionCancel?.(); setNavigation(value);
        }}>{value ? "Navigate" : "Edit"}</button>)}
      </div> : null}
      <button type="button" aria-label="Zoom canvas out" disabled={view.scale <= minimumScale} onClick={() => changeZoom(view.scale / 1.25)}>−</button>
      <label className="canvas-view-percent"><span className="sr-only">Canvas zoom percentage</span>
        <input type="number" inputMode="decimal" min={minimumScale * 100} max={400} step="any" value={percent ?? Math.round(view.scale * 1000) / 10}
          onChange={event => setPercent(event.target.value)} onBlur={commitPercent} onKeyDown={event => {
            if (event.key === "Enter") { event.preventDefault(); commitPercent(); }
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setPercent(null); }
          }} /><span aria-hidden="true">%</span>
      </label>
      <button type="button" aria-label="Zoom canvas in" disabled={view.scale >= MAX_VIEW_SCALE} onClick={() => changeZoom(view.scale * 1.25)}>+</button>
      <button type="button" aria-pressed={view.fit} onClick={fit}>Fit</button>
      <button type="button" aria-label={editable ? "Canvas at 100%" : "100% detail"} onClick={() => changeZoom(1)}>100%</button>
    </div>
    <p id={helpId} className="canvas-view-help">{navigation ? "Drag to pan · Pinch to zoom the canvas" : "Edit photos or frames · Choose Navigate to pan or zoom the canvas"}</p>
    <div ref={stageRef} className={`canvas-viewport-stage${navigation ? " navigating" : ""}`} aria-label={`${label} viewport`} aria-describedby={helpId}
      role="region" tabIndex={navigation ? 0 : -1}
      onPointerDownCapture={event => {
        if (!navigation) return;
        stop(event); event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId); gesture.current.down(event.pointerId, localPoint(event));
      }}
      onPointerMoveCapture={event => { if (navigation) { stop(event); updateView(gesture.current.move(event.pointerId, localPoint(event), viewRef.current, metrics.current, content)); } }}
      onPointerUpCapture={event => { if (navigation) { stop(event); gesture.current.end(event.pointerId); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } }}
      onPointerCancelCapture={event => { if (navigation) { stop(event); cancelGesture(); } }}
      onLostPointerCaptureCapture={event => { if (navigation && gesture.current.pointers.has(event.pointerId)) cancelGesture(); }}
      onKeyDownCapture={event => {
        if (!navigation) return;
        const key = event.key;
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-", "0", "Escape"].includes(key)) return;
        // An idle Escape retains the enclosing dialog's native close action.
        if (key === "Escape" && !gesture.current.pointers.size) return;
        event.preventDefault(); event.stopPropagation();
        if (key === "0") fit();
        else if (key === "+" || key === "=") changeZoom(view.scale * 1.25);
        else if (key === "-") changeZoom(view.scale / 1.25);
        else if (key === "Escape") cancelGesture();
        else { const step = event.shiftKey ? 120 : 40; updateView(panCanvas(viewRef.current,
          key === "ArrowLeft" ? step : key === "ArrowRight" ? -step : 0,
          key === "ArrowUp" ? step : key === "ArrowDown" ? -step : 0, metrics.current, content)); }
      }}>
      <div className="canvas-viewport-content" inert={navigation} style={{ width, height,
        transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, "--canvas-view-scale": view.scale } as CSSProperties}>
        {children}
      </div>
    </div>
  </div>;
}
