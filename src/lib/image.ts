import { DEFAULT_CROP } from "./crop";
import type { PhotoAsset } from "./types";

export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const MAX_SOURCE_BYTES = 80 * 1024 * 1024;
const PREVIEW_LONG_EDGE = 2200;

type DecodedImage = {
  drawable: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

function isAcceptedFile(file: Blob & { name?: string }): boolean {
  if (ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) return true;
  return Boolean(file.name && /\.(jpe?g|png|webp)$/i.test(file.name));
}

export function validateImageFile(file: File): void {
  if (!isAcceptedFile(file)) {
    throw new Error("Choose a JPEG, PNG or WebP image.");
  }
  if (file.size === 0) throw new Error("That image file is empty or damaged.");
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error("That photo is over 80 MB. Please choose a smaller copy.");
  }
}

export async function decodeImage(blob: Blob): Promise<DecodedImage> {
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      if (!bitmap.width || !bitmap.height) throw new Error("Invalid image dimensions.");
      return {
        drawable: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // Safari versions with partial ImageBitmap support fall through to HTMLImageElement.
    }
  }

  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("This image could not be opened. It may be damaged or unsupported.");
  }
  if (!image.naturalWidth || !image.naturalHeight) {
    URL.revokeObjectURL(url);
    throw new Error("This image has invalid dimensions.");
  }
  return {
    drawable: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    close: () => URL.revokeObjectURL(url),
  };
}

export async function createPhotoPreview(blob: Blob): Promise<{ blob: Blob; previewUrl: string; width: number; height: number }> {
  const decoded = await decodeImage(blob);
  try {
    const scale = Math.min(1, PREVIEW_LONG_EDGE / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not prepare an image preview.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.clearRect(0, 0, width, height);
    context.drawImage(decoded.drawable, 0, 0, width, height);
    const previewBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error("Your browser could not prepare an image preview."))),
        "image/webp",
        0.86,
      );
    });
    return { blob: previewBlob, previewUrl: URL.createObjectURL(previewBlob), width: decoded.width, height: decoded.height };
  } finally {
    decoded.close();
  }
}

export async function preparePhotoAsset(
  sourceBlob: Blob,
  frameId: string,
  blobKey = crypto.randomUUID(),
): Promise<PhotoAsset> {
  const preview = await createPhotoPreview(sourceBlob);
  return {
    frameId,
    blobKey,
    sourceBlob,
    previewUrl: preview.previewUrl,
    sourceWidth: preview.width,
    sourceHeight: preview.height,
    crop: { ...DEFAULT_CROP },
  };
}

export function disposePhotoAsset(asset: PhotoAsset): void {
  URL.revokeObjectURL(asset.previewUrl);
}
