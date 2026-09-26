"use client";

import { useRef, useState } from "react";
import { clampText, createTextBox, layoutText, MAX_TEXT_BOXES, MAX_TEXT_LENGTH, moveTextBox, TEXT_FONTS } from "@/lib/text";
import { useTextFonts } from "./text-layer";
import type { TextBox } from "@/lib/types";

interface Props {
  boxes: TextBox[]; selectedId: string | null; onSelect: (id: string | null) => void;
  onPreview: (boxes: TextBox[]) => void; onCommit: (boxes?: TextBox[]) => void; onCancel: () => void;
  width: number; height: number; snap: boolean; onSnap: (value: boolean) => void; placeholders?: boolean;
}

function TextNumber({ label, value, min, max, step = 1, onPreview, onCommit, onCancel }: {
  label: string; value: number; min: number; max: number; step?: number;
  onPreview: (value: number) => void; onCommit: (value?: number) => void; onCancel: () => void;
}) {
  const [input, setInput] = useState<string | null>(null);
  const canceled = useRef(false);
  const commitInput = () => {
    if (!canceled.current && input?.trim() && Number.isFinite(Number(input))) onCommit(clampText(Number(input), min, max));
    canceled.current = false; setInput(null);
  };
  return <label className="text-number-control"><span>{label}</span>
    <input className="range" type="range" aria-label={`${label} slider`} min={min} max={max} step={step} value={value}
      onChange={event => onPreview(Number(event.target.value))} onPointerUp={() => onCommit()}
      onPointerCancel={onCancel} onKeyUp={() => onCommit()} onBlur={() => onCommit()} />
    <input type="text" inputMode="decimal" aria-label={label} value={input ?? Number(value.toFixed(3))}
      onChange={event => setInput(event.target.value)} onBlur={commitInput} onKeyDown={event => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") { canceled.current = true; setInput(null); event.currentTarget.blur(); }
      }} />
  </label>;
}

