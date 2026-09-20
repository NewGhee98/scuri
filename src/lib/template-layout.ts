import type { FrameArrangement, FrameMargins, NormalizedFrame } from "./types";
import { MIN_FRAME_PIXELS, resizeFrame, type ResizeHandle } from "./frame-resize";

export interface DesignSize { width: number; height: number }
export interface FrameBounds { x: number; y: number; width: number; height: number }
export interface LayoutResult { frames: NormalizedFrame[]; notice?: string }
export interface MatchingGap { delta: number; start: number; end: number; cross: number; gap: number }
export const ZERO_MARGINS: FrameMargins = { top: 0, right: 0, bottom: 0, left: 0, linked: true };
export const FRAME_RATIOS = [
  { label: "Square · 1:1", width: 1, height: 1 },
  { label: "2:1", width: 2, height: 1 },
  { label: "3:2", width: 3, height: 2 },
  { label: "4:3", width: 4, height: 3 },
  { label: "16:9", width: 16, height: 9 },
  { label: "Standard Pano · 40:9", width: 40, height: 9 },
  { label: "Ultra Pano · 768:115", width: 768, height: 115 },
] as const;

const EPS = 1e-10;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const failure = (frames: NormalizedFrame[], notice = "These dimensions cannot fit within the margins with the chosen gap. Reduce the gap or margins."): LayoutResult => ({ frames, notice });
const finitePositive = (n: number) => Number.isFinite(n) && n > 0;

export function frameBounds(frames: readonly NormalizedFrame[]): FrameBounds {
  if (!frames.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...frames.map(f => f.x)), y = Math.min(...frames.map(f => f.y));
  return { x, y, width: Math.max(...frames.map(f => f.x + f.width)) - x,
    height: Math.max(...frames.map(f => f.y + f.height)) - y };
}

/** Match actual adjacent frame-edge gaps, with a tolerance supplied in screen units. */
export function matchingFrameGap(others: readonly NormalizedFrame[], moving: FrameBounds, axis: "x" | "y", tolerance: number): MatchingGap | null {
  const extent = axis === "x" ? "width" : "height", crossAxis = axis === "x" ? "y" : "x", crossExtent = axis === "x" ? "height" : "width";
  const crosses = (a: FrameBounds, b: FrameBounds) => Math.min(a[crossAxis] + a[crossExtent], b[crossAxis] + b[crossExtent]) > Math.max(a[crossAxis], b[crossAxis]);
  const gaps = new Set<number>();
  for (const a of others) {
    const adjacent = others.filter(b => a.id !== b.id && crosses(a, b) && b[axis] >= a[axis] + a[extent] - EPS)
      .sort((b, c) => b[axis] - c[axis])[0];
    if (adjacent) { const gap = adjacent[axis] - a[axis] - a[extent]; if (gap > EPS) gaps.add(gap); }
  }
  let closest: MatchingGap | null = null;
  for (const target of others) {
    if (!crosses(target, moving)) continue;
    const cross = (Math.max(target[crossAxis], moving[crossAxis]) + Math.min(target[crossAxis] + target[crossExtent], moving[crossAxis] + moving[crossExtent])) / 2;
    for (const gap of gaps) for (const after of [true, false]) {
      const desired = after ? target[axis] + target[extent] + gap : target[axis] - gap - moving[extent];
      const delta = desired - moving[axis];
      if (Math.abs(delta) > tolerance || (closest && Math.abs(delta) >= Math.abs(closest.delta))) continue;
      closest = { delta, gap, cross, start: after ? target[axis] + target[extent] : target[axis] - gap,
        end: after ? target[axis] + target[extent] + gap : target[axis] };
    }
  }
  return closest;
}

export function actualFrameRatio(frame: NormalizedFrame, size: DesignSize): number {
  return frame.width * size.width / (frame.height * size.height);
}

export function marginsFor(frame?: NormalizedFrame): FrameMargins {
  return frame?.layoutMargins ?? ZERO_MARGINS;
}

export function arrangementMembers(frames: readonly NormalizedFrame[], id: string): NormalizedFrame[] {
  return frames.filter(f => f.arrangement?.id === id).sort((a, b) => a.arrangement!.order - b.arrangement!.order);
}

