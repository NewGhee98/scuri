import { FORMATS, getFormat } from "./formats";
import type { CustomTemplate, FormatId, NormalizedFrame, TemplateDefinition } from "./types";

export type TemplateEdgeStyle = "rounded" | "straight" | "mixed";

export type TemplateLibraryFilters = {
  formatId: FormatId | "all";
  photoCount: number | "all";
  edgeStyle: TemplateEdgeStyle | "all";
};

const frame = (id: string, x: number, y: number, width: number, height: number, cornerRadius?: number): NormalizedFrame => ({
  id,
  x,
  y,
  width,
  height,
  cornerRadius,
});

const layouts: Array<Pick<TemplateDefinition, "name" | "defaultGutter" | "frames" | "frameInsetMultiplier"> & { slug: string }> = [
  {
    slug: "full-frame",
    name: "Full frame",
    defaultGutter: 0,
    frames: [frame("photo-1", 0, 0, 1, 1)],
  },
  {
    slug: "wide-border",
    name: "Gallery border",
    defaultGutter: 84,
    frameInsetMultiplier: 2,
    frames: [frame("photo-1", 0, 0, 1, 1)],
  },
  {
    slug: "vertical-pair",
    name: "Vertical pair",
    defaultGutter: 24,
    frames: [frame("photo-1", 0, 0, 1, 0.5), frame("photo-2", 0, 0.5, 1, 0.5)],
  },
  {
    slug: "side-by-side",
    name: "Side by side",
    defaultGutter: 24,
    frames: [frame("photo-1", 0, 0, 0.5, 1), frame("photo-2", 0.5, 0, 0.5, 1)],
  },
  {
    slug: "hero-trio",
    name: "Hero trio",
    defaultGutter: 24,
    frames: [
      frame("photo-1", 0, 0, 1, 0.62),
      frame("photo-2", 0, 0.62, 0.5, 0.38),
      frame("photo-3", 0.5, 0.62, 0.5, 0.38),
    ],
  },
  {
    slug: "tall-trio",
    name: "Tall trio",
    defaultGutter: 24,
    frames: [
      frame("photo-1", 0, 0, 0.58, 1),
      frame("photo-2", 0.58, 0, 0.42, 0.5),
      frame("photo-3", 0.58, 0.5, 0.42, 0.5),
    ],
  },
  {
    slug: "four-grid",
    name: "Four grid",
    defaultGutter: 24,
    frames: [
      frame("photo-1", 0, 0, 0.5, 0.5),
      frame("photo-2", 0.5, 0, 0.5, 0.5),
      frame("photo-3", 0, 0.5, 0.5, 0.5),
      frame("photo-4", 0.5, 0.5, 0.5, 0.5),
    ],
  },
  {
    slug: "editorial-four",
    name: "Editorial four",
    defaultGutter: 22,
    frames: [
      frame("photo-1", 0, 0, 0.64, 0.64),
      frame("photo-2", 0.64, 0, 0.36, 0.72),
      frame("photo-3", 0, 0.64, 0.64, 0.36),
      frame("photo-4", 0.64, 0.72, 0.36, 0.28),
    ],
  },
  {
    slug: "rounded-stories",
    name: "Rounded stories",
    defaultGutter: 34,
    frames: [
      frame("photo-1", 0, 0, 1, 0.32, 0.11),
      frame("photo-2", 0, 0.32, 1, 0.36, 0.11),
      frame("photo-3", 0, 0.68, 1, 0.32, 0.11),
    ],
  },
  {
    slug: "travel-notes",
    name: "Travel notes",
    defaultGutter: 34,
    frames: [
      frame("photo-1", 0, 0, 0.4, 0.42, 0.12),
      frame("photo-2", 0, 0.42, 0.4, 0.4, 0.12),
      frame("photo-3", 0.4, 0, 0.6, 0.82, 0.12),
      frame("photo-4", 0, 0.82, 1, 0.18, 0.1),
    ],
  },
  {
    slug: "editorial-portrait",
    name: "Editorial portrait",
    defaultGutter: 42,
    frames: [frame("photo-1", 0, 0, 1, 1, 0.08)],
  },
  {
    slug: "formal-gathering",
    name: "Formal gathering",
    defaultGutter: 34,
    frames: [
      frame("photo-1", 0, 0, 1, 0.2, 0.1),
      frame("photo-2", 0, 0.2, 0.42, 0.26, 0.12),
      frame("photo-3", 0.42, 0.2, 0.58, 0.26, 0.12),
      frame("photo-4", 0, 0.46, 0.68, 0.54, 0.12),
      frame("photo-5", 0.68, 0.46, 0.32, 0.27, 0.12),
      frame("photo-6", 0.68, 0.73, 0.32, 0.27, 0.12),
    ],
  },
  {
    slug: "night-frames",
    name: "Night frames",
    defaultGutter: 34,
    frames: [
      frame("photo-1", 0, 0, 1, 0.3, 0.06),
      frame("photo-2", 0, 0.3, 1, 0.38, 0.06),
      frame("photo-3", 0, 0.68, 1, 0.32, 0.06),
    ],
  },
  {
    slug: "quiet-landscape",
    name: "Quiet landscape",
    defaultGutter: 72,
    frames: [frame("photo-1", 0, 0, 1, 1)],
  },

];

