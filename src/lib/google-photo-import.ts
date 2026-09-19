import { getGoogleDriveClientId, requestGoogleDriveAccessToken } from "./google-drive";
import type { PhotoImportSource } from "./photo-import-queue";

export const photosImportConfigured = () => Boolean(process.env.NEXT_PUBLIC_GOOGLE_PHOTOS_CLIENT_ID || getGoogleDriveClientId());
export const drivePickerConfigured = () => Boolean(getGoogleDriveClientId() && process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY && process.env.NEXT_PUBLIC_GOOGLE_PICKER_APP_ID);
const PHOTO_API = "https://photospicker.googleapis.com/v1";
type PickedPhoto = { id: string; mediaFile: { baseUrl: string; filename: string; mimeType: string } };
type Session = { id: string; pickerUri: string; mediaItemsSet?: boolean; pollingConfig?: { pollInterval?: string; timeoutIn?: string } };
function seconds(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? ""); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
export async function boundedPhotoDownload(response: Response): Promise<Blob> {
  const limit = 80 * 1024 * 1024;
  if (Number(response.headers.get("Content-Length")) > limit) { await response.body?.cancel(); throw new Error("This photo is over 80 MB."); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The source did not return image bytes.");
  const chunks: ArrayBuffer[] = []; let length = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break;
      length += value.length; if (length > limit) { await reader.cancel(); throw new Error("This photo is over 80 MB."); }
      chunks.push(new Uint8Array(value).buffer);
    }
    return new Blob(chunks, { type: response.headers.get("Content-Type")?.split(";")[0] || "application/octet-stream" });
  } finally { reader.releaseLock(); }
}
async function photosToken(): Promise<string> {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_PHOTOS_CLIENT_ID || getGoogleDriveClientId();
  if (!clientId || !window.google?.accounts.oauth2) throw new Error("Google Photos is not ready on this installation. You can still add photos from Files or Photos.");
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({ client_id: clientId,
      scope: "https://www.googleapis.com/auth/photospicker.mediaitems.readonly",
      callback: response => response.access_token ? resolve(response.access_token) : reject(new Error("Google Photos access was not granted.")),
      error_callback: () => reject(new Error("Google Photos sign-in was cancelled or blocked.")) });
    client.requestAccessToken({ prompt: "consent" });
  });
}
async function photosRequest<T>(token: string, path: string, signal?: AbortSignal, method = "GET"): Promise<T> {
  const response = await fetch(`${PHOTO_API}${path}`, { method, signal, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(method === "POST" ? { body: "{}" } : {}) });
  if (!response.ok) throw new Error(`Google Photos could not complete this request (${response.status}). Reconnect and select the photos again; existing imports are safe.`);
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
export function googlePhotosDownloadUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".googleusercontent.com") || url.username || url.password) throw new Error("Google Photos returned an unsupported download address.");
  return `${baseUrl}=d`; // Full download, never w/h/c thumbnail parameters.
}
export async function listPickedPhotos(token: string, sessionId: string, signal?: AbortSignal): Promise<PickedPhoto[]> {
  const items: PickedPhoto[] = [], seen = new Set<string>(); let pageToken = "";
  do {
    if (seen.has(pageToken)) throw new Error("Google Photos repeated a result page. Retry the selection.");
    seen.add(pageToken);
    const query = new URLSearchParams({ sessionId, pageSize: "100", ...(pageToken ? { pageToken } : {}) });
    const page = await photosRequest<{ mediaItems?: PickedPhoto[]; nextPageToken?: string }>(token, `/mediaItems?${query}`, signal);
    items.push(...(page.mediaItems ?? [])); pageToken = page.nextPageToken ?? "";
  } while (pageToken);
  return items;
}
export async function chooseGooglePhotos(onLaunch: (uri: string) => void, signal: AbortSignal): Promise<PhotoImportSource[]> {
  const token = await photosToken(); signal.throwIfAborted();
  let session = await photosRequest<Session>(token, "/sessions", signal, "POST");
  const id = session.id;
  const cleanup = () => { void photosRequest(token, `/sessions/${encodeURIComponent(id)}`, undefined, "DELETE").catch(() => {}); };
  try {
    const uri = new URL(session.pickerUri);
    if (uri.protocol !== "https:" || uri.hostname !== "photos.google.com") throw new Error("Google Photos returned an unsupported picker address.");
    onLaunch(session.pickerUri);
    const duration = Math.min(600_000, Math.max(30_000, seconds(session.pollingConfig?.timeoutIn, 600) * 1000));
    const until = Date.now() + duration;
    while (!session.mediaItemsSet) {
      if (Date.now() >= until) throw new Error("Google Photos selection timed out. Your project is unchanged; try again.");
      await wait(Math.min(30_000, Math.max(1000, seconds(session.pollingConfig?.pollInterval, 5) * 1000)), signal);
      session = await photosRequest<Session>(token, `/sessions/${encodeURIComponent(id)}`, signal);
    }
    const items = await listPickedPhotos(token, id, signal), released = new Set<string>();
    if (!items.length) cleanup();
    return items.map(item => ({ id: item.id, name: item.mediaFile.filename,
      release: () => { released.add(item.id); if (released.size === items.length) cleanup(); }, file: async uploadSignal => {
      if (!["image/jpeg", "image/png", "image/webp"].includes(item.mediaFile.mimeType)) throw new Error("This source format is not supported. Choose a JPEG, PNG or WebP copy.");
      const response = await fetch(googlePhotosDownloadUrl(item.mediaFile.baseUrl), { signal: uploadSignal, headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("The Google Photos download expired or failed. Select this photo again; completed imports remain safe.");
      const blob = await boundedPhotoDownload(response);
      return new File([blob], item.mediaFile.filename, { type: item.mediaFile.mimeType });
    } }));
  } catch (error) { cleanup(); throw error; }
}

type PickerDocument = { id: string; name: string; mimeType: string };
interface PickerInstance { setVisible: (visible: boolean) => void; dispose: () => void }
interface PickerBuilder {
  setDeveloperKey(key: string): PickerBuilder; setAppId(id: string): PickerBuilder; setOAuthToken(token: string): PickerBuilder;
  setOrigin(origin: string): PickerBuilder; addView(view: unknown): PickerBuilder; enableFeature(feature: unknown): PickerBuilder;
  setCallback(callback: (data: { action: string; docs?: PickerDocument[] }) => void): PickerBuilder; build(): PickerInstance;
}
type PickerApi = { PickerBuilder: new () => PickerBuilder; DocsView: new () => { setMimeTypes: (types: string) => unknown }; Feature: { MULTISELECT_ENABLED: unknown } };
let pickerScript: Promise<void> | undefined;
function loadPicker(): Promise<void> {
  return pickerScript ??= new Promise<void>((resolve, reject) => {
    const ready = () => (window as unknown as { gapi: { load: (name: string, options: { callback: () => void; onerror: () => void; timeout: number; ontimeout: () => void }) => void } }).gapi.load("picker", {
      callback: resolve, onerror: () => reject(new Error("Google Drive picker could not load.")), timeout: 20_000, ontimeout: () => reject(new Error("Google Drive picker timed out.")) });
    if ((window as unknown as { gapi?: unknown }).gapi) { ready(); return; }
    const script = document.createElement("script"); script.src = "https://apis.google.com/js/api.js"; script.async = true;
    script.onload = ready; script.onerror = () => reject(new Error("Google Drive picker could not load.")); document.head.appendChild(script);
  }).catch(error => { pickerScript = undefined; throw error; });
}
export async function chooseGoogleDrive(signal: AbortSignal): Promise<PhotoImportSource[]> {
  if (!drivePickerConfigured()) throw new Error("Direct Drive selection is not ready on this installation. Choose Files, then Google Drive under Locations.");
  const token = await requestGoogleDriveAccessToken(); await loadPicker(); signal.throwIfAborted();
  const picker = (window as unknown as { google: { picker: PickerApi } }).google.picker;
  return new Promise((resolve, reject) => {
    const abort = () => { instance.dispose(); reject(new DOMException("Cancelled", "AbortError")); };
    const instance = new picker.PickerBuilder().setDeveloperKey(process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY!)
      .setAppId(process.env.NEXT_PUBLIC_GOOGLE_PICKER_APP_ID!).setOAuthToken(token.accessToken).setOrigin(window.location.origin)
      .addView(new picker.DocsView().setMimeTypes("image/jpeg,image/png,image/webp")).enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .setCallback(data => {
        if (data.action !== "picked" && data.action !== "cancel") return;
        signal.removeEventListener("abort", abort); instance.dispose();
        resolve((data.docs ?? []).map(item => ({ id: item.id, name: item.name, file: async uploadSignal => {
          const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(item.id)}?alt=media`, {
            signal: uploadSignal, headers: { Authorization: `Bearer ${token.accessToken}` } });
          if (!response.ok) throw new Error("Drive download failed. Select this photo again to renew access; completed imports are safe.");
          return new File([await boundedPhotoDownload(response)], item.name, { type: item.mimeType });
        } })));
      }).build();
    signal.addEventListener("abort", abort, { once: true }); instance.setVisible(true);
  });
}
