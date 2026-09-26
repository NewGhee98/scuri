import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadReservedDriveFile, type UploadJournal } from "../drive-resumable";
import { ProjectSyncQueue } from "../sync-queue";
const session = "https://www.googleapis.com/upload/drive/v3/files?upload_id=synthetic-session";
const metadata = { name: "synthetic.jpg", parents: ["folder"], appProperties: { scuriProjectId: "project", scuriBlobKey: "photo", scuriType: "original" } };
function harness(size = 1_300_000) {
  const blob = new Blob([new Uint8Array(size)], { type: "image/jpeg" }), journalEntries = new Map<string, UploadJournal>();
  const journal = { read: vi.fn(async (key: string) => journalEntries.get(key) ?? null),
    write: vi.fn(async (key: string, value: UploadJournal) => { journalEntries.set(key, value); }), remove: vi.fn(async (key: string) => { journalEntries.delete(key); }) };
  let completed = false;
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const value = String(url);
    if (value.includes("fields=id,size")) return completed ? Response.json({ id: "reserved", size: String(size), mimeType: blob.type, appProperties: metadata.appProperties }) : new Response(null, { status: 404 });
    if (init?.method === "POST") return new Response(null, { status: 200, headers: { Location: session } });
    const range = (init?.headers as Record<string, string>)["Content-Range"];
    if (range.startsWith("bytes */")) return new Response(null, { status: 308, headers: { Range: "bytes=0-1048575" } });
    if (range === `bytes 1048576-${size - 1}/${size}` || size <= 1048576) { completed = true; return Response.json({ id: "reserved" }); }
    return new Response(null, { status: 308, headers: { Range: "bytes=0-1048575" } });
  });
  vi.stubGlobal("fetch", fetcher);
  const progress = vi.fn(), options = { fileId: "reserved", blob, metadata, journalKey: "owner/project/photo/original", journal,
    token: () => "synthetic-token", current: () => true, progress };
  return { options, fetcher, journalEntries, completed: () => { completed = true; } };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("immutable resumable original uploads", () => {
  it("automatically checks the accepted offset after Safari loses a chunk response", async () => {
    vi.useFakeTimers();
    const h = harness(), normal = h.fetcher.getMockImplementation()!;
    let interrupted = false;
    h.fetcher.mockImplementation(async (url, init) => {
      const result = await normal(url, init);
      if (init?.method === "PUT" && !interrupted) { interrupted = true; throw new TypeError("Load failed"); }
      return result;
    });
    const result = expect(uploadReservedDriveFile(h.options)).resolves.toBe("reserved"); void result.catch(() => {});
    await vi.advanceTimersByTimeAsync(10_000); await result;
    expect(h.fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(h.fetcher.mock.calls.filter(([, init]) => init?.method === "PUT").map(([, init]) =>
      (init!.headers as Record<string, string>)["Content-Range"])).toEqual([
      "bytes 0-1048575/1300000", "bytes */1300000", "bytes 1048576-1299999/1300000",
    ]);
    expect(h.journalEntries.size).toBe(0);
  });
  it("recovers a lost final response without sending any bytes twice", async () => {
    vi.useFakeTimers();
    const h = harness(100), normal = h.fetcher.getMockImplementation()!;
    h.fetcher.mockImplementation(async (url, init) => {
      const result = await normal(url, init);
      if (init?.method === "PUT") throw new TypeError("Load failed");
      return result;
    });
    const result = expect(uploadReservedDriveFile(h.options)).resolves.toBe("reserved"); void result.catch(() => {});
    await vi.advanceTimersByTimeAsync(10_000); await result;
    expect(h.fetcher.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
    expect(h.journalEntries.size).toBe(0);
  });
  it("requires reconnect for a revoked token without repeatedly sending it", async () => {
    const h = harness(); h.fetcher.mockResolvedValue(new Response(null, { status: 401 }));
    await expect(uploadReservedDriveFile(h.options)).rejects.toMatchObject({ needsReconnect: true });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([429, 503])("resumes after a transient %s without allocating another file", async status => {
    vi.useFakeTimers();
    const h = harness(), normal = h.fetcher.getMockImplementation()!;
    let interrupted = false;
    h.fetcher.mockImplementation(async (url, init) => {
      const response = await normal(url, init);
      if (init?.method === "PUT" && !interrupted) { interrupted = true; return new Response(null, { status }); }
      return response;
    });
    const upload = uploadReservedDriveFile(h.options);
    const checked = expect(upload).resolves.toBe("reserved"); void checked.catch(() => {});
    await vi.advanceTimersByTimeAsync(10_000); await checked;
    expect(h.fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(h.fetcher.mock.calls.filter(([, init]) => init?.method === "PUT").map(([, init]) =>
      (init!.headers as Record<string, string>)["Content-Range"])).toContain("bytes */1300000");
  });
  it("bounds automatic retries and retains the session when the connection stays down", async () => {
    vi.useFakeTimers();
    const h = harness(), normal = h.fetcher.getMockImplementation()!, retrying = vi.fn();
    h.fetcher.mockImplementation(async (url, init) => {
      if (init?.method === "PUT") throw new TypeError("Load failed");
      return normal(url, init);
    });
    const checked = expect(uploadReservedDriveFile({ ...h.options, retrying })).rejects.toThrow("connection to Drive was interrupted");
    void checked.catch(() => {});
    await vi.advanceTimersByTimeAsync(20_000); await checked;
    expect(retrying.mock.calls).toEqual([[1, 1000], [2, 2000], [3, 4000]]);
    expect(h.fetcher.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(4);
    expect(h.journalEntries.get(h.options.journalKey)?.session).toBe(session);
  });
  it("stops retrying immediately when the workspace is cancelled", async () => {
    vi.useFakeTimers();
    const h = harness(), abort = new AbortController();
    h.fetcher.mockRejectedValue(new TypeError("Load failed"));
    const checked = expect(uploadReservedDriveFile({ ...h.options, signal: abort.signal,
      retrying: () => abort.abort() })).rejects.toThrow("workspace or project changed");
    void checked.catch(() => {});
    await vi.advanceTimersByTimeAsync(0); await checked;
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
  it("persists the session, uses 256 KiB multiple chunks and verifies completion before clearing the journal", async () => {
    const h = harness(); expect(await uploadReservedDriveFile(h.options)).toBe("reserved");
    const starts = h.fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(starts).toHaveLength(1); expect(JSON.parse(starts[0][1]!.body as string).id).toBe("reserved");
    const puts = h.fetcher.mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(puts.map(([, init]) => (init!.headers as Record<string, string>)["Content-Range"])).toEqual(["bytes 0-1048575/1300000", "bytes 1048576-1299999/1300000"]);
    expect(h.options.journal.write).toHaveBeenCalledWith(h.options.journalKey, { fileId: "reserved", size: 1300000, session });
    expect(JSON.stringify(h.options.journal.write.mock.calls)).not.toContain("synthetic-token");
    expect(h.journalEntries.size).toBe(0); expect(h.options.progress).toHaveBeenLastCalledWith(1300000, 1300000);
    expect(h.fetcher.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });
  it("queries the server offset after reload and resumes without a second create", async () => {
    const h = harness(); h.journalEntries.set(h.options.journalKey, { fileId: "reserved", size: 1300000, session });
    await uploadReservedDriveFile(h.options);
    expect(h.fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    expect(h.fetcher.mock.calls.filter(([, init]) => init?.method === "PUT").map(([, init]) => (init!.headers as Record<string, string>)["Content-Range"])).toEqual(["bytes */1300000", "bytes 1048576-1299999/1300000"]);
  });
  it("recovers an ambiguous successful PUT by verifying the reserved ID instead of creating another file", async () => {
    const h = harness(100); const normal = h.fetcher.getMockImplementation()!;
    h.fetcher.mockImplementation(async (url, init) => {
      const response = await normal(url, init);
      if (init?.method === "PUT") throw new Error("Response lost after successful upload");
      return response;
    });
    await expect(uploadReservedDriveFile(h.options)).rejects.toThrow("Response lost");
    h.fetcher.mockImplementation(normal);
    await uploadReservedDriveFile(h.options);
    expect(h.fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(h.fetcher.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
  });
  it("restarts an expired session against the same reserved identity", async () => {
    const h = harness(); h.journalEntries.set(h.options.journalKey, { fileId: "reserved", size: 1300000, session });
    const normal = h.fetcher.getMockImplementation()!;
    h.fetcher.mockImplementation(async (url, init) => (init?.headers as Record<string, string>)?.["Content-Range"] === "bytes */1300000" ? new Response(null, { status: 404 }) : normal(url, init));
    await uploadReservedDriveFile(h.options);
    expect(h.fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(h.journalEntries.size).toBe(0);
  });
  it("pauses on token expiry, journal failure, mismatched completed files and hostile cached session URLs", async () => {
    const h = harness(); let token: string | null = "synthetic-token";
    h.options.token = () => token!; h.options.progress.mockImplementation(sent => { if (sent === 1048576) token = null; });
    await expect(uploadReservedDriveFile(h.options)).rejects.toThrow("Reconnect Drive");
    expect(h.journalEntries.size).toBe(1);
    token = "synthetic-token"; h.journalEntries.set(h.options.journalKey, { fileId: "reserved", size: 1300000, session: "https://untrusted.example/upload" });
    await expect(uploadReservedDriveFile(h.options)).rejects.toThrow("Invalid cached");
    h.journalEntries.clear(); h.options.journal.write.mockRejectedValueOnce(new Error("Quota"));
    const before = h.fetcher.mock.calls.length;
    await expect(uploadReservedDriveFile(h.options)).rejects.toThrow("Quota");
    expect(h.fetcher.mock.calls.slice(before).some(([, init]) => init?.method === "POST")).toBe(false);
    h.fetcher.mockResolvedValue(Response.json({ id: "reserved", size: "1", mimeType: "image/jpeg" }));
    await expect(uploadReservedDriveFile(h.options)).rejects.toThrow("does not match");
  });
});

describe("metadata acknowledgement barrier", () => {
  it("waits for superseding metadata and settles failure/cancellation instead of permitting an unrecorded upload", async () => {
    vi.useFakeTimers(); const callbacks: Array<(ok: boolean) => void> = [];
    const queue = new ProjectSyncQueue(async () => new Promise(resolve => callbacks.push(resolve)), 0); queue.setEnabled(true);
    const accepted = vi.fn(); const first = queue.flush("p", "v1").then(accepted);
    await vi.advanceTimersByTimeAsync(0); queue.enqueue("p", "v2", true); callbacks[0](true);
    await vi.advanceTimersByTimeAsync(1); expect(accepted).not.toHaveBeenCalled(); callbacks[1](true);
    await first; expect(accepted).toHaveBeenCalledWith(true);
    const failed = queue.flush("p", "v3"); await vi.advanceTimersByTimeAsync(1); callbacks[2](false); expect(await failed).toBe(false);
    const stopped = queue.flush("p", "v4"); queue.stop(); expect(await stopped).toBe(false);
  });
});
