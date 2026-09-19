import { readPhotoJob, removePhotoJob, writePhotoJob } from "./photo-cache-storage";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const CHUNK = 4 * 256 * 1024;
export interface UploadJournal { fileId: string; size: number; session?: string }
interface UploadOptions {
  fileId: string; blob: Blob; journalKey: string;
  metadata: { name: string; parents: string[]; appProperties: Record<string, string> };
  token: () => string | null; current: () => boolean; signal?: AbortSignal;
  progress?: (sent: number, total: number) => void;
  journal?: { read: (key: string) => Promise<UploadJournal | null>; write: (key: string, value: UploadJournal) => Promise<void>; remove: (key: string) => Promise<void> };
}
export async function reserveDriveFileId(token: string): Promise<string> {
  const response = await fetch(`${API}/files/generateIds?count=1&space=drive&type=files`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Drive could not reserve an upload (${response.status}). Reconnect or retry.`);
  const data = await response.json() as { ids?: string[] };
  if (!data.ids?.[0]) throw new Error("Drive did not return a file identity.");
  return data.ids[0];
}
function allowedSession(url: string): boolean {
  try { const parsed = new URL(url); return parsed.protocol === "https:" && parsed.hostname === "www.googleapis.com" && parsed.pathname.startsWith("/upload/drive/"); }
  catch { return false; }
}
function received(response: Response, size: number): number {
  const range = response.headers.get("Range");
  if (!range) return 0;
  const match = /^bytes=0-(\d+)$/i.exec(range);
  const offset = match ? Number(match[1]) + 1 : NaN;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > size) throw new Error("Drive returned an invalid upload offset. Retry safely.");
  return offset;
}
/** Immutable create with a cloud-reserved ID. The caller MUST publish that ID
 * through the project revision gate before calling this function. A retry can
 * never PATCH an existing original. The journal contains no OAuth token. */
export async function uploadReservedDriveFile(options: UploadOptions): Promise<string> {
  const { fileId, blob, metadata, journalKey, current, progress } = options;
  const journal = options.journal ?? { read: readPhotoJob<UploadJournal>, write: writePhotoJob, remove: removePhotoJob };
  const request = async (url: string, init: RequestInit = {}) => {
    if (!current() || options.signal?.aborted) throw new Error("Upload paused because the workspace or project changed.");
    const token = options.token(); if (!token) throw new Error("Reconnect Drive to continue the backup.");
    return fetch(url, { ...init, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
      headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  };
  const verify = async (): Promise<boolean> => {
    const response = await request(`${API}/files/${encodeURIComponent(fileId)}?fields=id,size,mimeType,trashed,appProperties`);
    if (response.status === 404) return false;
    if (!response.ok) throw new Error(`Drive could not check this upload (${response.status}).`);
    const file = await response.json() as { id: string; size?: string; mimeType?: string; trashed?: boolean; appProperties?: Record<string, string> };
    if (file.id !== fileId || file.trashed || Number(file.size) !== blob.size || (blob.type && file.mimeType !== blob.type) ||
      ["scuriProjectId", "scuriBlobKey", "scuriType"].some(key => file.appProperties?.[key] !== metadata.appProperties[key])) {
      throw new Error("The reserved Drive file does not match this photo. Existing files were left untouched.");
    }
    return true;
  };
  const complete = async () => { if (!await verify()) throw new Error("Upload completion could not be verified. Retry to check it again.");
    await journal.remove(journalKey); progress?.(blob.size, blob.size); return fileId; };
  // Also handles a previous successful create whose final response was lost.
  if (await verify()) { await journal.remove(journalKey); progress?.(blob.size, blob.size); return fileId; }
  let saved = await journal.read(journalKey);
  if (saved && (saved.fileId !== fileId || saved.size !== blob.size)) saved = null;
  let session = saved?.session, offset = 0;
  if (session) {
    if (!allowedSession(session)) throw new Error("Invalid cached upload session. Existing Drive files were left untouched.");
    const status = await request(session, { method: "PUT", headers: { "Content-Range": `bytes */${blob.size}` } });
    if (status.status === 200 || status.status === 201) return complete();
    if (status.status === 308) offset = received(status, blob.size);
    else if ([404, 410].includes(status.status)) { if (await verify()) return complete(); session = undefined; }
    else throw new Error(`Drive upload is paused (${status.status}). Reconnect or retry.`);
  }
  if (!session) {
    // Persist identity before network transmission; failures stop safely.
    await journal.write(journalKey, { fileId, size: blob.size });
    const started = await request(`${UPLOAD}?uploadType=resumable&fields=id`, { method: "POST", headers: {
      "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": blob.type || "application/octet-stream", "X-Upload-Content-Length": String(blob.size),
    }, body: JSON.stringify({ ...metadata, id: fileId }) });
    if (started.status === 409) return complete();
    if (!started.ok) throw new Error(`Drive could not start this upload (${started.status}). Reconnect or retry.`);
    session = started.headers.get("Location") ?? undefined;
    if (!session || !allowedSession(session)) throw new Error("Drive did not return a valid upload session.");
    await journal.write(journalKey, { fileId, size: blob.size, session });
  }
  progress?.(offset, blob.size);
  while (offset < blob.size) {
    const end = Math.min(offset + CHUNK, blob.size);
    const response = await request(session, { method: "PUT", headers: { "Content-Type": blob.type || "application/octet-stream",
      "Content-Range": `bytes ${offset}-${end - 1}/${blob.size}` }, body: blob.slice(offset, end, blob.type) });
    if (response.status === 200 || response.status === 201) return complete();
    if (response.status !== 308) throw new Error(`Drive upload paused (${response.status}). Your completed files are preserved; retry to resume.`);
    const next = received(response, blob.size);
    if (next <= offset || next > end) throw new Error("Drive did not confirm the next upload chunk. Retry to resume.");
    offset = next; progress?.(offset, blob.size);
  }
  return complete();
}
