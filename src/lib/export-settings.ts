import { coverPlacement, resolveFrames } from "./crop";
import type { CanvasFormat, ProjectPage, ResolvedFrame, TemplateDefinition } from "./types";

export type ExportSize = Readonly<{ width: number; height: number }>;
// Bound canvas memory, particularly when previewing on mobile. Never change the
// user's composition or silently fall back to a lower-resolution export.
const MAX_EXPORT_PIXELS = 20_000_000;
const MAX_EXPORT_EDGE = 8192;

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

export function exportWidthStep(format: CanvasFormat): number {
  return format.width / gcd(format.width, format.height);
}

export function maximumExportWidth(format: CanvasFormat): number {
  const step = exportWidthStep(format);
  const ratio = format.height / format.width;
  return Math.floor(Math.min(MAX_EXPORT_EDGE, MAX_EXPORT_EDGE / ratio, Math.sqrt(MAX_EXPORT_PIXELS / ratio)) / step) * step;
}

/** Export-only dimensions; integer pixels with exactly the saved page ratio. */
export function getExportSize(format: CanvasFormat, requestedWidth = format.width): ExportSize {
  const step = exportWidthStep(format);
  if (!Number.isFinite(requestedWidth) || requestedWidth < format.width || requestedWidth > maximumExportWidth(format)) {
    throw new Error(`Choose a width from ${format.width} to ${maximumExportWidth(format)} pixels.`);
  }
  const width = Math.round(requestedWidth / step) * step;
  return { width, height: width / step * (format.height / gcd(format.width, format.height)) };
}

/** Resolve once at the editor's dimensions, then scale every length uniformly.
 * This also preserves tiny custom frames, rounded corners and embedded borders. */
export function resolveExportFrames(format: CanvasFormat, template: TemplateDefinition, gutter: number, size: ExportSize): ResolvedFrame[] {
  const expected = getExportSize(format, size.width);
  if (expected.width !== size.width || expected.height !== size.height) throw new Error("Export dimensions must keep the page's aspect ratio.");
  const scale = size.width / format.width;
  return resolveFrames(template, gutter, format.width, format.height).map(frame => ({
    id: frame.id, x: frame.x * scale, y: frame.y * scale,
    width: frame.width * scale, height: frame.height * scale, cornerRadius: frame.cornerRadius * scale,
  }));
}

export interface PhotoExportQuality {
  frameId: string;
  frameNumber: number;
  name: string;
  status: "sufficient" | "soft" | "unknown" | "unavailable";
  /** Output pixels per source pixel, after cover fit and the saved zoom. */
  enlargement?: number;
  visibleSourceWidth?: number;
  visibleSourceHeight?: number;
  visibleOutputWidth?: number;
  visibleOutputHeight?: number;
}

/** Advisory pixel-density check, not a claim about focus or JPEG artifacts.
 * Assess placements separately: the same original may have different crops. */
export function assessPageExportQuality(page: ProjectPage, format: CanvasFormat, template: TemplateDefinition, size: ExportSize): PhotoExportQuality[] {
  return resolveExportFrames(format, template, page.gutter, size).flatMap((frame, index) => {
    const photo = page.photos[frame.id] ?? page.unavailablePhotos?.[frame.id];
    if (!photo) return [];
    const result: PhotoExportQuality = { frameId: frame.id, frameNumber: index + 1, name: photo.sourceName || `Photo ${index + 1}`, status: "unknown" };
    if (page.unavailablePhotos?.[frame.id]) return [{ ...result, status: "unavailable" as const }];
    if (![photo.sourceWidth, photo.sourceHeight, photo.crop.zoom, photo.crop.positionX, photo.crop.positionY].every(Number.isFinite)
      || photo.sourceWidth <= 0 || photo.sourceHeight <= 0) return [result];
    const placement = coverPlacement(photo.sourceWidth, photo.sourceHeight, frame, photo.crop);
    // Exposed background from negative zoom is not photo content. Intersect the
    // placement with both the frame and the canvas, including off-centre crops.
    const visibleOutputWidth = Math.max(0, Math.min(frame.x + frame.width, placement.x + placement.width, size.width) - Math.max(frame.x, placement.x, 0));
    const visibleOutputHeight = Math.max(0, Math.min(frame.y + frame.height, placement.y + placement.height, size.height) - Math.max(frame.y, placement.y, 0));
    return [{ ...result, status: placement.scale > 1 + 1e-6 ? "soft" as const : "sufficient" as const,
      enlargement: placement.scale, visibleSourceWidth: visibleOutputWidth / placement.scale,
      visibleSourceHeight: visibleOutputHeight / placement.scale, visibleOutputWidth, visibleOutputHeight }];
  });
}
