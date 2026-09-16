import { resolveFrames } from "./crop";
import type { ProjectPage, TemplateDefinition } from "./types";

/** Materialize existing visible bounds only on an explicit move. Keeping frame
 * IDs, sizes and crop objects preserves every assignment, even without bytes. */
export function movePageFrame(page: ProjectPage, template: TemplateDefinition, frameId: string, x: number, y: number): ProjectPage {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return page;
  const resolved = resolveFrames(template, page.gutter);
  const selected = resolved.find(frame => frame.id === frameId);
  if (!selected) return page;
  x = Math.max(0, Math.min(template.canvasWidth - selected.width, x));
  y = Math.max(0, Math.min(template.canvasHeight - selected.height, y));
  if (Math.abs(x - selected.x) < 1e-9 && Math.abs(y - selected.y) < 1e-9) return page;
  const frames = resolved.map(frame => ({ ...template.frames.find(item => item.id === frame.id)!,
    x: (frame.id === frameId ? x : frame.x) / template.canvasWidth,
    y: (frame.id === frameId ? y : frame.y) / template.canvasHeight,
    width: frame.width / template.canvasWidth, height: frame.height / template.canvasHeight,
    cornerRadius: frame.cornerRadius / Math.min(frame.width, frame.height) }));
  return { ...page, gutter: 0, templateSnapshot: { ...template, frames, defaultGutter: 0, frameInsetMultiplier: 1, outerInsetMultiplier: 1 } };
}

export function reorderPageFrame(page: ProjectPage, template: TemplateDefinition, frameId: string, offset: -1 | 1): ProjectPage {
  const index = template.frames.findIndex(frame => frame.id === frameId), destination = index + offset;
  if (index < 0 || destination < 0 || destination >= template.frames.length) return page;
  const frames = [...template.frames];
  [frames[index], frames[destination]] = [frames[destination], frames[index]];
  return { ...page, templateSnapshot: { ...template, frames } };
}
