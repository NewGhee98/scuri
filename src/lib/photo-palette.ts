/** Local, deterministic five-colour analysis. OKLab conversion follows
 * https://www.w3.org/TR/css-color-4/#color-conversion-code . No model/services. */
export const PALETTE_VERSION = 1;
export type Lab = [number, number, number];
export interface PaletteColour { lab: Lab; rgb: [number, number, number]; proportion: number }
export interface PhotoAnalysis { version: 1; width: number; height: number; palette: PaletteColour[]; brightness: number; saturation: number; colourClass?: "bw" | "colour" | "uncertain" }

/** Conservative classification of uncropped pixels, not mean RGB. Neutral,
 * nearly uniform or very dark samples are uncertain rather than forced B&W. */
export function classifyPhotoColour(rgba: Uint8ClampedArray): "bw" | "colour" | "uncertain" {
  const samples: Array<{ l: number; c: number }> = [];
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 230) continue;
    const [l, a, b] = rgbToOklab(rgba[i], rgba[i + 1], rgba[i + 2]);
    samples.push({ l, c: Math.hypot(a, b) });
  }
  if (samples.length < 128) return "uncertain";
  const fraction = (test: (sample: { l: number; c: number }) => boolean) => samples.filter(test).length / samples.length;
  if (fraction(s => s.c >= 0.04 && s.l > 0.1) >= 0.05 || fraction(s => s.c >= 0.08 && s.l > 0.1) >= 0.01) return "colour";
  const lights = samples.map(s => s.l).sort((a, b) => a - b), chroma = samples.map(s => s.c).sort((a, b) => a - b);
  const quantile = (items: number[], fraction: number) => items[Math.floor((items.length - 1) * fraction)];
  if (quantile(lights, 0.95) - quantile(lights, 0.05) < 0.1) return "uncertain";
  return fraction(s => s.c <= 0.02) >= 0.98 && quantile(chroma, 0.95) <= 0.015 ? "bw" : "uncertain";
}

export function rgbToOklab(r: number, g: number, b: number): Lab {
  const linear = (value: number) => { const v = value / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const red = linear(r), green = linear(g), blue = linear(b);
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export const colourDistance = (a: Lab, b: Lab): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function analysePixels(rgba: Uint8ClampedArray, width: number, height: number): PhotoAnalysis {
  if (!width || !height || !rgba.length || rgba.length % 4) throw new Error("Image analysis needs valid pixels and dimensions.");
  const bins = new Map<number, { rgb: [number, number, number]; weight: number }>();
  let saturation = 0, total = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const weight = rgba[i + 3] / 255;
    if (weight < 0.05) continue; // transparent background is not a photo colour
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const id = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4);
    const bin = bins.get(id) ?? { rgb: [0, 0, 0], weight: 0 };
    bin.rgb[0] += r * weight; bin.rgb[1] += g * weight; bin.rgb[2] += b * weight; bin.weight += weight;
    bins.set(id, bin); total += weight;
    const max = Math.max(r, g, b);
    saturation += (max ? (max - Math.min(r, g, b)) / max : 0) * weight;
  }
  if (!total) throw new Error("This image has no visible pixels to analyse.");
  const points = [...bins.values()].map(bin => {
    const rgb = bin.rgb.map(value => value / bin.weight) as [number, number, number];
    return { rgb, lab: rgbToOklab(...rgb), weight: bin.weight };
  }).sort((a, b) => b.weight - a.weight || a.rgb[0] - b.rgb[0] || a.rgb[1] - b.rgb[1] || a.rgb[2] - b.rgb[2]);
  let centres: Lab[] = [points[0].lab];
  while (centres.length < Math.min(5, points.length)) {
    const ranked = points.map(point => ({ point, score: Math.min(...centres.map(c => colourDistance(c, point.lab) ** 2)) * point.weight }));
    ranked.sort((a, b) => b.score - a.score);
    if (ranked[0].score < 0.0001) break;
    centres.push(ranked[0].point.lab);
  }
  let palette: PaletteColour[] = [];
  for (let iteration = 0; iteration < 8; iteration++) {
    const clusters = centres.map(() => ({ lab: [0, 0, 0], rgb: [0, 0, 0], weight: 0 }));
    for (const point of points) {
      let nearest = 0;
      for (let i = 1; i < centres.length; i++) if (colourDistance(point.lab, centres[i]) < colourDistance(point.lab, centres[nearest])) nearest = i;
      const cluster = clusters[nearest]; cluster.weight += point.weight;
      for (let axis = 0; axis < 3; axis++) { cluster.lab[axis] += point.lab[axis] * point.weight; cluster.rgb[axis] += point.rgb[axis] * point.weight; }
    }
    palette = clusters.filter(c => c.weight).map(c => ({ lab: c.lab.map(v => v / c.weight) as Lab,
      rgb: c.rgb.map(v => Math.round(v / c.weight)) as [number, number, number], proportion: c.weight / total }));
    centres = palette.map(c => c.lab);
  }
  palette.sort((a, b) => b.proportion - a.proportion);
  return { version: PALETTE_VERSION, width, height, palette, colourClass: classifyPhotoColour(rgba),
    brightness: palette.reduce((sum, c) => sum + c.lab[0] * c.proportion, 0), saturation: saturation / total };
}

