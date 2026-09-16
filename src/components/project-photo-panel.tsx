"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ARRANGEMENT_LABELS, type ArrangementProposal } from "@/lib/arrangements";
import { PhotoAnalysisClient } from "@/lib/photo-analysis-client";
import { projectPhotoGroups, MAX_PROJECT_PHOTOS } from "@/lib/project-photo-library";
import type { DuplicateGroup, DuplicateScan } from "@/lib/photo-duplicates";
import { loadPhotoBlob } from "@/lib/storage";
import { downloadGoogleDrivePhoto } from "@/lib/google-drive";
import { getFormat } from "@/lib/formats";
import { DEFAULT_CROP } from "@/lib/crop";
import type { PhotoAnalysis } from "@/lib/photo-palette";
import type { PhotoAsset, ProjectPhoto, ProjectPage, StoredProject, TemplateDefinition } from "@/lib/types";
import { CompositionThumbnail } from "./composition-thumbnail";
import { DuplicatePhotoReview } from "./duplicate-photo-review";

type Analysed = { analysis: PhotoAnalysis; thumbnail: Blob; url: string };
interface Props {
  project: StoredProject; templates: TemplateDefinition[]; ownerId?: string | null; accessRevision: number; busy: boolean;
  getVolatileBlob: (key: string) => Blob | undefined; getDriveToken: () => string | null;
  onImport: (files: File[]) => void; onApply: (proposal: ArrangementProposal) => void;
  onChoose?: (photo: ProjectPhoto) => void;
  onCombineDuplicates: (scan: DuplicateScan, groups: DuplicateGroup[]) => void;
}

