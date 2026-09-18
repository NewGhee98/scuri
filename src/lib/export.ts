import { drawCroppedPhoto } from "./draw-photo";
import { getExportSize, resolveExportFrames, type ExportSize } from "./export-settings";
import { decodeImage } from "./image";
import type { CanvasFormat, PhotoAsset, ProjectPage, TemplateDefinition } from "./types";

export interface ExportOptions {
  format: CanvasFormat;
  template: TemplateDefinition;
  background: string;
  gutter: number;
  photos: Record<string, PhotoAsset>;
  quality?: number;
  signal?: AbortSignal;
  outputSize?: ExportSize;
}

/** Read-only preview uses the actual JPEG path, and never shows a missing
 * assigned original as an empty frame. Empty draft frames remain background. */
export function renderPagePreview(page: ProjectPage, format: CanvasFormat, template: TemplateDefinition, signal?: AbortSignal, outputSize?: ExportSize): Promise<Blob> {
  if (Object.keys(page.unavailablePhotos ?? {}).length) return Promise.reject(new Error("Assigned photos are unavailable."));
  return renderComposition({ format, template, background: page.background, gutter: page.gutter, photos: page.photos, signal, outputSize });
}

export async function renderComposition(options: ExportOptions): Promise<Blob> {
  const { format, template, background, gutter, photos, quality = 0.94, signal } = options;
  signal?.throwIfAborted();
  const outputSize = options.outputSize ?? getExportSize(format);
  const frames = resolveExportFrames(format, template, gutter, outputSize);
  const canvas = document.createElement("canvas");
  canvas.width = outputSize.width;
  canvas.height = outputSize.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Your browser could not start the export.");
  context.fillStyle = background;
  context.fillRect(0, 0, outputSize.width, outputSize.height);

  for (const frame of frames) {
    signal?.throwIfAborted();
    const photo = photos[frame.id];
    if (!photo) continue;
    const decoded = await decodeImage(photo.sourceBlob);
    try {
      signal?.throwIfAborted();
      context.save();
      context.beginPath();
      context.roundRect(frame.x, frame.y, frame.width, frame.height, frame.cornerRadius);
      context.clip();
      drawCroppedPhoto(context, decoded.drawable, decoded.width, decoded.height, frame, photo.crop, background);
      context.restore();
    } finally {
      decoded.close();
    }
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => signal?.aborted ? reject(signal.reason) : (blob ? resolve(blob) : reject(new Error("The JPEG export could not be created."))),
      "image/jpeg",
      quality,
    );
  });
}

export function createExportFilename(format: CanvasFormat, pageNumber?: number, outputSize?: ExportSize): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const page = pageNumber ? `-${String(pageNumber).padStart(2, "0")}` : "";
  const dimensions = outputSize && (outputSize.width !== format.width || outputSize.height !== format.height) ? `-${outputSize.width}x${outputSize.height}` : "";
  return `scuri-${format.shortLabel.toLowerCase()}-${stamp}${page}${dimensions}.jpg`;
}

export async function createExportZip(
  files: Array<{ filename: string; blob: Blob }>,
  projectName: string,
): Promise<{ blob: Blob; filename: string }> {
  const { zipSync } = await import("fflate");
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) entries[file.filename] = new Uint8Array(await file.blob.arrayBuffer());
  const zipped = zipSync(entries, { level: 0 });
  const zipBuffer = new ArrayBuffer(zipped.byteLength);
  new Uint8Array(zipBuffer).set(zipped);
  const safeName = projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "scuri-project";
  return {
    blob: new Blob([zipBuffer], { type: "application/zip" }),
    filename: `${safeName}-${new Date().toISOString().slice(0, 10)}.zip`,
  };
}
