export const isFingerprint = (value: unknown): value is string => typeof value === "string" && /^sha256:\d+:[a-f0-9]{64}$/.test(value);
/** Only delivered original file bytes, never rendered or preview bytes. */
export async function fingerprintOriginal(blob: Blob): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return `sha256:${blob.size}:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}
