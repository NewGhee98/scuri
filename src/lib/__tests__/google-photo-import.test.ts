import { afterEach, describe, expect, it, vi } from "vitest";
import { boundedPhotoDownload, chooseGooglePhotos, googlePhotosDownloadUrl, listPickedPhotos } from "../google-photo-import";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const item = (id: string) => ({ id, mediaFile: { filename: `${id}.jpg`, mimeType: "image/jpeg", baseUrl: `https://photos.googleusercontent.com/${id}` } });
describe("Google selection adapters, without accounts or real network", () => {
  it("collects every page and detects repeated pagination tokens", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ mediaItems: [item("one")], nextPageToken: "two" }))
      .mockResolvedValueOnce(Response.json({ mediaItems: [item("two")] })); vi.stubGlobal("fetch", fetcher);
    expect((await listPickedPhotos("synthetic", "session")).map(photo => photo.id)).toEqual(["one", "two"]);
    expect(fetcher.mock.calls[1][0]).toContain("pageToken=two");
    fetcher.mockImplementation(async () => Response.json({ nextPageToken: "repeated" }));
    await expect(listPickedPhotos("synthetic", "session")).rejects.toThrow("repeated");
  });
  it("only accepts Google media download hosts and requests the full file", () => {
    expect(googlePhotosDownloadUrl(item("original").mediaFile.baseUrl)).toBe("https://photos.googleusercontent.com/original=d");
    for (const url of ["http://photos.googleusercontent.com/file", "https://googleusercontent.com.evil.example/file", "https://user:password@photos.googleusercontent.com/file"]) {
      expect(() => googlePhotosDownloadUrl(url)).toThrow();
    }
  });
  it("hands off lazy originals to the queue, retaining the session until released and never saving temporary URLs", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_PHOTOS_CLIENT_ID", "synthetic-client");
    vi.stubGlobal("window", { google: { accounts: { oauth2: { initTokenClient: ({ callback }: { callback: (value: unknown) => void }) => ({ requestAccessToken: () => callback({ access_token: "synthetic-token" }) }) } } } });
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/sessions") && init?.method === "POST") return Response.json({ id: "selection", pickerUri: "https://photos.google.com/picker/selection", mediaItemsSet: true });
      if (url.includes("/mediaItems?")) return Response.json({ mediaItems: [item("one"), item("two")] });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return new Response("untouched delivered original", { headers: { "Content-Type": "image/jpeg" } });
    }); vi.stubGlobal("fetch", fetcher);
    const launch = vi.fn(), sources = await chooseGooglePhotos(launch, new AbortController().signal);
    expect(launch).toHaveBeenCalledWith("https://photos.google.com/picker/selection");
    expect(fetcher.mock.calls.some(([url]) => url.includes("googleusercontent"))).toBe(false);
    const file = await sources[0].file(new AbortController().signal);
    expect(await file.text()).toBe("untouched delivered original"); expect(file.type).toBe("image/jpeg");
    expect(fetcher.mock.calls.some(([url]) => url.endsWith("one=d"))).toBe(true);
    sources[0].release!(); expect(fetcher.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    sources[1].release!(); expect(fetcher.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
  });
  it("reports denied access without starting a picker session and rejects oversized originals", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_PHOTOS_CLIENT_ID", "synthetic-client");
    vi.stubGlobal("window", { google: { accounts: { oauth2: { initTokenClient: ({ callback }: { callback: (value: unknown) => void }) => ({ requestAccessToken: () => callback({ error: "denied" }) }) } } } });
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(chooseGooglePhotos(vi.fn(), new AbortController().signal)).rejects.toThrow("not granted");
    expect(fetcher).not.toHaveBeenCalled();
    await expect(boundedPhotoDownload(new Response("tiny", { headers: { "Content-Length": String(81 * 1024 * 1024) } }))).rejects.toThrow("80 MB");
  });
  it("cancels a hosted selection and cleans up its session without returning partial photos", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_PHOTOS_CLIENT_ID", "synthetic-client");
    vi.stubGlobal("window", { google: { accounts: { oauth2: { initTokenClient: ({ callback }: { callback: (value: unknown) => void }) => ({ requestAccessToken: () => callback({ access_token: "synthetic-token" }) }) } } } });
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "DELETE" ? new Response(null, { status: 204 }) :
      Response.json({ id: "cancelled", pickerUri: "https://photos.google.com/picker/cancelled", mediaItemsSet: false }));
    vi.stubGlobal("fetch", fetcher);
    const abort = new AbortController();
    await expect(chooseGooglePhotos(() => abort.abort(), abort.signal)).rejects.toThrow();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
    expect(fetcher.mock.calls.some(([url]) => url.includes("mediaItems"))).toBe(false);
  });
  it("reports expired downloads without presenting an error response as an original", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_PHOTOS_CLIENT_ID", "synthetic-client");
    vi.stubGlobal("window", { google: { accounts: { oauth2: { initTokenClient: ({ callback }: { callback: (value: unknown) => void }) => ({ requestAccessToken: () => callback({ access_token: "synthetic-token" }) }) } } } });
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return Response.json({ id: "expired", pickerUri: "https://photos.google.com/picker/expired", mediaItemsSet: true });
      if (url.includes("mediaItems")) return Response.json({ mediaItems: [item("one")] });
      return new Response(null, { status: init?.method === "DELETE" ? 204 : 403 });
    }); vi.stubGlobal("fetch", fetcher);
    const sources = await chooseGooglePhotos(vi.fn(), new AbortController().signal);
    await expect(sources[0].file(new AbortController().signal)).rejects.toThrow("expired or failed");
    sources[0].release!();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
  });
});
