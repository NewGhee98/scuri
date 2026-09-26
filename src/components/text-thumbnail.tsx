"use client";

import { useEffect, useRef } from "react";
import { resolveFrames } from "@/lib/crop";
import { drawTextLayers } from "@/lib/text";
import type { TemplateDefinition } from "@/lib/types";
import { EMPTY_TEXT, useTextFonts } from "./text-layer";

/** Existing SVG thumbnails stay untouched for all templates without text. */
export function TextThumbnail({ template, selected }: { template: TemplateDefinition; selected: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const fonts = useTextFonts(template.textLayers ?? EMPTY_TEXT);
  useEffect(() => {
    const canvas = ref.current, context = canvas?.getContext("2d"); if (!canvas || !context) return;
    const width = 180, height = width * template.canvasHeight / template.canvasWidth;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr; canvas.height = height * dpr;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = template.defaultBackground; context.fillRect(0, 0, width, height);
    resolveFrames(template, template.defaultGutter, width, height).forEach((frame, index) => {
      context.fillStyle = index % 2 ? "#c8c8c6" : "#dededb";
      context.beginPath(); context.roundRect(frame.x, frame.y, frame.width, frame.height, frame.cornerRadius); context.fill();
    });
    if (fonts.ready) drawTextLayers(context, template, width, height);
    if (selected) { context.strokeStyle = "#111"; context.lineWidth = 3; context.strokeRect(1.5, 1.5, width - 3, height - 3); }
  }, [template, selected, fonts.ready]);
  return <span className="relative block h-full w-full"><canvas ref={ref} className="h-full w-full" aria-hidden="true" />
    {!fonts.ready ? <span className="text-thumbnail-status">{fonts.error ? "Text font unavailable" : "Loading text…"}</span> : null}</span>;
}