export const TEMPLATES: readonly TemplateDefinition[] = FORMATS.flatMap((format) =>
  layouts.map((layout) => ({
    id: `${format.id}-${layout.slug}`,
    name: layout.name,
    formatId: format.id,
    canvasWidth: format.width,
    canvasHeight: format.height,
    defaultBackground: "#ffffff",
    defaultGutter: layout.defaultGutter,
    frameInsetMultiplier: layout.frameInsetMultiplier,
    frames: layout.frames,
  })),
);

export function getTemplatesForFormat(formatId: FormatId, customTemplates: readonly CustomTemplate[] = []): TemplateDefinition[] {
  return [
    ...TEMPLATES.filter((template) => template.formatId === formatId),
    ...customTemplates.filter((template) => template.status === "saved" && template.formatId === formatId),
  ];
}

export function getTemplateEdgeStyle(template: Pick<TemplateDefinition, "frames">): TemplateEdgeStyle {
  const roundedFrameCount = template.frames.filter((item) => (item.cornerRadius ?? 0) > 0).length;
  if (roundedFrameCount === 0) return "straight";
  if (roundedFrameCount === template.frames.length) return "rounded";
  return "mixed";
}

export function filterTemplates<T extends TemplateDefinition>(
  templates: readonly T[],
  filters: TemplateLibraryFilters,
): T[] {
  return templates.filter((template) => (
    (filters.formatId === "all" || template.formatId === filters.formatId) &&
    (filters.photoCount === "all" || template.frames.length === filters.photoCount) &&
    (filters.edgeStyle === "all" || getTemplateEdgeStyle(template) === filters.edgeStyle)
  ));
}

export function getTemplate(templateId: string, customTemplates: readonly CustomTemplate[] = []): TemplateDefinition {
  const template = TEMPLATES.find((candidate) => candidate.id === templateId) ??
    customTemplates.find((candidate) => candidate.id === templateId);
  if (!template) {
    throw new Error(`Unknown template: ${templateId}`);
  }
  return template;
}

export function validateTemplate(template: TemplateDefinition): string[] {
  const errors: string[] = [];
  const format = getFormat(template.formatId);

  if (!template.id.trim()) errors.push("Template ID is required.");
  if (!template.name.trim()) errors.push("Template name is required.");
  if (template.canvasWidth !== format.width || template.canvasHeight !== format.height) {
    errors.push("Template canvas must match its output format.");
  }
  if (template.frames.length === 0) errors.push("A template needs at least one frame.");
  if (new Set(template.frames.map((item) => item.id)).size !== template.frames.length) {
    errors.push("Frame IDs must be unique within a template.");
  }
  for (const item of template.frames) {
    const values = [item.x, item.y, item.width, item.height];
    if (values.some((value) => !Number.isFinite(value))) errors.push(`${item.id} has invalid coordinates.`);
    if (item.x < 0 || item.y < 0 || item.width <= 0 || item.height <= 0) {
      errors.push(`${item.id} must use positive normalised bounds.`);
    }
    if (item.x + item.width > 1.000001 || item.y + item.height > 1.000001) {
      errors.push(`${item.id} falls outside the canvas.`);
    }
    if ((item.cornerRadius ?? 0) < 0 || (item.cornerRadius ?? 0) > 0.5) {
      errors.push(`${item.id} has an invalid corner radius.`);
    }
  }
  return errors;
}
