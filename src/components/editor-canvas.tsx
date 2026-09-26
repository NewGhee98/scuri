"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAX_ZOOM, minimumPhotoZoom, moveCrop, resolveFrames } from "@/lib/crop";
import { drawCroppedPhoto } from "@/lib/draw-photo";
import { drawCompositionGuides } from "@/lib/composition-guides";
import { FRAME_SELECTION_TINT } from "@/lib/selection-style";
import { pointInCanvas } from "@/lib/canvas-viewport";
import { CanvasViewport } from "./canvas-viewport";
import { TextLayer } from "./text-layer";
import type { DisplayPhoto } from "@/lib/photo-preview-cache";
import { snapFramePosition, snapPhotoPosition, type AlignmentGuide } from "@/lib/editor-alignment";
import type { CanvasFormat, CropState, ResolvedFrame, TemplateDefinition, TextBox } from "@/lib/types";

interface EditorCanvasProps {
  format: CanvasFormat;
  template: TemplateDefinition;
  background: string;
  gutter: number;
  photos: Record<string, DisplayPhoto>;
  unavailableFrameIds?: string[];
  selectedFrameId: string | null;
  rearrangeMode: boolean;
  moveFrameMode: boolean;
  snapEnabled: boolean;
  guides: AlignmentGuide[];
  compositionGuides: boolean;
  onSelectFrame: (frameId: string) => void;
  onRequestPhoto: (frameId: string) => void;
  onCropChange: (frameId: string, crop: CropState) => void;
  onMovePhoto: (sourceFrameId: string, targetFrameId: string) => void;
  onZoomChange: (frameId: string, zoom: number, tolerance: number) => void;
  onFrameMove: (frameId: string, x: number, y: number) => void;
  onGuidesChange: (guides: AlignmentGuide[]) => void;
  onViewWidthChange: (width: number) => void;
  textEditing?: boolean;
  selectedTextId?: string | null;
  onSelectText?: (id: string) => void;
  onTextChange?: (boxes: TextBox[]) => void;
}

interface Point {
  x: number;
  y: number;
}

function hitTest(frames: ResolvedFrame[], point: Point): ResolvedFrame | null {
  return (
    [...frames]
      .reverse()
      .find(
        (frame) =>
          point.x >= frame.x &&
          point.x <= frame.x + frame.width &&
          point.y >= frame.y &&
          point.y <= frame.y + frame.height,
      ) ?? null
  );
}

function pointerDistance(points: Point[]): number {
  if (points.length < 2) return 0;
  return Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
}