/** Expand only explicitly related members, never nearby/overlapping frames. */
export function relatedFrameIds(frames: readonly NormalizedFrame[], ids: readonly string[]): string[] {
  const groups = new Set(frames.filter(f => ids.includes(f.id)).map(f => f.arrangement?.id).filter(Boolean));
  return frames.filter(f => ids.includes(f.id) || (f.arrangement && groups.has(f.arrangement.id))).map(f => f.id);
}

function region(margins: FrameMargins, size: DesignSize): FrameBounds {
  return { x: margins.left / size.width, y: margins.top / size.height,
    width: 1 - (margins.left + margins.right) / size.width, height: 1 - (margins.top + margins.bottom) / size.height };
}

function inside(frame: FrameBounds, box: FrameBounds): boolean {
  return frame.width > 0 && frame.height > 0 && frame.x >= box.x - EPS && frame.y >= box.y - EPS &&
    frame.x + frame.width <= box.x + box.width + EPS && frame.y + frame.height <= box.y + box.height + EPS;
}

function placeWithin(frame: NormalizedFrame, box: FrameBounds): NormalizedFrame | null {
  if (frame.width > box.width + EPS || frame.height > box.height + EPS) return null;
  return { ...frame, x: clamp(frame.x, box.x, box.x + box.width - frame.width), y: clamp(frame.y, box.y, box.y + box.height - frame.height) };
}

/** All positions are baked into frames. This function is used only by explicit edits. */
function placeArrangement(members: NormalizedFrame[], size: DesignSize, centre: { x: number; y: number }): NormalizedFrame[] | null {
  const settings = members[0].arrangement!, box = region(marginsFor(members[0]), size);
  const vertical = settings.axis === "vertical", gap = settings.gap / (vertical ? size.height : size.width);
  const width = vertical ? Math.max(...members.map(f => f.width)) : members.reduce((sum, f) => sum + f.width, 0) + gap * (members.length - 1);
  const height = vertical ? members.reduce((sum, f) => sum + f.height, 0) + gap * (members.length - 1) : Math.max(...members.map(f => f.height));
  if (width > box.width + EPS || height > box.height + EPS) return null;
  const x = clamp(centre.x - width / 2, box.x, box.x + box.width - width);
  const y = clamp(centre.y - height / 2, box.y, box.y + box.height - height);
  let cursor = vertical ? y : x;
  return members.map(f => {
    const next = { ...f, x: vertical ? x + (width - f.width) / 2 : cursor, y: vertical ? cursor : y + (height - f.height) / 2 };
    cursor += (vertical ? f.height : f.width) + gap;
    return next;
  });
}

function replace(frames: NormalizedFrame[], changes: readonly NormalizedFrame[]): NormalizedFrame[] {
  const map = new Map(changes.map(f => [f.id, f]));
  return frames.map(f => map.get(f.id) ?? f);
}

