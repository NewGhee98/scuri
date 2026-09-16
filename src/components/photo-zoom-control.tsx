"use client";

import { useState } from "react";
import { MAX_ZOOM, zoomPercent } from "@/lib/crop";
import { parseZoomPercent } from "@/lib/editor-alignment";

const display = (zoom: number) => String(Number(zoomPercent(zoom).toFixed(2)));

export function PhotoZoomControl({ zoom, minimum, onChange, onGestureEnd }: {
  zoom: number; minimum: number; onChange: (zoom: number, snap: boolean) => void; onGestureEnd: () => void;
}) {
  const [draft, setDraft] = useState(display(zoom));
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [displayedZoom, setDisplayedZoom] = useState(zoom);
  if (displayedZoom !== zoom) {
    setDisplayedZoom(zoom); setDirty(false); setDraft(display(zoom)); setError("");
  }
  const commit = () => {
    // Merely focusing/blurring a rounded display must never rewrite a saved crop.
    if (!dirty) return;
    const value = parseZoomPercent(draft, minimum);
    if (value === null) {
      setError(`Enter a percentage from ${Math.ceil(zoomPercent(minimum) * 100) / 100}% to ${zoomPercent(MAX_ZOOM)}%.`);
      return;
    }
    setDirty(false); setError(""); setDraft(display(value)); onGestureEnd();
    if (Math.abs(value - zoom) > 1e-12) onChange(value, false);
  };
  return <>
    <div className="flex items-center justify-between gap-3">
      <label className="control-label" htmlFor="photo-zoom-percent">Selected photo</label>
      <div className="flex items-center gap-1">
        <input id="photo-zoom-percent" type="text" inputMode="text" className="zoom-percent-input"
          aria-label="Photo zoom percentage" aria-invalid={Boolean(error)} aria-describedby={error ? "photo-zoom-error" : "photo-zoom-help"}
          value={draft} onChange={event => { setDirty(true); setDraft(event.target.value); setError(""); }} onBlur={commit}
          onKeyDown={event => {
            if (event.key === "Enter") { event.preventDefault(); commit(); }
            if (event.key === "Escape") { event.preventDefault(); setDirty(false); setDraft(display(zoom)); setError(""); }
          }} />
        <span aria-hidden="true">%</span>
      </div>
    </div>
    {error ? <p id="photo-zoom-error" role="alert" className="mt-2 text-xs text-red-700">{error}</p> : null}
    <input id="zoom" type="range" className="range mt-3" min={minimum} max={MAX_ZOOM} step="any" value={zoom}
      aria-label="Photo zoom" aria-valuetext={`${display(zoom)}% from fill-frame size`}
      onChange={event => onChange(Number(event.target.value), true)} onPointerUp={onGestureEnd} onPointerCancel={onGestureEnd}
      onBlur={onGestureEnd} onKeyDown={event => {
        const direction = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : 0;
        if (direction) { event.preventDefault(); onGestureEnd(); onChange(Math.max(minimum, Math.min(MAX_ZOOM, zoom + direction * (event.shiftKey ? 0.1 : 0.01))), false); }
      }} />
  </>;
}
