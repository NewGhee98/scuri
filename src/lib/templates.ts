import { FORMATS, getFormat } from "./formats";
import type { FormatId, NormalizedFrame, TemplateDefinition } from "./types";

const frame = (id: string, x: number, y: number, width: number, height: number): NormalizedFrame => ({
  id,
  x,
  y,
  width,
  height,
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

export function getTemplatesForFormat(formatId: FormatId): TemplateDefinition[] {
  return TEMPLATES.filter((template) => template.formatId === formatId);
}

export function getTemplate(templateId: string): TemplateDefinition {
  const template = TEMPLATES.find((candidate) => candidate.id === templateId);
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
  }
  return errors;
}
