import type { PhotoRank, ProjectPhoto } from "./types";

export const PHOTO_RANKS: readonly PhotoRank[] = ["hero", "good", "other"];
export const PHOTO_RANK_LABELS = { hero: "Hero", good: "Good", other: "Other", unranked: "Unranked" };
export type PhotoMetadataEdit = { rank: PhotoRank | null } | { addLabels: string[] } | { removeLabel: string };

export function isPhotoRank(value: unknown): value is PhotoRank {
  return PHOTO_RANKS.includes(value as PhotoRank);
}

/** One canonical spelling across devices, suggestions, filtering and bulk edits. */
export function normalizePhotoLabel(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

export function normalizePhotoLabels(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizePhotoLabel).filter(Boolean))].sort();
}

export function projectPhotoLabels(photos: readonly ProjectPhoto[]): string[] {
  return normalizePhotoLabels(photos.flatMap(photo => photo.labels ?? []));
}
