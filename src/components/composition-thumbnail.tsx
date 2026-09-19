"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { resolveFrames } from "@/lib/crop";
import { drawCroppedPhoto } from "@/lib/draw-photo";
import type { CanvasFormat, ProjectPage, TemplateDefinition } from "@/lib/types";
import { usePagePreviews } from "./photo-preview-context";

interface CompositionThumbnailProps {
  format: CanvasFormat;
  page: ProjectPage;
  template: TemplateDefinition;
}

export function CompositionThumbnail({ format, page, template }: CompositionThumbnailProps) {
  const [visible, setVisible] = useState(false);
  const photos = usePagePreviews(page, visible);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cacheRef = useRef(new Map<string, HTMLImageElement>());
  const [revision, setRevision] = useState(0);
  const width = 280;
  const height = (width * format.height) / format.width;
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    if (typeof IntersectionObserver === "undefined") { queueMicrotask(() => setVisible(true)); return; }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "200px" });
    observer.observe(canvas); return () => observer.disconnect();
  }, []);
  const frames = useMemo(
    () => resolveFrames(template, page.gutter, width, height),
    [height, page.gutter, template],
  );

  useEffect(() => {
    const cache = cacheRef.current;
    const activeUrls = new Set(Object.values(photos).flatMap(photo => [photo.previewUrl, photo.fallbackPreviewUrl].filter((url): url is string => Boolean(url))));
    for (const [key, image] of cache) if (!activeUrls.has(key)) { image.onload = null; image.src = ""; cache.delete(key); }
    for (const url of activeUrls) {
      if (cache.has(url)) continue;
      const image = new Image();
      image.decoding = "async";
      image.onload = () => setRevision((value) => value + 1);
      image.src = url;
      cache.set(url, image);
    }
  }, [photos]);

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
      const photo = photos[frame.id];
      context.save();
      context.beginPath();
      context.roundRect(frame.x, frame.y, frame.width, frame.height, frame.cornerRadius);
      context.clip();
      if (photo) {
        const primary = cacheRef.current.get(photo.previewUrl);
        const image = primary?.complete && primary.naturalWidth ? primary : cacheRef.current.get(photo.fallbackPreviewUrl ?? "");
        if (image?.complete && image.naturalWidth) {
          drawCroppedPhoto(context, image, photo.sourceWidth, photo.sourceHeight, frame, photo.crop, page.background);
        }
      } else {
        context.fillStyle = "#e7e7e3";
        context.fillRect(frame.x, frame.y, frame.width, frame.height);
      }
      context.restore();
    }
  }, [frames, height, page.background, photos, revision]);

  return (
    <canvas
      ref={canvasRef}
      className="block h-auto w-full bg-white"
      style={{ aspectRatio: `${format.width}/${format.height}` }}
      aria-label={`${template.name} page preview`}
    />
  );
}
