"use client";

import "./photo-library.css";

import { useEffect, useMemo, useRef, useState } from "react";
import { ARRANGEMENT_LABELS, type ArrangementProposal } from "@/lib/arrangements";
import { PhotoAnalysisClient } from "@/lib/photo-analysis-client";
import { projectPhotoGroups, getProjectPhotos, MAX_PROJECT_PHOTOS } from "@/lib/project-photo-library";
import { PHOTO_RANKS, PHOTO_RANK_LABELS, projectPhotoLabels, type PhotoMetadataEdit } from "@/lib/photo-metadata";
import type { PhotoRank } from "@/lib/types";
import { PhotoLabelInput } from "./photo-label-input";
import type { DuplicateGroup, DuplicateScan } from "@/lib/photo-duplicates";
import { getFormat } from "@/lib/formats";
import { DEFAULT_CROP } from "@/lib/crop";
import type { PhotoAnalysis } from "@/lib/photo-palette";
import type { ProjectPhoto, ProjectPage, StoredProject, TemplateDefinition } from "@/lib/types";
import { fileImportSources, type PhotoImportItem, type PhotoImportSource } from "@/lib/photo-import-queue";
import { DEFAULT_LIBRARY_VIEW, filterLibraryRows, libraryRows, readLibraryView, rememberLibraryView, type LibraryView, type Orientation, type ColourClass } from "@/lib/photo-library-view";
import { workspaceKey } from "@/lib/workspace";
import { CompositionThumbnail } from "./composition-thumbnail";
import { DuplicatePhotoReview } from "./duplicate-photo-review";
import { usePhotoPreviewSession } from "./photo-preview-context";
import { PhotoLibraryGallery } from "./photo-library-gallery";
import { LibraryPhotoViewer } from "./library-photo-viewer";
import { PhotoImportMenu } from "./photo-import-menu";
import type { PhotoBackupStatus } from "@/lib/project-photo-backup";
import { ActionDialog } from "./action-dialog";

type Analysed = { analysis: PhotoAnalysis; thumbnail: Blob; url: string };
interface Props {
  project: StoredProject; templates: TemplateDefinition[]; ownerId?: string | null; accessRevision: number; busy: boolean;
  getVolatileBlob: (key: string) => Blob | undefined; getDriveToken: () => string | null;
  onImport: (sources: PhotoImportSource[]) => void; onApply: (proposal: ArrangementProposal) => void;
  onChoose?: (photo: ProjectPhoto) => void; onChooseMultiple?: (photos: ProjectPhoto[]) => void; chooseLimit?: number; chooseSessionKey?: string;
  onOverride: (key: string, value: ProjectPhoto["colourOverride"]) => void;
  onMetadata: (keys: string[], edit: PhotoMetadataEdit) => void;
  onReorder: (key: string, position: number) => void;
  onCombineDuplicates: (scan: DuplicateScan, groups: DuplicateGroup[]) => void;
  open: boolean; onOpen: () => void; onClose: () => void; targetLabel?: string; compact?: boolean;
  imports: readonly PhotoImportItem[]; onRetryImport: (id?: string) => void;
  backupStatus: PhotoBackupStatus[]; backupActivity?: string; onRetryBackup: () => void; onReconnectDrive?: () => void; initiallyImport?: boolean;
}
const labels = { portrait: "Portrait", square: "Square", landscape: "Landscape", panorama: "Panorama", awaiting: "Awaiting dimensions" };
const colourLabels = { bw: "Black & white", colour: "Colour", uncertain: "Uncertain", awaiting: "Awaiting analysis" };
const toolLabels = { filters: "Filters", view: "View", actions: "Library actions", activity: "Backups and activity" };
async function idle() { await new Promise(resolve => setTimeout(resolve, 30)); }

