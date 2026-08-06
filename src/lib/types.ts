export type FormatId = "instagram-post" | "instagram-story";

export interface CanvasFormat {
  id: FormatId;
  name: string;
  shortLabel: string;
  aspectRatio: string;
  width: number;
  height: number;
  description: string;
}

export interface NormalizedFrame {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TemplateDefinition {
  id: string;
  name: string;
  formatId: FormatId;
  canvasWidth: number;
  canvasHeight: number;
  defaultBackground: string;
  defaultGutter: number;
  frameInsetMultiplier?: number;
  frames: NormalizedFrame[];
}

export interface ResolvedFrame {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropState {
  positionX: number;
  positionY: number;
  zoom: number;
}

export interface PhotoAsset {
  frameId: string;
  blobKey: string;
  sourceBlob: Blob;
  previewUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  crop: CropState;
}

export interface StoredPhotoAsset {
  frameId: string;
  blobKey: string;
  sourceWidth: number;
  sourceHeight: number;
  crop: CropState;
}

export type AppScreen = "format" | "template" | "editor" | "export";

export interface StoredProject {
  version: 1;
  screen: AppScreen;
  formatId: FormatId | null;
  templateId: string | null;
  background: string;
  gutter: number;
  selectedFrameId: string | null;
  photos: Record<string, StoredPhotoAsset>;
  updatedAt: string;
}
