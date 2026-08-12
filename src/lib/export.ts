import { coverPlacement, resolveFrames } from "./crop";
import { decodeImage } from "./image";
import type { CanvasFormat, PhotoAsset, TemplateDefinition } from "./types";

export interface ExportOptions {
  format: CanvasFormat;
  template: TemplateDefinition;
  background: string;
  gutter: number;
  photos: Record<string, PhotoAsset>;
  quality?: number;
}

export async function renderComposition(options: ExportOptions): Promise<Blob> {
  const { format, template, background, gutter, photos, quality = 0.94 } = options;
  const canvas = document.createElement("canvas");
  canvas.width = format.width;
  canvas.height = format.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Your browser could not start the export.");
  context.fillStyle = background;
  context.fillRect(0, 0, format.width, format.height);

  const frames = resolveFrames(template, gutter, format.width, format.height);
  for (const frame of frames) {
    const photo = photos[frame.id];
    if (!photo) continue;
    const decoded = await decodeImage(photo.sourceBlob);
    try {
      const placement = coverPlacement(decoded.width, decoded.height, frame, photo.crop);
      context.save();
      context.beginPath();
      context.roundRect(frame.x, frame.y, frame.width, frame.height, frame.cornerRadius);
      context.clip();
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(decoded.drawable, placement.x, placement.y, placement.width, placement.height);
      context.restore();
    } finally {
      decoded.close();
    }
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The JPEG export could not be created."))),
      "image/jpeg",
      quality,
    );
  });
}

export function createExportFilename(format: CanvasFormat, pageNumber?: number): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const page = pageNumber ? `-${String(pageNumber).padStart(2, "0")}` : "";
  return `layouts-${format.shortLabel.toLowerCase()}-${stamp}${page}.jpg`;
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
    .replace(/^-|-$/g, "") || "layouts-project";
  return {
    blob: new Blob([zipBuffer], { type: "application/zip" }),
    filename: `${safeName}-${new Date().toISOString().slice(0, 10)}.zip`,
  };
}
