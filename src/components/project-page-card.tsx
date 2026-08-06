"use client";

import { useRef } from "react";
import { getMissingPhotoCount } from "@/lib/project";
import type { CanvasFormat, ProjectPage, TemplateDefinition } from "@/lib/types";
import { CompositionThumbnail } from "./composition-thumbnail";

interface ProjectPageCardProps {
  format: CanvasFormat;
  page: ProjectPage;
  pageNumber: number;
  pageCount: number;
  template: TemplateDefinition;
  dragging: boolean;
  onDragStart: (pageId: string) => void;
  onDragOver: (sourceId: string, targetId: string) => void;
  onDragEnd: () => void;
  onMove: (pageId: string, offset: -1 | 1) => void;
  onEdit: (pageId: string) => void;
  onDuplicate: (pageId: string) => void;
  onDelete: (pageId: string) => void;
  onExport: (pageId: string) => void;
}

export function ProjectPageCard({
  format,
  page,
  pageNumber,
  pageCount,
  template,
  dragging,
  onDragStart,
  onDragOver,
  onDragEnd,
  onMove,
  onEdit,
  onDuplicate,
  onDelete,
  onExport,
}: ProjectPageCardProps) {
  const dragRef = useRef<{ pageId: string; moved: boolean } | null>(null);
  const missing = getMissingPhotoCount(page, template);

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pageId: page.id, moved: false };
    onDragStart(page.id);
  };

  const moveDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    drag.moved = true;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-project-page-id]");
    const targetId = target?.dataset.projectPageId;
    if (targetId && targetId !== drag.pageId) onDragOver(drag.pageId, targetId);
  };

  const endDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return;
    event.preventDefault();
    dragRef.current = null;
    onDragEnd();
  };

  return (
    <article
      className={`project-page-card ${dragging ? "dragging" : ""}`}
      data-project-page-id={page.id}
      aria-label={`Page ${pageNumber}: ${template.name}`}
    >
      <div className="project-page-preview">
        <CompositionThumbnail format={format} page={page} template={template} />
        <span className="page-number" aria-hidden="true">{pageNumber}</span>
        <button
          className="drag-handle"
          type="button"
          aria-label={`Drag page ${pageNumber} to reorder`}
          title="Drag to reorder"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span aria-hidden="true">⠿</span>
        </button>
      </div>
      <div className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{template.name}</p>
            <p className={`mt-1 text-xs ${missing ? "text-amber-700" : "text-emerald-700"}`}>
              {missing ? `${missing} ${missing === 1 ? "photo" : "photos"} missing` : "Ready to export"}
            </p>
          </div>
          <button className="small-button compact" type="button" onClick={() => onEdit(page.id)}>Edit</button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          <button className="card-action" type="button" disabled={pageNumber === 1} onClick={() => onMove(page.id, -1)} aria-label={`Move page ${pageNumber} earlier`}>← Earlier</button>
          <button className="card-action" type="button" disabled={pageNumber === pageCount} onClick={() => onMove(page.id, 1)} aria-label={`Move page ${pageNumber} later`}>Later →</button>
          <button className="card-action" type="button" disabled={Boolean(missing)} onClick={() => onExport(page.id)}>Export</button>
          <button className="card-action" type="button" onClick={() => onDuplicate(page.id)}>Duplicate</button>
          <button className="card-action danger col-span-2" type="button" onClick={() => onDelete(page.id)}>Delete page</button>
        </div>
      </div>
    </article>
  );
}
