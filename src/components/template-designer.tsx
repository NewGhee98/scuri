"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getFormat } from "@/lib/formats";
import type { ResizeHandle } from "@/lib/frame-resize";
import { actualFrameRatio, alignFrames, arrangeFrames, arrangementMembers, centreFrameGroup, deleteLayoutFrames,
  duplicateLayoutFrames, equaliseFrameSpacing, flipFrameRatios, FRAME_RATIOS, frameBounds, marginsFor, matchFrameDimension, matchingFrameGap,
  moveFrameGroup, releaseArrangement, resizeLayoutSelection, setArrangementGap, setFrameDimension,
  setFrameMargins, setFrameRatio, type LayoutResult } from "@/lib/template-layout";
import { validateTemplate } from "@/lib/templates";
import { FRAME_SELECTION_TINT } from "@/lib/selection-style";
import { pointInCanvas } from "@/lib/canvas-viewport";
import { CanvasViewport } from "./canvas-viewport";
import type { CustomTemplate, FrameMargins, NormalizedFrame } from "@/lib/types";

type Guide = { axis: "x" | "y"; value: number; gap?: { start: number; end: number; cross: number; pixels: number } };

interface Interaction {
  pointerId: number;
  mode: "move" | "resize";
  frameId: string;
  handle?: ResizeHandle;
  start: { x: number; y: number };
  before: CustomTemplate;
  selectedIds: string[];
}

interface TemplateDesignerProps {
  initialTemplate: CustomTemplate;
  onCancel: () => void;
  onDraftChange: (template: CustomTemplate) => void;
  onSave: (template: CustomTemplate) => void;
  saving: boolean;
}

const SNAP_DISTANCE = 0.009;
const CORNER_PRESETS = [0, 0.06, 0.16, 0.5] as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function sameTemplate(a: CustomTemplate, b: CustomTemplate): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function updateFrames(
  template: CustomTemplate,
  frameIds: readonly string[],
  updater: (frame: NormalizedFrame) => NormalizedFrame,
): CustomTemplate {
  const ids = new Set(frameIds);
  const frames = template.frames.map((frame) => ids.has(frame.id) ? updater(frame) : frame);
  if (JSON.stringify(frames) === JSON.stringify(template.frames)) return template;
  return {
    ...template,
    frames,
    updatedAt: new Date().toISOString(),
    syncState: template.syncState === "synced" ? "pending" : template.syncState,
  };
}

function nearestSnap(sourceValues: number[], targetValues: number[], tolerance = SNAP_DISTANCE): { delta: number; guide: number } | null {
  let result: { delta: number; guide: number } | null = null;
  for (const source of sourceValues) {
    for (const target of targetValues) {
      const delta = target - source;
      if (Math.abs(delta) <= tolerance && (!result || Math.abs(delta) < Math.abs(result.delta))) {
        result = { delta, guide: target };
      }
    }
  }
  return result;
}

/** Commit an exact value on Enter/blur, not one undo entry per keystroke. */
function DesignNumber({ label, value, onCommit, disabled = false, min = 0 }: {
  label: string; value: number | null; onCommit: (value: number) => void; disabled?: boolean; min?: number;
}) {
  const formatted = value === null ? "" : String(Number(value.toFixed(5)));
  const [edit, setEdit] = useState<{ source: string; text: string } | null>(null);
  const text = edit?.source === formatted ? edit.text : formatted;
  const cancelRef = useRef(false);
  return <label className="design-number"><span>{label}</span><input type="text" inputMode="decimal" aria-label={label}
    disabled={disabled} value={text} placeholder={value === null ? "Mixed" : undefined}
    onChange={event => setEdit({ source: formatted, text: event.target.value })}
    onBlur={() => {
      const next = Number(text);
      if (!cancelRef.current && text.trim() && text !== formatted && Number.isFinite(next) && next >= min) onCommit(next);
      cancelRef.current = false; setEdit(null);
    }}
    onKeyDown={event => {
      if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelRef.current = true; setEdit(null); event.currentTarget.blur(); }
    }} /></label>;
}

