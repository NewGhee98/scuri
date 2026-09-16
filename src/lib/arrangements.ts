import { DEFAULT_CROP, resolveFrames } from "./crop";
import { getFormat } from "./formats";
import { MAX_PROJECT_PAGES } from "./project";
import { getProjectPhotos, getVisibleProjectPhotos, MAX_PROJECT_PHOTOS } from "./project-photo-library";
import { paletteDescription, paletteDistance, type PhotoAnalysis } from "./photo-palette";
import { validateTemplate } from "./templates";
import type { FormatId, ProjectPhoto, StoredProject, StoredProjectPage, TemplateDefinition } from "./types";

export type ArrangementMode = "colour" | "fit" | "balanced";
export const ARRANGEMENT_LABELS: Record<ArrangementMode, string> = { colour: "Colour harmony", fit: "Best fit", balanced: "Balanced mix" };
export interface AnalysedPhoto { photo: ProjectPhoto; analysis?: PhotoAnalysis }
export interface SuggestedPage { template: TemplateDefinition; background: string; gutter: number; assignments: Record<string, string>; explanation: string; cropLoss: number }
export interface ArrangementProposal { mode: ArrangementMode; pages: SuggestedPage[]; unplaced: Array<{ blobKey: string; reason: string }>; score: number }
export interface ArrangementInput { photos: AnalysedPhoto[]; templates: TemplateDefinition[]; formatId: FormatId; background?: string; maxPages?: number }

/** Fraction of image area lost at the editor's default fill-frame scale. */
export function cropLoss(photoAspect: number, frameAspect: number): number {
  return 1 - Math.min(photoAspect / frameAspect, frameAspect / photoAspect);
}

export function eligibleArrangementTemplates(templates: TemplateDefinition[], formatId: FormatId): TemplateDefinition[] {
  return [...new Map(templates.filter(template => {
    try { return template.formatId === formatId && Number.isFinite(template.defaultGutter) && template.defaultGutter >= 0 &&
      typeof template.defaultBackground === "string" && template.frames.length > 0 && template.frames.length <= 12 &&
      [template.frameInsetMultiplier, template.outerInsetMultiplier].every(value => value === undefined || (Number.isFinite(value) && value >= 0)) &&
      template.frames.every(frame => typeof frame.id === "string" && frame.id.length > 0 && !["__proto__", "constructor", "prototype"].includes(frame.id)) && !validateTemplate(template).length; }
    catch { return false; }
  }).map(template => [template.id, template])).values()].sort((a, b) => a.id.localeCompare(b.id));
}

type ReadyPhoto = { photo: ProjectPhoto; analysis: PhotoAnalysis };
const weights = { colour: { fit: 0.35, colour: 0.65, variety: 0.01 }, fit: { fit: 0.96, colour: 0.04, variety: 0 }, balanced: { fit: 0.65, colour: 0.35, variety: 0.07 } };

/** Joint template/group search with bounded deterministic multi-start greedy
 * assignments. It is a heuristic, not a claim of a globally optimal layout. */