export function ProjectPhotoPanel({ project, templates, ownerId, accessRevision, busy, getVolatileBlob, getDriveToken, onImport, onApply, onChoose, onCombineDuplicates }: Props) {
  const groups = projectPhotoGroups(project);
  const photos = groups.map(group => group.photo);
  const libraryKey = JSON.stringify([project.id, photos]);
  const [analysed, setAnalysed] = useState<Record<string, Analysed>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [processing, setProcessing] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [message, setMessage] = useState("");
  const [proposals, setProposals] = useState<ArrangementProposal[]>([]);
  const [retry, setRetry] = useState(0);
  const [reviewDuplicates, setReviewDuplicates] = useState(false);
  const clientRef = useRef<PhotoAnalysisClient | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const generationRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const [, items] = JSON.parse(libraryKey) as [string, ProjectPhoto[]];
    let cancelled = false;
    const urls: string[] = [];
    const generation = ++generationRef.current;
    setAnalysed({}); setErrors({}); setProposals([]); setSuggesting(false); setMessage("");
    let client: PhotoAnalysisClient;
    if (busy) { setProcessing(false); return; }
    try { client = new PhotoAnalysisClient(); clientRef.current = client; }
    catch { setMessage("Local analysis is unavailable in this browser. Photos stay in the library and can still be placed manually."); return; }
    setProcessing(Boolean(items.length));
    const cancel = () => { cancelled = true; generationRef.current++; client.dispose(); setProcessing(false); setSuggesting(false); };
    cancelRef.current = cancel;
    void (async () => {
      for (const photo of items.slice(0, MAX_PROJECT_PHOTOS)) {
        if (cancelled) break;
        try {
          let result = await client.cached(photo, ownerId);
          if (!result) {
            let blob = await loadPhotoBlob(photo.blobKey).catch(() => null) ?? getVolatileBlob(photo.blobKey);
            if (cancelled) break;
            const token = getDriveToken();
            // Drive previews are uncropped. Unknown dimensions require originals.
            const fileId = photo.sourceWidth > 0 && photo.sourceHeight > 0 ? photo.drivePreviewId ?? photo.driveOriginalId : photo.driveOriginalId;
            if (!blob && token && fileId) blob = await downloadGoogleDrivePhoto(token, fileId);
            if (cancelled) break;
            if (!blob) throw new Error("Awaiting analysis — reconnect Drive or restore the original on this device.");
            result = await client.analyse(photo, blob, ownerId);
          }
          if (cancelled) break;
          const url = URL.createObjectURL(result.thumbnail); urls.push(url);
          setAnalysed(current => ({ ...current, [photo.blobKey]: { ...result, url } }));
        } catch (error) {
          if (!cancelled) setErrors(current => ({ ...current, [photo.blobKey]: error instanceof Error ? error.message : "Awaiting analysis. Retry when the photo is available." }));
        }
      }
      if (!cancelled && generationRef.current === generation) setProcessing(false);
    })();
    return () => { cancelled = true; client.dispose(); urls.forEach(url => URL.revokeObjectURL(url)); if (clientRef.current === client) clientRef.current = null; };
  }, [libraryKey, ownerId, accessRevision, retry, getVolatileBlob, getDriveToken, busy]);

  const suggest = async () => {
    if (!clientRef.current) return;
    const generation = generationRef.current;
    setSuggesting(true); setMessage("");
    try {
      const next = await clientRef.current.suggest({ formatId: project.formatId, templates,
        background: project.pages[0]?.background, photos: photos.map(photo => ({ photo, analysis: analysed[photo.blobKey]?.analysis })) });
      if (generationRef.current !== generation) return;
      setProposals(next);
      setMessage(next.length < 3 ? `${next.length} meaningfully different ${next.length === 1 ? "arrangement is" : "arrangements are"} available for these photos and layouts.` : "Three different arrangements are ready to review.");
    } catch (error) { if (generationRef.current === generation) setMessage(error instanceof Error ? error.message : "Suggestions could not be prepared. Your arrangement is unchanged."); }
    finally { if (generationRef.current === generation) setSuggesting(false); }
  };

  const previewPage = (page: ArrangementProposal["pages"][number], index: number): ProjectPage => ({
    id: `preview-${index}`, templateId: page.template.id, templateSnapshot: page.template, background: page.background, gutter: page.gutter,
    selectedFrameId: null, createdAt: project.createdAt, updatedAt: project.updatedAt,
    photos: Object.fromEntries(Object.entries(page.assignments).flatMap(([frameId, key]) => {
      const item = analysed[key]; if (!item) return [];
      const photo: PhotoAsset = { frameId, blobKey: key, sourceBlob: item.thumbnail, previewUrl: item.url,
        sourceWidth: item.analysis.width, sourceHeight: item.analysis.height, crop: { ...DEFAULT_CROP } };
      return [[frameId, photo]];
    })),
  });
  const placementCounts = new Map<string, number>();
  project.pages.forEach(page => Object.values(page.photos).forEach(photo => placementCounts.set(photo.blobKey, (placementCounts.get(photo.blobKey) ?? 0) + 1)));

  return <section className="photo-library-panel" aria-label="Project photo library">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-semibold">Project photos</h2><p className="mt-1 text-xs text-neutral-600">{photos.length} photos · {Object.keys(analysed).length} analysed · up to {MAX_PROJECT_PHOTOS} photos</p></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="small-button" disabled={busy || photos.length >= MAX_PROJECT_PHOTOS} onClick={() => inputRef.current?.click()}>Add photos to library</button>
        <button type="button" className="small-button" disabled={busy || photos.length < 2 || suggesting} onClick={() => setReviewDuplicates(true)}>Find duplicates</button>
        <button type="button" className="primary-button" disabled={busy || processing || suggesting || !Object.keys(analysed).length} onClick={() => void suggest()}>Suggest arrangements</button>
      </div>
    </div>
    <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) onImport(files); }} />
    <p className="mt-3 text-sm text-neutral-600">Photos stay here when removed from a frame. Analysis runs locally on uncropped previews. Applying a suggestion creates a new project copy.</p>
    {processing || suggesting ? <div className="mt-3 flex items-center gap-3"><p role="status" className="text-sm">{suggesting ? "Comparing photo groups and layouts…" : `Analysing photos: ${Object.keys(analysed).length + Object.keys(errors).length}/${Math.min(photos.length, MAX_PROJECT_PHOTOS)}`}</p><button type="button" className="text-button" onClick={() => cancelRef.current?.()}>Cancel</button></div> : null}
    {photos.length && !processing && !suggesting ? <button type="button" className="text-button mt-2" onClick={() => setRetry(value => value + 1)}>Retry unavailable photos</button> : null}
    {message ? <p role="status" className="mt-3 text-sm text-neutral-700">{message}</p> : null}
    {!photos.length ? <p className="mt-4 text-sm text-neutral-500">Add photos here before choosing any layouts, or keep adding them directly to frames.</p> :
      <div className="photo-library-grid mt-4">{photos.map((photo, index) => {
        const item = analysed[photo.blobKey];
        const placements = groups[index].members.reduce((count, member) => count + (placementCounts.get(member.blobKey) ?? 0), 0);
        return <article key={photo.blobKey} className="rounded-xl border border-black/10 bg-white p-2">
          <div className="grid aspect-square place-items-center rounded-lg bg-neutral-100">{item ? <Image unoptimized src={item.url} width={160} height={160} alt={photo.sourceName ?? `Photo ${index + 1}`} className="h-full w-full object-contain" /> : <span className="p-2 text-center text-xs text-neutral-600">Awaiting analysis</span>}</div>
          <p className="mt-2 truncate text-xs font-medium" title={photo.sourceName}>{photo.sourceName ?? `Photo ${index + 1}`}</p>
          <p className="mt-1 text-xs text-neutral-500">{placements ? `Used ${placements}×` : "Unplaced"}</p>
          {errors[photo.blobKey] ? <p className="mt-1 text-xs text-amber-800">{errors[photo.blobKey]}</p> : null}
          {onChoose ? <button type="button" className="card-action mt-2 w-full" disabled={busy} onClick={() => onChoose(photo)}>Use in selected frame</button> : null}
        </article>;
      })}</div>}
    {proposals.length ? <div className="mt-6 grid gap-4 lg:grid-cols-3">{proposals.map(proposal => <article key={proposal.mode} className="rounded-xl border border-black/15 bg-white p-4">
      <h3 className="font-semibold">{ARRANGEMENT_LABELS[proposal.mode]}</h3>
      <p className="mt-1 text-xs text-neutral-600">{proposal.pages.length} pages · {photos.length - proposal.unplaced.length} photos placed</p>
      <div className="mt-3 grid gap-3">{proposal.pages.slice(0, 2).map((page, i) => <figure key={i}><CompositionThumbnail format={getFormat(project.formatId)} template={page.template} page={previewPage(page, i)} /><figcaption className="mt-1 text-xs text-neutral-600">Page {i + 1}: {page.template.name}. {page.explanation}</figcaption></figure>)}</div>
      {proposal.pages.length > 2 ? <details className="mt-3"><summary className="cursor-pointer text-sm">Preview the remaining {proposal.pages.length - 2} pages</summary><div className="mt-3 grid gap-3">{proposal.pages.slice(2).map((page, i) => <figure key={i}><CompositionThumbnail format={getFormat(project.formatId)} template={page.template} page={previewPage(page, i + 2)} /><figcaption className="text-xs">Page {i + 3}: {page.template.name}. {page.explanation}</figcaption></figure>)}</div></details> : null}
      {proposal.unplaced.length ? <details className="mt-3 text-sm text-amber-900"><summary>{proposal.unplaced.length} photos remain unplaced in the library</summary><ul className="mt-2 list-disc pl-4">{proposal.unplaced.map(item => <li key={item.blobKey}>{photos.find(photo => photo.blobKey === item.blobKey)?.sourceName ?? "Photo"}: {item.reason}</li>)}</ul></details> : null}
      <button type="button" className="primary-button mt-4 w-full" disabled={busy || processing || suggesting} onClick={() => onApply(proposal)}>Apply as new project</button>
    </article>)}</div> : null}
    {reviewDuplicates ? <DuplicatePhotoReview project={project} ownerId={ownerId} thumbnails={analysed}
      getVolatileBlob={getVolatileBlob} getDriveToken={getDriveToken} onApply={onCombineDuplicates} onClose={() => setReviewDuplicates(false)} /> : null}
  </section>;
}
