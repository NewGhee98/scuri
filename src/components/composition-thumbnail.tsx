"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { coverPlacement, resolveFrames } from "@/lib/crop";
import type { CanvasFormat, ProjectPage, TemplateDefinition } from "@/lib/types";

interface CompositionThumbnailProps {
  format: CanvasFormat;
  page: ProjectPage;
  template: TemplateDefinition;
}

export function CompositionThumbnail({ format, page, template }: CompositionThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cacheRef = useRef(new Map<string, HTMLImageElement>());
  const [revision, setRevision] = useState(0);
  const width = 280;
  const height = (width * format.height) / format.width;
  const frames = useMemo(
    () => resolveFrames(template, page.gutter, width, height),
    [height, page.gutter, template],
  );

  useEffect(() => {
    const cache = cacheRef.current;
    const activeUrls = new Set(Object.values(page.photos).map((photo) => photo.previewUrl));
    for (const key of cache.keys()) if (!activeUrls.has(key)) cache.delete(key);
    for (const photo of Object.values(page.photos)) {
      if (cache.has(photo.previewUrl)) continue;
      const image = new Image();
      image.decoding = "async";
      image.onload = () => setRevision((value) => value + 1);
      image.src = photo.previewUrl;
      cache.set(photo.previewUrl, image);
    }
  }, [page.photos]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = page.background;
    context.fillRect(0, 0, width, height);
    for (const frame of frames) {
      const photo = page.photos[frame.id];
      context.save();
      context.beginPath();
      context.rect(frame.x, frame.y, frame.width, frame.height);
      context.clip();
      if (photo) {
        const image = cacheRef.current.get(photo.previewUrl);
        if (image?.complete && image.naturalWidth) {
          const placement = coverPlacement(photo.sourceWidth, photo.sourceHeight, frame, photo.crop);
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = "high";
          context.drawImage(image, placement.x, placement.y, placement.width, placement.height);
        }
      } else {
        context.fillStyle = "#e7e7e3";
        context.fillRect(frame.x, frame.y, frame.width, frame.height);
      }
      context.restore();
    }
  }, [frames, height, page.background, page.photos, revision]);

  return (
    <canvas
      ref={canvasRef}
      className="block h-auto w-full bg-white"
      style={{ aspectRatio: `${format.width}/${format.height}` }}
      aria-label={`${template.name} page preview`}
    />
  );
}
