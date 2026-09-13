import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhotoAnalysisClient, analysisCacheKey } from "../photo-analysis-client";
import { analysePixels } from "../photo-palette";
import { loadPhotoBlob, savePhotoBlob } from "../storage";
import { getTemplatesForFormat } from "../templates";
import { suggestArrangements } from "../arrangements";

vi.mock("../storage", () => ({ loadPhotoBlob: vi.fn(), savePhotoBlob: vi.fn() }));
const photo = { blobKey: "synthetic-worker-photo", sourceWidth: 3000, sourceHeight: 1000, fileSize: 42 };
const analysis = analysePixels(new Uint8ClampedArray([20, 70, 160, 255]), 3000, 1000);
beforeEach(() => {
  const values = new Map<string, string>(), blobs = new Map<string, Blob>();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No external analysis service"); }));
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  vi.mocked(loadPhotoBlob).mockImplementation(async key => blobs.get(key) ?? null);
  vi.mocked(savePhotoBlob).mockImplementation(async (key, blob) => { blobs.set(key, blob); });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("worker analysis and derived cache", () => {
  it("uses complete uncropped previews in the real worker handler and reports unsupported analysis safely", async () => {
    const post = vi.fn(), draws: unknown[][] = [], sizes: number[][] = [];
    vi.stubGlobal("postMessage", post); vi.stubGlobal("onmessage", undefined);
    const bitmap = { width: 320, height: 107, close: vi.fn() };
    const decode = vi.fn(async () => bitmap); vi.stubGlobal("createImageBitmap", decode);
    vi.stubGlobal("OffscreenCanvas", class {
      constructor(public width: number, public height: number) { sizes.push([width, height]); }
      getContext() { return { drawImage: (...args: unknown[]) => draws.push(args), getImageData: () => ({ data: new Uint8ClampedArray([20, 70, 160, 255]) }) }; }
      async convertToBlob() { return new Blob(["synthetic-preview"]); }
    });
    await import("../arrangement.worker");
    const scope = globalThis as unknown as { onmessage: (event: { data: unknown }) => Promise<void> };
    const blob = new Blob(["synthetic-original"]);
    await scope.onmessage({ data: { id: 1, kind: "analyse", blob, width: 3000, height: 1000 } });
    expect(decode).toHaveBeenCalledWith(blob, expect.objectContaining({ imageOrientation: "from-image", resizeWidth: 320, resizeHeight: 107 }));
    expect(sizes[0]).toEqual([96, 32]);
    expect(draws.every(args => args.length === 5 && args[1] === 0 && args[2] === 0)).toBe(true); // no source crop rectangle
    expect(post.mock.calls[0][0].result.analysis).toMatchObject({ width: 3000, height: 1000, palette: expect.any(Array) });
    expect(bitmap.close).toHaveBeenCalledOnce();
    vi.stubGlobal("OffscreenCanvas", undefined);
    await scope.onmessage({ data: { id: 2, kind: "analyse", blob, width: 3000, height: 1000 } });
    expect(post.mock.calls[1][0]).toMatchObject({ id: 2, error: expect.stringContaining("remain in the library") });
  });
  it("reuses versioned account-scoped analysis without posting another worker job", async () => {
    const jobs: unknown[] = [];
    vi.stubGlobal("Worker", class {
      onmessage?: (event: { data: unknown }) => void;
      postMessage(message: { id: number }) { jobs.push(message); queueMicrotask(() => this.onmessage?.({ data: { id: message.id, result: { analysis, thumbnail: new Blob(["synthetic-preview"]) } } })); }
      terminate() {}
    });
    const client = new PhotoAnalysisClient();
    await client.analyse(photo, new Blob(["synthetic-source"]), "owner-a");
    expect((await client.cached(photo, "owner-a"))?.analysis).toEqual(analysis);
    expect(jobs).toHaveLength(1);
    expect(await client.cached(photo, "owner-b")).toBeNull();
    expect(await client.cached({ ...photo, fileSize: 99 }, "owner-a")).toBeNull();
    localStorage.setItem(analysisCacheKey(photo, "owner-a"), '{"version":1,"palette":[]}');
    expect(await client.cached(photo, "owner-a")).toBeNull();
    client.dispose();
    await expect(client.suggest({ photos: [], templates: [], formatId: "instagram-square" })).rejects.toThrow("cancelled");
  });
  it("bounds a maximum-size project and accounts for every input photo", () => {
    const photos = Array.from({ length: 200 }, (_, i) => ({ photo: { ...photo, blobKey: `synthetic-${i}` }, analysis }));
    const proposals = suggestArrangements({ photos, templates: getTemplatesForFormat("instagram-square"), formatId: "instagram-square" });
    expect(proposals.length).toBeGreaterThan(0);
    for (const proposal of proposals) {
      expect(proposal.pages.length).toBeLessThanOrEqual(20);
      const placed = proposal.pages.flatMap(page => Object.values(page.assignments));
      expect(new Set([...placed, ...proposal.unplaced.map(item => item.blobKey)]).size).toBe(200);
      expect(placed.length + proposal.unplaced.length).toBe(200);
    }
  }, 30_000);
});
