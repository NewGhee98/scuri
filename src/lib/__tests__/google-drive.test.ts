import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadPhotoAssetToDrive } from "../google-drive";

afterEach(() => vi.unstubAllGlobals());

describe("Drive upload recovery hints", () => {
  it("backs up an unassigned original without inventing page or frame identities", async () => {
    const metadata: Array<{ appProperties: Record<string, string> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options: RequestInit) => {
      if (options.method === "POST") {
        metadata.push(JSON.parse(String(options.body)));
        return new Response(null, { status: 200, headers: { Location: "https://example.invalid/synthetic-upload" } });
      }
      return Response.json({ id: `synthetic-unassigned-${metadata.length}` });
    }));
    const bytes = new Blob(["synthetic bytes"], { type: "image/jpeg" });
    await uploadPhotoAssetToDrive("synthetic-token", { projectFolderId: "p", originalsFolderId: "o", previewsFolderId: "v", exportsFolderId: "e" },
      "synthetic-project", null, { blobKey: "synthetic-library-photo" }, bytes, bytes);
    expect(metadata.map(item => item.appProperties)).toEqual(["original", "preview"].map(scuriType => ({
      scuriType, scuriProjectId: "synthetic-project", scuriBlobKey: "synthetic-library-photo",
    })));
  });
  it("attaches project/page/frame/blob identity to both uploads", async () => {
    const metadata: Array<{ appProperties: Record<string, string> }> = [];
    const fetch = vi.fn(async (_url: string, options: RequestInit) => {
      if (options.method === "POST") {
        metadata.push(JSON.parse(String(options.body)));
        return new Response(null, { status: 200, headers: { Location: "https://example.invalid/synthetic-upload" } });
      }
      return Response.json({ id: `synthetic-file-${metadata.length}` });
    });
    vi.stubGlobal("fetch", fetch);
    const folders = { projectFolderId: "test-folder", originalsFolderId: "test-originals", previewsFolderId: "test-previews", exportsFolderId: "test-exports" };
    const photo = { blobKey: "test-blob", frameId: "test-frame", mimeType: "image/jpeg" };
    const bytes = new Blob(["synthetic bytes"], { type: "image/jpeg" });
    const uploaded = await uploadPhotoAssetToDrive("synthetic-token", folders, "test-project", "test-page", photo, bytes, bytes);
    expect(metadata.map((item) => item.appProperties)).toEqual(["original", "preview"].map((scuriType) => ({
      scuriType, scuriProjectId: "test-project", scuriPageId: "test-page", scuriFrameId: "test-frame", scuriBlobKey: "test-blob",
    })));
    expect(uploaded).toEqual({ driveOriginalId: "synthetic-file-1", drivePreviewId: "synthetic-file-2" });
    expect(fetch).toHaveBeenCalledTimes(4);
    await uploadPhotoAssetToDrive("synthetic-token", folders, "test-project", "test-page", { ...photo, ...uploaded }, bytes, bytes);
    expect(fetch).toHaveBeenCalledTimes(4); // existing files need no new metadata to work
  });
});