export function suggestArrangements(input: ArrangementInput): ArrangementProposal[] {
  const maxPages = Math.max(0, Math.min(MAX_PROJECT_PAGES, Math.floor(input.maxPages ?? MAX_PROJECT_PAGES)));
  const all = [...new Map(input.photos.map(item => [item.photo.blobKey, item])).values()].sort((a, b) => a.photo.blobKey.localeCompare(b.photo.blobKey));
  const ready = all.filter((item): item is ReadyPhoto => Boolean(item.analysis && item.analysis.width > 0 && item.analysis.height > 0)).slice(0, MAX_PROJECT_PHOTOS);
  const templates = eligibleArrangementTemplates(input.templates, input.formatId);
  if (!ready.length || !templates.length || !maxPages) return [];
  const format = getFormat(input.formatId);
  const geometry = templates.map(template => ({ template, frames: resolveFrames(template, template.defaultGutter, format.width, format.height) }));
  const maxFrames = Math.max(...geometry.map(item => item.frames.length));
  const distance = ready.map((a, i) => ready.map((b, j) => i === j ? 0 : Math.min(1, paletteDistance(a.analysis, b.analysis) / 0.45)));
  const aspect = ready.map(item => item.analysis.width / item.analysis.height);

  const build = (mode: ArrangementMode, variant: number): ArrangementProposal => {
    const w = weights[mode];
    let remaining = ready.map((_, i) => i);
    const pages: SuggestedPage[] = [];
    const usedTemplates = new Map<string, number>();
    let totalScore = 0;
    while (remaining.length && pages.length < maxPages) {
      const seeds = [remaining[variant % remaining.length]];
      while (seeds.length < Math.min(6, remaining.length)) {
        const next = remaining.filter(i => !seeds.includes(i)).sort((a, b) => {
          const spread = (i: number) => Math.min(...seeds.map(j => distance[i][j] + Math.min(1, Math.abs(Math.log(aspect[i] / aspect[j]))) * 0.35));
          return spread(b) - spread(a) || a - b;
        })[0];
        seeds.push(next);
      }
      const candidates: Array<{ page: SuggestedPage; used: number[]; rank: number }> = [];
      for (const { template, frames } of geometry) {
        const frameAspects = frames.map(frame => frame.width / frame.height);
        const count = Math.min(remaining.length, frames.length);
        for (const seed of seeds) {
          const chosen = Array<number>(frames.length).fill(-1);
          const bestSlot = frameAspects.map((ratio, i) => ({ i, loss: cropLoss(aspect[seed], ratio) })).sort((a, b) => a.loss - b.loss)[0].i;
          chosen[bestSlot] = seed;
          const used = new Set([seed]);
          for (let slot = 0; slot < frames.length && used.size < count; slot++) {
            if (chosen[slot] !== -1) continue;
            let best = -1, bestScore = Infinity;
            for (const photo of remaining) {
              if (used.has(photo)) continue;
              const harmony = [...used].reduce((sum, other) => sum + distance[photo][other], 0) / used.size;
              const score = w.fit * cropLoss(aspect[photo], frameAspects[slot]) + w.colour * harmony;
              if (score < bestScore) { bestScore = score; best = photo; }
            }
            chosen[slot] = best; used.add(best);
          }
          // Refine assignment while keeping the colour group unchanged.
          for (let pass = 0; pass < 2; pass++) for (let a = 0; a < chosen.length; a++) for (let b = a + 1; b < chosen.length; b++) {
            if (chosen[a] < 0 || chosen[b] < 0) continue;
            const old = cropLoss(aspect[chosen[a]], frameAspects[a]) + cropLoss(aspect[chosen[b]], frameAspects[b]);
            const swapped = cropLoss(aspect[chosen[b]], frameAspects[a]) + cropLoss(aspect[chosen[a]], frameAspects[b]);
            if (swapped < old - 0.00001) [chosen[a], chosen[b]] = [chosen[b], chosen[a]];
          }
          const group = [...used];
          const loss = chosen.reduce((sum, photo, slot) => sum + (photo < 0 ? 0 : cropLoss(aspect[photo], frameAspects[slot])), 0) / count;
          let harmony = 0, pairs = 0;
          for (let a = 0; a < group.length; a++) for (let b = a + 1; b < group.length; b++) { harmony += distance[group[a]][group[b]]; pairs++; }
          harmony /= Math.max(1, pairs);
          const unplaceable = Math.max(0, remaining.length - count - (maxPages - pages.length - 1) * maxFrames);
          const rank = w.fit * loss + w.colour * harmony + 0.1 / count + (frames.length - count) * 0.08 +
            w.variety * (usedTemplates.get(template.id) ?? 0) + unplaceable * 10;
          const colourText = harmony < 0.22 && group.length > 1 ? `Similar ${paletteDescription(group.map(i => ready[i].analysis))} colours` : "Mixed palettes";
          const fitText = loss < 0.1 ? "minimal cropping" : `about ${Math.round(loss * 100)}% average cropping at fill size`;
          candidates.push({ used: group, rank, page: { template, background: input.background ?? template.defaultBackground,
            gutter: template.defaultGutter, assignments: Object.fromEntries(chosen.flatMap((photo, slot) => photo < 0 ? [] : [[frames[slot].id, ready[photo].photo.blobKey]])),
            explanation: `${colourText}; ${fitText}.`, cropLoss: loss } });
        }
      }
      candidates.sort((a, b) => a.rank - b.rank || b.used.length - a.used.length || a.page.template.id.localeCompare(b.page.template.id));
      const candidate = candidates[0];
      pages.push(candidate.page); totalScore += candidate.rank * candidate.used.length;
      usedTemplates.set(candidate.page.template.id, (usedTemplates.get(candidate.page.template.id) ?? 0) + 1);
      remaining = remaining.filter(i => !candidate.used.includes(i));
    }
    const placed = new Set(pages.flatMap(page => Object.values(page.assignments)));
    return { mode, pages, score: totalScore / Math.max(1, placed.size), unplaced: all.filter(item => !placed.has(item.photo.blobKey)).map(item => ({ blobKey: item.photo.blobKey,
      reason: !item.analysis ? "Awaiting analysis: photo bytes are unavailable or analysis has not completed." : "Project photo/page limit reached; retained in the photo library." })) };
  };

  const proposals: ArrangementProposal[] = [];
  for (const mode of ["colour", "fit", "balanced"] as const) {
    const candidates = [0, 1, 2].map(variant => build(mode, variant)).sort((a, b) => a.unplaced.length - b.unplaced.length || a.score - b.score);
    const best = candidates[0];
    const distinct = candidates.find(candidate => candidate.unplaced.length === best.unplaced.length && candidate.score <= best.score + 0.12 &&
      proposals.every(previous => meaningfullyDifferent(previous, candidate, input.formatId)));
    if (distinct) proposals.push(distinct);
  }
  return proposals;
}

