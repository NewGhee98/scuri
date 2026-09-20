import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { createProjectBackup, inspectProjectBackup, materializeProjectBackup } from "../project-backup";
import { getTemplate } from "../templates";
import { uploadPhotoAssetToDrive } from "../google-drive";
import type { StoredProject } from "../types";

const template = getTemplate("instagram-post-full-frame");
const timestamp = "2026-01-01T00:00:00.000Z";
function project(): StoredProject {
  const frameId = template.frames[0].id;
  return { version: 3, id: "synthetic-project", name: "Synthetic backup", formatId: template.formatId,
    revision: 8, cloudSyncedAt: timestamp, driveFolderId: "synthetic-folder", createdAt: timestamp, updatedAt: timestamp, activePageId: "synthetic-page",
    pages: [{ id: "synthetic-page", templateId: template.id, background: "#ffffff", gutter: 0, selectedFrameId: frameId, createdAt: timestamp, updatedAt: timestamp,
      photos: { [frameId]: { frameId, blobKey: "synthetic-blob", cloudAssetId: "synthetic-row", driveOriginalId: "synthetic-original", drivePreviewId: "synthetic-preview",
        sourceName: "synthetic.jpg", mimeType: "image/jpeg", fileSize: 9, sourceWidth: 1200, sourceHeight: 800, crop: { positionX: 0.5, positionY: -0.2, zoom: 2 } } } }],
  };
}
const bytes = () => new Blob(["synthetic original bytes"], { type: "image/jpeg" });
const blobFromZip = (entries: Record<string, Uint8Array>) => new Blob([new Uint8Array(zipSync(entries)).buffer]);
beforeEach(() => { vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No real network in backup tests"); })); });
afterEach(() => vi.unstubAllGlobals());

describe("portable project packages", () => {
  it("retains free positioning and independent repeated crops without touching original bytes", async () => {
    const source = project(), photo = Object.values(source.pages[0].photos)[0];
    photo.crop = { ...photo.crop, zoom: .67, freePosition: { x: .12, y: -.34 } };
    source.pages.push({ ...source.pages[0], id: "synthetic-repeat", photos: { [photo.frameId]: { ...photo, crop: { ...photo.crop, freePosition: { x: -.23, y: .45 } } } } });
    const before = structuredClone(source), read = vi.fn(async () => bytes());
    const review = await inspectProjectBackup((await createProjectBackup(source, read)).blob);
    const restored = materializeProjectBackup(review);
    expect(read).toHaveBeenCalledOnce(); expect(restored.originals.size).toBe(1);
    for (let i = 0; i < 2; i++) expect(Object.values(restored.project.pages[i].photos)[0].crop).toEqual(Object.values(source.pages[i].photos)[0].crop);
    expect(await [...restored.originals.values()][0].text()).toBe(await bytes().text());
    expect(source).toEqual(before);
  });
  it("round-trips originals, layout snapshots and crops, restoring entirely fresh identities", async () => {
    const source = project(); const original = structuredClone(source);
    const backup = await createProjectBackup(source, async () => bytes());
    const preview = await inspectProjectBackup(backup.blob);
    expect(preview.missingOriginals).toBe(0);
    expect(await preview.originals.get("synthetic-blob")!.text()).toBe(await bytes().text());
    expect(preview.project.pages[0].templateSnapshot).toEqual(template);
    let id = 0;
    const restored = materializeProjectBackup(preview, () => `synthetic-new-${++id}`);
    const photo = Object.values(restored.project.pages[0].photos)[0];
    expect(photo.crop).toEqual(Object.values(source.pages[0].photos)[0].crop);
    expect([restored.project.id, restored.project.pages[0].id, photo.blobKey]).not.toContain(source.id);
    expect(restored.project.pages[0].id).not.toBe(source.pages[0].id);
    expect(photo.blobKey).not.toBe("synthetic-blob");
    expect([restored.project.revision, restored.project.cloudSyncedAt, restored.project.driveFolderId, photo.cloudAssetId, photo.driveOriginalId, photo.drivePreviewId]).toEqual(Array(6).fill(undefined));
    expect(restored.originals.has(photo.blobKey)).toBe(true);
    expect(source).toEqual(original);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("clearly marks missing originals while retaining every assignment", async () => {
    const backup = await createProjectBackup(project(), async () => null);
    expect(backup.missingOriginals).toBe(1);
    const preview = await inspectProjectBackup(backup.blob);
    expect(preview.missingOriginals).toBe(1);
    const restored = materializeProjectBackup(preview);
    expect(Object.keys(restored.project.pages[0].photos)).toHaveLength(1);
    expect(restored.originals.size).toBe(0);
  });

  it("includes one original for repeated assignments without overwriting an existing cache key", async () => {
    const source = project(); source.pages.push({ ...source.pages[0], id: "synthetic-second-page" });
    const read = vi.fn(async () => bytes());
    const preview = await inspectProjectBackup((await createProjectBackup(source, read)).blob);
    expect(read).toHaveBeenCalledTimes(1);
    const restored = materializeProjectBackup(preview);
    expect(restored.originals.size).toBe(1);
    expect(Object.values(restored.project.pages[0].photos)[0].blobKey).toBe(Object.values(restored.project.pages[1].photos)[0].blobKey);
  });

  it.each(["photo checksum", "missing photo", "unsafe path", "unsupported version", "malformed photos"])("rejects %s before import can write any project", async failure => {
    const backup = await createProjectBackup(project(), async () => bytes());
    const entries = unzipSync(new Uint8Array(await backup.blob.arrayBuffer()));
    if (failure === "photo checksum") entries["originals/0.bin"][0] ^= 1;
    if (failure === "missing photo") delete entries["originals/0.bin"]; // synthetic ZIP entry only, never stored project assets
    if (failure === "unsafe path") entries["../unsafe.bin"] = new Uint8Array([1]);
    if (failure === "unsupported version" || failure === "malformed photos") {
      const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
      if (failure === "unsupported version") manifest.version = 999;
      else manifest.project.pages[0].photos = null;
      entries["manifest.json"] = strToU8(JSON.stringify(manifest));
    }
    await expect(inspectProjectBackup(blobFromZip(entries))).rejects.toThrow();
  });
});

describe("partial Drive upload durability", () => {
  it("checkpoints the original before preview failure, then retries only the preview", async () => {
    const metadata: Array<{ appProperties: { scuriType: string } }> = [];
    let previewFails = true;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === "POST") {
        metadata.push(JSON.parse(String(init.body)));
        return new Response(null, { headers: { Location: "https://synthetic.invalid/upload" } });
      }
      const type = metadata.at(-1)!.appProperties.scuriType;
      if (type === "preview" && previewFails) return new Response(null, { status: 503 });
      return Response.json({ id: `synthetic-${type}` });
    }));
    const folders = { projectFolderId: "p", originalsFolderId: "o", previewsFolderId: "v", exportsFolderId: "e" };
    const photo: { frameId: string; blobKey: string; driveOriginalId?: string; drivePreviewId?: string } = { frameId: "f", blobKey: "b" };
    const checkpoint = vi.fn(async ids => { Object.assign(photo, ids); });
    await expect(uploadPhotoAssetToDrive("synthetic-token", folders, "p", "page", photo, bytes(), bytes(), checkpoint)).rejects.toThrow("503");
    expect(photo.driveOriginalId).toBe("synthetic-original");
    previewFails = false;
    await uploadPhotoAssetToDrive("synthetic-token", folders, "p", "page", photo, bytes(), bytes(), checkpoint);
    expect(metadata.filter(item => item.appProperties.scuriType === "original")).toHaveLength(1);
    expect(photo.drivePreviewId).toBe("synthetic-preview");
  });
});