export function TextTools({ boxes, selectedId, onSelect, onPreview, onCommit, onCancel, width, height, snap, onSnap, placeholders = false }: Props) {
  const box = boxes.find(item => item.id === selectedId);
  const fonts = useTextFonts(box ? [box] : []);
  const change = (patch: Partial<TextBox>, preview = false) => {
    if (!box) return;
    const next = boxes.map(item => item.id === box.id ? { ...box, ...patch } : item);
    if (preview) onPreview(next); else onCommit(next);
  };
  const number = (label: string, key: "fontSize" | "letterSpacing" | "lineHeight" | "opacity", min: number, max: number, step = 1, factor = 1) => box &&
    <TextNumber key={`${box.id}:${key}`} label={label} value={box[key] * factor} min={min} max={max} step={step}
      onPreview={value => change({ [key]: value / factor }, true)} onCommit={value => value === undefined ? onCommit() : change({ [key]: value / factor })} onCancel={onCancel} />;
  const centre = () => {
    if (!box) return;
    const ctx = document.createElement("canvas").getContext("2d"); if (!ctx) return;
    const layout = layoutText(ctx, box, { width, height });
    change(moveTextBox(box, (1 - box.width) / 2, (1 - layout.height / height) / 2, layout.height, { width, height }, []).box);
  };
  return <section className="text-tools" aria-label={placeholders ? "Template text" : "Page text"}>
    <div className="flex items-center justify-between gap-2"><h2 className="control-label">{placeholders ? "Text placeholders" : "Text"}</h2>
      <button type="button" className="small-button compact" disabled={boxes.length >= MAX_TEXT_BOXES} onClick={() => {
        const next = createTextBox(crypto.randomUUID()); onCommit([...boxes, next]); onSelect(next.id);
      }}>Add text</button></div>
    {boxes.length ? <label className="text-field"><span>Selected text box</span><select value={box?.id ?? ""} onChange={event => onSelect(event.target.value)}>
      <option value="" disabled>Choose text</option>
      {boxes.map((item, i) => <option key={item.id} value={item.id}>{i + 1} · {item.text.slice(0, 35) || "Empty text box"}</option>)}
    </select></label> : <p className="text-xs text-neutral-500">Add a title or caption anywhere on the page.</p>}
    {box ? <div key={box.id} className="text-box-controls">
      <label className="text-field"><span>Text content</span><textarea rows={3} maxLength={MAX_TEXT_LENGTH} value={box.text}
        onChange={event => change({ text: event.target.value }, true)} onBlur={() => onCommit()} onKeyDown={event => {
          if (event.key === "Escape") { event.stopPropagation(); onCancel(); }
        }} /></label>
      <div className="text-control-pair"><label className="text-field"><span>Font</span><select value={box.font} onChange={event => {
        const font = TEXT_FONTS.find(item => item.id === event.target.value)!;
        change({ font: font.id, italic: font.italic && box.italic });
      }}>{TEXT_FONTS.map(font => <option key={font.id} value={font.id}>{font.name}</option>)}</select></label>
      <label className="text-field"><span>Weight</span><select value={box.weight} onChange={event => change({ weight: Number(event.target.value) as TextBox["weight"] })}>
        <option value={400}>Regular</option><option value={500}>Medium</option><option value={600}>Semibold</option><option value={700}>Bold</option>
      </select></label></div>
      <div className="text-control-pair"><label className="text-field"><span>Alignment</span><select value={box.align} onChange={event => change({ align: event.target.value as TextBox["align"] })}>
        <option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option>
      </select></label><label className="text-checkbox"><input type="checkbox" checked={box.italic} disabled={box.font === "cinzel"}
        onChange={event => change({ italic: event.target.checked })} /> Italic{box.font === "cinzel" ? " (unavailable)" : ""}</label></div>
      {number("Font size (px)", "fontSize", 8, 300)}
      {number("Letter spacing (px)", "letterSpacing", -5, 60, .1)}
      {number("Line spacing", "lineHeight", .8, 3, .05)}
      {number("Opacity (%)", "opacity", 0, 100, 1, 100)}
      <TextNumber label="Box width (%)" value={box.width * 100} min={5} max={100} step={1}
        onPreview={value => change({ width: value / 100, x: Math.min(box.x, 1 - value / 100) }, true)}
        onCommit={value => value === undefined ? onCommit() : change({ width: value / 100, x: Math.min(box.x, 1 - value / 100) })} onCancel={onCancel} />
      <div className="text-control-pair"><label className="text-field"><span>Text colour</span><input type="color" value={box.colour}
        onChange={event => change({ colour: event.target.value }, true)} onBlur={() => onCommit()} /></label>
      <label className="text-field"><span>Background colour</span><input type="color" disabled={!box.background} value={box.background ?? "#ffffff"}
        onChange={event => change({ background: event.target.value }, true)} onBlur={() => onCommit()} /></label></div>
      <label className="text-checkbox"><input type="checkbox" checked={box.background !== null} onChange={event => change({ background: event.target.checked ? "#ffffff" : null })} /> Text box background</label>
      <label className="text-checkbox"><input type="checkbox" checked={snap} onChange={event => onSnap(event.target.checked)} /> Snap text to edges and centre</label>
      <div className="text-control-pair"><button type="button" className="small-button" disabled={!fonts.ready} onClick={centre}>Centre on page</button>
        <button type="button" className="small-button" disabled={boxes.length >= MAX_TEXT_BOXES} onClick={() => {
          const copy = { ...box, id: crypto.randomUUID(), y: Math.min(.95, box.y + .03) };
          onCommit([...boxes, copy]); onSelect(copy.id);
        }}>Duplicate text</button></div>
      <div className="text-control-pair"><button type="button" className="small-button" disabled={boxes.at(-1)?.id === box.id} onClick={() => onCommit([...boxes.filter(item => item.id !== box.id), box])}>Bring text forward</button>
        <button type="button" className="small-button danger" onClick={() => { onCommit(boxes.filter(item => item.id !== box.id)); onSelect(null); }}>Delete text</button></div>
      <p className="text-xs text-neutral-500">Drag text in Edit mode. Arrow keys nudge; Shift moves 10 px. Text stays above photos. All sizes scale with export resolution. Text beyond the page is clipped.</p>
    </div> : null}
    {placeholders ? <p className="text-xs text-neutral-500">Each new page gets its own editable copy. Existing pages keep their text.</p> : null}
  </section>;
}