export function TemplateDesigner({ initialTemplate, onCancel, onDraftChange, onSave, saving }: TemplateDesignerProps) {
  const [draft, setDraft] = useState(initialTemplate);
  const draftRef = useRef(draft);
  const [past, setPast] = useState<CustomTemplate[]>([]);
  const [future, setFuture] = useState<CustomTemplate[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => initialTemplate.frames[0] ? [initialTemplate.frames[0].id] : []);
  const [referenceId, setReferenceId] = useState(initialTemplate.frames[0]?.id ?? "");
  const [multiSelect, setMultiSelect] = useState(false);
  const [preview, setPreview] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [resizeFromCenter, setResizeFromCenter] = useState(false);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [viewScale, setViewScale] = useState(1);
  const [layoutNotice, setLayoutNotice] = useState("");
  const [nextGap, setNextGap] = useState(32);
  const [keepGaps, setKeepGaps] = useState(true);
  const [customRatio, setCustomRatio] = useState(false);
  const [ratioWidth, setRatioWidth] = useState(4);
  const [ratioHeight, setRatioHeight] = useState(3);
  const canvasRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<Interaction | null>(null);

  const format = getFormat(draft.formatId);
  const selectedFrames = useMemo(
    () => draft.frames.filter((frame) => selectedIds.includes(frame.id)),
    [draft.frames, selectedIds],
  );
  const primaryFrame = selectedFrames.find(frame => frame.id === referenceId) ?? selectedFrames.at(-1) ?? null;
  const canvasWidth = format.width, canvasHeight = format.height;
  const designSize = { width: canvasWidth, height: canvasHeight };
  const selectionBounds = frameBounds(selectedFrames);
  const activeArrangement = primaryFrame?.arrangement;
  const members = activeArrangement ? arrangementMembers(draft.frames, activeArrangement.id) : [];
  const margins = marginsFor(primaryFrame ?? undefined);
  const commonDimension = (dimension: "width" | "height") => selectedFrames.length && selectedFrames.every(f => Math.abs(f[dimension] - selectedFrames[0][dimension]) < 1e-10)
    ? selectedFrames[0][dimension] * designSize[dimension] : null;
  const ratioIndex = primaryFrame && selectedFrames.every(f => f.aspectRatioLocked)
    ? FRAME_RATIOS.findIndex(ratio => selectedFrames.every(f => Math.abs(actualFrameRatio(f, designSize) - ratio.width / ratio.height) < 1e-8)) : -1;

  useEffect(() => {
    draftRef.current = draft;
    const timer = window.setTimeout(() => onDraftChange(draft), 350);
    return () => window.clearTimeout(timer);
  }, [draft, onDraftChange]);

  const replaceDraft = (next: CustomTemplate) => {
    draftRef.current = next;
    setDraft(next);
  };

  const commit = (next: CustomTemplate) => {
    // State updaters can run after replaceDraft has changed the mutable ref.
    const before = draftRef.current;
    if (sameTemplate(before, next)) return;
    setPast((current) => [...current.slice(-49), before]);
    setFuture([]);
    replaceDraft(next);
  };

  const commitLayout = (result: LayoutResult) => {
    setLayoutNotice(result.notice ?? "");
    if (JSON.stringify(result.frames) === JSON.stringify(draftRef.current.frames)) return;
    commit({ ...draftRef.current, frames: result.frames, updatedAt: new Date().toISOString(),
      syncState: draftRef.current.syncState === "synced" ? "pending" : draftRef.current.syncState });
  };

  const chooseFrame = (frameId: string) => {
    setLayoutNotice("");
    if (!multiSelect) { setSelectedIds([frameId]); setReferenceId(frameId); return; }
    setSelectedIds(current => current.includes(frameId) ? current.filter(id => id !== frameId) : [...current, frameId]);
    if (!selectedIds.includes(frameId)) setReferenceId(frameId);
  };

  const arrange = (axis: "horizontal" | "vertical") => {
    commitLayout(arrangeFrames(draftRef.current.frames, selectedIds, axis, activeArrangement?.gap ?? nextGap, activeArrangement ? true : keepGaps, designSize, crypto.randomUUID()));
  };

  const changeMargins = (next: FrameMargins) => commitLayout(setFrameMargins(draft.frames, selectedIds, next, designSize));

  const undo = () => {
    const previous = past.at(-1);
    if (!previous) return;
    const before = draftRef.current;
    setLayoutNotice("");
    setPast((current) => current.slice(0, -1));
    setFuture((current) => [before, ...current].slice(0, 50));
    replaceDraft(previous);
    setSelectedIds((current) => current.filter((id) => previous.frames.some((frame) => frame.id === id)));
  };

  const redo = () => {
    const next = future[0];
    if (!next) return;
    const before = draftRef.current;
    setLayoutNotice("");
    setFuture((current) => current.slice(1));
    setPast((current) => [...current.slice(-49), before]);
    replaceDraft(next);
  };

  const addFrame = () => {
    const offset = (draft.frames.length % 6) * 0.035;
    const frame: NormalizedFrame = {
      id: crypto.randomUUID(),
      x: clamp(0.12 + offset, 0, 0.58),
      y: clamp(0.12 + offset, 0, 0.67),
      width: 0.3,
      height: 0.24,
      cornerRadius: 0,
      aspectRatioLocked: false,
    };
    commit({
      ...draftRef.current,
      frames: [...draftRef.current.frames, frame],
      updatedAt: new Date().toISOString(),
      syncState: draftRef.current.syncState === "synced" ? "pending" : draftRef.current.syncState,
    });
    setSelectedIds([frame.id]);
    setReferenceId(frame.id);
  };

  const duplicateSelected = () => {
    if (!selectedFrames.length) return;
    const next = duplicateLayoutFrames(draftRef.current.frames, selectedIds, designSize, () => crypto.randomUUID());
    commitLayout(next);
    setSelectedIds(next.selectedIds);
    setReferenceId(next.selectedIds.at(-1) ?? "");
  };

  const deleteSelected = () => {
    if (!selectedIds.length) return;
    commitLayout(deleteLayoutFrames(draftRef.current.frames, selectedIds, designSize));
    setSelectedIds([]);
  };

  const pointForEvent = (event: React.PointerEvent<HTMLElement>): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return pointInCanvas(event, rect, { width: 1, height: 1 });
  };

  const beginInteraction = (event: React.PointerEvent<HTMLDivElement>) => {
    if (preview || interactionRef.current) return;
    const target = event.target as HTMLElement;
    const frameElement = target.closest<HTMLElement>("[data-template-frame-id]");
    const handleElement = target.closest<HTMLElement>("[data-resize-handle]");
    const sharedHandle = handleElement?.hasAttribute("data-selection-handle");
    if (!frameElement && !sharedHandle) {
      if (event.target === event.currentTarget) setSelectedIds([]);
      return;
    }
    const frameId = frameElement?.dataset.templateFrameId ?? primaryFrame?.id;
    if (!frameId) return;
    const handle = handleElement?.dataset.resizeHandle as ResizeHandle | undefined;
    const mode = handle ? "resize" : "move";
    event.preventDefault();
    event.stopPropagation();
    const alreadySelected = selectedIds.includes(frameId);
    let nextSelected = selectedIds;
    if (multiSelect && !handle) {
      chooseFrame(frameId);
      return;
    } else if (!alreadySelected) {
      nextSelected = [frameId];
    }
    setSelectedIds(nextSelected);
    if (!sharedHandle) setReferenceId(frameId);
    setLayoutNotice("");
    canvasRef.current?.setPointerCapture(event.pointerId);
    interactionRef.current = {
      pointerId: event.pointerId,
      mode,
      frameId,
      handle,
      start: pointForEvent(event),
      before: draftRef.current,
      selectedIds: nextSelected,
    };
  };

  const moveInteraction = (event: React.PointerEvent<HTMLElement>) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    event.preventDefault();
    const point = pointForEvent(event);
    const deltaX = point.x - interaction.start.x;
    const deltaY = point.y - interaction.start.y;
    // A stationary selection is not a drag, snap or draft edit.
    if (deltaX === 0 && deltaY === 0 && draftRef.current === interaction.before) return;
    if (Math.hypot(deltaX * canvasWidth * viewScale, deltaY * canvasHeight * viewScale) < 3 && draftRef.current === interaction.before) return;
    const beforeFrames = interaction.before.frames;
    const primary = beforeFrames.find((frame) => frame.id === interaction.frameId);
    if (!primary) return;

    if (interaction.mode === "move") {
      const moving = beforeFrames.filter((frame) => interaction.selectedIds.includes(frame.id));
      const minX = Math.min(...moving.map((frame) => frame.x));
      const minY = Math.min(...moving.map((frame) => frame.y));
      const maxX = Math.max(...moving.map((frame) => frame.x + frame.width));
      const maxY = Math.max(...moving.map((frame) => frame.y + frame.height));
      let safeX = clamp(deltaX, -minX, 1 - maxX);
      let safeY = clamp(deltaY, -minY, 1 - maxY);
      const nextGuides: Guide[] = [];
      if (snapEnabled) {
        const otherFrames = beforeFrames.filter((frame) => !interaction.selectedIds.includes(frame.id));
        const xTargets = [0, 0.5, 1, ...otherFrames.flatMap((frame) => [frame.x, frame.x + frame.width / 2, frame.x + frame.width])];
        const yTargets = [0, 0.5, 1, ...otherFrames.flatMap((frame) => [frame.y, frame.y + frame.height / 2, frame.y + frame.height])];
        const xSnap = nearestSnap(
          [primary.x + safeX, primary.x + primary.width / 2 + safeX, primary.x + primary.width + safeX],
          xTargets, 5 / (canvasWidth * viewScale),
        );
        const ySnap = nearestSnap(
          [primary.y + safeY, primary.y + primary.height / 2 + safeY, primary.y + primary.height + safeY],
          yTargets, 5 / (canvasHeight * viewScale),
        );
        if (xSnap) {
          safeX = clamp(safeX + xSnap.delta, -minX, 1 - maxX);
          nextGuides.push({ axis: "x", value: xSnap.guide });
        } else {
          const match = matchingFrameGap(otherFrames, { ...primary, x: primary.x + safeX, y: primary.y + safeY }, "x", 5 / (canvasWidth * viewScale));
          if (match) { safeX += match.delta; nextGuides.push({ axis: "x", value: match.start, gap: { ...match, pixels: match.gap * canvasWidth } }); }
        }
        if (ySnap) {
          safeY = clamp(safeY + ySnap.delta, -minY, 1 - maxY);
          nextGuides.push({ axis: "y", value: ySnap.guide });
        } else {
          const match = matchingFrameGap(otherFrames, { ...primary, x: primary.x + safeX, y: primary.y + safeY }, "y", 5 / (canvasHeight * viewScale));
          if (match) { safeY += match.delta; nextGuides.push({ axis: "y", value: match.start, gap: { ...match, pixels: match.gap * canvasHeight } }); }
        }
      }
      const result = moveFrameGroup(beforeFrames, interaction.selectedIds, safeX, safeY, designSize);
      setLayoutNotice(result.notice ?? "");
      const moved = result.frames.find(frame => frame.id === primary.id)!;
      setGuides(nextGuides.filter(guide => guide.axis === "x" ? Math.abs(moved.x - primary.x - safeX) < 1e-9 : Math.abs(moved.y - primary.y - safeY) < 1e-9));
      replaceDraft(updateFrames(interaction.before, interaction.selectedIds, frame => result.frames.find(next => next.id === frame.id)!));
      return;
    }

    const result = resizeLayoutSelection(beforeFrames, interaction.selectedIds, interaction.handle ?? "se", deltaX, deltaY, resizeFromCenter, designSize);
    setLayoutNotice(result.notice ?? "");
    replaceDraft(updateFrames(interaction.before, beforeFrames.map(frame => frame.id), frame => result.frames.find(next => next.id === frame.id)!));
  };

  const endInteraction = (event: React.PointerEvent<HTMLElement>) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (!sameTemplate(interaction.before, draftRef.current)) {
      setPast((current) => [...current.slice(-49), interaction.before]);
      setFuture([]);
    }
    interactionRef.current = null;
    setGuides([]);
  };

  const cancelInteraction = () => {
    const interaction = interactionRef.current;
    interactionRef.current = null;
    if (interaction && !sameTemplate(interaction.before, draftRef.current)) replaceDraft(interaction.before);
    setGuides([]);
    if (interaction && canvasRef.current?.hasPointerCapture(interaction.pointerId)) canvasRef.current.releasePointerCapture(interaction.pointerId);
  };

  const alignSelected = (mode: "left" | "hcentre" | "right" | "top" | "vcentre" | "bottom") => {
    if (selectedFrames.length < 2) return;
    commitLayout(alignFrames(draftRef.current.frames, selectedIds, mode, designSize));
  };

  const makeSame = (dimension: "width" | "height") => {
    if (selectedFrames.length < 2 || !primaryFrame) return;
    commitLayout(matchFrameDimension(draftRef.current.frames, selectedIds, primaryFrame.id, dimension, designSize));
  };

  const distribute = (axis: "x" | "y") => {
    commitLayout(equaliseFrameSpacing(draftRef.current.frames, selectedIds, axis === "x" ? "horizontal" : "vertical", designSize));
  };

  const changeLayer = (mode: "front" | "forward" | "backward" | "back") => {
    if (!primaryFrame) return;
    const frames = [...draftRef.current.frames];
    const index = frames.findIndex((frame) => frame.id === primaryFrame.id);
    const [frame] = frames.splice(index, 1);
    const target = mode === "front" ? frames.length : mode === "back" ? 0 : mode === "forward" ? Math.min(frames.length, index + 1) : Math.max(0, index - 1);
    frames.splice(target, 0, frame);
    commit({ ...draftRef.current, frames, updatedAt: new Date().toISOString(), syncState: draftRef.current.syncState === "synced" ? "pending" : draftRef.current.syncState });
  };

  const save = () => {
    const next: CustomTemplate = {
      ...draftRef.current,
      name: draftRef.current.name.trim() || "Untitled template",
      status: "saved",
      updatedAt: new Date().toISOString(),
      syncState: draftRef.current.syncState === "synced" ? "pending" : draftRef.current.syncState,
    };
    const errors = validateTemplate(next);
    if (errors.length) return;
    replaceDraft(next);
    onSave(next);
  };

  const resizeWithKeys = (event: React.KeyboardEvent, handle: ResizeHandle) => {
    if (preview || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const step = event.shiftKey ? 10 : 1;
    commitLayout(resizeLayoutSelection(draft.frames, selectedIds, handle,
      event.key === "ArrowLeft" ? -step / canvasWidth : event.key === "ArrowRight" ? step / canvasWidth : 0,
      event.key === "ArrowUp" ? -step / canvasHeight : event.key === "ArrowDown" ? step / canvasHeight : 0,
      resizeFromCenter, designSize));
  };

  const validationErrors = validateTemplate({ ...draft, name: draft.name.trim() || "Untitled template" });

  return (
    <main className="template-designer-shell">
      <section className="template-canvas-workspace">
        <div className="template-designer-topbar">
          <button className="text-button" type="button" onClick={onCancel}>← Templates</button>
          <div className="flex items-center gap-2">
            <button className="small-button compact" type="button" disabled={!past.length} onClick={undo}>Undo</button>
            <button className="small-button compact" type="button" disabled={!future.length} onClick={redo}>Redo</button>
            <button className={`small-button compact ${preview ? "selected-tool" : ""}`} type="button" aria-pressed={preview} onClick={() => { cancelInteraction(); setPreview((value) => !value); }}>Preview</button>
          </div>
        </div>
        <CanvasViewport width={canvasWidth} height={canvasHeight} label="Template canvas" editable
          onScaleChange={setViewScale} onInteractionCancel={cancelInteraction}>
        <div
          ref={canvasRef}
          className={`template-design-canvas ${preview ? "previewing" : ""}`}
          style={{ width: canvasWidth, height: canvasHeight, background: draft.defaultBackground }}
          onPointerDown={beginInteraction}
          onPointerMove={moveInteraction}
          onPointerUp={endInteraction}
          onPointerCancel={cancelInteraction}
          onLostPointerCapture={event => { if (interactionRef.current?.pointerId === event.pointerId) cancelInteraction(); }}
          onKeyDown={event => {
            const handle = (event.target as HTMLElement).closest<HTMLElement>("[data-resize-handle]")?.dataset.resizeHandle as ResizeHandle | undefined;
            if (handle) resizeWithKeys(event, handle);
          }}
        >
          {!preview && guides.map((guide, index) => guide.gap ? <span key={`${guide.axis}-${index}`} className={`matching-gap-guide ${guide.axis}`} aria-hidden="true"
            style={guide.axis === "x" ? { left: `${guide.gap.start * 100}%`, top: `${guide.gap.cross * 100}%`, width: `${(guide.gap.end - guide.gap.start) * 100}%` }
              : { top: `${guide.gap.start * 100}%`, left: `${guide.gap.cross * 100}%`, height: `${(guide.gap.end - guide.gap.start) * 100}%` }}>
            <span>{Number(guide.gap.pixels.toFixed(2))} px</span>
          </span> : (
            <span
              key={`${guide.axis}-${guide.value}-${index}`}
              className={`snap-guide ${guide.axis}`}
              style={guide.axis === "x" ? { left: `${guide.value * 100}%` } : { top: `${guide.value * 100}%` }}
            />
          ))}
          {draft.frames.map((frame, index) => {
            const selected = selectedIds.includes(frame.id);
            return (
              <div
                key={frame.id}
                data-template-frame-id={frame.id}
                className={`designed-frame ${!preview && selected ? "selected" : ""}`}
                style={{
                  left: `${frame.x * 100}%`,
                  top: `${frame.y * 100}%`,
                  width: `${frame.width * 100}%`,
                  height: `${frame.height * 100}%`,
                  borderRadius: `${(frame.cornerRadius ?? 0) * 100}%`,
                  zIndex: index + 1,
                }}
              >
                {!preview && selected ? <span className="frame-selection-shade" aria-hidden="true" style={{ background: FRAME_SELECTION_TINT }} /> : null}
                <span className="designed-frame-label">Photo {index + 1}</span>
                {!preview && selected && selectedIds.length === 1 ? (["nw", "ne", "sw", "se"] as ResizeHandle[]).map((handle) => (
                  <button
                    key={handle}
                    type="button"
                    aria-label={`Resize selected frame ${handle}`}
                    className={`resize-handle ${handle}`}
                    data-resize-handle={handle}
                  />
                )) : null}
              </div>
            );
          })}
          {!preview && selectedIds.length > 1 ? <div className="template-selection-handles" style={{
            left: `${selectionBounds.x * 100}%`, top: `${selectionBounds.y * 100}%`,
            width: `${selectionBounds.width * 100}%`, height: `${selectionBounds.height * 100}%`,
          }}>
            {(["nw", "ne", "sw", "se"] as ResizeHandle[]).map(handle => <button key={handle} type="button"
              aria-label={`Resize ${selectedIds.length} selected frames ${handle}`} className={`resize-handle ${handle}`}
              data-resize-handle={handle} data-selection-handle />)}
          </div> : null}
          {!preview && members.length > 1 && activeArrangement && activeArrangement.gap > 0 ? <span className="template-gap-measure" aria-hidden="true" style={{
            left: `${(activeArrangement.axis === "vertical" ? members[0].x + members[0].width / 2 : (members[0].x + members[0].width + members[1].x) / 2) * 100}%`,
            top: `${(activeArrangement.axis === "vertical" ? (members[0].y + members[0].height + members[1].y) / 2 : members[0].y + members[0].height / 2) * 100}%`,
          }}>{Number(activeArrangement.gap.toFixed(2))} px · all gaps</span> : null}
          {!draft.frames.length ? <div className="blank-canvas-message">Blank canvas<br /><span>Add your first photo frame</span></div> : null}
        </div>
        </CanvasViewport>
      </section>

      <aside className="template-control-panel">
        <div>
          <p className="eyebrow">{format.name} · {format.aspectRatio}</p>
          <label className="sr-only" htmlFor="template-name">Template name</label>
          <input
            id="template-name"
            className="template-name-input mt-2"
            value={draft.name}
            maxLength={80}
            onChange={(event) => replaceDraft({ ...draftRef.current, name: event.target.value, updatedAt: new Date().toISOString(), syncState: draftRef.current.syncState === "synced" ? "pending" : draftRef.current.syncState })}
          />
          <p className="mt-2 text-xs text-neutral-500">{draft.frames.length} {draft.frames.length === 1 ? "photo frame" : "photo frames"}</p>
        </div>

        <div className="control-section grid gap-2">
          <button className="primary-button w-full" type="button" onClick={addFrame}>+ Add photo frame</button>
          <div className="grid grid-cols-2 gap-2">
            <button className="small-button" type="button" disabled={!selectedFrames.length} onClick={duplicateSelected}>Duplicate</button>
            <button className="small-button danger" type="button" disabled={!selectedFrames.length} onClick={deleteSelected}>Delete</button>
          </div>
          <button className={`secondary-button w-full ${multiSelect ? "rearrange-active" : ""}`} type="button" aria-pressed={multiSelect} onClick={() => setMultiSelect((value) => !value)}>
            {multiSelect ? "Done selecting" : "Select multiple"}
          </button>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm" role="status">{selectedFrames.length} selected</span>
            <button className="small-button compact" type="button" disabled={!draft.frames.length} onClick={() => setSelectedIds(draft.frames.map(frame => frame.id))}>Select all</button>
          </div>
          {multiSelect ? <p className="design-help">Tap frames to add or remove them. Choose Done selecting to drag the selection.</p> : null}
        </div>

        <div className="control-section">
          <div className="flex items-center justify-between gap-3">
            <span className="control-label">Size and proportion</span>
            <label className="toggle-label"><input type="checkbox" checked={snapEnabled} onChange={(event) => setSnapEnabled(event.target.checked)} /> Snap</label>
          </div>
          <div className="design-fields mt-3">
            <DesignNumber label="Frame width (px)" value={commonDimension("width")} min={1} disabled={!primaryFrame}
              onCommit={value => commitLayout(setFrameDimension(draftRef.current.frames, selectedIds, "width", value, designSize))} />
            <DesignNumber label="Frame height (px)" value={commonDimension("height")} min={1} disabled={!primaryFrame}
              onCommit={value => commitLayout(setFrameDimension(draftRef.current.frames, selectedIds, "height", value, designSize))} />
          </div>
          <p className="design-help mt-2">Canvas pixels at {canvasWidth} × {canvasHeight}. Larger exports scale the whole design.</p>
          <label className="design-select mt-3"><span>Frame proportion</span><select aria-label="Frame proportion" disabled={!primaryFrame}
            value={customRatio ? "custom" : ratioIndex < 0 ? "current" : String(ratioIndex)} onChange={event => {
              if (event.target.value === "custom") { setCustomRatio(true); return; }
              const ratio = FRAME_RATIOS[Number(event.target.value)];
              if (ratio) { setCustomRatio(false); commitLayout(setFrameRatio(draftRef.current.frames, selectedIds, ratio, designSize)); }
            }}>
            <option value="current" disabled>Current / unlocked / mixed</option>
            {FRAME_RATIOS.map((ratio, index) => <option key={ratio.label} value={index}>{ratio.label}</option>)}
            <option value="custom">Custom width:height</option>
          </select></label>
          {customRatio ? <div className="mt-2 grid gap-2"><div className="design-fields">
            <DesignNumber label="Ratio width" value={ratioWidth} min={0.000001} onCommit={setRatioWidth} />
            <DesignNumber label="Ratio height" value={ratioHeight} min={0.000001} onCommit={setRatioHeight} />
          </div><button className="small-button" type="button" disabled={!primaryFrame} onClick={() => commitLayout(setFrameRatio(draftRef.current.frames, selectedIds,
            { width: ratioWidth, height: ratioHeight }, designSize))}>Apply custom proportion</button></div> : null}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <label className="toggle-label"><input type="checkbox" disabled={!primaryFrame}
              checked={!!selectedFrames.length && selectedFrames.every(frame => frame.aspectRatioLocked)}
              ref={element => { if (element) element.indeterminate = selectedFrames.some(frame => frame.aspectRatioLocked) && !selectedFrames.every(frame => frame.aspectRatioLocked); }}
              aria-checked={selectedFrames.some(frame => frame.aspectRatioLocked) && !selectedFrames.every(frame => frame.aspectRatioLocked) ? "mixed" : undefined}
              onChange={event => commit(updateFrames(draftRef.current, selectedIds, frame => {
                const next = { ...frame, aspectRatioLocked: event.target.checked }; if (!event.target.checked) delete next.aspectRatio; return next;
              }))} /> Lock aspect ratio</label>
            <button className="small-button compact" type="button" disabled={!primaryFrame}
              onClick={() => commitLayout(flipFrameRatios(draftRef.current.frames, selectedIds, designSize))}>Flip orientation</button>
          </div>
          <label className="toggle-label mt-2"><input type="checkbox" disabled={!primaryFrame} checked={resizeFromCenter} onChange={event => setResizeFromCenter(event.target.checked)} /> Resize from centre</label>
          {selectedFrames.length > 1 ? <label className="design-select mt-3"><span>Match sizes to</span>
            <select aria-label="Reference frame" value={primaryFrame?.id ?? ""} onChange={event => setReferenceId(event.target.value)}>
              {selectedFrames.map(frame => <option key={frame.id} value={frame.id}>Photo {draft.frames.findIndex(f => f.id === frame.id) + 1}</option>)}
            </select></label> : null}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="small-button" type="button" disabled={selectedFrames.length < 2} onClick={() => makeSame("width")}>Same width</button>
            <button className="small-button" type="button" disabled={selectedFrames.length < 2} onClick={() => makeSame("height")}>Same height</button>
          </div>
          {activeArrangement ? <p className="design-help mt-2">Resizing a member repositions its row/stack to retain the chosen gap.</p> : null}
          <p className="design-notice" role="status">{layoutNotice}</p>
        </div>

        <details className="control-section design-disclosure">
          <summary>Arrange and spacing</summary>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="small-button" type="button" disabled={selectedFrames.length < 2} onClick={() => arrange("horizontal")}>Horizontal row</button>
            <button className="small-button" type="button" disabled={selectedFrames.length < 2} onClick={() => arrange("vertical")}>Vertical stack</button>
          </div>
          <div className="mt-3"><DesignNumber label="Gap (px)" value={activeArrangement?.gap ?? nextGap} disabled={!primaryFrame} onCommit={value => {
            if (activeArrangement) commitLayout(setArrangementGap(draftRef.current.frames, activeArrangement.id, value, designSize));
            else setNextGap(value);
          }} /></div>
          <label className="toggle-label mt-3"><input type="checkbox" checked={activeArrangement ? true : keepGaps} onChange={event => {
            setKeepGaps(event.target.checked);
            if (activeArrangement && !event.target.checked) commitLayout({ frames: releaseArrangement(draftRef.current.frames, members.map(f => f.id)) });
          }} /> Keep gaps consistent</label>
          {activeArrangement ? <div className="mt-2 grid gap-2">
            <p className="design-help">{members.length}-frame {activeArrangement.axis === "vertical" ? "stack" : "row"}. Gaps remain fixed after saving and reopening.</p>
            <div className="grid grid-cols-2 gap-2"><button className="small-button" type="button" onClick={() => { setSelectedIds(members.map(f => f.id)); setMultiSelect(false); }}>Select arrangement</button>
              <button className="small-button" type="button" onClick={() => commitLayout({ frames: releaseArrangement(draftRef.current.frames, members.map(f => f.id)) })}>Release arrangement</button></div>
          </div> : <p className="design-help mt-2">Choose a row or stack to apply this gap. Other frames stay in place.</p>}
          <button className="small-button w-full mt-3" type="button" disabled={!primaryFrame}
            onClick={() => commitLayout(centreFrameGroup(draftRef.current.frames, selectedIds, designSize))}>Centre group</button>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button className="small-button" type="button" disabled={selectedFrames.length < 3 || selectedFrames.some(f => f.arrangement)} onClick={() => distribute("x")}>Equalise across</button>
            <button className="small-button" type="button" disabled={selectedFrames.length < 3 || selectedFrames.some(f => f.arrangement)} onClick={() => distribute("y")}>Equalise down</button>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {(["left", "hcentre", "right", "top", "vcentre", "bottom"] as const).map(mode => <button key={mode} className="small-button" type="button"
              disabled={selectedFrames.length < 2 || selectedFrames.some(f => f.arrangement)} onClick={() => alignSelected(mode)}>
              {mode === "hcentre" ? "Centre ↔" : mode === "vcentre" ? "Middle ↕" : mode[0].toUpperCase() + mode.slice(1)}</button>)}
          </div>
        </details>

        <details className="control-section design-disclosure">
          <summary>Minimum margins</summary>
          <p className="design-help mt-2">Clear space around this selection or arrangement. Centring can leave extra whitespace.</p>
          <label className="toggle-label mt-2"><input type="checkbox" disabled={!primaryFrame} checked={margins.linked} onChange={event => changeMargins(event.target.checked
            ? { top: margins.top, right: margins.top, bottom: margins.top, left: margins.top, linked: true }
            : { ...margins, linked: false })} /> Link all four sides</label>
          <div className="design-fields mt-3">
            {margins.linked ? <DesignNumber label="All margins (px)" value={margins.top} disabled={!primaryFrame}
              onCommit={value => changeMargins({ top: value, right: value, bottom: value, left: value, linked: true })} />
              : <>
                <DesignNumber label="Top margin (px)" value={margins.top} disabled={!primaryFrame} onCommit={value => changeMargins({ ...margins, top: value })} />
                <DesignNumber label="Right margin (px)" value={margins.right} disabled={!primaryFrame} onCommit={value => changeMargins({ ...margins, right: value })} />
                <DesignNumber label="Bottom margin (px)" value={margins.bottom} disabled={!primaryFrame} onCommit={value => changeMargins({ ...margins, bottom: value })} />
                <DesignNumber label="Left margin (px)" value={margins.left} disabled={!primaryFrame} onCommit={value => changeMargins({ ...margins, left: value })} />
              </>}
          </div>
          <p className="design-help mt-2">Spacing is part of the saved frame geometry. A later page Border/gutter adjustment adds inset and can change the visible proportions.</p>
        </details>

        <details className="control-section design-disclosure">
          <summary>Corners and layers</summary>
          <div className="mt-3 grid grid-cols-4 gap-2" aria-label="Corner radius presets">
            {CORNER_PRESETS.map((radius) => (
              <button
                key={radius}
                className={`corner-preset ${(primaryFrame?.cornerRadius ?? 0) === radius ? "selected" : ""}`}
                type="button"
                disabled={!primaryFrame}
                aria-label={`Corner radius ${Math.round(radius * 100)} percent`}
                onClick={() => primaryFrame && commit(updateFrames(draftRef.current, selectedIds, (frame) => ({ ...frame, cornerRadius: radius })))}
              ><span style={{ borderRadius: `${radius * 100}%` }} /></button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="small-button" type="button" disabled={!primaryFrame} onClick={() => changeLayer("front")}>Bring to front</button>
            <button className="small-button" type="button" disabled={!primaryFrame} onClick={() => changeLayer("forward")}>Bring forward</button>
            <button className="small-button" type="button" disabled={!primaryFrame} onClick={() => changeLayer("backward")}>Send backward</button>
            <button className="small-button" type="button" disabled={!primaryFrame} onClick={() => changeLayer("back")}>Send to back</button>
          </div>
        </details>

        <div className="control-section">
          <div className="flex items-center justify-between gap-3">
            <span className="control-label">Layers</span>
            <span className="text-[10px] text-neutral-500">Front to back</span>
          </div>
          <div className="mt-3 grid gap-1.5">
            {[...draft.frames].reverse().map((frame) => {
              const originalIndex = draft.frames.findIndex((item) => item.id === frame.id);
              const selected = selectedIds.includes(frame.id);
              return (
                <button
                  key={frame.id}
                  className={`layer-row ${selected ? "selected" : ""}`}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => chooseFrame(frame.id)}
                >
                  <span className="layer-swatch" style={{ borderRadius: `${(frame.cornerRadius ?? 0) * 100}%` }} />
                  <span>Photo {originalIndex + 1}{selectedFrames.length > 1 && frame.id === primaryFrame?.id ? " · Reference" : ""}</span>
                  <span className="ml-auto text-[10px] text-neutral-500">{Math.round(frame.width * canvasWidth)} × {Math.round(frame.height * canvasHeight)} px</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="control-section">
          <label className="control-label" htmlFor="template-background">Canvas background</label>
          <div className="mt-3 flex items-center gap-3">
            <input
              id="template-background"
              className="template-colour-input"
              type="color"
              value={draft.defaultBackground}
              onChange={(event) => commit({ ...draftRef.current, defaultBackground: event.target.value, updatedAt: new Date().toISOString(), syncState: draftRef.current.syncState === "synced" ? "pending" : draftRef.current.syncState })}
            />
            <span className="text-xs uppercase tabular-nums text-neutral-500">{draft.defaultBackground}</span>
          </div>
        </div>

        <div className="mt-auto grid gap-2 pt-5">
          <button className="primary-button w-full" type="button" disabled={saving || validationErrors.length > 0} onClick={save}>
            {saving ? "Saving to cloud…" : "Save template"}
          </button>
          {validationErrors.length ? <p className="text-center text-xs leading-5 text-[#8d2424]">Add at least one valid photo frame before saving.</p> : null}
          <p className="text-center text-[11px] leading-4 text-neutral-500">Saved templates appear on every signed-in device.</p>
        </div>
      </aside>
    </main>
  );
}