export function EditorCanvas({
  format,
  template,
  background,
  gutter,
  photos,
  unavailableFrameIds,
  selectedFrameId,
  rearrangeMode,
  moveFrameMode,
  snapEnabled,
  guides,
  compositionGuides,
  onSelectFrame,
  onRequestPhoto,
  onCropChange,
  onMovePhoto,
  onZoomChange,
  onFrameMove,
  onGuidesChange,
  onViewWidthChange,
  textEditing = false, selectedTextId, onSelectText, onTextChange,
}: EditorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageCacheRef = useRef(new Map<string, HTMLImageElement>());
  const pointersRef = useRef(new Map<number, Point>());
  const dragRef = useRef<{ pointerId: number; frameId: string; blobKey?: string; last: Point; distance: number; rawCrop?: CropState } | null>(null);
  const pinchRef = useRef<{ frameId: string; startDistance: number; startZoom: number } | null>(null);
  const swapDragRef = useRef<{ pointerId: number; sourceFrameId: string; targetFrameId: string } | null>(null);
  const frameDragRef = useRef<{ pointerId: number; start: Point; frame: ResolvedFrame } | null>(null);
  const wheelRef = useRef<{ frameId: string; rawZoom: number; time: number } | null>(null);
  // Fixed, bounded preview backing surface. View zoom never loads originals.
  const size = { width: format.width, height: format.height };
  const viewScaleRef = useRef(1);
  const [imageRevision, setImageRevision] = useState(0);
  const [swapTargetFrameId, setSwapTargetFrameId] = useState<string | null>(null);
  const [textCancelKey, setTextCancelKey] = useState(0);

  const cancelInteraction = () => {
    setTextCancelKey(value => value + 1);
    const ids = [...pointersRef.current.keys()];
    pointersRef.current.clear(); dragRef.current = null; pinchRef.current = null;
    swapDragRef.current = null; frameDragRef.current = null; wheelRef.current = null;
    setSwapTargetFrameId(null); onGuidesChange([]);
    for (const id of ids) if (canvasRef.current?.hasPointerCapture(id)) canvasRef.current.releasePointerCapture(id);
  };
  const changeViewScale = useCallback((scale: number) => {
    viewScaleRef.current = scale;
    onViewWidthChange(format.width * scale);
  }, [format.width, onViewWidthChange]);

  useEffect(() => {
    const ids = [...pointersRef.current.keys()];
    pointersRef.current.clear(); dragRef.current = null; pinchRef.current = null;
    swapDragRef.current = null; frameDragRef.current = null; wheelRef.current = null;
    for (const id of ids) if (canvasRef.current?.hasPointerCapture(id)) canvasRef.current.releasePointerCapture(id);
  }, [moveFrameMode, rearrangeMode, textEditing]);

  useEffect(() => {
    if (!guides.length) return;
    const timeout = window.setTimeout(() => onGuidesChange([]), 800);
    return () => window.clearTimeout(timeout);
  }, [guides, onGuidesChange]);

  useEffect(() => {
    const cache = imageCacheRef.current;
    const activeUrls = new Set(Object.values(photos).flatMap(photo => [photo.previewUrl, photo.fallbackPreviewUrl].filter((url): url is string => Boolean(url))));
    for (const key of cache.keys()) {
      if (!activeUrls.has(key)) cache.delete(key);
    }
    for (const url of activeUrls) {
      if (cache.has(url)) continue;
      const image = new Image();
      image.decoding = "async";
      image.onload = () => setImageRevision((revision) => revision + 1);
      image.src = url;
      cache.set(url, image);
    }
  }, [photos]);

  const frames = useMemo(
    () => resolveFrames(template, gutter, size.width, size.height),
    [gutter, size.height, size.width, template],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = background;
    context.fillRect(0, 0, size.width, size.height);

    for (const frame of frames) {
      const photo = photos[frame.id];
      context.save();
      context.beginPath();
      context.roundRect(frame.x, frame.y, frame.width, frame.height, frame.cornerRadius);
      context.clip();
      if (photo) {
        const primary = imageCacheRef.current.get(photo.previewUrl);
        const image = primary?.complete && primary.naturalWidth ? primary : imageCacheRef.current.get(photo.fallbackPreviewUrl ?? "");
        if (image?.complete && image.naturalWidth) {
          drawCroppedPhoto(context, image, photo.sourceWidth, photo.sourceHeight, frame, photo.crop, background);
        } else {
          context.fillStyle = "#e8e8e5";
          context.fillRect(frame.x, frame.y, frame.width, frame.height);
        }
      } else {
        context.fillStyle = "#e8e8e5";
        context.fillRect(frame.x, frame.y, frame.width, frame.height);
        const fontSize = Math.max(10, Math.min(16, frame.width / 9));
        context.fillStyle = "#5f5f5b";
        context.font = `500 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(unavailableFrameIds?.includes(frame.id) ? "Photo unavailable" : "Tap to add photo", frame.x + frame.width / 2, frame.y + frame.height / 2, frame.width - 16);
      }
      if (selectedFrameId === frame.id) {
        context.fillStyle = FRAME_SELECTION_TINT;
        context.fillRect(frame.x, frame.y, frame.width, frame.height);
      }
      if (compositionGuides && !rearrangeMode && selectedFrameId === frame.id && photo) drawCompositionGuides(context, frame);
      context.restore();

      if (rearrangeMode && swapDragRef.current && swapTargetFrameId === frame.id && swapDragRef.current.sourceFrameId !== frame.id) {
        context.save();
        context.strokeStyle = "#1f8f55";
        context.lineWidth = 5;
        context.beginPath();
        context.roundRect(frame.x + 2.5, frame.y + 2.5, Math.max(0, frame.width - 5), Math.max(0, frame.height - 5), frame.cornerRadius);
        context.stroke();
        context.restore();
      }
    }
    if (guides.length) {
      context.save(); context.strokeStyle = "#c43588"; context.lineWidth = 1.5; context.setLineDash([5, 4]);
      for (const guide of guides) {
        const value = guide.value * (guide.axis === "x" ? size.width / format.width : size.height / format.height);
        context.beginPath();
        if (guide.axis === "x") { context.moveTo(value, 0); context.lineTo(value, size.height); }
        else { context.moveTo(0, value); context.lineTo(size.width, value); }
        context.stroke();
      }
      context.restore();
    }
  }, [background, frames, imageRevision, photos, selectedFrameId, size.height, size.width, swapTargetFrameId, unavailableFrameIds, guides, format.width, format.height, rearrangeMode, compositionGuides]);

  const canvasPoint = useCallback((event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return pointInCanvas(event, rect, { width: size.width, height: size.height });
  }, [size.height, size.width]);

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    onGuidesChange([]); wheelRef.current = null;
    const point = canvasPoint(event);
    if (swapDragRef.current || frameDragRef.current || pointersRef.current.size >= 2) return;
    const selected = moveFrameMode ? frames.filter(frame => frame.id === selectedFrameId) : [];
    const target = hitTest(selected, point) ?? hitTest(frames, point);
    if (!target && !dragRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, point);
    // A second finger may land on a different (or empty) frame. Keep the
    // first finger's photo selected and make this one continuous gesture.
    if (!moveFrameMode && !rearrangeMode && pointersRef.current.size === 2 && dragRef.current && photos[dragRef.current.frameId]) {
      pinchRef.current = { frameId: dragRef.current.frameId, startDistance: Math.max(1, pointerDistance([...pointersRef.current.values()])),
        startZoom: photos[dragRef.current.frameId].crop.zoom };
      dragRef.current = null;
      return;
    }
    if (pointersRef.current.size > 1 || !target) return;
    onSelectFrame(target.id);
    if (moveFrameMode) {
      if (!frameDragRef.current) frameDragRef.current = { pointerId: event.pointerId, start: point, frame: target };
      return;
    }
    if (rearrangeMode && photos[target.id]) {
      swapDragRef.current = { pointerId: event.pointerId, sourceFrameId: target.id, targetFrameId: target.id };
      setSwapTargetFrameId(target.id);
      dragRef.current = null;
      pinchRef.current = null;
      return;
    }
    if (!photos[target.id]) {
      dragRef.current = { pointerId: event.pointerId, frameId: target.id, last: point, distance: 0 };
      return;
    }
    if (pointersRef.current.size === 1) {
      dragRef.current = { pointerId: event.pointerId, frameId: target.id, blobKey: photos[target.id].blobKey,
        last: point, distance: 0, rawCrop: photos[target.id].crop };
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const previousPoint = pointersRef.current.get(event.pointerId);
    if (!previousPoint) return;
    event.preventDefault();
    const point = canvasPoint(event);
    // Selection alone must not snap a frame or commit an unchanged crop/pinch.
    if (point.x === previousPoint.x && point.y === previousPoint.y) return;
    pointersRef.current.set(event.pointerId, point);
    const frameDrag = frameDragRef.current;
    if (moveFrameMode) {
      if (frameDrag?.pointerId !== event.pointerId) return;
      const result = snapFramePosition(frameDrag.frame, frames, frameDrag.frame.x + point.x - frameDrag.start.x,
        frameDrag.frame.y + point.y - frameDrag.start.y, size.width, size.height, snapEnabled && !event.altKey ? 5 / viewScaleRef.current : -1);
      onGuidesChange(result.guides.map(guide => ({ ...guide, value: guide.value * (guide.axis === "x" ? format.width / size.width : format.height / size.height) })));
      onFrameMove(frameDrag.frame.id, result.x * format.width / size.width, result.y * format.height / size.height);
      return;
    }
    const swapDrag = swapDragRef.current;
    if (swapDrag?.pointerId === event.pointerId) {
      const target = hitTest(frames, point);
      if (target) swapDrag.targetFrameId = target.id;
      setSwapTargetFrameId(target?.id ?? null);
      return;
    }
    if (pointersRef.current.size >= 2 && pinchRef.current) {
      const photo = photos[pinchRef.current.frameId];
      if (!photo) return;
      const distance = pointerDistance([...pointersRef.current.values()]);
      onZoomChange(
        pinchRef.current.frameId,
        pinchRef.current.startZoom * (distance / pinchRef.current.startDistance),
        event.altKey ? -1 : 5 * format.width / (size.width * viewScaleRef.current),
      );
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const photo = photos[drag.frameId];
    const target = frames.find((frame) => frame.id === drag.frameId);
    const deltaX = point.x - drag.last.x;
    const deltaY = point.y - drag.last.y;
    drag.distance += Math.hypot(deltaX, deltaY);
    drag.last = point;
    if (photo && target && photo.blobKey === drag.blobKey) {
      // Accumulate unsnapped input, independently of React's last render. This
      // both avoids lost fast pointer deltas and lets a slow drag pass centre.
      drag.rawCrop = moveCrop(photo.sourceWidth, photo.sourceHeight, target, drag.rawCrop ?? photo.crop, deltaX, deltaY);
      const result = snapPhotoPosition(drag.rawCrop, target, snapEnabled && !event.altKey ? 5 / viewScaleRef.current : -1);
      onGuidesChange(result.guides);
      onCropChange(drag.frameId, result.crop);
    }
  };

  const endPointer = (event: React.PointerEvent<HTMLCanvasElement>, commitSwap: boolean) => {
    event.preventDefault();
    onGuidesChange([]);
    if (frameDragRef.current?.pointerId === event.pointerId) frameDragRef.current = null;
    const swapDrag = swapDragRef.current;
    if (commitSwap && swapDrag?.pointerId === event.pointerId && swapDrag.sourceFrameId !== swapDrag.targetFrameId) {
      onMovePhoto(swapDrag.sourceFrameId, swapDrag.targetFrameId);
    }
    const drag = dragRef.current;
    if (commitSwap && !moveFrameMode && drag && drag.distance * viewScaleRef.current < 6 && !photos[drag.frameId] && !unavailableFrameIds?.includes(drag.frameId)) onRequestPhoto(drag.frameId);
    const pinch = pinchRef.current;
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pinch && pointersRef.current.size === 1) {
      const [pointerId, point] = [...pointersRef.current][0], photo = photos[pinch.frameId];
      dragRef.current = photo ? { pointerId, frameId: pinch.frameId, blobKey: photo.blobKey,
        last: point, distance: 0, rawCrop: photo.crop } : null;
    }
    if (swapDrag?.pointerId === event.pointerId) {
      swapDragRef.current = null;
      setSwapTargetFrameId(null);
    }
    if (pointersRef.current.size === 0) {
      dragRef.current = null;
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    if (moveFrameMode || rearrangeMode || !selectedFrameId || !photos[selectedFrameId]) return;
    event.preventDefault();
    const photo = photos[selectedFrameId];
    const frame = frames.find(item => item.id === selectedFrameId);
    if (!frame) return;
    const last = wheelRef.current;
    const rawZoom = Math.max(Math.min(photo.crop.zoom, minimumPhotoZoom(photo.sourceWidth, photo.sourceHeight, frame)), Math.min(MAX_ZOOM,
      (last?.frameId === selectedFrameId && Date.now() - last.time < 300 ? last.rawZoom : photo.crop.zoom) * (event.deltaY > 0 ? 0.94 : 1.06)));
    wheelRef.current = { frameId: selectedFrameId, rawZoom, time: Date.now() };
    onZoomChange(selectedFrameId, rawZoom, event.altKey ? -1 : 5 * format.width / (size.width * viewScaleRef.current));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!selectedFrameId) return;
    const photo = photos[selectedFrameId];
    const target = frames.find((frame) => frame.id === selectedFrameId);
    if (moveFrameMode) {
      if (target && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault(); onGuidesChange([]);
        const step = event.shiftKey ? 10 : 1;
        onFrameMove(selectedFrameId, target.x * format.width / size.width + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0),
          target.y * format.height / size.height + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0));
      }
      return;
    }
    if (!photo) {
      if (event.key === "Enter" || event.key === " ") onRequestPhoto(selectedFrameId);
      return;
    }
    if (rearrangeMode && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      const currentIndex = frames.findIndex((frame) => frame.id === selectedFrameId);
      const offset = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      const nextFrame = frames[currentIndex + offset];
      if (nextFrame) onMovePhoto(selectedFrameId, nextFrame.id);
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      onZoomChange(selectedFrameId, photo.crop.zoom + 0.1, -1);
    } else if (event.key === "-") {
      event.preventDefault();
      onZoomChange(selectedFrameId, photo.crop.zoom - 0.1, -1);
    } else if (target && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      onGuidesChange([]); // Keyboard nudges are exact and never trapped by a snap.
      const delta = event.shiftKey ? 12 : 4;
      const deltaX = event.key === "ArrowLeft" ? -delta : event.key === "ArrowRight" ? delta : 0;
      const deltaY = event.key === "ArrowUp" ? -delta : event.key === "ArrowDown" ? delta : 0;
      onCropChange(
        selectedFrameId,
        moveCrop(photo.sourceWidth, photo.sourceHeight, target, photo.crop, deltaX, deltaY),
      );
    }
  };

  return (
    <CanvasViewport width={format.width} height={format.height} label="Page canvas" editable
      onScaleChange={changeViewScale} onInteractionCancel={cancelInteraction}>
      <div className="relative" style={{ width: format.width, height: format.height }}>
      <canvas
        ref={canvasRef}
        className={`ios-gesture-surface block touch-none bg-white shadow-[0_16px_50px_rgba(0,0,0,0.14)] outline-none focus-visible:ring-2 focus-visible:ring-sky-700 focus-visible:ring-offset-4 ${moveFrameMode || rearrangeMode ? "cursor-grab" : ""}`}
        aria-label={textEditing ? "Page canvas in text mode. Select and drag a text box, or choose Photos to edit images."
          : moveFrameMode ? "Photo layout canvas in move frame mode. Drag the selected frame or use arrow keys to move it."
          : rearrangeMode
          ? "Photo layout canvas in rearrange mode. Drag a filled frame onto another frame to swap or move its photo."
          : "Photo layout canvas. Tap a frame to select it, drag to reposition, and pinch to zoom."}
        role="application"
        tabIndex={0}
        draggable={false}
        onContextMenu={(event) => event.preventDefault()}
        onDragStart={(event) => event.preventDefault()}
        onKeyDown={textEditing ? undefined : handleKeyDown}
        onPointerCancel={cancelInteraction}
        onLostPointerCapture={event => { if (pointersRef.current.has(event.pointerId)) cancelInteraction(); }}
        onPointerDown={textEditing ? undefined : handlePointerDown}
        onPointerMove={textEditing ? undefined : handlePointerMove}
        onPointerUp={textEditing ? undefined : (event) => endPointer(event, true)}
        onWheel={textEditing ? undefined : handleWheel}
      />
      {template.textLayers?.length ? <TextLayer template={template} selectedId={selectedTextId} editable={textEditing}
        snap={snapEnabled} onSelect={onSelectText} onCommit={onTextChange} cancelKey={textCancelKey} /> : null}
      </div>
    </CanvasViewport>
  );
}
