import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeImage } from "../image";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("shared original decode budget", () => {
  it("holds the next large decode until the previous consumer releases it, respecting EXIF orientation", async () => {
    const close = vi.fn(), decode = vi.fn(async () => ({ width: 1440, height: 6400, close }));
    vi.stubGlobal("window", { createImageBitmap: decode }); vi.stubGlobal("createImageBitmap", decode);
    const original = new Blob(["synthetic encoded JPEG"], { type: "image/jpeg" });
    const first = await decodeImage(original), waiting = decodeImage(original);
    await Promise.resolve(); expect(decode).toHaveBeenCalledOnce();
    expect(decode).toHaveBeenCalledWith(original, { imageOrientation: "from-image" });
    expect(first).toMatchObject({ width: 1440, height: 6400 });
    first.close(); first.close();
    const second = await waiting;
    expect(decode).toHaveBeenCalledTimes(2); expect(close).toHaveBeenCalledOnce();
    second.close(); expect(close).toHaveBeenCalledTimes(2);
  });
  it("releases the decode lane after an unreadable file so later imports can continue", async () => {
    const decode = vi.fn().mockRejectedValueOnce(new Error("Invalid bitmap"))
      .mockResolvedValueOnce({ width: 1000, height: 1000, close: vi.fn() });
    vi.stubGlobal("window", { createImageBitmap: decode }); vi.stubGlobal("createImageBitmap", decode);
    vi.stubGlobal("Image", class { decoding = ""; src = ""; async decode() { throw new Error("Invalid JPEG"); } });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    await expect(decodeImage(new Blob(["broken"]))).rejects.toThrow("could not be opened");
    const next = await decodeImage(new Blob(["valid"]));
    expect(next.width).toBe(1000); expect(revoke).toHaveBeenCalledWith("blob:synthetic"); next.close();
  });
});
