"use client";

import { useEffect, useMemo, useState } from "react";
import { disposePhotoAsset, preparePhotoAsset } from "@/lib/image";
import { isPageComplete } from "@/lib/project";
import { loadPhotoBlob } from "@/lib/storage";
import { getTemplate } from "@/lib/templates";
import type { CanvasFormat, PhotoAsset, ProjectPage, StoredProject } from "@/lib/types";
import { CompositionThumbnail } from "./composition-thumbnail";
import { TemplateThumbnail } from "./template-thumbnail";

interface ProjectLibraryCardProps {
  format: CanvasFormat;
  project: StoredProject;
  onOpen: (projectId: string) => void;
  onDelete: (projectId: string) => void;
}

function formatEditedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Edited recently";
  return `Edited ${new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(date)}`;
}

export function ProjectLibraryCard({ format, project, onOpen, onDelete }: ProjectLibraryCardProps) {
  const completePages = useMemo(
    () => project.pages.filter((page) => isPageComplete(page, page.templateSnapshot ?? getTemplate(page.templateId))),
    [project.pages],
  );
  const coverPage = completePages[0] ?? project.pages[0] ?? null;
  const coverTemplate = coverPage ? coverPage.templateSnapshot ?? getTemplate(coverPage.templateId) : null;
  const [hydratedPage, setHydratedPage] = useState<ProjectPage | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loadedPage: ProjectPage | null = null;

    const hydrateCover = async () => {
      if (!coverPage || !coverTemplate) {
        setHydratedPage(null);
        return;
      }
      const entries = await Promise.all(Object.values(coverPage.photos).map(async (item) => {
        const blob = await loadPhotoBlob(item.blobKey).catch(() => null);
        if (!blob) return null;
        try {
          const asset = await preparePhotoAsset(blob, item.frameId, item.blobKey);
          asset.crop = item.crop;
          return [item.frameId, asset] as const;
        } catch {
          // A missing preview should not prevent the project from opening.
          return null;
        }
      }));
      const photos: Record<string, PhotoAsset> = Object.fromEntries(entries.filter((entry): entry is readonly [string, PhotoAsset] => entry !== null));
      loadedPage = { ...coverPage, photos };
      if (cancelled) {
        Object.values(photos).forEach(disposePhotoAsset);
        return;
      }
      setHydratedPage(loadedPage);
    };

    void hydrateCover();
    return () => {
      cancelled = true;
      if (loadedPage) Object.values(loadedPage.photos).forEach(disposePhotoAsset);
    };
  }, [coverPage, coverTemplate]);

  return (
    <article className="project-library-card">
      <button className="project-library-open" type="button" onClick={() => onOpen(project.id)} aria-label={`Open ${project.name}`}>
        <span className="project-library-preview">
          {hydratedPage && coverTemplate ? (
            <CompositionThumbnail format={format} page={hydratedPage} template={coverTemplate} />
          ) : coverTemplate ? (
            <TemplateThumbnail template={coverTemplate} selected={false} />
          ) : (
            <span className="project-library-empty" aria-hidden="true"><span /><span /><span /></span>
          )}
        </span>
        <span className="block min-w-0 p-4 text-left">
          <span className="block truncate text-base font-semibold tracking-[-0.02em]">{project.name}</span>
          <span className="mt-1 block text-xs text-neutral-500">
            {format.shortLabel} · {project.pages.length} {project.pages.length === 1 ? "page" : "pages"}
            {completePages.length ? ` · ${completePages.length} ready` : ""}
          </span>
          <span className="mt-2 block text-[11px] text-neutral-500">{formatEditedDate(project.updatedAt)}</span>
        </span>
      </button>
      <div className="project-library-actions">
        <button className="card-action" type="button" onClick={() => onOpen(project.id)}>Open</button>
        <button className="card-action danger" type="button" onClick={() => onDelete(project.id)}>Delete</button>
      </div>
    </article>
  );
}
