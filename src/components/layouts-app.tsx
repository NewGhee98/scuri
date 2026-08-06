"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PRODUCT } from "@/config/product";
import { DEFAULT_CROP, MAX_ZOOM, MIN_ZOOM, setCropZoom } from "@/lib/crop";
import { createExportFilename, renderComposition } from "@/lib/export";
import { FORMATS, getFormat } from "@/lib/formats";
import { disposePhotoAsset, preparePhotoAsset, validateImageFile } from "@/lib/image";
import { LOCAL_PHOTO_SOURCE } from "@/lib/photo-sources";
import {
  clearSavedProject,
  deletePhotoBlob,
  loadPhotoBlob,
  loadProject,
  savePhotoBlob,
  saveProject,
} from "@/lib/storage";
import { getTemplate, getTemplatesForFormat } from "@/lib/templates";
import type { AppScreen, CropState, FormatId, PhotoAsset, StoredProject, TemplateDefinition } from "@/lib/types";
import { EditorCanvas } from "./editor-canvas";
import { TemplateThumbnail } from "./template-thumbnail";

type Notice = { kind: "error" | "success" | "info"; text: string } | null;

const BACKGROUNDS = ["#ffffff", "#f3f1ec", "#d9d6cf", "#1b1b1b", "#c9d2cc", "#e1d2c6"];

function Header({
  screen,
  hasPhotos,
  onBack,
  onNew,
}: {
  screen: AppScreen;
  hasPhotos: boolean;
  onBack: () => void;
  onNew: () => void;
}) {
  return (
    <header className="app-header">
      <div className="mx-auto flex h-full w-full max-w-[1240px] items-center justify-between px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          {screen !== "format" ? (
            <button className="icon-button" type="button" onClick={onBack} aria-label="Go back">
              <span aria-hidden="true">←</span>
            </button>
          ) : (
            <span className="brand-mark" aria-hidden="true">L</span>
          )}
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold tracking-[-0.02em]">{PRODUCT.name}</p>
            <p className="truncate text-[11px] text-neutral-500">
              {screen === "format" ? "Private photo layouts" : screen === "template" ? "Choose a layout" : screen === "editor" ? "Edit composition" : "Export"}
            </p>
          </div>
        </div>
        {hasPhotos ? (
          <button className="text-button" type="button" onClick={onNew}>
            Start new
          </button>
        ) : null}
      </div>
    </header>
  );
}

