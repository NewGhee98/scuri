import type { CanvasFormat, FormatId } from "./types";

export const FORMATS: readonly CanvasFormat[] = [
  {
    id: "instagram-post",
    name: "Instagram Post",
    shortLabel: "Post",
    aspectRatio: "4:5",
    width: 1080,
    height: 1350,
    description: "Portrait feed post",
  },
  {
    id: "instagram-square",
    name: "Instagram Square",
    shortLabel: "Square",
    aspectRatio: "1:1",
    width: 1080,
    height: 1080,
    description: "Square feed post",
  },
  {
    id: "instagram-story",
    name: "Instagram Story",
    shortLabel: "Story",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    description: "Full-screen story",
  },
] as const;

export function getFormat(id: FormatId): CanvasFormat {
  const format = FORMATS.find((candidate) => candidate.id === id);
  if (!format) {
    throw new Error(`Unknown canvas format: ${id}`);
  }
  return format;
}

export function getExportDimensions(id: FormatId): { width: number; height: number } {
  const { width, height } = getFormat(id);
  return { width, height };
}
