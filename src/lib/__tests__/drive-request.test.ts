import { afterEach, describe, expect, it, vi } from "vitest";
import { driveRequest, driveResponseError } from "../drive-request";
afterEach(() => vi.unstubAllGlobals());

describe("Drive recovery classification", () => {
  it("retries rate limits but reports full storage and permission failures separately", async () => {
    const response = (reason: string) => Response.json({ error: { errors: [{ reason }] } }, { status: 403 });
    expect(await driveResponseError(response("userRateLimitExceeded"), "Uploading photo")).toMatchObject({ retryable: true, needsReconnect: false });
    expect(await driveResponseError(response("storageQuotaExceeded"), "Uploading photo")).toMatchObject({
      retryable: false, needsReconnect: false, message: expect.stringContaining("storage is full"),
    });
    expect(await driveResponseError(response("insufficientPermissions"), "Uploading photo")).toMatchObject({ retryable: false, needsReconnect: true });
  });
  it("adds useful context without echoing private URLs or credentials", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Load failed")));
    await expect(driveRequest("https://www.googleapis.com/private-session", {
      headers: { Authorization: "Bearer synthetic-secret" },
    }, "Uploading preview")).rejects.toMatchObject({
      retryable: true, message: "Uploading preview: the connection to Drive was interrupted. Retry backup to resume.",
    });
  });
  it("keeps explicit cancellation out of the network retry path", async () => {
    const abort = new AbortController(); abort.abort();
    const error = new DOMException("Stopped", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
    await expect(driveRequest("https://www.googleapis.com/drive/v3/files", { signal: abort.signal }, "Checking upload")).rejects.toBe(error);
  });
});
