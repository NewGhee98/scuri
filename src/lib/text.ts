import type { TemplateDefinition, TextBox } from "./types";

export const MAX_TEXT_BOXES = 20;
export const MAX_TEXT_LENGTH = 2000;
export const TEXT_FONTS = [
  { id: "cinzel", name: "Cinzel", family: "Scuri Cinzel", italic: false },
  { id: "cormorant", name: "Cormorant Garamond", family: "Scuri Cormorant", italic: true },
  { id: "inter", name: "Inter", family: "Scuri Inter", italic: true },
] as const;
export const clampText = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export function createTextBox(id: string): TextBox {
  return { id, text: "Your text", x: .1, y: .1, width: .8, font: "cinzel", fontSize: 48,
    weight: 400, italic: false, letterSpacing: 6, lineHeight: 1.2, align: "center",
    colour: "#171717", opacity: 1, background: null };
}

export function isTextLayers(value: unknown): value is TextBox[] {
  if (!Array.isArray(value) || value.length > MAX_TEXT_BOXES) return false;
  const ids = new Set<string>();
  const bounded = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  const colour = (v: unknown) => typeof v === "string" && /^#[\da-f]{6}$/i.test(v);
  return value.every(v => {
    if (!v || typeof v !== "object" || typeof v.id !== "string" || !v.id || ids.has(v.id)) return false;
    ids.add(v.id);
    return typeof v.text === "string" && v.text.length <= MAX_TEXT_LENGTH &&
      TEXT_FONTS.some(f => f.id === v.font) && bounded(v.x, 0, 1) && bounded(v.y, 0, 1) &&
      bounded(v.width, .05, 1) && v.x + v.width <= 1.000001 && bounded(v.fontSize, 8, 300) &&
      [400, 500, 600, 700].includes(v.weight) && typeof v.italic === "boolean" && !(v.font === "cinzel" && v.italic) &&
      bounded(v.letterSpacing, -5, 60) && bounded(v.lineHeight, .8, 3) && ["left", "center", "right"].includes(v.align) &&
      colour(v.colour) && bounded(v.opacity, 0, 1) && (v.background === null || colour(v.background));
  });
}

export function textFont(box: TextBox): string {
  return `${box.italic ? "italic" : "normal"} ${box.weight} ${box.fontSize}px "${TEXT_FONTS.find(f => f.id === box.font)!.family}"`;
}

/** Request bundled faces, not an arbitrary installed font with the same name. */
export async function ensureTextFonts(boxes: readonly TextBox[]): Promise<void> {
  if (!boxes.length) return;
  const requests = new Map(boxes.map(box => [textFont(box), box]));
  await Promise.all([...requests.values()].map(async box => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const faces = await Promise.race([document.fonts.load(textFont(box)), new Promise<FontFace[]>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Font request timed out")), 10000);
      })]);
      if (!faces.length || faces.some(face => face.status !== "loaded")) throw new Error("Font unavailable");
    } catch {
      throw new Error(`${TEXT_FONTS.find(f => f.id === box.font)!.name} could not load. Reconnect and retry; text will not be exported with a substitute font.`);
    } finally {
      clearTimeout(timeout);
    }
  }));
}

export interface TextLine { text: string; x: number; baseline: number; width: number }
export interface TextLayout { x: number; y: number; width: number; height: number; lines: TextLine[]; overflows: boolean }
type TextContext = Pick<CanvasRenderingContext2D, "font" | "measureText" | "fontKerning" | "letterSpacing" | "textAlign" | "textBaseline">;

function prepareText(context: TextContext, box: TextBox) {
  context.font = textFont(box);
  context.fontKerning = "normal";
  context.letterSpacing = "0px";
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
}

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
function glyphs(text: string): string[] { return Array.from(segmenter.segment(text), item => item.segment); }

/** Shared reference-space layout. Measure before scaling so line breaks remain
 * identical at thumbnail, viewport and print resolutions. Explicit glyph runs
 * implement tracking consistently, including browsers without canvas tracking. */