/** Ignore page order, template names and inconsequential same-shape swaps. */
export function meaningfullyDifferent(a: ArrangementProposal, b: ArrangementProposal, formatId: FormatId): boolean {
  const format = getFormat(formatId);
  const describe = (proposal: ArrangementProposal) => new Map(proposal.pages.flatMap(page => {
    const group = Object.values(page.assignments).sort().join("|");
    return resolveFrames(page.template, page.gutter, format.width, format.height).flatMap(frame => {
      const key = page.assignments[frame.id];
      return key ? [[key, { group, ratio: frame.width / frame.height, area: frame.width * frame.height / (format.width * format.height) }] as const] : [];
    });
  }));
  const left = describe(a), right = describe(b), keys = new Set([...left.keys(), ...right.keys()]);
  let changed = 0;
  for (const key of keys) {
    const x = left.get(key), y = right.get(key);
    if (!x || !y || x.group !== y.group || Math.abs(Math.log(x.ratio / y.ratio)) > 0.2 || Math.abs(x.area - y.area) > 0.15) changed++;
  }
  return changed >= Math.max(1, Math.ceil(keys.size * 0.2));
}

/** Explicit Apply creates new identities. The source arrangement, including
 * unavailable assignments, is never mutated or replaced by a suggestion. */
export function applyArrangementAsCopy(source: StoredProject, proposal: ArrangementProposal,
  generateId = () => crypto.randomUUID(), timestamp = new Date().toISOString()): StoredProject {
  if (!proposal.pages.length || proposal.pages.length > MAX_PROJECT_PAGES) throw new Error("This suggestion exceeds the project page limit.");
  const library = getProjectPhotos(source);
  const visible = getVisibleProjectPhotos(source);
  const photos = new Map(visible.map(photo => [photo.blobKey, photo]));
  const used = new Set<string>();
  const pages: StoredProjectPage[] = proposal.pages.map(page => {
    if (!eligibleArrangementTemplates([page.template], source.formatId).length) throw new Error("This suggestion contains an ineligible layout.");
    return { id: generateId(), templateId: page.template.id, templateSnapshot: structuredClone(page.template), background: page.background,
      gutter: page.gutter, selectedFrameId: null, createdAt: timestamp, updatedAt: timestamp,
      photos: Object.fromEntries(Object.entries(page.assignments).map(([frameId, key]) => {
        const photo = photos.get(key);
        if (!photo || used.has(key) || !page.template.frames.some(frame => frame.id === frameId)) throw new Error("This suggestion contains an unknown or repeated photo.");
        used.add(key);
        return [frameId, { ...photo, frameId, crop: { ...DEFAULT_CROP } }];
      })) };
  });
  const unplaced = new Set(proposal.unplaced.map(item => item.blobKey));
  if (unplaced.size !== proposal.unplaced.length || [...unplaced].some(key => used.has(key) || !photos.has(key)) || visible.some(photo => !used.has(photo.blobKey) && !unplaced.has(photo.blobKey))) {
    throw new Error("The photo library changed. Generate fresh suggestions before applying one.");
  }
  return { version: 3, id: generateId(), name: `${source.name} (${ARRANGEMENT_LABELS[proposal.mode]})`.slice(0, 120),
    formatId: source.formatId, activePageId: pages[0].id, pages, photoLibrary: structuredClone(library), createdAt: timestamp, updatedAt: timestamp };
}
