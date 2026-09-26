import { beforeEach, describe, expect, it, vi } from "vitest";
import { snapshotImportFile, saveImportedOriginal } from "../photo-original-storage";
import { fingerprintOriginal } from "../photo-fingerprint";
import { loadPhotoBlob, savePhotoBlob } from "../storage";
import { clearDerivedCache } from "../photo-cache-storage";
vi.mock("../storage", () => ({ loadPhotoBlob: vi.fn(), savePhotoBlob: vi.fn() }));
vi.mock("../photo-cache-storage", () => ({ clearDerivedCache: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); vi.mocked(clearDerivedCache).mockResolvedValue(); });

describe("verified original storage", () => {
  const source = () => new File([new Uint8Array([0, 255, 34, 10, 97, 0])], "unchanged.jpeg", { type: "image/jpeg", lastModified: 1234 });
  it("detaches a provider file while retaining every original byte and file metadata", async () => {
    const selected = source(), copy = await snapshotImportFile(selected);
    vi.spyOn(selected, "arrayBuffer").mockRejectedValue(new Error("Picker handle expired"));
    expect(copy).not.toBe(selected);
    expect(copy.name).toBe(selected.name); expect(copy.type).toBe(selected.type); expect(copy.lastModified).toBe(selected.lastModified);
    expect(Array.from(new Uint8Array(await copy.arrayBuffer()))).toEqual([0, 255, 34, 10, 97, 0]);
  });
  it("reads back persisted bytes before accepting the original and stores a Blob rather than a picker File", async () => {
    const file = source();
    vi.mocked(savePhotoBlob).mockImplementation(async (_key, blob) => { vi.mocked(loadPhotoBlob).mockResolvedValue(structuredClone(blob)); });
    await saveImportedOriginal("photo", file, await fingerprintOriginal(file));
    expect(vi.mocked(savePhotoBlob).mock.calls[0][1]).not.toBeInstanceOf(File);
    expect(loadPhotoBlob).toHaveBeenCalledWith("photo");
  });
  it.each(["missing", "different", "unreadable"] as const)("rejects a successful write whose read-back is %s", async failure => {
    const file = source(); vi.mocked(savePhotoBlob).mockResolvedValue();
    if (failure === "missing") vi.mocked(loadPhotoBlob).mockResolvedValue(null);
    else if (failure === "different") vi.mocked(loadPhotoBlob).mockResolvedValue(new Blob(["wrong!"]));
    else vi.mocked(loadPhotoBlob).mockRejectedValue(new Error("Stored bytes unreadable"));
    await expect(saveImportedOriginal("photo", file, await fingerprintOriginal(file))).rejects.toThrow();
  });
  it("reclaims only derived cache on write failure and verifies the retried original", async () => {
    const file = source();
    vi.mocked(savePhotoBlob).mockRejectedValueOnce(new Error("Quota")).mockResolvedValueOnce();
    vi.mocked(loadPhotoBlob).mockResolvedValue(file);
    await saveImportedOriginal("photo", file, await fingerprintOriginal(file));
    expect(clearDerivedCache).toHaveBeenCalledOnce(); expect(savePhotoBlob).toHaveBeenCalledTimes(2);
  });
});
