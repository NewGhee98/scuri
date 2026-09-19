"use client";
import { useEffect, useRef, useState } from "react";
import { chooseGoogleDrive, chooseGooglePhotos } from "@/lib/google-photo-import";
import { fileImportSources, type PhotoImportSource } from "@/lib/photo-import-queue";

export function PhotoImportMenu({ onImport, initiallyOpen = false, externalPicker }: { onImport: (sources: PhotoImportSource[]) => void; initiallyOpen?: boolean; externalPicker?: () => (() => void) }) {
  const files = useRef<HTMLInputElement>(null), folder = useRef<HTMLInputElement>(null), controller = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(initiallyOpen), [working, setWorking] = useState(false);
  const [message, setMessage] = useState(""), [photosLink, setPhotosLink] = useState<string | null>(null);
  useEffect(() => { if (folder.current && "webkitdirectory" in folder.current) folder.current.setAttribute("webkitdirectory", "");
    return () => controller.current?.abort(); }, []);
  const receive = (input: HTMLInputElement) => { const chosen = Array.from(input.files ?? []); input.value = "";
    if (chosen.length) { onImport(fileImportSources(chosen)); setOpen(false); } };
  const google = async (source: "drive" | "photos") => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setWorking(true); setMessage(""); setPhotosLink(null);
    const restore = source === "drive" ? externalPicker?.() : undefined;
    try {
      const items = source === "drive" ? await chooseGoogleDrive(abort.signal) : await chooseGooglePhotos(setPhotosLink, abort.signal);
      if (abort.signal.aborted) { items.forEach(item => item.release?.()); return; }
      // The import queue now owns the sources, even if the library closes.
      controller.current = null;
      if (items.length) onImport(items); setPhotosLink(null); setOpen(false);
    } catch (error) { if (!abort.signal.aborted) setMessage(error instanceof Error ? error.message : "Import selection could not open."); }
    finally { restore?.(); if (!abort.signal.aborted) setWorking(false); }
  };
  return <div className="photo-import-menu">
    <button type="button" className="primary-button" onClick={() => setOpen(value => !value)}>Add photos</button>
    <input ref={files} hidden type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={event => receive(event.target)} />
    <input ref={folder} hidden type="file" multiple onChange={event => receive(event.target)} />
    {open ? <div className="photo-source-menu" aria-label="Photo import sources">
      <p className="font-medium">Import into this project</p>
      <button className="secondary-button" type="button" disabled={working} onClick={() => files.current?.click()}>Photos or Files…</button>
      <button className="secondary-button" type="button" disabled={working} onClick={() => {
        if (folder.current && "webkitdirectory" in folder.current) folder.current.click();
        else { setMessage("Folder selection is unavailable here; select multiple files instead."); files.current?.click(); }
      }}>Choose folder…</button>
      <button className="secondary-button" type="button" disabled={working} onClick={() => void google("drive")}>Google Drive…</button>
      <button className="secondary-button" type="button" disabled={working} onClick={() => void google("photos")}>Google Photos…</button>
      <p className="text-xs text-neutral-600">Files also includes your enabled cloud providers. JPEG, PNG and WebP, up to 80 MB per file.</p>
      {photosLink ? <a href={photosLink} target="_blank" rel="noopener noreferrer" className="primary-button">Open Google Photos to choose</a> : null}
      {working ? <><p role="status">{photosLink ? "Choose your photos in Google Photos, then return here." : "Opening photo selection…"}</p>
        <button type="button" className="text-button" onClick={() => { controller.current?.abort(); setWorking(false); setPhotosLink(null); }}>Cancel selection</button></> : null}
      {message ? <p role="alert" className="text-sm text-amber-900">{message}</p> : null}
    </div> : null}
  </div>;
}
