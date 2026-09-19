import { isPhotoAnalysis, PALETTE_VERSION, type PhotoAnalysis } from "./photo-palette";
import type { ArrangementInput, ArrangementProposal } from "./arrangements";
import type { ProjectPhoto } from "./types";
import { readDerived, writeDerived } from "./photo-cache-storage";
import { workspaceKey } from "./workspace";

/** Only derived data is cached here. Never infer library membership from it. */
export function analysisCacheKey(photo: ProjectPhoto, ownerId?: string | null): string {
  return workspaceKey(`scuri.analysis.${PALETTE_VERSION}.colour-v2.${encodeURIComponent(photo.blobKey)}.${photo.sourceWidth}x${photo.sourceHeight}.${photo.fileSize ?? 0}`, ownerId);
}

export class PhotoAnalysisClient {
  private worker: Worker;
  private sequence = 0;
  private disposed = false;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor() {
    this.worker = new Worker(new URL("./arrangement.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = ({ data }: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const job = this.pending.get(data.id); if (!job) return;
      clearTimeout(job.timer); this.pending.delete(data.id);
      if (data.error) job.reject(new Error(data.error)); else job.resolve(data.result);
    };
    this.worker.onerror = () => this.dispose("Local analysis could not run in this browser. Photos are unchanged.");
  }
  private request<T>(message: Record<string, unknown>): Promise<T> {
    if (this.disposed) return Promise.reject(new Error("Analysis was cancelled. Select Retry unavailable photos to start again."));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("Analysis timed out. The photo remains in the library; retry when ready.")); }, 60_000);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      this.worker.postMessage({ ...message, id });
    });
  }
  async cached(photo: ProjectPhoto, ownerId?: string | null): Promise<{ analysis: PhotoAnalysis; thumbnail: Blob } | null> {
    const key = analysisCacheKey(photo, ownerId);
    try {
      const cached = await readDerived<PhotoAnalysis>(key);
      const value = cached?.data, thumbnail = cached?.blob;
      return isPhotoAnalysis(value) && thumbnail ? { analysis: value, thumbnail } : null;
    } catch { return null; }
  }
  async analyse(photo: ProjectPhoto, blob: Blob, ownerId?: string | null): Promise<{ analysis: PhotoAnalysis; thumbnail: Blob }> {
    const result = await this.request<{ analysis: PhotoAnalysis; thumbnail: Blob }>({ kind: "analyse", blob, width: photo.sourceWidth, height: photo.sourceHeight });
    const key = analysisCacheKey(photo, ownerId);
    await writeDerived(key, { data: result.analysis, blob: result.thumbnail });
    return result;
  }
  suggest(input: ArrangementInput): Promise<ArrangementProposal[]> { return this.request({ kind: "suggest", input }); }
  fingerprint(blob: Blob): Promise<string> { return this.request({ kind: "fingerprint", blob }); }
  dispose(message = "Analysis cancelled."): void {
    this.disposed = true;
    this.worker.terminate();
    for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(new Error(message)); }
    this.pending.clear();
  }
}
