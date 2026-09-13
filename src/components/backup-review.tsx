"use client";

import { useEffect, useRef } from "react";
import type { ProjectBackupPreview } from "@/lib/project-backup";

export function BackupReview({ preview, busy, onCancel, onRestore }: {
  preview: ProjectBackupPreview; busy: boolean; onCancel: () => void; onRestore: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return (
    <dialog ref={dialog} className="backup-dialog" aria-labelledby="backup-review-title"
      onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
      <h2 id="backup-review-title" className="text-xl font-semibold">Restore project backup</h2>
      <p className="mt-3 text-base font-medium">{preview.project.name}</p>
      <p className="mt-2 text-sm text-neutral-600">{preview.project.pages.length} pages · {preview.originals.size} original photos included</p>
      {preview.missingOriginals > 0 ? <p role="status" className="mt-3 text-sm text-amber-800">
        This backup is incomplete: {preview.missingOriginals} original photos are missing. Their frames and crops will be kept, but you will need to add those images again.
      </p> : null}
      <p className="mt-3 text-sm leading-6 text-neutral-600">A new project will be created in this workspace. Existing projects will stay unchanged. Photos will back up to your connected Drive account when available.</p>
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button autoFocus className="secondary-button" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
        <button className="primary-button" type="button" disabled={busy} onClick={onRestore}>{busy ? "Restoring…" : "Restore as new project"}</button>
      </div>
    </dialog>
  );
}
