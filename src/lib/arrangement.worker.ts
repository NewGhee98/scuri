import { analysePixels } from "./photo-palette";
import { suggestArrangements, type ArrangementInput } from "./arrangements";
import { fingerprintOriginal } from "./photo-fingerprint";

export type ArrangementWorkerRequest = { id: number } & (
  { kind: "analyse"; blob: Blob; width: number; height: number } |
  { kind: "fingerprint"; blob: Blob } |
  { kind: "suggest"; input: ArrangementInput }
);

const scope = globalThis as unknown as { onmessage: (event: MessageEvent<ArrangementWorkerRequest>) => void; postMessage: (message: unknown) => void };
scope.onmessage = async ({ data }) => {
  try {
    if (data.kind === "fingerprint") { scope.postMessage({ id: data.id, result: await fingerprintOriginal(data.blob) }); return; }
    if (data.kind === "suggest") { scope.postMessage({ id: data.id, result: suggestArrangements(data.input) }); return; }
    if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") throw new Error("Local photo analysis is not supported in this browser. Your photos remain in the library.");
    // Decode one uncropped image at a time. Known original dimensions allow
    // browser decoding directly to a small bitmap without a large canvas.
    const factor = Math.min(1, 320 / Math.max(data.width, data.height));
    const bitmap = await createImageBitmap(data.blob, { imageOrientation: "from-image", ...(data.width > 0 && data.height > 0 ? {
      resizeWidth: Math.max(1, Math.round(data.width * factor)), resizeHeight: Math.max(1, Math.round(data.height * factor)), resizeQuality: "medium" as const,
    } : {}) });
    try {
      const width = data.width || bitmap.width, height = data.height || bitmap.height;
      const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
      const sample = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
      const context = sample.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Local image analysis could not start.");
      context.drawImage(bitmap, 0, 0, sample.width, sample.height);
      const analysis = analysePixels(context.getImageData(0, 0, sample.width, sample.height).data, width, height);
      const thumbScale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
      const thumbnail = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * thumbScale)), Math.max(1, Math.round(bitmap.height * thumbScale)));
      const thumbContext = thumbnail.getContext("2d");
      if (!thumbContext) throw new Error("Photo preview could not be created.");
      thumbContext.drawImage(bitmap, 0, 0, thumbnail.width, thumbnail.height);
      scope.postMessage({ id: data.id, result: { analysis, thumbnail: await thumbnail.convertToBlob({ type: "image/webp", quality: 0.8 }) } });
    } finally { bitmap.close(); }
  } catch (error) { scope.postMessage({ id: data.id, error: error instanceof Error ? error.message : "Local analysis failed; the photo was retained." }); }
};