/** Resolve requested sizes together; one common limit preserves ratios and equality. */
function fitSizes(before: NormalizedFrame[], proposed: NormalizedFrame[], resizedIds: readonly string[], size: DesignSize, dimension?: "width" | "height"): LayoutResult {
  const changedGroups = new Set(proposed.filter(f => resizedIds.includes(f.id) && f.arrangement).map(f => f.arrangement!.id));
  const attempt = (scale: number): NormalizedFrame[] | null => {
    let next = proposed.map(f => {
      if (!resizedIds.includes(f.id)) return f;
      const scaleX = !f.aspectRatioLocked && dimension === "height" ? 1 : scale;
      const scaleY = !f.aspectRatioLocked && dimension === "width" ? 1 : scale;
      return { ...f, x: f.x + f.width * (1 - scaleX) / 2, y: f.y + f.height * (1 - scaleY) / 2,
        width: f.width * scaleX, height: f.height * scaleY };
    });
    for (const id of changedGroups) {
      const oldMembers = arrangementMembers(before, id), members = arrangementMembers(next, id);
      const bounds = frameBounds(oldMembers.length ? oldMembers : members);
      const positioned = placeArrangement(members, size, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
      if (!positioned) return null;
      next = replace(next, positioned);
    }
    const changes: NormalizedFrame[] = [];
    for (const f of next.filter(f => resizedIds.includes(f.id) && !f.arrangement)) {
      const positioned = placeWithin(f, region(marginsFor(f), size));
      if (!positioned) return null;
      changes.push(positioned);
    }
    return replace(next, changes);
  };
  let next = attempt(1), limited = false;
  if (!next) {
    // Gap/margin conflicts can be unsatisfiable even with infinitesimal frames.
    if (!attempt(1e-10)) return failure(before);
    let low = 0, high = 1;
    for (let i = 0; i < 55; i++) {
      const mid = (low + high) / 2;
      if (attempt(mid)) low = mid; else high = mid;
    }
    next = attempt(low); limited = true;
  }
  if (!next || next.some(f => resizedIds.includes(f.id) && (f.width * size.width < MIN_FRAME_PIXELS - EPS || f.height * size.height < MIN_FRAME_PIXELS - EPS))) {
    return failure(before, `A frame must be at least ${MIN_FRAME_PIXELS} canvas pixels wide and high. Use a larger frame or leave more space between the margins.`);
  }
  return { frames: next, notice: limited ? "Stopped at the largest size that fits. Aspect ratios, margins and the chosen gap are unchanged." : undefined };
}

function withSize(frame: NormalizedFrame, width: number, height: number): NormalizedFrame {
  return { ...frame, x: frame.x + (frame.width - width) / 2, y: frame.y + (frame.height - height) / 2, width, height };
}

export function setFrameRatio(frames: NormalizedFrame[], ids: readonly string[], ratio: { width: number; height: number }, size: DesignSize): LayoutResult {
  if (!finitePositive(ratio.width) || !finitePositive(ratio.height)) return failure(frames, "Enter a positive width and height for the ratio.");
  const next = frames.map(f => ids.includes(f.id) ? {
    ...withSize(f, f.width, f.width * size.width * ratio.height / ratio.width / size.height),
    aspectRatioLocked: true, aspectRatio: { width: ratio.width, height: ratio.height },
  } : f);
  return fitSizes(frames, next, ids, size);
}

export function flipFrameRatios(frames: NormalizedFrame[], ids: readonly string[], size: DesignSize): LayoutResult {
  const next = frames.map(f => {
    if (!ids.includes(f.id)) return f;
    const ratio = f.aspectRatio ?? { width: f.width * size.width, height: f.height * size.height };
    return { ...withSize(f, f.width, f.width * size.width * ratio.width / ratio.height / size.height),
      aspectRatioLocked: true, aspectRatio: { width: ratio.height, height: ratio.width } };
  });
  return fitSizes(frames, next, ids, size);
}

export function setFrameDimension(frames: NormalizedFrame[], ids: readonly string[], dimension: "width" | "height", pixels: number, size: DesignSize): LayoutResult {
  if (!finitePositive(pixels)) return failure(frames, "Enter a positive frame size in canvas pixels.");
  const next = frames.map(f => {
    if (!ids.includes(f.id)) return f;
    const ratio = actualFrameRatio(f, size);
    const width = dimension === "width" ? pixels / size.width : f.aspectRatioLocked ? pixels * ratio / size.width : f.width;
    const height = dimension === "height" ? pixels / size.height : f.aspectRatioLocked ? pixels / ratio / size.height : f.height;
    return withSize(f, width, height);
  });
  return fitSizes(frames, next, ids, size, dimension);
}

export function matchFrameDimension(frames: NormalizedFrame[], ids: readonly string[], referenceId: string, dimension: "width" | "height", size: DesignSize): LayoutResult {
  const reference = frames.find(f => f.id === referenceId && ids.includes(f.id));
  return reference ? setFrameDimension(frames, ids, dimension, reference[dimension] * size[dimension], size) : failure(frames, "Choose a selected reference frame first.");
}

export function releaseArrangement(frames: NormalizedFrame[], ids: readonly string[]): NormalizedFrame[] {
  const groups = new Set(frames.filter(f => ids.includes(f.id)).map(f => f.arrangement?.id).filter(Boolean));
  return frames.map(f => {
    if (!f.arrangement || !groups.has(f.arrangement.id)) return f;
    const next = { ...f }; delete next.arrangement; return next;
  });
}

export function deleteLayoutFrames(frames: NormalizedFrame[], ids: readonly string[], size: DesignSize): LayoutResult {
  let next = frames.filter(f => !ids.includes(f.id));
  const groups = new Set(frames.filter(f => ids.includes(f.id)).map(f => f.arrangement?.id).filter((id): id is string => Boolean(id)));
  for (const id of groups) {
    const members = arrangementMembers(next, id);
    if (members.length < 2) { next = releaseArrangement(next, members.map(f => f.id)); continue; }
    const old = frameBounds(arrangementMembers(frames, id));
    const positioned = placeArrangement(members, size, { x: old.x + old.width / 2, y: old.y + old.height / 2 });
    if (positioned) next = replace(next, positioned);
  }
  return { frames: next };
}

export function duplicateLayoutFrames(frames: NormalizedFrame[], ids: readonly string[], size: DesignSize, newId: () => string): { frames: NormalizedFrame[]; selectedIds: string[] } {
  const groups = new Map<string, string>();
  const clones = frames.filter(f => ids.includes(f.id)).map(f => {
    const next = { ...f, id: newId(), aspectRatio: f.aspectRatio && { ...f.aspectRatio }, layoutMargins: f.layoutMargins && { ...f.layoutMargins } };
    if (f.arrangement && arrangementMembers(frames, f.arrangement.id).every(member => ids.includes(member.id))) {
      if (!groups.has(f.arrangement.id)) groups.set(f.arrangement.id, newId());
      next.arrangement = { ...f.arrangement, id: groups.get(f.arrangement.id)! };
    } else delete next.arrangement;
    return next;
  });
  const selectedIds = clones.map(f => f.id);
  return { frames: [...frames, ...moveFrameGroup(clones, selectedIds, .025, .025, size).frames], selectedIds };
}

export function arrangeFrames(frames: NormalizedFrame[], ids: readonly string[], axis: FrameArrangement["axis"], gap: number, keep: boolean, size: DesignSize, groupId: string): LayoutResult {
  if (!Number.isFinite(gap) || gap < 0) return failure(frames, "Gap must be zero or a positive number of canvas pixels.");
  const selected = frames.filter(f => ids.includes(f.id));
  if (selected.length < 2) return failure(frames, "Select at least two frames to arrange.");
  if (relatedFrameIds(frames, ids).some(id => !ids.includes(id))) return failure(frames, "Select the whole arrangement or release it before creating another row or stack.");
  const bounds = frameBounds(selected), margins = marginsFor(selected[0]);
  const sorted = [...selected].sort((a, b) => axis === "vertical" ? a.y - b.y || a.x - b.x : a.x - b.x || a.y - b.y);
  const members = sorted.map((f, order) => ({ ...f, layoutMargins: { ...margins }, arrangement: { id: groupId, axis, order, gap } }));
  const positioned = placeArrangement(members, size, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
  if (!positioned) return failure(frames, "This row or stack does not fit. Reduce frame sizes, gap or minimum margins before arranging.");
  let next = replace(releaseArrangement(frames, ids), positioned);
  if (!keep) next = releaseArrangement(next, ids);
  return { frames: next };
}

export function setArrangementGap(frames: NormalizedFrame[], groupId: string, gap: number, size: DesignSize): LayoutResult {
  const members = arrangementMembers(frames, groupId);
  if (!members.length) return failure(frames, "Select a row or stack first.");
  if (!Number.isFinite(gap) || gap < 0) return failure(frames, "Gap must be zero or a positive number of canvas pixels.");
  const bounds = frameBounds(members);
  const next = members.map(f => ({ ...f, arrangement: { ...f.arrangement!, gap } }));
  const placed = placeArrangement(next, size, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
  // A gap edit must not resize the frames or silently change the requested gap.
  return placed ? { frames: replace(frames, placed) } : failure(frames, "That gap does not fit with these frame sizes and margins. The previous gap was kept.");
}

export function setFrameMargins(frames: NormalizedFrame[], ids: readonly string[], margins: FrameMargins, size: DesignSize): LayoutResult {
  if ([margins.top, margins.right, margins.bottom, margins.left].some(n => !Number.isFinite(n) || n < 0) ||
    margins.top + margins.bottom >= size.height || margins.left + margins.right >= size.width) return failure(frames, "Margins must leave a positive canvas area.");
  const affected = relatedFrameIds(frames, ids);
  const next = frames.map(f => affected.includes(f.id) ? { ...f, layoutMargins: { ...margins } } : f);
  // Keep freeform geometry together, shrinking only if the available area requires it.
  const free = next.filter(f => ids.includes(f.id) && !f.arrangement), bounds = frameBounds(free), box = region(margins, size);
  const scale = free.length ? Math.min(1, box.width / bounds.width, box.height / bounds.height) : 1;
  const left = clamp(bounds.x + bounds.width * (1 - scale) / 2, box.x, box.x + box.width - bounds.width * scale);
  const top = clamp(bounds.y + bounds.height * (1 - scale) / 2, box.y, box.y + box.height - bounds.height * scale);
  const positioned = replace(next, free.map(f => ({ ...f, x: left + (f.x - bounds.x) * scale, y: top + (f.y - bounds.y) * scale, width: f.width * scale, height: f.height * scale })));
  const result = fitSizes(frames, positioned, affected, size);
  return scale < 1 && !result.notice ? { ...result, notice: "Frames were scaled proportionally to fit inside the minimum margins." } : result;
}

export function centreFrameGroup(frames: NormalizedFrame[], ids: readonly string[], size: DesignSize, axis: "both" | "x" | "y" = "both"): LayoutResult {
  const affected = relatedFrameIds(frames, ids), selected = frames.filter(f => affected.includes(f.id));
  if (!selected.length) return { frames };
  const bounds = frameBounds(selected), margins = selected.reduce((m, f) => ({ ...m,
    left: Math.max(m.left, marginsFor(f).left), right: Math.max(m.right, marginsFor(f).right),
    top: Math.max(m.top, marginsFor(f).top), bottom: Math.max(m.bottom, marginsFor(f).bottom),
  }), { ...ZERO_MARGINS });
  const box = region(margins, size);
  const dx = axis === "y" ? 0 : box.x + (box.width - bounds.width) / 2 - bounds.x;
  const dy = axis === "x" ? 0 : box.y + (box.height - bounds.height) / 2 - bounds.y;
  return moveFrameGroup(frames, affected, dx, dy, size);
}

export function moveFrameGroup(frames: NormalizedFrame[], ids: readonly string[], dx: number, dy: number, size: DesignSize): LayoutResult {
  if (relatedFrameIds(frames, ids).some(id => !ids.includes(id))) return failure(frames, "Select the whole row/stack to move it, or release the arrangement to move this frame independently.");
  const selected = frames.filter(f => ids.includes(f.id));
  if (!selected.length) return { frames };
  let minX = -Infinity, maxX = Infinity, minY = -Infinity, maxY = Infinity;
  for (const f of selected) {
    const box = region(marginsFor(f), size);
    minX = Math.max(minX, box.x - f.x); maxX = Math.min(maxX, box.x + box.width - f.x - f.width);
    minY = Math.max(minY, box.y - f.y); maxY = Math.min(maxY, box.y + box.height - f.y - f.height);
  }
  const x = clamp(dx, minX, maxX), y = clamp(dy, minY, maxY);
  return { frames: frames.map(f => ids.includes(f.id) ? { ...f, x: f.x + x, y: f.y + y } : f) };
}

/** Shared corner handles uniformly resize freeform selections. Arranged members retain fixed gaps. */
export function resizeFrameGroup(frames: NormalizedFrame[], ids: readonly string[], handle: ResizeHandle, dx: number, dy: number, fromCentre: boolean, size: DesignSize): LayoutResult {
  const selected = frames.filter(f => ids.includes(f.id));
  if (!selected.length) return { frames };
  const bounds = frameBounds(selected), multiplier = fromCentre ? 2 : 1;
  const groups = new Set(selected.map(f => f.arrangement?.id).filter(Boolean));
  const allOneGroup = groups.size === 1 && selected.every(f => f.arrangement) && relatedFrameIds(frames, ids).length === ids.length;
  const settings = allOneGroup ? selected[0].arrangement : undefined;
  const width = bounds.width * size.width - (settings?.axis === "horizontal" ? settings.gap * (selected.length - 1) : 0);
  const height = bounds.height * size.height - (settings?.axis === "vertical" ? settings.gap * (selected.length - 1) : 0);
  const dw = dx * size.width * (handle.includes("e") ? 1 : -1) * multiplier;
  const dh = dy * size.height * (handle.includes("s") ? 1 : -1) * multiplier;
  const minimum = Math.max(...selected.map(f => Math.max(MIN_FRAME_PIXELS / (f.width * size.width), MIN_FRAME_PIXELS / (f.height * size.height))));
  const requested = Math.max(minimum, 1 + (dw * width + dh * height) / (width * width + height * height));
  if (allOneGroup) {
    const anchorX = fromCentre ? bounds.x + bounds.width / 2 : handle.includes("e") ? bounds.x : bounds.x + bounds.width;
    const anchorY = fromCentre ? bounds.y + bounds.height / 2 : handle.includes("s") ? bounds.y : bounds.y + bounds.height;
    const attempt = (scale: number) => {
      const resized = selected.map(f => ({ ...f, width: f.width * scale, height: f.height * scale })).sort((a, b) => a.arrangement!.order - b.arrangement!.order);
      const newWidth = (width * scale + (settings?.axis === "horizontal" ? settings.gap * (selected.length - 1) : 0)) / size.width;
      const newHeight = (height * scale + (settings?.axis === "vertical" ? settings.gap * (selected.length - 1) : 0)) / size.height;
      const centre = { x: fromCentre ? anchorX : anchorX + (handle.includes("e") ? newWidth / 2 : -newWidth / 2),
        y: fromCentre ? anchorY : anchorY + (handle.includes("s") ? newHeight / 2 : -newHeight / 2) };
      const placed = placeArrangement(resized, size, centre);
      if (!placed) return null;
      const after = frameBounds(placed);
      // A corner cannot drift when the opposite edge reaches a page/margin bound.
      if (Math.abs(after.x + after.width / 2 - centre.x) > EPS || Math.abs(after.y + after.height / 2 - centre.y) > EPS) return null;
      return placed;
    };
    let next = attempt(requested), limited = false;
    if (!next) {
      let low = minimum, high = requested;
      if (!attempt(low)) return failure(frames);
      for (let i = 0; i < 55; i++) { const mid = (low + high) / 2; if (attempt(mid)) low = mid; else high = mid; }
      next = attempt(low); limited = true;
    }
    return next ? { frames: replace(frames, next), notice: limited ? "Stopped at the page or minimum margin. Ratios and the chosen gap are unchanged." : undefined } : failure(frames);
  }
  if (groups.size) {
    const next = frames.map(f => ids.includes(f.id) ? withSize(f, f.width * requested, f.height * requested) : f);
    const result = fitSizes(frames, next, ids, size);
    return result;
  }
  const anchorX = fromCentre ? bounds.x + bounds.width / 2 : handle.includes("e") ? bounds.x : bounds.x + bounds.width;
  const anchorY = fromCentre ? bounds.y + bounds.height / 2 : handle.includes("s") ? bounds.y : bounds.y + bounds.height;
  const attempt = (scale: number) => selected.map(f => ({ ...f, x: anchorX + (f.x - anchorX) * scale, y: anchorY + (f.y - anchorY) * scale, width: f.width * scale, height: f.height * scale }));
  const valid = (scale: number) => attempt(scale).every(f => inside(f, region(marginsFor(f), size)));
  let scale = requested;
  if (!valid(scale)) {
    let low = minimum, high = requested;
    if (!valid(low)) return failure(frames);
    for (let i = 0; i < 55; i++) { const mid = (low + high) / 2; if (valid(mid)) low = mid; else high = mid; }
    scale = low;
  }
  return { frames: replace(frames, attempt(scale)), notice: scale < requested - EPS ? "Stopped at the page or minimum margin. Frame proportions are unchanged." : undefined };
}

export function resizeLayoutSelection(frames: NormalizedFrame[], ids: readonly string[], handle: ResizeHandle, dx: number, dy: number, fromCentre: boolean, size: DesignSize): LayoutResult {
  const selected = frames.filter(f => ids.includes(f.id));
  if (selected.length !== 1) return resizeFrameGroup(frames, ids, handle, dx, dy, fromCentre, size);
  const frame = selected[0], box = region(marginsFor(frame), size);
  const relative = { ...frame, x: (frame.x - box.x) / box.width, y: (frame.y - box.y) / box.height,
    width: frame.width / box.width, height: frame.height / box.height };
  const resized = resizeFrame(relative, handle, dx / box.width, dy / box.height, fromCentre, { width: size.width * box.width, height: size.height * box.height });
  const next = { ...resized, x: box.x + resized.x * box.width, y: box.y + resized.y * box.height, width: resized.width * box.width, height: resized.height * box.height };
  if (frame.arrangement) return fitSizes(frames, replace(frames, [next]), ids, size);
  const stopped = Math.abs(next.width - frame.width) + Math.abs(next.height - frame.height) < EPS && (Math.abs(dx) + Math.abs(dy) > EPS);
  return { frames: replace(frames, [next]), notice: stopped ? "The frame has reached a page, margin or minimum-size limit." : undefined };
}

export function equaliseFrameSpacing(frames: NormalizedFrame[], ids: readonly string[], axis: "horizontal" | "vertical", size: DesignSize): LayoutResult {
  const selected = frames.filter(f => ids.includes(f.id)), vertical = axis === "vertical";
  if (selected.length < 3) return failure(frames, "Select at least three frames to equalise spacing.");
  if (selected.some(f => f.arrangement)) return failure(frames, "This arrangement already keeps its chosen gap. Release it to distribute frames freely.");
  const sorted = [...selected].sort((a, b) => vertical ? a.y - b.y : a.x - b.x), bounds = frameBounds(sorted);
  const total = sorted.reduce((sum, f) => sum + (vertical ? f.height : f.width), 0);
  const gap = ((vertical ? bounds.height : bounds.width) - total) / (sorted.length - 1);
  if (gap < -EPS) return failure(frames, "There is not enough space between the first and last frame. Move them apart or use a row/stack with zero gap.");
  let cursor = vertical ? bounds.y : bounds.x;
  const positioned = sorted.map(f => { const next = { ...f, [vertical ? "y" : "x"]: cursor }; cursor += (vertical ? f.height : f.width) + Math.max(0, gap); return next; });
  if (positioned.some(f => !inside(f, region(marginsFor(f), size)))) return failure(frames);
  return { frames: replace(frames, positioned) };
}

/** Align edges/centres without violating an active arrangement or minimum margins. */
export function alignFrames(frames: NormalizedFrame[], ids: readonly string[], mode: "left" | "hcentre" | "right" | "top" | "vcentre" | "bottom", size: DesignSize): LayoutResult {
  const selected = frames.filter(f => ids.includes(f.id));
  if (selected.some(f => f.arrangement)) return failure(frames, "Release the arrangement before aligning individual frames. Centre group moves the whole arrangement.");
  const box = frameBounds(selected);
  const next = selected.map(f => {
    if (mode === "left") return { ...f, x: box.x };
    if (mode === "right") return { ...f, x: box.x + box.width - f.width };
    if (mode === "hcentre") return { ...f, x: box.x + (box.width - f.width) / 2 };
    if (mode === "top") return { ...f, y: box.y };
    if (mode === "bottom") return { ...f, y: box.y + box.height - f.height };
    return { ...f, y: box.y + (box.height - f.height) / 2 };
  });
  return next.some(f => !inside(f, region(marginsFor(f), size))) ? failure(frames) : { frames: replace(frames, next) };
}