export function layoutText(context: TextContext, box: TextBox, size: { width: number; height: number }): TextLayout {
  prepareText(context, box);
  const width = box.width * size.width, x = box.x * size.width, y = box.y * size.height;
  const measure = (text: string) => box.letterSpacing === 0 ? context.measureText(text).width :
    glyphs(text).reduce((total, glyph, i) => total + context.measureText(glyph).width + (i ? box.letterSpacing : 0), 0);
  const rows: string[] = [];
  for (const paragraph of box.text.replace(/\r\n?/g, "\n").split("\n")) {
    let row = "";
    for (const word of paragraph.match(/\S+\s*|\s+/gu) ?? []) {
      if (row && measure((row + word).trimEnd()) > width) { rows.push(row.trimEnd()); row = ""; }
      // Hard-wrap long words without splitting surrogate pairs or combining marks.
      for (const glyph of glyphs(word)) {
        if (!row && /^\s$/u.test(glyph)) continue;
        if (row && measure(row + glyph) > width) { rows.push(row.trimEnd()); row = ""; }
        row += glyph;
      }
    }
    rows.push(row.trimEnd());
  }
  const metrics = context.measureText("Mg");
  const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent ?? box.fontSize * .8;
  const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent ?? box.fontSize * .2;
  const step = box.fontSize * box.lineHeight;
  const lineBox = Math.max(step, ascent + descent);
  const height = lineBox + Math.max(0, rows.length - 1) * step;
  const lines = rows.map((text, i) => {
    const measured = measure(text);
    return { text, width: measured, x: x + (box.align === "center" ? (width - measured) / 2 : box.align === "right" ? width - measured : 0),
      baseline: y + (lineBox - ascent - descent) / 2 + ascent + i * step };
  });
  return { x, y, width, height, lines, overflows: y + height > size.height + .01 || lines.some(line => line.width > width + .01) };
}

/** Editing adornments are deliberately not part of this renderer. */
export function drawTextLayers(context: CanvasRenderingContext2D, template: Pick<TemplateDefinition, "textLayers" | "canvasWidth" | "canvasHeight">,
  width = template.canvasWidth, height = template.canvasHeight): void {
  if (!template.textLayers?.length) return;
  context.save();
  context.scale(width / template.canvasWidth, height / template.canvasHeight);
  context.beginPath(); context.rect(0, 0, template.canvasWidth, template.canvasHeight); context.clip();
  for (const box of template.textLayers) {
    context.save();
    const layout = layoutText(context, box, { width: template.canvasWidth, height: template.canvasHeight });
    context.globalAlpha = box.opacity;
    if (box.background) { context.fillStyle = box.background; context.fillRect(layout.x, layout.y, layout.width, layout.height); }
    context.fillStyle = box.colour;
    for (const line of layout.lines) {
      if (box.letterSpacing === 0) { context.fillText(line.text, line.x, line.baseline); continue; }
      let x = line.x;
      for (const glyph of glyphs(line.text)) {
        context.fillText(glyph, x, line.baseline);
        x += context.measureText(glyph).width + box.letterSpacing;
      }
    }
    context.restore();
  }
  context.restore();
}

/** Raw pointer deltas stay independent of snapping, so the snap can be crossed. */
export function moveTextBox(box: TextBox, x: number, y: number, height: number, size: { width: number; height: number },
  others: readonly TextBox[], tolerance = 0): { box: TextBox; guides: { axis: "x" | "y"; value: number }[] } {
  const h = height / size.height;
  let nx = clampText(x, 0, 1 - box.width), ny = clampText(y, 0, Math.max(0, 1 - h));
  const guides: { axis: "x" | "y"; value: number }[] = [];
  const snap = (sources: number[], targets: number[], limit: number) => {
    let best: { delta: number; value: number } | undefined;
    for (const value of targets) for (const source of sources) {
      const delta = value - source;
      if (Math.abs(delta) <= limit && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, value };
    }
    return best;
  };
  if (tolerance > 0) {
    const sx = snap([nx, nx + box.width / 2, nx + box.width], [0, .5, 1, ...others.filter(b => b.id !== box.id).flatMap(b => [b.x, b.x + b.width / 2, b.x + b.width])], tolerance / size.width);
    const sy = snap([ny, ny + h / 2, ny + h], [0, .5, 1, ...others.filter(b => b.id !== box.id).map(b => b.y)], tolerance / size.height);
    if (sx && nx + sx.delta >= 0 && nx + sx.delta + box.width <= 1) { nx += sx.delta; guides.push({ axis: "x", value: sx.value }); }
    if (sy && ny + sy.delta >= 0 && ny + sy.delta + h <= 1) { ny += sy.delta; guides.push({ axis: "y", value: sy.value }); }
  }
  return { box: { ...box, x: nx, y: ny }, guides };
}