/** Symmetric greedy transport between weighted perceptual palettes. Matching
 * colour mass, rather than averages, distinguishes differently mixed palettes. */
export function paletteDistance(a: PhotoAnalysis, b: PhotoAnalysis): number {
  const left = a.palette.map(c => c.proportion), right = b.palette.map(c => c.proportion);
  const edges = a.palette.flatMap((x, i) => b.palette.map((y, j) => ({ i, j, distance: colourDistance(x.lab, y.lab) })));
  edges.sort((x, y) => x.distance - y.distance);
  let distance = 0;
  for (const edge of edges) { const mass = Math.min(left[edge.i], right[edge.j]); distance += mass * edge.distance; left[edge.i] -= mass; right[edge.j] -= mass; }
  return distance + 0.05 * Math.abs(a.brightness - b.brightness) + 0.03 * Math.abs(a.saturation - b.saturation);
}

export function isPhotoAnalysis(value: unknown): value is PhotoAnalysis {
  const a = value as PhotoAnalysis | null;
  return Boolean(a && a.version === PALETTE_VERSION && Number.isFinite(a.width) && a.width > 0 && Number.isFinite(a.height) && a.height > 0 &&
    Number.isFinite(a.brightness) && Number.isFinite(a.saturation) && (a.colourClass === undefined || ["bw", "colour", "uncertain"].includes(a.colourClass)) && Array.isArray(a.palette) && a.palette.length > 0 && a.palette.length <= 5 &&
    a.palette.every(c => Array.isArray(c.lab) && c.lab.length === 3 && c.lab.every(Number.isFinite) && Array.isArray(c.rgb) && c.rgb.length === 3 && c.rgb.every(v => Number.isFinite(v) && v >= 0 && v <= 255) && Number.isFinite(c.proportion) && c.proportion > 0 && c.proportion <= 1) &&
    Math.abs(a.palette.reduce((sum, c) => sum + c.proportion, 0) - 1) < 0.001);
}

export function paletteDescription(photos: PhotoAnalysis[]): string {
  const colours = photos.flatMap(photo => photo.palette.filter(c => c.proportion >= 0.15));
  const names = colours.map(({ rgb: [r, g, b], lab: [l] }) => {
    if (l < 0.3) return "dark";
    if (Math.max(r, g, b) - Math.min(r, g, b) < 30) return l > 0.8 ? "light neutral" : "grey";
    if (r > 180 && g > 160 && b < g && r - g < 65) return "cream";
    if (b > r && b > g * 0.92) return "blue";
    if (g > r && g > b) return "green";
    if (r > b * 1.3 && r > g * 1.3) return "red";
    if (r > b && g > b) return "warm";
    return "purple";
  });
  const counts = new Map<string, number>(); names.forEach(name => counts.set(name, (counts.get(name) ?? 0) + 1));
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([name]) => name).join(" / ");
}
