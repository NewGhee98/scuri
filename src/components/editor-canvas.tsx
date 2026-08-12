"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { coverPlacement, moveCrop, resolveFrames, setCropZoom } from "@/lib/crop";
import type { CanvasFormat, CropState, PhotoAsset, ResolvedFrame, TemplateDefinition } from "@/lib/types";

interface EditorCanvasProps {
  format: CanvasFormat;
  template: TemplateDefinition;
  background: string;
  gutter: number;
  photos: Record<string, PhotoAsset>;
  selectedFrameId: string | null;
  rearrangeMode: boolean;
  onSelectFrame: (frameId: string) => void;
  onRequestPhoto: (frameId: string) => void;
  onCropChange: (frameId: string, crop: CropState) => void;
  onMovePhoto: (sourceFrameId: string, targetFrameId: string) => void;
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
  selectedFrameId,
  rearrangeMode,
  onSelectFrame,
  onRequestPhoto,
  onCropChange,
  onMovePhoto,
}: EditorCanvasProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageCacheRef = useRef(new Map<string, HTMLImageElement>());
  const pointersRef = useRef(new Map<number, Point>());
  const dragRef = useRef<{ frameId: string; last: Point; distance: number } | null>(null);
  const pinchRef = useRef<{ frameId: string; startDistance: number; startZoom: number } | null>(null);
  const swapDragRef = useRef<{ pointerId: number; sourceFrameId: string; targetFrameId: string } | null>(null);
  const [size, setSize] = useState({ width: 320, height: (320 * format.height) / format.width });
  const [imageRevision, setImageRevision] = useState(0);
  const [swapTargetFrameId, setSwapTargetFrameId] = useState<string | null>(null);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const update = () => {
      const availableWidth = shell.clientWidth;
      const availableHeight = Math.max(340, window.innerHeight - (window.innerWidth >= 900 ? 150 : 250));
      const width = Math.max(240, Math.min(availableWidth, (availableHeight * format.width) / format.height));
      setSize({ width, height: (width * format.height) / format.width });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(shell);
    window.addEventListener("orientationchange", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("orientationchange", update);
    };
  }, [format.height, format.width]);

  useEffect(() => {
    const cache = imageCacheRef.current;
    const activeUrls = new Set(Object.values(photos).map((photo) => photo.previewUrl));
    for (const key of cache.keys()) {
      if (!activeUrls.has(key)) cache.delete(key);
    }
    for (const photo of Object.values(photos)) {
      if (cache.has(photo.previewUrl)) continue;
      const image = new Image();
      image.decoding = "async";
      image.onload = () => setImageRevision((revision) => revision + 1);
      image.src = photo.previewUrl;
      cache.set(photo.previewUrl, image);
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
        const image = imageCacheRef.current.get(photo.previewUrl);
        if (image?.complete && image.naturalWidth) {
          const placement = coverPlacement(photo.sourceWidth, photo.sourceHeight, frame, photo.crop);
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = "high";
          context.drawImage(image, placement.x, placement.y, placement.width, placement.height);
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
        context.fillText("Tap to add photo", frame.x + frame.width / 2, frame.y + frame.height / 2, frame.width - 16);
      }
      context.restore();

      if (swapTargetFrameId === frame.id && swapDragRef.current?.sourceFrameId !== frame.id) {
        context.save();
        context.strokeStyle = "#1f8f55";
        context.lineWidth = 5;
        context.beginPath();
        context.roundRect(frame.x + 2.5, frame.y + 2.5, Math.max(0, frame.width - 5), Math.max(0, frame.height - 5), frame.cornerRadius);
        context.stroke();
        context.restore();
      } else if (selectedFrameId === frame.id) {
        context.save();
        context.strokeStyle = "#0a0a0a";
        context.lineWidth = 3;
        context.setLineDash([8, 5]);
        context.beginPath();
        context.roundRect(frame.x + 1.5, frame.y + 1.5, Math.max(0, frame.width - 3), Math.max(0, frame.height - 3), frame.cornerRadius);
        context.stroke();
        context.restore();
      }
    }
  }, [background, frames, imageRevision, photos, selectedFrameId, size.height, size.width, swapTargetFrameId]);

  const canvasPoint = useCallback((event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * size.width,
      y: ((event.clientY - rect.top) / rect.height) * size.height,
    };
  }, [size.height, size.width]);

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = canvasPoint(event);
    pointersRef.current.set(event.pointerId, point);
    if (swapDragRef.current) return;
    const target = hitTest(frames, point);
    if (!target) return;
    onSelectFrame(target.id);
    if (rearrangeMode && photos[target.id]) {
      swapDragRef.current = { pointerId: event.pointerId, sourceFrameId: target.id, targetFrameId: target.id };
      setSwapTargetFrameId(target.id);
      dragRef.current = null;
      pinchRef.current = null;
      return;
    }
    if (!photos[target.id]) {
      dragRef.current = { frameId: target.id, last: point, distance: 0 };
      return;
    }
    if (pointersRef.current.size === 1) {
      dragRef.current = { frameId: target.id, last: point, distance: 0 };
    } else if (pointersRef.current.size === 2) {
      const points = [...pointersRef.current.values()];
      pinchRef.current = {
        frameId: target.id,
        startDistance: Math.max(1, pointerDistance(points)),
        startZoom: photos[target.id].crop.zoom,
      };
      dragRef.current = null;
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    event.preventDefault();
    const point = canvasPoint(event);
    pointersRef.current.set(event.pointerId, point);
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
      onCropChange(
        pinchRef.current.frameId,
        setCropZoom(photo.crop, pinchRef.current.startZoom * (distance / pinchRef.current.startDistance)),
      );
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    const photo = photos[drag.frameId];
    const target = frames.find((frame) => frame.id === drag.frameId);
    const deltaX = point.x - drag.last.x;
    const deltaY = point.y - drag.last.y;
    drag.distance += Math.hypot(deltaX, deltaY);
    drag.last = point;
    if (photo && target) {
      onCropChange(
        drag.frameId,
        moveCrop(photo.sourceWidth, photo.sourceHeight, target, photo.crop, deltaX, deltaY),
      );
    }
  };

  const endPointer = (event: React.PointerEvent<HTMLCanvasElement>, commitSwap: boolean) => {
    event.preventDefault();
    const swapDrag = swapDragRef.current;
    if (commitSwap && swapDrag?.pointerId === event.pointerId && swapDrag.sourceFrameId !== swapDrag.targetFrameId) {
      onMovePhoto(swapDrag.sourceFrameId, swapDrag.targetFrameId);
    }
    const drag = dragRef.current;
    if (drag && drag.distance < 6 && !photos[drag.frameId]) onRequestPhoto(drag.frameId);
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (swapDrag?.pointerId === event.pointerId) {
      swapDragRef.current = null;
      setSwapTargetFrameId(null);
    }
    if (pointersRef.current.size === 0) {
      dragRef.current = null;
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    if (rearrangeMode || !selectedFrameId || !photos[selectedFrameId]) return;
    event.preventDefault();
    const photo = photos[selectedFrameId];
    onCropChange(selectedFrameId, setCropZoom(photo.crop, photo.crop.zoom * (event.deltaY > 0 ? 0.94 : 1.06)));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!selectedFrameId) return;
    const photo = photos[selectedFrameId];
    const target = frames.find((frame) => frame.id === selectedFrameId);
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
      onCropChange(selectedFrameId, setCropZoom(photo.crop, photo.crop.zoom + 0.1));
    } else if (event.key === "-") {
      event.preventDefault();
      onCropChange(selectedFrameId, setCropZoom(photo.crop, photo.crop.zoom - 0.1));
    } else if (target && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
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
    <div ref={shellRef} className="flex min-h-[340px] w-full items-center justify-center overflow-hidden">
      <canvas
        ref={canvasRef}
        className={`ios-gesture-surface block max-w-full touch-none bg-white shadow-[0_16px_50px_rgba(0,0,0,0.14)] outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-4 ${rearrangeMode ? "cursor-grab" : ""}`}
        aria-label={rearrangeMode
          ? "Photo layout canvas in rearrange mode. Drag a filled frame onto another frame to swap or move its photo."
          : "Photo layout canvas. Tap a frame to select it, drag to reposition, and pinch to zoom."}
        role="application"
        tabIndex={0}
        draggable={false}
        onContextMenu={(event) => event.preventDefault()}
        onDragStart={(event) => event.preventDefault()}
        onKeyDown={handleKeyDown}
        onPointerCancel={(event) => endPointer(event, false)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => endPointer(event, true)}
        onWheel={handleWheel}
      />
    </div>
  );
}