export function ProjectPhotoPanel({ project, templates, ownerId, accessRevision, busy, getVolatileBlob, getDriveToken, onImport, onApply, onChoose, onChooseMultiple, chooseLimit = 1, chooseSessionKey,
  onCombineDuplicates, onOverride, onMetadata, onReorder, open, onOpen, onClose, targetLabel, imports, onRetryImport, backupStatus, backupActivity, onRetryBackup, onReconnectDrive, initiallyImport, compact = false }: Props) {
  const { session: previewSession } = usePhotoPreviewSession(), previewCache = previewSession?.cache;
  const photos = projectPhotoGroups(project).map(group => group.photo);
  const projectImports = imports.filter(item => item.projectId === project.id);
  // Restoring bytes can leave every library metadata field unchanged.
  const completedImportsKey = JSON.stringify(projectImports.filter(item => item.state === "imported" || item.state === "duplicate").map(item => item.id));
  const libraryKey = JSON.stringify(photos.map(photo => [photo.blobKey, photo.sourceWidth, photo.sourceHeight, photo.fileSize, photo.drivePreviewId, photo.driveThumbnailId]));
  const [analysed, setAnalysed] = useState<Record<string, Analysed>>({});
  const [processing, setProcessing] = useState(false), [suggesting, setSuggesting] = useState(false);
  const [message, setMessage] = useState(""), [proposals, setProposals] = useState<ArrangementProposal[]>([]);
  const [retry, setRetry] = useState(0), [reviewDuplicates, setReviewDuplicates] = useState(false);
  const [inspected, setInspected] = useState<string | null>(null), [showSuggestions, setShowSuggestions] = useState(false);
  const [returnFocusKey, setReturnFocusKey] = useState<string>();
  const [tool, setTool] = useState<keyof typeof toolLabels | null>(null);
  const [viewerControlsHidden, setViewerControlsHidden] = useState(false);
  const [selecting, setSelecting] = useState(false), [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [editMessage, setEditMessage] = useState("");
  const choosing = !!(onChoose || onChooseMultiple), choosingMultiple = !!onChooseMultiple;
  const capacity = Number.isFinite(chooseLimit) ? Math.max(0, Math.min(MAX_PROJECT_PHOTOS, Math.floor(chooseLimit))) : 0;
  const selectionActive = selecting || choosingMultiple;
  const selectionScope = `${ownerId ?? "local"}:${project.id}:${choosingMultiple}:${chooseSessionKey ?? ""}:${open}`;
  const [previousSelectionScope, setPreviousSelectionScope] = useState(selectionScope);
  // A parent can dismiss the dialog without calling its close button. Reset on
  // that boundary too, so a later destination never inherits an old choice.
  if (previousSelectionScope !== selectionScope) {
    setPreviousSelectionScope(selectionScope); setSelectedKeys([]); setSelecting(false); setEditMessage("");
    setInspected(null); setTool(null); setShowSuggestions(false);
  }
  const restoreFiles = useRef<HTMLInputElement>(null);
  const viewKey = workspaceKey(`scuri.library-view.${project.id}`, ownerId);
  const [view, setView] = useState<LibraryView>(() => readLibraryView(viewKey));
  const clientRef = useRef<PhotoAnalysisClient | null>(null), cancelRef = useRef<(() => void) | null>(null);
  const suggestionClient = useRef<PhotoAnalysisClient | null>(null);
  const analysedRef = useRef(analysed), photosRef = useRef(photos), dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { photosRef.current = photos; analysedRef.current = analysed; });
  const changeView = (value: LibraryView) => {
    const filters = (item: LibraryView) => JSON.stringify([item.search, item.orientations, item.colours, item.usage, item.ranks, item.labels, item.untagged]);
    if (filters(value) !== filters(view)) { setSelectedKeys([]); setEditMessage(""); }
    setView(value); rememberLibraryView(viewKey, value);
  };
  const analyses = useMemo(() => new Map(Object.entries(analysed).map(([key, item]) => [key, item.analysis])), [analysed]);
  const rows = libraryRows(project, analyses), filtered = filterLibraryRows(rows, view);
  const inspectIndex = filtered.findIndex(row => row.photo.blobKey === inspected), inspectedRow = rows.find(row => row.photo.blobKey === inspected);
  const labelSuggestions = projectPhotoLabels(getProjectPhotos(project));
  const visibleKeys = new Set(filtered.map(row => row.photo.blobKey));
  const selection = selectedKeys.filter(key => visibleKeys.has(key));
  const close = () => { setSelecting(false); setSelectedKeys([]); setEditMessage(""); setInspected(null); setTool(null); setShowSuggestions(false); onClose(); };
  const toggleSelected = (key: string, addOnly = false) => {
    if (!visibleKeys.has(key)) return;
    setEditMessage("");
    if (addOnly && selection.includes(key)) return;
    if (!selection.includes(key) && choosingMultiple && capacity !== 1 && selection.length >= capacity) {
      setEditMessage(capacity ? `Choose up to ${capacity} photos for this page. Deselect one to choose another.` : "There are no available photo spaces on this page."); return;
    }
    setSelectedKeys(current => {
      const shown = current.filter(item => visibleKeys.has(item));
      if (shown.includes(key)) return shown.filter(item => item !== key);
      if (choosingMultiple && capacity !== 1 && shown.length >= capacity) return shown;
      return choosingMultiple && capacity === 1 ? [key] : [...shown, key];
    });
  };
  const chooseSelected = () => {
    const byKey = new Map(filtered.map(row => [row.photo.blobKey, row.photo]));
    const chosen = selection.flatMap(key => byKey.get(key) ? [byKey.get(key)!] : []);
    if (!busy && chosen.length && chosen.length <= capacity) onChooseMultiple?.(chosen);
  };
  const editSelected = (edit: PhotoMetadataEdit) => {
    if (!selection.length) return;
    onMetadata(selection, edit);
    setEditMessage("rank" in edit ? `Rank updated for ${selection.length} photos.` : `Labels added to ${selection.length} photos.`);
    // Keep matching photos selected for further edits. Only visible matches
    // participate in the next action, and changing filters clears selection.
  };
  const choose = (photo: ProjectPhoto) => { onChoose?.(photo); };
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  useEffect(() => {
    try { clientRef.current = new PhotoAnalysisClient(); }
    catch { queueMicrotask(() => setMessage("Local analysis is unavailable. You can still browse and place photos.")); }
    return () => { clientRef.current?.dispose(); clientRef.current = null; };
  }, [retry]);
  useEffect(() => () => {
    suggestionClient.current?.dispose(); suggestionClient.current = null;
    Object.values(analysedRef.current).forEach(item => URL.revokeObjectURL(item.url));
  }, []);
  useEffect(() => {
    const client = clientRef.current;
    if (!client || !previewCache || !open) return;
    let cancelled = false;
    const isCurrent = previewCache.capture();
    const cancel = () => { cancelled = true; setProcessing(false); };
    cancelRef.current = cancel;
    void (async () => {
      await idle(); if (cancelled) return; setProcessing(true);
      for (const photo of photosRef.current) {
        if (cancelled || !isCurrent()) break;
        const known = analysedRef.current[photo.blobKey];
        if (known) { previewCache.rememberThumbnail(photo, known.thumbnail); continue; }
        try {
          await idle(); if (cancelled) break;
          let result = await client.cached(photo, ownerId);
          if (!result) {
            if (document.hidden) break;
            await previewCache.request(photo, getDriveToken, getVolatileBlob, 10);
            if (cancelled || !isCurrent()) break;
            const blob = previewCache.getBlob(photo.blobKey);
            if (!blob) continue; // Listed independently of bytes/analysis.
            result = await client.analyse(photo, blob, ownerId);
          }
          if (cancelled || !isCurrent()) break;
          previewCache.rememberThumbnail(photo, result.thumbnail);
          const item = { ...result, url: URL.createObjectURL(result.thumbnail) };
          analysedRef.current = { ...analysedRef.current, [photo.blobKey]: item };
          setAnalysed(analysedRef.current);
        } catch { /* Unavailable analysis stays awaiting; it never removes a photo. */ }
      }
      if (!cancelled) setProcessing(false);
    })();
    return () => { cancelled = true; };
  }, [libraryKey, completedImportsKey, ownerId, accessRevision, retry, getVolatileBlob, getDriveToken, previewCache, open]);
  useEffect(() => { const resume = () => { if (!document.hidden) setRetry(value => value + 1); };
    document.addEventListener("visibilitychange", resume); return () => document.removeEventListener("visibilitychange", resume); }, []);
  const suggest = async () => {
    if (!clientRef.current) return;
    cancelRef.current?.();
    const client = new PhotoAnalysisClient(); suggestionClient.current?.dispose(); suggestionClient.current = client;
    setSuggesting(true); setMessage(""); setShowSuggestions(true); setInspected(null);
    try {
      const next = await client.suggest({ formatId: project.formatId, templates, background: project.pages[0]?.background,
        photos: photos.map(photo => ({ photo, analysis: analysedRef.current[photo.blobKey]?.analysis })) });
      if (suggestionClient.current !== client) return;
      setProposals(next);
      setMessage(next.length ? `${next.length} different arrangements ready. Unplaced photos remain in the library.` : "No arrangement is ready yet. Wait for analysis or choose another eligible template.");
    } catch (error) { if (suggestionClient.current === client) setMessage(error instanceof Error ? error.message : "Suggestions could not be prepared. Your arrangement is unchanged."); }
    finally { client.dispose(); if (suggestionClient.current === client) { suggestionClient.current = null; setSuggesting(false); } }
  };
  const previewPage = (page: ArrangementProposal["pages"][number], index: number): ProjectPage => ({
    id: `preview-${index}`, templateId: page.template.id, templateSnapshot: page.template, background: page.background, gutter: page.gutter,
    selectedFrameId: null, createdAt: project.createdAt, updatedAt: project.updatedAt, photos: {},
    unavailablePhotos: Object.fromEntries(Object.entries(page.assignments).flatMap(([frameId, key]) => {
      const photo = photos.find(photo => photo.blobKey === key);
      return photo ? [[frameId, { ...photo, frameId, crop: { ...DEFAULT_CROP } }]] : [];
    })),
  });
  const toggleOrientation = (value: Orientation) => changeView({ ...view, scrollTop: 0, anchor: undefined, orientations: view.orientations.includes(value) ? view.orientations.filter(item => item !== value) : [...view.orientations, value] });
  const toggleColour = (value: ColourClass) => changeView({ ...view, scrollTop: 0, anchor: undefined, colours: view.colours.includes(value) ? view.colours.filter(item => item !== value) : [...view.colours, value] });
  const toggleRank = (rank: LibraryView["ranks"][number]) => changeView({ ...view, scrollTop: 0, anchor: undefined,
    ranks: view.ranks.includes(rank) ? view.ranks.filter(item => item !== rank) : [...view.ranks, rank] });
  const toggleLabel = (label: string) => changeView({ ...view, scrollTop: 0, anchor: undefined,
    untagged: false, labels: view.labels.includes(label) ? view.labels.filter(item => item !== label) : [...view.labels, label] });
  const toggleUntagged = () => changeView({ ...view, scrollTop: 0, anchor: undefined, untagged: !view.untagged, labels: [] });
  const filterCount = view.orientations.length + view.colours.length + view.ranks.length + view.labels.length + Number(view.untagged) + (view.usage === "all" ? 0 : 1);
  const clearFilters = () => changeView({ ...DEFAULT_LIBRARY_VIEW, size: view.size, sort: view.sort });
  const backedUp = photos.filter(photo => photo.driveOriginalId).length;
  const currentBackupStatus = backupStatus.filter(status => photos.some(photo => photo.blobKey === status.blobKey));
  const pendingBackupStatus = currentBackupStatus.filter(status => status.stage !== "Backed up")
    .sort((a, b) => Number(Boolean(b.error)) - Number(Boolean(a.error)));
  const needsAttention = currentBackupStatus.some(status => status.error || status.stage.startsWith("Original unavailable")) ||
    projectImports.some(item => item.state === "failed" || item.state === "paused");
  const importFinished = projectImports.filter(item => ["imported", "duplicate"].includes(item.state)).length;
  const backToPhotos = () => { setReturnFocusKey(inspectedRow?.photo.blobKey); setInspected(null); };
  const toolbar = <>
    <div className="library-toolbar">
      <PhotoImportMenu onImport={onImport} initiallyOpen={initiallyImport && !photos.length} externalPicker={() => {
        dialog.current?.close(); return () => { if (dialog.current?.dataset.open === "true" && !dialog.current.open) dialog.current.showModal(); };
      }} />
      <input type="search" aria-label="Search photo filenames" placeholder="Search filenames" value={view.search} onChange={event => changeView({ ...view, search: event.target.value, scrollTop: 0, anchor: undefined })} />
      <button className="small-button" type="button" aria-haspopup="dialog" onClick={() => setTool("view")}>View</button>
      <button className="small-button" type="button" aria-pressed={view.sort === "custom"} onClick={() => changeView({ ...view, sort: view.sort === "custom" ? "import" : "custom", scrollTop: 0, anchor: undefined })}>Custom order</button>
      <button className="small-button" type="button" aria-haspopup="dialog" onClick={() => setTool("actions")}>Actions</button>
      {!choosing ? <button className="small-button" type="button" aria-pressed={selecting} disabled={!photos.length} onClick={() => {
        setSelecting(value => !value); setSelectedKeys([]); setEditMessage("");
      }}>{selecting ? "Finish selecting" : "Select photos"}</button> : null}
    </div>
    <div className="library-active-filters" aria-label="Active filters">
      <span>{filtered.length} / {rows.length} photos</span>
      {view.orientations.map(key => <button key={key} type="button" className="library-filter" aria-label={`Remove ${labels[key]} filter`} onClick={() => toggleOrientation(key)}>{labels[key]} ×</button>)}
      {view.colours.map(key => <button key={key} type="button" className="library-filter" aria-label={`Remove ${colourLabels[key]} filter`} onClick={() => toggleColour(key)}>{colourLabels[key]} ×</button>)}
      {view.usage !== "all" ? <button type="button" className="library-filter" aria-label="Remove usage filter" onClick={() => changeView({ ...view, usage: "all", scrollTop: 0, anchor: undefined })}>{view.usage === "used" ? "Used" : "Unused"} ×</button> : null}
      {view.ranks.map(rank => <button key={rank} type="button" className="library-filter" aria-label={`Remove ${PHOTO_RANK_LABELS[rank]} filter`} onClick={() => toggleRank(rank)}>{PHOTO_RANK_LABELS[rank]} ×</button>)}
      {view.labels.map(label => <button key={label} type="button" className="library-filter" aria-label={`Remove label filter ${label}`} onClick={() => toggleLabel(label)}>{label} ×</button>)}
      {view.untagged ? <button type="button" className="library-filter" aria-label="Remove Untagged filter" onClick={toggleUntagged}>Untagged ×</button> : null}
      {filterCount || view.search ? <button className="text-button" type="button" onClick={clearFilters}>Clear filters</button> : null}
      {projectImports.length && importFinished < projectImports.length ? <button className="text-button" type="button" onClick={() => setTool("activity")}>Import progress: {importFinished}/{projectImports.length} finished</button> : null}
    </div>
    {view.sort === "custom" ? <p className="library-edit-message">Drag a photo’s handle or enter its position from 1 to {rows.length}. Positions refer to all project photos, including filtered photos.</p> : null}
    {!selecting && !choosing && photos.length ? <p className="library-edit-message">Long-press a photo to select several, then apply ranks or labels together.</p> : null}
    {choosingMultiple ? <p className="library-edit-message">{capacity === 1 ? "Tap a photo to select it. Tap another to change your choice." : `Tap photos in the order you want to add them. Choose up to ${capacity} photos for the available spaces on this page.`} Preview opens a photo for a closer look. Changing filters clears selection.</p> : null}
    {selecting && !choosing ? <section className="library-bulk-edit" aria-label="Edit selected photos">
      <div className="library-selection-summary"><strong>{selection.length} selected</strong>
        <button className="text-button" type="button" disabled={!filtered.length} onClick={() => setSelectedKeys(filtered.map(row => row.photo.blobKey))}>Select all shown</button>
        <button className="text-button" type="button" disabled={!selection.length} onClick={() => setSelectedKeys([])}>Clear selection</button>
      </div>
      <div className="photo-metadata-controls">
        <label className="photo-rank-control">Rank selected <select value="" disabled={!selection.length} onChange={event => {
          if (event.target.value) editSelected({ rank: event.target.value === "unranked" ? null : event.target.value as PhotoRank });
        }}><option value="" disabled>Set rank…</option>{PHOTO_RANKS.map(rank => <option key={rank} value={rank}>{PHOTO_RANK_LABELS[rank]}</option>)}<option value="unranked">Clear rank</option></select></label>
        <PhotoLabelInput title="Add labels to selected photos" suggestions={labelSuggestions} disabled={!selection.length} onAdd={label => editSelected({ addLabels: [label] })} />
      </div>
      <p>Labels are added to each photo’s existing labels. Changing filters clears selection.</p>
    </section> : null}
    {editMessage && !choosingMultiple ? <p className="library-edit-message" role="status">{editMessage}</p> : null}
  </>;
  return <section className={compact ? "photo-library-dialog-host" : "photo-library-panel"} aria-label="Project photo library">
    {!compact ? <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Project photos</h2>
      <p className="text-sm text-neutral-600">{photos.length} photos · capacity {MAX_PROJECT_PHOTOS} · reusable across all pages</p></div>
      <button type="button" className="primary-button" onClick={onOpen}>Open Project photos</button></div> : null}
    <dialog ref={dialog} data-open={String(open)} className="photo-library-dialog" onCancel={event => {
      event.preventDefault(); if (event.target !== event.currentTarget) return;
      if (inspectedRow) backToPhotos(); else close();
    }} aria-label={inspectedRow ? "Photo viewer" : choosing ? choosingMultiple && capacity > 1 ? "Choose photos" : "Choose a photo" : "Project photos"}>
      <div className="photo-library-shell">
        {!inspectedRow ? <header className="library-heading"><div className="library-heading-context"><h2>{choosing ? choosingMultiple && capacity > 1 ? "Choose photos" : "Choose a photo" : "Project photos"}</h2><p title={`${project.name}${targetLabel ? ` · ${targetLabel}` : ""}`}>{project.name}{targetLabel ? ` · ${targetLabel}` : ""}</p></div>
          <button className="small-button" type="button" aria-haspopup="dialog" onClick={() => setTool("filters")}>Filters{filterCount ? ` (${filterCount})` : ""}</button>
          <button className={`library-backup-status${needsAttention ? " needs-attention" : ""}`} type="button" aria-haspopup="dialog" onClick={() => setTool("activity")}>
            <span>Photos backed up: {backedUp}/{photos.length}</span>{needsAttention ? <strong role="status">Needs attention</strong> : null}</button>
          <button className="secondary-button" type="button" onClick={close}>{choosing ? "Cancel" : !photos.length ? "Skip for now" : "Done"}</button></header> : null}
        {open ? <>
        {tool ? <ActionDialog title={toolLabels[tool]} onClose={() => setTool(null)}><div className="library-tool-content">
          <header><h2>{toolLabels[tool]}</h2><button type="button" className="small-button" onClick={() => setTool(null)}>Close</button></header>
          {tool === "filters" ? <div className="library-filters">
            <fieldset><legend>Rank</legend><div>{[...PHOTO_RANKS, "unranked" as const].map(rank =>
              <button key={rank} type="button" className="library-filter" aria-pressed={view.ranks.includes(rank)} onClick={() => toggleRank(rank)}>{PHOTO_RANK_LABELS[rank]}</button>)}</div></fieldset>
            <fieldset><legend>Labels · match all selected</legend><div><button type="button" className="library-filter" aria-pressed={view.untagged} onClick={toggleUntagged}>Untagged</button>{[...new Set([...labelSuggestions, ...view.labels])].map(label =>
              <button key={label} type="button" className="library-filter" aria-pressed={view.labels.includes(label)} onClick={() => toggleLabel(label)}>{label}</button>)}</div>
              <p className="library-edit-message">Untagged shows photos with no custom labels, whatever their rank.</p>
              {!labelSuggestions.length && !view.labels.length ? <p>Open a photo to add labels, or select photos to label them together.</p> : null}</fieldset>
            <fieldset><legend>Photo proportions</legend><div>{(Object.keys(labels) as Orientation[]).map(key => <button key={key} type="button" className="library-filter" aria-pressed={view.orientations.includes(key)} onClick={() => toggleOrientation(key)}>{labels[key]}</button>)}</div></fieldset>
            <fieldset><legend>Photo colour</legend><div>{(Object.keys(colourLabels) as ColourClass[]).map(key => <button key={key} type="button" className="library-filter" aria-pressed={view.colours.includes(key)} onClick={() => toggleColour(key)}>{colourLabels[key]}</button>)}</div></fieldset>
            <label>Usage <select value={view.usage} onChange={event => changeView({ ...view, usage: event.target.value as LibraryView["usage"], scrollTop: 0, anchor: undefined })}><option value="all">All</option><option value="unused">Unused</option><option value="used">Used</option></select></label>
            <div className="library-tool-footer"><button className="text-button" type="button" onClick={clearFilters}>Clear filters</button><button className="primary-button" type="button" onClick={() => setTool(null)}>Show {filtered.length} photos</button></div>
          </div> : null}
          {tool === "view" ? <div className="library-view-options">
            <label>Sort <select value={view.sort} onChange={event => changeView({ ...view, sort: event.target.value as LibraryView["sort"], scrollTop: 0, anchor: undefined })}><option value="import">Import order</option><option value="filename">Filename</option><option value="custom">Custom order</option></select></label>
            <label>Thumbnails <select value={view.size} onChange={event => changeView({ ...view, size: event.target.value as LibraryView["size"] })}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
          </div> : null}
          {tool === "actions" ? <div className="library-view-options">
            <button className="secondary-button" type="button" disabled={busy || photos.length < 2} onClick={() => { setTool(null); setReviewDuplicates(true); }}>Find duplicates</button>
            <button className="secondary-button" type="button" disabled={busy || suggesting || !Object.keys(analysed).length} onClick={() => { setTool(null); void suggest(); }}>Suggest arrangements</button>
            <button className="secondary-button" type="button" onClick={() => setTool("activity")}>Backups and activity</button>
          </div> : null}
          {tool === "activity" ? <div className="library-progress">
          <span>{Object.keys(analysed).length}/{photos.length} analysed{processing ? " · Analysing in background" : ""}</span>
          {processing ? <button type="button" className="text-button" onClick={() => cancelRef.current?.()}>Pause analysis</button> :
            <button type="button" className="text-button" onClick={() => setRetry(value => value + 1)}>Retry analysis</button>}
          <span>Originals backed up: {backedUp}/{photos.length} · Previews: {photos.filter(photo => photo.drivePreviewId).length}/{photos.length}</span>
          {backupActivity ? <p role="status">{backupActivity}</p> : null}
          <div><p>Project metadata saves independently. Originals without a Drive reference are only on this device until backup completes. Keep Scuri open; iPadOS may suspend background work.</p>
            <div className="library-import-list" aria-live="polite">{pendingBackupStatus.map(status => <p key={status.blobKey}>{photos.find(photo => photo.blobKey === status.blobKey)?.sourceName ?? "Photo"} · {status.stage}
              {status.total !== undefined ? ` · ${((status.sent ?? 0) / 1048576).toFixed(1)} / ${(status.total / 1048576).toFixed(1)} MB` : ""}{status.error ? ` · ${status.error}` : ""}</p>)}</div>
            <div className="library-view-options">
              <button type="button" className="small-button" disabled={busy} onClick={onRetryBackup}>Retry backup / reconnect Drive</button>
              {onReconnectDrive ? <button type="button" className="small-button" disabled={busy} onClick={onReconnectDrive}>Reconnect Drive</button> : null}
            </div></div>
          <div>
            <p>If originals are unavailable, choose the same files from Photos or Files. Exact matches restore the existing photos without changing placements or crops. Other files are left unchanged.</p>
            <input ref={restoreFiles} hidden type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label="Reselect original photos"
              onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = "";
                if (files.length) onImport(fileImportSources(files).map(source => ({ ...source, restoreOnly: true }))); }} />
            <button type="button" className="secondary-button" onClick={() => restoreFiles.current?.click()}>Reselect originals…</button>
          </div>
          {projectImports.length ? <details><summary>Import progress: {projectImports.filter(item => ["imported", "duplicate"].includes(item.state)).length}/{projectImports.length} finished</summary>
            <div className="library-import-list">{projectImports.map(item => <div key={item.id}><span>{item.name} · {item.state}{item.detail ? ` — ${item.detail}` : ""}</span>
              {item.state === "failed" || item.state === "paused" ? <button type="button" className="text-button" onClick={() => onRetryImport(item.id)}>Retry</button> : null}</div>)}</div>
            <button className="text-button" type="button" onClick={() => onRetryImport()}>Retry failed / resume paused</button></details> : null}
          {message ? <p role="status">{message}</p> : null}
        </div> : null}
        </div></ActionDialog> : null}
        {showSuggestions ? <div className="library-suggestions-scroll"><button className="secondary-button" type="button" onClick={() => setShowSuggestions(false)}>Back to photos</button>
          {message ? <p className="mt-4" role="status">{message}</p> : null}
          {suggesting ? <button className="small-button" type="button" onClick={() => { suggestionClient.current?.dispose(); suggestionClient.current = null; setSuggesting(false); setMessage("Suggestions cancelled. Your pages are unchanged."); }}>Cancel suggestions</button> : null}
    {proposals.length ? <div className="mt-6 grid gap-4 lg:grid-cols-3">{proposals.map(proposal => <article key={proposal.mode} className="rounded-xl border border-black/15 bg-white p-4">
      <h3 className="font-semibold">{ARRANGEMENT_LABELS[proposal.mode]}</h3>
      <p className="mt-1 text-xs text-neutral-600">{proposal.pages.length} pages · {photos.length - proposal.unplaced.length} photos placed</p>
      <div className="mt-3 grid gap-3">{proposal.pages.slice(0, 2).map((page, i) => <figure key={i}><CompositionThumbnail format={getFormat(project.formatId)} template={page.template} page={previewPage(page, i)} /><figcaption className="mt-1 text-xs text-neutral-600">Page {i + 1}: {page.template.name}. {page.explanation}</figcaption></figure>)}</div>
      {proposal.pages.length > 2 ? <details className="mt-3"><summary className="cursor-pointer text-sm">Preview the remaining {proposal.pages.length - 2} pages</summary><div className="mt-3 grid gap-3">{proposal.pages.slice(2).map((page, i) => <figure key={i}><CompositionThumbnail format={getFormat(project.formatId)} template={page.template} page={previewPage(page, i + 2)} /><figcaption className="text-xs">Page {i + 3}: {page.template.name}. {page.explanation}</figcaption></figure>)}</div></details> : null}
      {proposal.unplaced.length ? <details className="mt-3 text-sm text-amber-900"><summary>{proposal.unplaced.length} photos remain unplaced in the library</summary><ul className="mt-2 list-disc pl-4">{proposal.unplaced.map(item => <li key={item.blobKey}>{photos.find(photo => photo.blobKey === item.blobKey)?.sourceName ?? "Photo"}: {item.reason}</li>)}</ul></details> : null}
      <button type="button" className="primary-button mt-4 w-full" disabled={busy || suggesting} onClick={() => onApply(proposal)}>Apply as new project</button>
    </article>)}</div> : null}

          </div> : inspectedRow ? <LibraryPhotoViewer key={inspectedRow.photo.blobKey} row={inspectedRow} ownerId={ownerId} index={inspectIndex} count={filtered.length}
            controlsHidden={viewerControlsHidden} onToggleControls={() => setViewerControlsHidden(value => !value)}
            onBack={backToPhotos} onPrevious={() => { if (inspectIndex > 0) setInspected(filtered[inspectIndex - 1].photo.blobKey); }}
            onNext={() => { if (inspectIndex >= 0 && inspectIndex + 1 < filtered.length) setInspected(filtered[inspectIndex + 1].photo.blobKey); }}
            labelSuggestions={labelSuggestions} onMetadata={edit => onMetadata([inspectedRow.photo.blobKey], edit)}
            onUse={choosingMultiple ? () => toggleSelected(inspectedRow.photo.blobKey) : onChoose ? () => choose(inspectedRow.photo) : undefined}
            useLabel={choosingMultiple ? selection.includes(inspectedRow.photo.blobKey) ? "Deselect photo" : "Select photo" : undefined}
            useDisabled={choosingMultiple && (inspectIndex < 0 || capacity === 0 || (!selection.includes(inspectedRow.photo.blobKey) && capacity > 1 && selection.length >= capacity))}
            onOverride={value => onOverride(inspectedRow.photo.blobKey, value)} /> :
          <PhotoLibraryGallery rows={filtered} view={view} onView={value => { setReturnFocusKey(undefined); changeView(value); }} focusPhotoKey={returnFocusKey}
            totalPhotos={rows.length} onReorder={onReorder}
            onStartSelecting={!onChoose || choosingMultiple ? key => { if (!choosingMultiple) setSelecting(true); toggleSelected(key, true); } : undefined}
            selectedKeys={selectionActive ? new Set(selection) : undefined}
            selectionOrder={choosingMultiple ? new Map(selection.map((key, index) => [key, index + 1])) : undefined}
            showPreviewButtons={choosingMultiple}
            onToggleSelected={selectionActive ? key => toggleSelected(key) : undefined}
            header={toolbar} empty={!photos.length ? <div className="library-empty"><h3>Add your candidate photos once</h3><p>Choose Photos, Files or a connected source above. You can choose layouts later.</p></div> : undefined}
            onInspect={key => { setInspected(key); setShowSuggestions(false); setViewerControlsHidden(false); }} />}
        {choosingMultiple ? <section className="library-picker-footer" aria-label="Add selected photos">
          <div><strong aria-live="polite">{selection.length} of {capacity} selected</strong><p role="status">{selection.length > capacity ? `This page now has ${capacity} available ${capacity === 1 ? "space" : "spaces"}. Reduce your selection or reopen the picker.` : editMessage || (capacity > 1 ? "Photos will fill this page in selection order." : "Choose one photo for this space.")}</p></div>
          <button className="text-button" type="button" disabled={!selection.length} onClick={() => { setSelectedKeys([]); setEditMessage(""); }}>Clear selection</button>
          <button className="primary-button" type="button" disabled={busy || !selection.length || selection.length > capacity || !capacity} onClick={chooseSelected}>Add {selection.length} {selection.length === 1 ? "photo" : "photos"}</button>
        </section> : null}
        {reviewDuplicates ? <DuplicatePhotoReview project={project} ownerId={ownerId} thumbnails={analysed}
          getVolatileBlob={getVolatileBlob} getDriveToken={getDriveToken} onApply={onCombineDuplicates} onClose={() => setReviewDuplicates(false)} /> : null}
        </> : null}
      </div>
    </dialog>
  </section>;
}
