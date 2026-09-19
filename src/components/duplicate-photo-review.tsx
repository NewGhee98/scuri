"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { downloadGoogleDrivePhoto } from "@/lib/google-drive";
import { loadPhotoBlob } from "@/lib/storage";
import { getProjectPhotos } from "@/lib/project-photo-library";
import { scanExactDuplicates, type DuplicateScan, type DuplicateGroup } from "@/lib/photo-duplicates";
import type { StoredProject } from "@/lib/types";

export function DuplicatePhotoReview({ project, ownerId, thumbnails, getVolatileBlob, getDriveToken, onApply, onClose }: {
  project: StoredProject; ownerId?: string | null; thumbnails: Record<string, { url: string }>;
  getVolatileBlob: (key: string) => Blob | undefined; getDriveToken: () => string | null;
  onApply: (scan: DuplicateScan, groups: DuplicateGroup[]) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const initial = useRef(project);
  const [scan, setScan] = useState<DuplicateScan | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const photos = new Map(getProjectPhotos(project).map(photo => [photo.blobKey, photo]));

  useEffect(() => {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    const abort = new AbortController();
    let cache: Storage | undefined;
    try { cache = localStorage; } catch { /* Derived cache is optional. */ }
    void scanExactDuplicates(initial.current, async photo => {
      const local = await loadPhotoBlob(photo.blobKey).catch(() => null) ?? getVolatileBlob(photo.blobKey);
      if (local) return local;
      const token = getDriveToken();
      // Exact copies require originals, never the small analysis previews.
      return token && photo.driveOriginalId ? downloadGoogleDrivePhoto(token, photo.driveOriginalId) : null;
    }, { ownerId, cache, signal: abort.signal, onProgress: (done, total) => setProgress({ done, total }) })
      .then(result => { if (!abort.signal.aborted) { setScan(result); setSelected(new Set(result.groups.map(group => group.fingerprint))); } })
      .catch(() => { if (!abort.signal.aborted) setError("Duplicate checking could not finish. Your library is unchanged."); });
    return () => { abort.abort(); focused?.focus(); };
  }, [getDriveToken, getVolatileBlob, ownerId]);

  const chosen = scan?.groups.filter(group => selected.has(group.fingerprint)) ?? [];
  const removed = chosen.reduce((count, group) => count + group.keys.length - 1, 0);
  return <dialog ref={dialog} className="backup-dialog duplicate-review-dialog" aria-labelledby="duplicates-title"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2 id="duplicates-title" className="text-xl font-semibold">Review exact duplicates</h2>
    <p className="mt-2 text-sm text-neutral-600">Combine identical uploads into one library card. Every page placement and crop stays as it is. Drive originals are kept. You can undo this change.</p>
    <p className="mt-2 text-xs text-neutral-600">Exact matches are checked using original file bytes, including older uploads that have not yet been verified.</p>
    {!scan && !error ? <p role="status" className="mt-4 text-sm">Checking original files: {progress.done} / {progress.total}…</p> : null}
    {error ? <p role="alert" className="mt-4 text-sm text-red-700">{error}</p> : null}
    {scan ? <>
      {!scan.groups.length ? <p role="status" className="mt-4">No exact duplicates found among {scan.checked} checked photos.</p> : null}
      <div className="mt-4 grid gap-3">{scan.groups.map((group, index) => <label key={group.fingerprint} className="flex items-start gap-3 rounded-xl border border-black/10 p-3">
        <input type="checkbox" className="mt-2" checked={selected.has(group.fingerprint)} onChange={event => setSelected(current => {
          const next = new Set(current); if (event.target.checked) next.add(group.fingerprint); else next.delete(group.fingerprint); return next;
        })} aria-label={`Combine duplicate group ${index + 1}`} />
        {thumbnails[group.keys[0]] ? <Image unoptimized src={thumbnails[group.keys[0]].url} width={72} height={72} alt="" className="h-18 w-18 rounded object-contain" /> : null}
        <span className="min-w-0 text-sm"><strong>{group.keys.length} identical uploads → 1 library photo</strong>
          {group.keys.map((key, copy) => <span key={key} className="mt-1 block break-words text-xs text-neutral-600">{copy + 1}. {photos.get(key)?.sourceName ?? "Photo"}</span>)}
        </span>
      </label>)}</div>
      {scan.unavailable.length ? <p role="status" className="mt-4 text-sm text-amber-800">{scan.unavailable.length} {scan.unavailable.length === 1 ? "original is" : "originals are"} unavailable and could not be checked. Those photos stay in the library. Reconnect Drive and check again.</p> : null}
    </> : null}
    <div className="mt-6 flex flex-wrap justify-end gap-3">
      <button autoFocus type="button" className="secondary-button" onClick={onClose}>{scan ? "Cancel" : "Cancel check"}</button>
      <button type="button" className="primary-button" disabled={!scan || !removed} onClick={() => {
        try { if (scan) onApply(scan, chosen); onClose(); }
        catch (failure) { setError(failure instanceof Error ? failure.message : "Find duplicates again before applying."); }
      }}>Combine {removed} duplicate {removed === 1 ? "entry" : "entries"}</button>
    </div>
  </dialog>;
}
