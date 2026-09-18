"use client";

import { useMemo } from "react";
import { isPageComplete } from "@/lib/project";
import { getProjectBackupCounts } from "@/lib/project-sync";
import { getTemplate } from "@/lib/templates";
import type { CanvasFormat, ProjectCloudSyncState, ProjectPage, StoredProject } from "@/lib/types";
import { CompositionThumbnail } from "./composition-thumbnail";

interface ProjectLibraryCardProps {
  format: CanvasFormat;
  project: StoredProject;
  syncState?: ProjectCloudSyncState;
  onOpen: (projectId: string) => void;
  onDelete: (projectId: string) => void;
}

function formatEditedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Edited recently";
  return `Edited ${new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(date)}`;
}

const SYNC_STATUS_LABEL: Record<ProjectCloudSyncState, string> = {
  "local-only": "On this device only",
  "saved-locally": "Saved locally · syncing soon",
  syncing: "Syncing…",
  synced: "Synced",
  "waiting-for-connection": "Waiting for connection",
  "drive-reconnect-required": "Reconnect Drive for full-res photos",
  "sync-error": "Sync needs attention",
  "photos-pending": "Layout saved · photo backup pending",
};

const SYNC_STATUS_CLASS: Record<ProjectCloudSyncState, string> = {
  "local-only": "text-neutral-500",
  "saved-locally": "text-neutral-500",
  syncing: "text-neutral-500",
  synced: "text-emerald-700",
  "waiting-for-connection": "text-amber-700",
  "drive-reconnect-required": "text-amber-700",
  "sync-error": "text-red-700",
  "photos-pending": "text-amber-700",
};

export function ProjectLibraryCard({ format, project, syncState, onOpen, onDelete }: ProjectLibraryCardProps) {
  const backup = getProjectBackupCounts(project);
  const completePages = useMemo(
    () => project.pages.filter((page) => isPageComplete(page, page.templateSnapshot ?? getTemplate(page.templateId))),
    [project.pages],
  );
  const coverPage = completePages[0] ?? project.pages[0] ?? null;
  const coverTemplate = coverPage ? coverPage.templateSnapshot ?? getTemplate(coverPage.templateId) : null;
  // This cover is display-only. Preview bytes never masquerade as originals.
  const previewPage = useMemo<ProjectPage | null>(() => coverPage
    ? { ...coverPage, photos: {}, unavailablePhotos: coverPage.photos } : null, [coverPage]);

  return (
    <article className="project-library-card">
      <button className="project-library-open" type="button" onClick={() => onOpen(project.id)} aria-label={`Open ${project.name}`}>
        <span className="project-library-preview">
          {previewPage && coverTemplate ? (
            <CompositionThumbnail format={format} page={previewPage} template={coverTemplate} />
          ) : (
            <span className="project-library-empty" aria-hidden="true"><span /><span /><span /></span>
          )}
        </span>
        <span className="block min-w-0 p-4 text-left">
          <span className="block truncate text-base font-semibold tracking-[-0.02em]">{project.name}</span>
          <span className="mt-1 block text-xs text-neutral-500">
            {format.shortLabel} · {project.pages.length} {project.pages.length === 1 ? "page" : "pages"}
            {completePages.length ? ` · ${completePages.length} filled` : ""}
          </span>
          <span className="mt-2 block text-[11px] text-neutral-500">{formatEditedDate(project.updatedAt)}</span>
          {syncState ? <span className={`mt-1 block text-[11px] font-medium ${SYNC_STATUS_CLASS[syncState]}`}>{SYNC_STATUS_LABEL[syncState]}</span> : null}
          {backup.total ? <span className="mt-1 block text-[11px] text-neutral-500">Originals backed up: {backup.originals}/{backup.total} · Previews: {backup.previews}/{backup.total}</span> : null}
        </span>
      </button>
      <div className="project-library-actions">
        <button className="card-action" type="button" onClick={() => onOpen(project.id)}>Open</button>
        <button className="card-action danger" type="button" onClick={() => onDelete(project.id)}>Delete</button>
      </div>
    </article>
  );
}