export function LayoutsApp() {
  const [screen, setScreen] = useState<AppScreen>("format");
  const [formatId, setFormatId] = useState<FormatId | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [background, setBackground] = useState("#ffffff");
  const [gutter, setGutter] = useState(24);
  const [photos, setPhotos] = useState<Record<string, PhotoAsset>>({});
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<"image" | "export" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [exportBlob, setExportBlob] = useState<Blob | null>(null);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileTargetRef = useRef<string | null>(null);
  const photosRef = useRef(photos);

  const format = formatId ? getFormat(formatId) : null;
  const template = templateId ? getTemplate(templateId) : null;
  const templates = formatId ? getTemplatesForFormat(formatId) : [];
  const selectedPhoto = selectedFrameId ? photos[selectedFrameId] : undefined;
  const hasPhotos = Object.keys(photos).length > 0;
  const missingPhotoCount = template ? template.frames.filter((frame) => !photos[frame.id]).length : 0;

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  const clearRuntimePhotos = async (assets: Record<string, PhotoAsset>) => {
    for (const asset of Object.values(assets)) {
      disposePhotoAsset(asset);
      try {
        await deletePhotoBlob(asset.blobKey);
      } catch {
        // Data can still be forgotten from the active project if IndexedDB is unavailable.
      }
    }
  };

  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      const saved = loadProject();
      if (!saved?.formatId || !saved.templateId) {
        if (!cancelled) setReady(true);
        return;
      }
      try {
        const restoredFormat = getFormat(saved.formatId);
        const restoredTemplate = getTemplate(saved.templateId);
        if (restoredTemplate.formatId !== restoredFormat.id) throw new Error("Project format mismatch.");
        const restoredPhotos: Record<string, PhotoAsset> = {};
        for (const item of Object.values(saved.photos)) {
          const blob = await loadPhotoBlob(item.blobKey);
          if (!blob || !restoredTemplate.frames.some((frame) => frame.id === item.frameId)) continue;
          const asset = await preparePhotoAsset(blob, item.frameId, item.blobKey);
          asset.crop = item.crop;
          restoredPhotos[item.frameId] = asset;
        }
        if (cancelled) {
          Object.values(restoredPhotos).forEach(disposePhotoAsset);
          return;
        }
        setFormatId(restoredFormat.id);
        setTemplateId(restoredTemplate.id);
        setBackground(saved.background);
        setGutter(saved.gutter);
        setSelectedFrameId(saved.selectedFrameId);
        setPhotos(restoredPhotos);
        setScreen(saved.screen === "export" ? "editor" : saved.screen);
        if (Object.keys(restoredPhotos).length) setNotice({ kind: "info", text: "Your last project was restored on this device." });
      } catch {
        clearSavedProject();
        setNotice({ kind: "error", text: "The previous project could not be restored. You can start a new one." });
      } finally {
        if (!cancelled) setReady(true);
      }
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      Object.values(photosRef.current).forEach(disposePhotoAsset);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (exportUrl) URL.revokeObjectURL(exportUrl);
    };
  }, [exportUrl]);

  useEffect(() => {
    if (!ready) return;
    const storedPhotos = Object.fromEntries(
      Object.entries(photos).map(([frameId, photo]) => [
        frameId,
        {
          frameId,
          blobKey: photo.blobKey,
          sourceWidth: photo.sourceWidth,
          sourceHeight: photo.sourceHeight,
          crop: photo.crop,
        },
      ]),
    );
    const project: StoredProject = {
      version: 1,
      screen,
      formatId,
      templateId,
      background,
      gutter,
      selectedFrameId,
      photos: storedPhotos,
      updatedAt: new Date().toISOString(),
    };
    try {
      saveProject(project);
    } catch {
      window.setTimeout(
        () => setNotice({ kind: "error", text: "Project settings could not be saved in this browser." }),
        0,
      );
    }
  }, [background, formatId, gutter, photos, ready, screen, selectedFrameId, templateId]);

  useEffect(() => {
    if (!hasPhotos) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasPhotos]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), notice.kind === "error" ? 6000 : 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const selectFormat = (nextFormatId: FormatId) => {
    if (hasPhotos && nextFormatId !== formatId && !window.confirm("Change format and discard the photographs in this project?")) return;
    if (hasPhotos && nextFormatId !== formatId) void clearRuntimePhotos(photos);
    setPhotos(nextFormatId === formatId ? photos : {});
    setFormatId(nextFormatId);
    if (nextFormatId !== formatId) {
      setTemplateId(null);
      setSelectedFrameId(null);
    }
    setScreen("template");
  };

  const selectTemplate = (nextTemplate: TemplateDefinition) => {
    if (templateId === nextTemplate.id) {
      setScreen("editor");
      return;
    }
    if (hasPhotos && !window.confirm("Use this layout and remove the photographs from the current layout?")) return;
    if (hasPhotos) void clearRuntimePhotos(photos);
    setPhotos({});
    setTemplateId(nextTemplate.id);
    setBackground(nextTemplate.defaultBackground);
    setGutter(nextTemplate.defaultGutter);
    setSelectedFrameId(nextTemplate.frames[0]?.id ?? null);
    setScreen("editor");
  };

  const requestPhoto = (frameId: string) => {
    fileTargetRef.current = frameId;
    inputRef.current?.click();
  };

  const receivePhoto = async (file: File | undefined) => {
    const frameId = fileTargetRef.current;
    if (!file || !frameId) return;
    setBusy("image");
    setNotice({ kind: "info", text: "Preparing photo…" });
    try {
      validateImageFile(file);
      const asset = await preparePhotoAsset(file, frameId);
      try {
        await savePhotoBlob(asset.blobKey, file);
      } catch {
        setNotice({ kind: "info", text: "Photo added, but refresh recovery is unavailable in this browser." });
      }
      const previous = photos[frameId];
      if (previous) {
        disposePhotoAsset(previous);
        void deletePhotoBlob(previous.blobKey).catch(() => undefined);
      }
      setPhotos((current) => ({ ...current, [frameId]: asset }));
      setSelectedFrameId(frameId);
      setNotice({ kind: "success", text: "Photo added. Drag to reposition or pinch to zoom." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "That photo could not be added." });
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const updateCrop = (frameId: string, crop: CropState) => {
    setPhotos((current) => {
      const photo = current[frameId];
      return photo ? { ...current, [frameId]: { ...photo, crop } } : current;
    });
  };

  const removeSelected = () => {
    if (!selectedFrameId || !photos[selectedFrameId]) return;
    const removed = photos[selectedFrameId];
    disposePhotoAsset(removed);
    void deletePhotoBlob(removed.blobKey).catch(() => undefined);
    setPhotos((current) => {
      const next = { ...current };
      delete next[selectedFrameId];
      return next;
    });
  };

  const resetSelected = () => {
    if (selectedFrameId && photos[selectedFrameId]) updateCrop(selectedFrameId, { ...DEFAULT_CROP });
  };

  const startNew = async () => {
    if (hasPhotos && !window.confirm("Start a new project and remove the photographs from this one?")) return;
    await clearRuntimePhotos(photos);
    setPhotos({});
    setFormatId(null);
    setTemplateId(null);
    setSelectedFrameId(null);
    setBackground("#ffffff");
    setGutter(24);
    setScreen("format");
    clearSavedProject();
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    setExportUrl(null);
    setExportBlob(null);
  };

  const goBack = () => {
    if (screen === "template") setScreen("format");
    else if (screen === "editor") setScreen("template");
    else if (screen === "export") setScreen("editor");
  };

  const exportComposition = async () => {
    if (!format || !template) return;
    if (missingPhotoCount) {
      setNotice({ kind: "error", text: `Add ${missingPhotoCount} more ${missingPhotoCount === 1 ? "photo" : "photos"} before exporting.` });
      return;
    }
    setBusy("export");
    setNotice({ kind: "info", text: `Creating ${format.width} × ${format.height} JPEG…` });
    try {
      const blob = await renderComposition({ format, template, background, gutter, photos });
      if (exportUrl) URL.revokeObjectURL(exportUrl);
      setExportBlob(blob);
      setExportUrl(URL.createObjectURL(blob));
      setScreen("export");
      setNotice({ kind: "success", text: "High-quality JPEG created." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Export failed. Try closing other apps and exporting again." });
    } finally {
      setBusy(null);
    }
  };

  const downloadExport = () => {
    if (!exportUrl || !format) return;
    const anchor = document.createElement("a");
    anchor.href = exportUrl;
    anchor.download = createExportFilename(format);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setNotice({ kind: "success", text: "JPEG opened or downloaded. On iPhone, use Share → Save Image." });
  };

  const shareExport = async () => {
    if (!exportBlob || !format) return;
    const file = new File([exportBlob], createExportFilename(format), { type: "image/jpeg" });
    if (!("share" in navigator) || !("canShare" in navigator) || !navigator.canShare({ files: [file] })) {
      setNotice({ kind: "info", text: "Sharing is unavailable here. Use Download instead." });
      return;
    }
    try {
      await navigator.share({ files: [file], title: `${PRODUCT.name} export` });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setNotice({ kind: "error", text: "The share sheet could not be opened. Use Download instead." });
    }
  };

  const formatCards = useMemo(
    () => FORMATS.map((item) => ({ ...item, ratio: item.width / item.height })),
    [],
  );

  if (!ready) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#f5f5f2]">
        <div className="text-center">
          <span className="loading-ring" aria-hidden="true" />
          <p className="mt-4 text-sm text-neutral-600">Opening {PRODUCT.name}…</p>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-dvh bg-[#f5f5f2] text-[#11110f]">
      <Header screen={screen} hasPhotos={hasPhotos} onBack={goBack} onNew={() => void startNew()} />
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept={LOCAL_PHOTO_SOURCE.accept}
        onChange={(event) => void receivePhoto(event.target.files?.[0])}
      />

      {screen === "format" ? (
        <main className="screen-shell max-w-[920px]">
          <section className="pt-9 sm:pt-14">
            <p className="eyebrow">New composition</p>
            <h1 className="mt-3 max-w-[620px] text-[clamp(2.2rem,7vw,4.6rem)] font-medium leading-[0.95] tracking-[-0.055em]">
              Choose where your photos will live.
            </h1>
            <p className="mt-5 max-w-[520px] text-[15px] leading-6 text-neutral-600 sm:text-base">
              Your photographs stay on this device. Pick a format, choose a layout and export a finished JPEG.
            </p>
          </section>
          <section className="mt-9 grid gap-3 sm:mt-12 sm:grid-cols-2" aria-label="Instagram formats">
            {formatCards.map((item) => (
              <button key={item.id} className="format-card group" type="button" onClick={() => selectFormat(item.id)}>
                <span
                  className="format-ratio"
                  style={{ aspectRatio: `${item.width}/${item.height}`, width: item.id === "instagram-story" ? 48 : 61 }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 text-left">
                  <span className="block text-lg font-semibold tracking-[-0.025em]">{item.name}</span>
                  <span className="mt-1 block text-sm text-neutral-500">
                    {item.aspectRatio} · {item.width} × {item.height}
                  </span>
                  <span className="mt-3 block text-sm text-neutral-700">{item.description}</span>
                </span>
                <span className="text-xl transition-transform group-hover:translate-x-1" aria-hidden="true">→</span>
              </button>
            ))}
          </section>
          <button className="mt-8 text-sm font-medium underline decoration-neutral-300 underline-offset-4" type="button" onClick={() => setShowInstallHelp(true)}>
            Install on iPhone or iPad
          </button>
        </main>
      ) : null}

      {screen === "template" && format ? (
        <main className="screen-shell max-w-[1100px]">
          <section className="flex flex-wrap items-end justify-between gap-4 pt-7 sm:pt-10">
            <div>
              <p className="eyebrow">{format.name} · {format.aspectRatio}</p>
              <h1 className="mt-2 text-3xl font-medium tracking-[-0.04em] sm:text-4xl">Choose a layout</h1>
              <p className="mt-2 text-sm text-neutral-600">All layouts export at {format.width} × {format.height}px.</p>
            </div>
            <button className="secondary-button" type="button" onClick={() => setShowInstallHelp(true)}>Installation help</button>
          </section>
          <section className="mt-7 grid grid-cols-2 gap-3 pb-10 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4" aria-label={`${format.name} templates`}>
            {templates.map((item) => (
              <button key={item.id} className="template-card" type="button" onClick={() => selectTemplate(item)}>
                <span className="template-preview" style={{ aspectRatio: `${item.canvasWidth}/${item.canvasHeight}` }}>
                  <TemplateThumbnail template={item} selected={item.id === templateId} />
                </span>
                <span className="mt-3 flex w-full items-center justify-between gap-2 text-left">
                  <span className="text-sm font-semibold tracking-[-0.01em]">{item.name}</span>
                  <span className="text-xs text-neutral-500">{item.frames.length} {item.frames.length === 1 ? "photo" : "photos"}</span>
                </span>
              </button>
            ))}
          </section>
        </main>
      ) : null}

      {screen === "editor" && format && template ? (
        <main className="editor-shell">
          <section className="min-w-0 rounded-[20px] bg-[#e8e8e4] p-3 sm:p-6 lg:min-h-[calc(100dvh-104px)] lg:p-8">
            <EditorCanvas
              format={format}
              template={template}
              background={background}
              gutter={gutter}
              photos={photos}
              selectedFrameId={selectedFrameId}
              onSelectFrame={setSelectedFrameId}
              onRequestPhoto={requestPhoto}
              onCropChange={updateCrop}
            />
          </section>
          <aside className="control-panel" aria-label="Editing controls">
            <div>
              <p className="eyebrow">{template.name}</p>
              <div className="mt-3 flex items-center justify-between gap-3">
                <h1 className="text-2xl font-medium tracking-[-0.035em]">Edit layout</h1>
                <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-600">{Object.keys(photos).length}/{template.frames.length}</span>
              </div>
              <p className="mt-2 text-sm leading-5 text-neutral-600">Tap a frame, then drag the photo or pinch to zoom.</p>
            </div>

            <div className="control-section">
              <div className="flex items-center justify-between gap-3">
                <label className="control-label" htmlFor="zoom">Selected photo</label>
                <span className="text-xs tabular-nums text-neutral-500">{selectedPhoto ? `${Math.round(selectedPhoto.crop.zoom * 100)}%` : "Empty frame"}</span>
              </div>
              <input
                id="zoom"
                className="range mt-3"
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step="0.01"
                value={selectedPhoto?.crop.zoom ?? 1}
                disabled={!selectedPhoto}
                onChange={(event) => selectedFrameId && selectedPhoto && updateCrop(selectedFrameId, setCropZoom(selectedPhoto.crop, Number(event.target.value)))}
                aria-label="Photo zoom"
              />
              <div className="mt-4 grid grid-cols-3 gap-2">
                <button className="small-button" type="button" disabled={!selectedFrameId} onClick={() => selectedFrameId && requestPhoto(selectedFrameId)}>
                  {selectedPhoto ? "Replace" : "Add photo"}
                </button>
                <button className="small-button" type="button" disabled={!selectedPhoto} onClick={resetSelected}>Reset</button>
                <button className="small-button danger" type="button" disabled={!selectedPhoto} onClick={removeSelected}>Remove</button>
              </div>
            </div>

            <div className="control-section">
              <label className="control-label" htmlFor="background">Background</label>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {BACKGROUNDS.map((colour) => (
                  <button
                    key={colour}
                    className={`colour-chip ${background.toLowerCase() === colour ? "selected" : ""}`}
                    style={{ backgroundColor: colour }}
                    type="button"
                    aria-label={`Use background ${colour}`}
                    onClick={() => setBackground(colour)}
                  />
                ))}
                <label className="colour-picker" title="Choose custom background">
                  <span aria-hidden="true">+</span>
                  <span className="sr-only">Choose a custom background colour</span>
                  <input id="background" type="color" value={background} onChange={(event) => setBackground(event.target.value)} />
                </label>
              </div>
            </div>

            <div className="control-section">
              <div className="flex items-center justify-between gap-3">
                <label className="control-label" htmlFor="gutter">Border and gutter</label>
                <span className="text-xs tabular-nums text-neutral-500">{gutter}px</span>
              </div>
              <input id="gutter" className="range mt-3" type="range" min="0" max="140" step="2" value={gutter} onChange={(event) => setGutter(Number(event.target.value))} />
            </div>

            <div className="mt-auto pt-5">
              <button className="primary-button w-full" type="button" disabled={busy !== null} onClick={() => void exportComposition()}>
                {busy === "export" ? "Creating JPEG…" : missingPhotoCount ? `Add ${missingPhotoCount} more ${missingPhotoCount === 1 ? "photo" : "photos"}` : "Preview and export"}
              </button>
              <p className="mt-3 text-center text-[11px] leading-4 text-neutral-500">Photos are composed locally and never uploaded.</p>
            </div>
          </aside>
        </main>
      ) : null}

      {screen === "export" && format && exportUrl ? (
        <main className="screen-shell max-w-[1000px] py-7 sm:py-10">
          <div className="grid items-start gap-7 md:grid-cols-[minmax(0,1fr)_320px]">
            <section className="rounded-[20px] bg-[#e8e8e4] p-3 sm:p-7">
              {/* eslint-disable-next-line @next/next/no-img-element -- object URL is generated locally at runtime */}
              <img className="mx-auto max-h-[70dvh] w-auto max-w-full shadow-[0_16px_50px_rgba(0,0,0,0.14)]" src={exportUrl} alt="Final exported photo composition" />
            </section>
            <aside className="rounded-[20px] bg-white p-5 shadow-[0_1px_0_rgba(0,0,0,0.05)] sm:p-6">
              <p className="eyebrow">Ready to save</p>
              <h1 className="mt-2 text-3xl font-medium tracking-[-0.04em]">Your JPEG is ready.</h1>
              <p className="mt-3 text-sm leading-6 text-neutral-600">{format.width} × {format.height}px · high-quality JPEG</p>
              <div className="mt-6 grid gap-2">
                <button className="primary-button" type="button" onClick={() => void shareExport()}>Share or save image</button>
                <button className="secondary-button" type="button" onClick={downloadExport}>Download JPEG</button>
                <button className="text-button mt-2 justify-center" type="button" onClick={() => setScreen("editor")}>Keep editing</button>
              </div>
              <p className="mt-5 rounded-xl bg-neutral-50 p-3 text-xs leading-5 text-neutral-600">On iPhone or iPad, choose <strong>Save Image</strong> in the share sheet to add it to Apple Photos.</p>
            </aside>
          </div>
        </main>
      ) : null}

      {showInstallHelp ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowInstallHelp(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="install-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="eyebrow">Home Screen app</p>
                <h2 id="install-title" className="mt-2 text-2xl font-medium tracking-[-0.035em]">Install {PRODUCT.name}</h2>
              </div>
              <button className="icon-button" type="button" aria-label="Close installation help" onClick={() => setShowInstallHelp(false)}>×</button>
            </div>
            <ol className="mt-5 grid gap-3 text-sm leading-6 text-neutral-700">
              <li><strong>1.</strong> Open this address in Safari.</li>
              <li><strong>2.</strong> Tap Safari’s Share button.</li>
              <li><strong>3.</strong> Choose <strong>Add to Home Screen</strong>.</li>
              <li><strong>4.</strong> Keep <strong>Open as Web App</strong> enabled, then tap Add.</li>
            </ol>
            <p className="mt-5 rounded-xl bg-neutral-50 p-3 text-xs leading-5 text-neutral-600">Install it separately on your iPhone and iPad. Projects and photographs stay on the device where they were added.</p>
            <button className="primary-button mt-5 w-full" type="button" onClick={() => setShowInstallHelp(false)}>Done</button>
          </section>
        </div>
      ) : null}

      {notice ? <div className={`notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</div> : null}
      {busy === "image" ? <div className="busy-overlay" aria-live="polite"><span className="loading-ring" aria-hidden="true" /><span>Preparing photo…</span></div> : null}
    </div>
  );
}
