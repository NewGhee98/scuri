"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getFormat } from "@/lib/formats";
import { validateTemplate } from "@/lib/templates";
import type { CustomTemplate, NormalizedFrame } from "@/lib/types";

type ResizeHandle = "nw" | "ne" | "sw" | "se";
type Guide = { axis: "x" | "y"; value: number };

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

const MIN_SIZE = 0.045;
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
  return {
    ...template,
    frames: template.frames.map((frame) => ids.has(frame.id) ? updater(frame) : frame),
    updatedAt: new Date().toISOString(),
    syncState: template.syncState === "synced" ? "pending" : template.syncState,
  };
}

function nearestSnap(sourceValues: number[], targetValues: number[]): { delta: number; guide: number } | null {
  let result: { delta: number; guide: number } | null = null;
  for (const source of sourceValues) {
    for (const target of targetValues) {
      const delta = target - source;
      if (Math.abs(delta) <= SNAP_DISTANCE && (!result || Math.abs(delta) < Math.abs(result.delta))) {
        result = { delta, guide: target };
      }
    }
  }
  return result;
}

export function TemplateDesigner({ initialTemplate, onCancel, onDraftChange, onSave, saving }: TemplateDesignerProps) {
  const [draft, setDraft] = useState(initialTemplate);
  const draftRef = useRef(draft);
  const [past, setPast] = useState<CustomTemplate[]>([]);
  const [future, setFuture] = useState<CustomTemplate[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => initialTemplate.frames[0] ? [initialTemplate.frames[0].id] : []);
  const [multiSelect, setMultiSelect] = useState(false);
  const [preview, setPreview] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [canvasWidth, setCanvasWidth] = useState(520);
  const canvasShellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<Interaction | null>(null);

  const format = getFormat(draft.formatId);
  const selectedFrames = useMemo(
    () => draft.frames.filter((frame) => selectedIds.includes(frame.id)),
    [draft.frames, selectedIds],
  );
  const primaryFrame = selectedFrames.at(-1) ?? null;
  const canvasHeight = (canvasWidth * format.height) / format.width;

  useEffect(() => {
    draftRef.current = draft;
    const timer = window.setTimeout(() => onDraftChange(draft), 350);
    return () => window.clearTimeout(timer);
  }, [draft, onDraftChange]);

  useEffect(() => {
    const shell = canvasShellRef.current;
    if (!shell) return;
    const update = () => {
      const available = Math.max(260, Math.min(720, shell.clientWidth - 24));
      const maxHeight = Math.max(380, window.innerHeight - 180);
      setCanvasWidth(Math.min(available, (maxHeight * format.width) / format.height));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [format.height, format.width]);

  const replaceDraft = (next: CustomTemplate) => {
    draftRef.current = next;
    setDraft(next);
  };

  const commit = (next: CustomTemplate) => {
    if (sameTemplate(draftRef.current, next)) return;
    setPast((current) => [...current.slice(-49), draftRef.current]);
    setFuture([]);
    replaceDraft(next);
  };

  const undo = () => {
    const previous = past.at(-1);
    if (!previous) return;
    setPast((current) => current.slice(0, -1));
    setFuture((current) => [draftRef.current, ...current].slice(0, 50));
    replaceDraft(previous);
    setSelectedIds((current) => current.filter((id) => previous.frames.some((frame) => frame.id === id)));
  };

  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture((current) => current.slice(1));
    setPast((current) => [...current.slice(-49), draftRef.current]);
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
  };

  const duplicateSelected = () => {
    if (!selectedFrames.length) return;
    const clones = selectedFrames.map((frame) => ({
      ...frame,
      id: crypto.randomUUID(),
      x: clamp(frame.x + 0.025, 0, 1 - frame.width),
      y: clamp(frame.y + 0.025, 0, 1 - frame.height),
    }));
    commit({
      ...draftRef.current,
      frames: [...draftRef.current.frames, ...clones],
      updatedAt: new Date().toISOString(),
      syncState: draftRef.current.syncState === "synced" ? "pending" : draftRef.current.syncState,
    });
    setSelectedIds(clones.map((frame) => frame.id));
  };

  const deleteSelected = () => {
    if (!selectedIds.length) return;
    const ids = new Set(selectedIds);
    commit({
      ...draftRef.current,
      frames: draftRef.current.frames.filter((frame) => !ids.has(frame.id)),
      updatedAt: new Date().toISOString(),
      syncState: draftRef.current.syncState === "synced" ? "pending" : draftRef.current.syncState,
    });
    setSelectedIds([]);
  };

  const pointForEvent = (event: React.PointerEvent<HTMLElement>): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  };

  const beginInteraction = (event: React.PointerEvent<HTMLDivElement>) => {
    if (preview) return;
    const target = event.target as HTMLElement;
    const frameElement = target.closest<HTMLElement>("[data-template-frame-id]");
    const handleElement = target.closest<HTMLElement>("[data-resize-handle]");
    if (!frameElement) {
      if (event.target === event.currentTarget) setSelectedIds([]);
      return;
    }
    const frameId = frameElement.dataset.templateFrameId;
    if (!frameId) return;
    const handle = handleElement?.dataset.resizeHandle as ResizeHandle | undefined;
    const mode = handle ? "resize" : "move";
    event.preventDefault();
    event.stopPropagation();
    const alreadySelected = selectedIds.includes(frameId);
    let nextSelected = selectedIds;
    if (multiSelect) {
      nextSelected = alreadySelected ? selectedIds : [...selectedIds, frameId];
    } else if (!alreadySelected || selectedIds.length > 1) {
      nextSelected = [frameId];
    }
    setSelectedIds(nextSelected);
    canvasRef.current?.setPointerCapture(event.pointerId);
    interactionRef.current = {
      pointerId: event.pointerId,
      mode,
      frameId,
      handle,
      start: pointForEvent(event),
      before: draftRef.current,
      selectedIds: mode === "move" ? nextSelected : [frameId],
    };
  };

  const moveInteraction = (event: React.PointerEvent<HTMLElement>) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    event.preventDefault();
    const point = pointForEvent(event);
    const deltaX = point.x - interaction.start.x;
    const deltaY = point.y - interaction.start.y;
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
          xTargets,
        );
        const ySnap = nearestSnap(
          [primary.y + safeY, primary.y + primary.height / 2 + safeY, primary.y + primary.height + safeY],
          yTargets,
        );
        if (xSnap) {
          safeX = clamp(safeX + xSnap.delta, -minX, 1 - maxX);
          nextGuides.push({ axis: "x", value: xSnap.guide });
        }
        if (ySnap) {
          safeY = clamp(safeY + ySnap.delta, -minY, 1 - maxY);
          nextGuides.push({ axis: "y", value: ySnap.guide });
        }
      }
      setGuides(nextGuides);
      const ids = new Set(interaction.selectedIds);
      replaceDraft({
        ...interaction.before,
        frames: beforeFrames.map((frame) => ids.has(frame.id) ? { ...frame, x: frame.x + safeX, y: frame.y + safeY } : frame),
        updatedAt: new Date().toISOString(),
        syncState: interaction.before.syncState === "synced" ? "pending" : interaction.before.syncState,
      });
      return;
    }

    const handle = interaction.handle ?? "se";
    let left = primary.x;
    let top = primary.y;
    let right = primary.x + primary.width;
    let bottom = primary.y + primary.height;
    if (handle.includes("w")) left = clamp(primary.x + deltaX, 0, right - MIN_SIZE);
    if (handle.includes("e")) right = clamp(primary.x + primary.width + deltaX, left + MIN_SIZE, 1);
    if (handle.includes("n")) top = clamp(primary.y + deltaY, 0, bottom - MIN_SIZE);
    if (handle.includes("s")) bottom = clamp(primary.y + primary.height + deltaY, top + MIN_SIZE, 1);
    if (primary.aspectRatioLocked) {
      const ratio = primary.width / primary.height;
      const width = right - left;
      const height = bottom - top;
      if (Math.abs(deltaX) >= Math.abs(deltaY)) {
        const adjustedHeight = width / ratio;
        if (handle.includes("n")) top = clamp(bottom - adjustedHeight, 0, bottom - MIN_SIZE);
        else bottom = clamp(top + adjustedHeight, top + MIN_SIZE, 1);
      } else {
        const adjustedWidth = height * ratio;
        if (handle.includes("w")) left = clamp(right - adjustedWidth, 0, right - MIN_SIZE);
        else right = clamp(left + adjustedWidth, left + MIN_SIZE, 1);
      }
    }
    replaceDraft(updateFrames(interaction.before, [primary.id], (frame) => ({
      ...frame,
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    })));
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

  const alignSelected = (mode: "left" | "hcentre" | "right" | "top" | "vcentre" | "bottom") => {
    if (selectedFrames.length < 2) return;
    const left = Math.min(...selectedFrames.map((frame) => frame.x));
    const right = Math.max(...selectedFrames.map((frame) => frame.x + frame.width));
    const top = Math.min(...selectedFrames.map((frame) => frame.y));
    const bottom = Math.max(...selectedFrames.map((frame) => frame.y + frame.height));
    commit(updateFrames(draftRef.current, selectedIds, (frame) => {
      if (mode === "left") return { ...frame, x: left };
      if (mode === "hcentre") return { ...frame, x: (left + right - frame.width) / 2 };
      if (mode === "right") return { ...frame, x: right - frame.width };
      if (mode === "top") return { ...frame, y: top };
      if (mode === "vcentre") return { ...frame, y: (top + bottom - frame.height) / 2 };
      return { ...frame, y: bottom - frame.height };
    }));
  };

  const makeSame = (dimension: "width" | "height") => {
    if (selectedFrames.length < 2 || !primaryFrame) return;
    commit(updateFrames(draftRef.current, selectedIds, (frame) => {
      const size = primaryFrame[dimension];
      return dimension === "width"
        ? { ...frame, width: Math.min(size, 1 - frame.x) }
        : { ...frame, height: Math.min(size, 1 - frame.y) };
    }));
  };

  const distribute = (axis: "x" | "y") => {
    if (selectedFrames.length < 3) return;
    const sorted = [...selectedFrames].sort((a, b) => axis === "x" ? a.x - b.x : a.y - b.y);
    const first = sorted[0];
    const last = sorted.at(-1)!;
    const start = axis === "x" ? first.x : first.y;
    const end = axis === "x" ? last.x + last.width : last.y + last.height;
    const totalSize = sorted.reduce((sum, frame) => sum + (axis === "x" ? frame.width : frame.height), 0);
    const gap = (end - start - totalSize) / (sorted.length - 1);
    let cursor = start;
    const positions = new Map<string, number>();
    for (const frame of sorted) {
      positions.set(frame.id, cursor);
      cursor += (axis === "x" ? frame.width : frame.height) + gap;
    }
    commit(updateFrames(draftRef.current, selectedIds, (frame) => {
      return axis === "x"
        ? { ...frame, x: clamp(positions.get(frame.id)!, 0, 1 - frame.width) }
        : { ...frame, y: clamp(positions.get(frame.id)!, 0, 1 - frame.height) };
    }));
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

  const validationErrors = validateTemplate({ ...draft, name: draft.name.trim() || "Untitled template" });

  return (
    <main className="template-designer-shell">
      <section ref={canvasShellRef} className="template-canvas-workspace">
        <div className="template-designer-topbar">
          <button className="text-button" type="button" onClick={onCancel}>← Templates</button>
          <div className="flex items-center gap-2">
            <button className="small-button compact" type="button" disabled={!past.length} onClick={undo}>Undo</button>
            <button className="small-button compact" type="button" disabled={!future.length} onClick={redo}>Redo</button>
            <button className={`small-button compact ${preview ? "selected-tool" : ""}`} type="button" aria-pressed={preview} onClick={() => setPreview((value) => !value)}>Preview</button>
          </div>
        </div>
        <div
          ref={canvasRef}
          className={`template-design-canvas ${preview ? "previewing" : ""}`}
          style={{ width: canvasWidth, height: canvasHeight, background: draft.defaultBackground }}
          onPointerDown={beginInteraction}
          onPointerMove={moveInteraction}
          onPointerUp={endInteraction}
          onPointerCancel={endInteraction}
        >
          {guides.map((guide, index) => (
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
                className={`designed-frame ${selected ? "selected" : ""}`}
                style={{
                  left: `${frame.x * 100}%`,
                  top: `${frame.y * 100}%`,
                  width: `${frame.width * 100}%`,
                  height: `${frame.height * 100}%`,
                  borderRadius: `${(frame.cornerRadius ?? 0) * 100}%`,
                  zIndex: index + 1,
                }}
              >
                <span className="designed-frame-label">Photo {index + 1}</span>
                {!preview && selected && selectedIds.length === 1 ? (["nw", "ne", "sw", "se"] as ResizeHandle[]).map((handle) => (
                  <span
                    key={handle}
                    className={`resize-handle ${handle}`}
                    data-resize-handle={handle}
                  />
                )) : null}
              </div>
            );
          })}
          {!draft.frames.length ? <div className="blank-canvas-message">Blank canvas<br /><span>Add your first photo frame</span></div> : null}
        </div>
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
        </div>

        <div className="control-section">
          <div className="flex items-center justify-between gap-3">
            <span className="control-label">Snap and arrange</span>
            <label className="toggle-label"><input type="checkbox" checked={snapEnabled} onChange={(event) => setSnapEnabled(event.target.checked)} /> Snap</label>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {(["left", "hcentre", "right", "top", "vcentre", "bottom"] as const).map((mode) => (
              <button key={mode} className="small-button" type="button" disabled={selectedFrames.length < 2} onClick={() => alignSelected(mode)}>
                {mode === "hcentre" ? "Centre ↔" : mode === "vcentre" ? "Middle ↕" : mode[0].toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button className="small-button" type="button" disabled={selectedFrames.length < 2} onClick={() => makeSame("width")}>Same width</button>
            <button className="small-button" type="button" disabled={selectedFrames.length < 2} onClick={() => makeSame("height")}>Same height</button>
            <button className="small-button" type="button" disabled={selectedFrames.length < 3} onClick={() => distribute("x")}>Space across</button>
            <button className="small-button" type="button" disabled={selectedFrames.length < 3} onClick={() => distribute("y")}>Space down</button>
          </div>
        </div>

        <div className="control-section">
          <span className="control-label">Selected frame</span>
          <div className="mt-3 grid grid-cols-4 gap-2" aria-label="Corner radius presets">
            {CORNER_PRESETS.map((radius) => (
              <button
                key={radius}
                className={`corner-preset ${(primaryFrame?.cornerRadius ?? 0) === radius ? "selected" : ""}`}
                type="button"
                disabled={!primaryFrame}
                aria-label={`Corner radius ${Math.round(radius * 100)} percent`}
                onClick={() => primaryFrame && commit(updateFrames(draftRef.current, [primaryFrame.id], (frame) => ({ ...frame, cornerRadius: radius })))}
              ><span style={{ borderRadius: `${radius * 100}%` }} /></button>
            ))}
          </div>
          <label className="toggle-label mt-3"><input type="checkbox" disabled={!primaryFrame} checked={primaryFrame?.aspectRatioLocked ?? false} onChange={(event) => primaryFrame && commit(updateFrames(draftRef.current, [primaryFrame.id], (frame) => ({ ...frame, aspectRatioLocked: event.target.checked })))} /> Lock aspect ratio</label>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="small-button" type="button" disabled={!primaryFrame} onClick={() => changeLayer("front")}>Bring to front</button>
            <button className="small-button" type="button" disabled={!primaryFrame} onClick={() => changeLayer("forward")}>Bring forward</button>
            <button className="small-button" type="button" disabled={!primaryFrame} onClick={() => changeLayer("backward")}>Send backward</button>
            <button className="small-button" type="button" disabled={!primaryFrame} onClick={() => changeLayer("back")}>Send to back</button>
          </div>
        </div>

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
                  onClick={() => setSelectedIds((current) => {
                    if (!multiSelect) return [frame.id];
                    return current.includes(frame.id) ? current.filter((id) => id !== frame.id) : [...current, frame.id];
                  })}
                >
                  <span className="layer-swatch" style={{ borderRadius: `${(frame.cornerRadius ?? 0) * 100}%` }} />
                  <span>Photo {originalIndex + 1}</span>
                  <span className="ml-auto text-[10px] text-neutral-400">{Math.round(frame.width * 100)} × {Math.round(frame.height * 100)}</span>
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
