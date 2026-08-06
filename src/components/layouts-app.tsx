"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PRODUCT } from "@/config/product";
import { DEFAULT_CROP, MAX_ZOOM, MIN_ZOOM, setCropZoom } from "@/lib/crop";
import { createExportFilename, createExportZip, renderComposition } from "@/lib/export";
import { FORMATS, getFormat } from "@/lib/formats";
import { disposePhotoAsset, preparePhotoAsset, validateImageFile } from "@/lib/image";
import { LOCAL_PHOTO_SOURCE } from "@/lib/photo-sources";
import {
  MAX_PROJECT_PAGES,
  getMissingPhotoCount,
  getPhotoFillTargets,
  isPageComplete,
  moveLayoutPhoto,
  moveProjectPage,
  moveProjectPageByOffset,
} from "@/lib/project";
import {
  clearSavedProject,
  deletePhotoBlob,
  loadPhotoBlob,
  loadProject,
  savePhotoBlob,
  saveProject,
} from "@/lib/storage";
import { getTemplate, getTemplatesForFormat } from "@/lib/templates";
import type {
  AppScreen,
  CropState,
  FormatId,
  PhotoAsset,
  ProjectPage,
  StoredProject,
  StoredProjectPage,
  TemplateDefinition,
} from "@/lib/types";
import { EditorCanvas } from "./editor-canvas";
import { ProjectPageCard } from "./project-page-card";
import { TemplateThumbnail } from "./template-thumbnail";

type Notice = { kind: "error" | "success" | "info"; text: string } | null;
type BusyState = "image" | "export" | "duplicate" | null;
type ExportItem = { pageId: string; pageNumber: number; blob: Blob; url: string; filename: string };

const BACKGROUNDS = ["#ffffff", "#f3f1ec", "#d9d6cf", "#1b1b1b", "#c9d2cc", "#e1d2c6"];

function now(): string {
  return new Date().toISOString();
}

function Header({
  screen,
  pageCount,
  onBack,
  onProject,
  onNew,
}: {
  screen: AppScreen;
  pageCount: number;
  onBack: () => void;
  onProject: () => void;
  onNew: () => void;
}) {
  const subtitle =
    screen === "format" ? "Private photo projects" :
    screen === "template" ? "Choose a layout" :
    screen === "editor" ? "Edit project page" :
    screen === "project" ? `${pageCount} ${pageCount === 1 ? "page" : "pages"}` :
    "Export project";

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
            <p className="truncate text-[11px] text-neutral-500">{subtitle}</p>
          </div>
        </div>
        {pageCount > 0 ? (
          screen === "project" ? (
            <button className="text-button" type="button" onClick={onNew}>Start new</button>
          ) : (
            <button className="text-button" type="button" onClick={onProject}>Project ({pageCount})</button>
          )
        ) : null}
      </div>
    </header>
  );
}

function serializePage(page: ProjectPage): StoredProjectPage {
  return {
    id: page.id,
    templateId: page.templateId,
    background: page.background,
    gutter: page.gutter,
    selectedFrameId: page.selectedFrameId,
    photos: Object.fromEntries(
      Object.entries(page.photos).map(([frameId, photo]) => [
        frameId,
        {
          frameId,
          blobKey: photo.blobKey,
          sourceWidth: photo.sourceWidth,
          sourceHeight: photo.sourceHeight,
          crop: photo.crop,
        },
      ]),
    ),
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  };
}

export function LayoutsApp() {
  const [screen, setScreen] = useState<AppScreen>("format");
  const [projectId, setProjectId] = useState("");
  const [projectName, setProjectName] = useState("My project");
  const [projectCreatedAt, setProjectCreatedAt] = useState("");
  const [formatId, setFormatId] = useState<FormatId | null>(null);
  const [pages, setPages] = useState<ProjectPage[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<BusyState>(null);
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number } | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [exportItems, setExportItems] = useState<ExportItem[]>([]);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [draggingPageId, setDraggingPageId] = useState<string | null>(null);
  const [rearrangeMode, setRearrangeMode] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileTargetRef = useRef<{ pageId: string; frameId: string } | null>(null);
  const exportHeadingRef = useRef<HTMLHeadingElement>(null);
  const pagesRef = useRef(pages);
  const exportItemsRef = useRef(exportItems);

  const format = formatId ? getFormat(formatId) : null;
  const templates = formatId ? getTemplatesForFormat(formatId) : [];
  const activePage = pages.find((page) => page.id === activePageId) ?? null;
  const template = activePage ? getTemplate(activePage.templateId) : null;
  const selectedPhoto = activePage?.selectedFrameId ? activePage.photos[activePage.selectedFrameId] : undefined;
  const missingPhotoCount = activePage && template ? getMissingPhotoCount(activePage, template) : 0;
  const completePageCount = pages.reduce((count, page) => count + (isPageComplete(page, getTemplate(page.templateId)) ? 1 : 0), 0);
  const incompletePageCount = pages.length - completePageCount;
  const hasAnyPhotos = pages.some((page) => Object.keys(page.photos).length > 0);

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  useEffect(() => {
    exportItemsRef.current = exportItems;
  }, [exportItems]);

  const clearExportItems = () => {
    for (const item of exportItemsRef.current) URL.revokeObjectURL(item.url);
    exportItemsRef.current = [];
    setExportItems([]);
  };

  const disposePagePreviews = (page: ProjectPage) => {
    Object.values(page.photos).forEach(disposePhotoAsset);
  };

  const deletePagePhotos = async (page: ProjectPage) => {
    for (const photo of Object.values(page.photos)) {
      disposePhotoAsset(photo);
      try {
        await deletePhotoBlob(photo.blobKey);
      } catch {
        // The in-memory project can still be cleared if browser storage is unavailable.
      }
    }
  };

  const deleteAllProjectPhotos = async (projectPages: ProjectPage[]) => {
    for (const page of projectPages) await deletePagePhotos(page);
  };

  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      const saved = loadProject();
      if (!saved) {
        if (!cancelled) {
          const createdAt = now();
          setProjectId(crypto.randomUUID());
          setProjectCreatedAt(createdAt);
          setReady(true);
        }
        return;
      }
      try {
        const restoredFormat = saved.formatId ? getFormat(saved.formatId) : null;
        const restoredPages: ProjectPage[] = [];
        for (const storedPage of saved.pages) {
          const restoredTemplate = getTemplate(storedPage.templateId);
          if (!restoredFormat || restoredTemplate.formatId !== restoredFormat.id) continue;
          const restoredPhotos: Record<string, PhotoAsset> = {};
          for (const item of Object.values(storedPage.photos)) {
            const blob = await loadPhotoBlob(item.blobKey);
            if (!blob || !restoredTemplate.frames.some((frame) => frame.id === item.frameId)) continue;
            try {
              const asset = await preparePhotoAsset(blob, item.frameId, item.blobKey);
              asset.crop = item.crop;
              restoredPhotos[item.frameId] = asset;
            } catch {
              // A single damaged stored photo should not prevent the rest of the project opening.
            }
          }
          restoredPages.push({ ...storedPage, photos: restoredPhotos });
        }
        if (cancelled) {
          restoredPages.forEach(disposePagePreviews);
          return;
        }
        const restoredActiveId = restoredPages.some((page) => page.id === saved.activePageId)
          ? saved.activePageId
          : restoredPages[0]?.id ?? null;
        let restoredScreen = saved.screen === "export" ? "project" : saved.screen;
        if (restoredScreen === "editor" && !restoredActiveId) restoredScreen = restoredPages.length ? "project" : "format";
        if (restoredScreen === "project" && !restoredFormat) restoredScreen = "format";
        setProjectId(saved.id || crypto.randomUUID());
        setProjectName(saved.name || "My project");
        setProjectCreatedAt(saved.createdAt || saved.updatedAt || now());
        setFormatId(restoredFormat?.id ?? null);
        setPages(restoredPages);
        setActivePageId(restoredActiveId);
        setScreen(restoredScreen);
        if (restoredPages.length) setNotice({ kind: "info", text: `${restoredPages.length === 1 ? "Your project was" : "Your project pages were"} restored on this device.` });
      } catch {
        clearSavedProject();
        setProjectId(crypto.randomUUID());
        setProjectCreatedAt(now());
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
      pagesRef.current.forEach(disposePagePreviews);
      exportItemsRef.current.forEach((item) => URL.revokeObjectURL(item.url));
    };
  }, []);

  useEffect(() => {
    if (!ready || !projectId) return;
    const timer = window.setTimeout(() => {
      const saved: StoredProject = {
        version: 2,
        id: projectId,
        name: projectName.trim() || "My project",
        screen,
        formatId,
        activePageId,
        pages: pages.map(serializePage),
        createdAt: projectCreatedAt || now(),
        updatedAt: now(),
      };
      try {
        saveProject(saved);
      } catch {
        setNotice({ kind: "error", text: "This project could not be autosaved in this browser." });
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [activePageId, formatId, pages, projectCreatedAt, projectId, projectName, ready, screen]);

  useEffect(() => {
    if (!hasAnyPhotos) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasAnyPhotos]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), notice.kind === "error" ? 6000 : 3800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (screen !== "export" || !exportItems.length) return;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "instant" });
      exportHeadingRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [exportItems.length, screen]);

  const updatePage = (pageId: string, updater: (page: ProjectPage) => ProjectPage) => {
    setPages((current) => current.map((page) => page.id === pageId ? { ...updater(page), updatedAt: now() } : page));
  };

  const selectFormat = (nextFormatId: FormatId) => {
    setRearrangeMode(false);
    setFormatId(nextFormatId);
    setActivePageId(null);
    setScreen("template");
  };

  const selectTemplate = async (nextTemplate: TemplateDefinition) => {
    if (!formatId || nextTemplate.formatId !== formatId) return;
    if (activePage) {
      if (activePage.templateId === nextTemplate.id) {
        setRearrangeMode(false);
        setScreen("editor");
        return;
      }
      if (Object.keys(activePage.photos).length && !window.confirm("Change this page layout and remove its photographs?")) return;
      await deletePagePhotos(activePage);
      updatePage(activePage.id, (page) => ({
        ...page,
        templateId: nextTemplate.id,
        background: nextTemplate.defaultBackground,
        gutter: nextTemplate.defaultGutter,
        selectedFrameId: nextTemplate.frames[0]?.id ?? null,
        photos: {},
      }));
      setRearrangeMode(false);
      setScreen("editor");
      return;
    }
    if (pages.length >= MAX_PROJECT_PAGES) {
      setNotice({ kind: "error", text: `A project can contain up to ${MAX_PROJECT_PAGES} pages.` });
      return;
    }
    const createdAt = now();
    const page: ProjectPage = {
      id: crypto.randomUUID(),
      templateId: nextTemplate.id,
      background: nextTemplate.defaultBackground,
      gutter: nextTemplate.defaultGutter,
      selectedFrameId: nextTemplate.frames[0]?.id ?? null,
      photos: {},
      createdAt,
      updatedAt: createdAt,
    };
    setPages((current) => [...current, page]);
    setActivePageId(page.id);
    setRearrangeMode(false);
    setScreen("editor");
  };

  const requestPhoto = (frameId: string) => {
    if (!activePage) return;
    fileTargetRef.current = { pageId: activePage.id, frameId };
    inputRef.current?.click();
  };

  const receivePhotos = async (files: File[]) => {
    const target = fileTargetRef.current;
    if (!files.length || !target) return;
    const currentPage = pagesRef.current.find((page) => page.id === target.pageId);
    if (!currentPage) return;
    const currentTemplate = getTemplate(currentPage.templateId);
    const targetFrameIds = getPhotoFillTargets(currentTemplate, currentPage.photos, target.frameId, files.length);
    const selectedFiles = files.slice(0, targetFrameIds.length);
    if (!selectedFiles.length) return;
    setBusy("image");
    setNotice({ kind: "info", text: selectedFiles.length === 1 ? "Preparing photo…" : `Preparing ${selectedFiles.length} photos…` });
    const preparedAssets: PhotoAsset[] = [];
    let refreshRecoveryAvailable = true;
    try {
      selectedFiles.forEach(validateImageFile);
      for (let index = 0; index < selectedFiles.length; index += 1) {
        const file = selectedFiles[index];
        const frameId = targetFrameIds[index];
        const asset = await preparePhotoAsset(file, frameId);
        preparedAssets.push(asset);
        try {
          await savePhotoBlob(asset.blobKey, file);
        } catch {
          refreshRecoveryAvailable = false;
        }
      }

      const replacedPhotos = targetFrameIds
        .map((frameId) => currentPage.photos[frameId])
        .filter((photo): photo is PhotoAsset => Boolean(photo));
      const additions = Object.fromEntries(preparedAssets.map((asset) => [asset.frameId, asset]));
      updatePage(target.pageId, (page) => ({
        ...page,
        selectedFrameId: targetFrameIds[0],
        photos: { ...page.photos, ...additions },
      }));
      for (const previous of replacedPhotos) {
        disposePhotoAsset(previous);
        void deletePhotoBlob(previous.blobKey).catch(() => undefined);
      }
      if (preparedAssets.length > 1) setRearrangeMode(true);

      const ignoredCount = files.length - preparedAssets.length;
      const recoveryText = refreshRecoveryAvailable ? "" : " Refresh recovery is unavailable for the new photos in this browser.";
      const ignoredText = ignoredCount ? ` ${ignoredCount} extra ${ignoredCount === 1 ? "photo was" : "photos were"} not added because the template is full.` : "";
      setNotice({
        kind: refreshRecoveryAvailable ? "success" : "info",
        text: preparedAssets.length === 1
          ? `Photo added. Drag to reposition or pinch to zoom.${ignoredText}${recoveryText}`
          : `${preparedAssets.length} photos added. Drag tiles to rearrange them.${ignoredText}${recoveryText}`,
      });
    } catch (error) {
      for (const asset of preparedAssets) {
        disposePhotoAsset(asset);
        void deletePhotoBlob(asset.blobKey).catch(() => undefined);
      }
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Those photos could not be added." });
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const updateCrop = (frameId: string, crop: CropState) => {
    if (!activePage) return;
    updatePage(activePage.id, (page) => {
      const photo = page.photos[frameId];
      return photo ? { ...page, photos: { ...page.photos, [frameId]: { ...photo, crop } } } : page;
    });
  };

  const movePhoto = (sourceFrameId: string, targetFrameId: string) => {
    if (!activePage || sourceFrameId === targetFrameId) return;
    updatePage(activePage.id, (page) => ({
      ...page,
      selectedFrameId: targetFrameId,
      photos: moveLayoutPhoto(page.photos, sourceFrameId, targetFrameId),
    }));
  };

  const removeSelected = () => {
    if (!activePage?.selectedFrameId) return;
    const frameId = activePage.selectedFrameId;
    const removed = activePage.photos[frameId];
    if (!removed) return;
    disposePhotoAsset(removed);
    void deletePhotoBlob(removed.blobKey).catch(() => undefined);
    updatePage(activePage.id, (page) => {
      const photos = { ...page.photos };
      delete photos[frameId];
      return { ...page, photos };
    });
  };

  const resetSelected = () => {
    if (activePage?.selectedFrameId && selectedPhoto) updateCrop(activePage.selectedFrameId, { ...DEFAULT_CROP });
  };

  const startNew = async () => {
    if (pages.length && !window.confirm("Start a new project and remove every page and photograph in this one?")) return;
    await deleteAllProjectPhotos(pages);
    clearExportItems();
    clearSavedProject();
    const createdAt = now();
    setProjectId(crypto.randomUUID());
    setProjectCreatedAt(createdAt);
    setProjectName("My project");
    setPages([]);
    setFormatId(null);
    setActivePageId(null);
    setRearrangeMode(false);
    setScreen("format");
  };

  const goBack = () => {
    setRearrangeMode(false);
    if (screen === "template") setScreen(pages.length ? "project" : "format");
    else if (screen === "editor") setScreen("project");
    else if (screen === "export") setScreen("project");
    else if (screen === "project" && !pages.length) setScreen("format");
  };

  const openProject = () => {
    setDraggingPageId(null);
    setRearrangeMode(false);
    setScreen("project");
  };

  const addPage = () => {
    if (pages.length >= MAX_PROJECT_PAGES) {
      setNotice({ kind: "error", text: `A project can contain up to ${MAX_PROJECT_PAGES} pages.` });
      return;
    }
    setActivePageId(null);
    setRearrangeMode(false);
    setScreen("template");
  };

  const editPage = (pageId: string) => {
    setActivePageId(pageId);
    setRearrangeMode(false);
    setScreen("editor");
  };

  const duplicatePage = async (pageId: string) => {
    const source = pagesRef.current.find((page) => page.id === pageId);
    if (!source) return;
    if (pagesRef.current.length >= MAX_PROJECT_PAGES) {
      setNotice({ kind: "error", text: `A project can contain up to ${MAX_PROJECT_PAGES} pages.` });
      return;
    }
    setBusy("duplicate");
    const clonedPhotos: Record<string, PhotoAsset> = {};
    try {
      for (const [frameId, photo] of Object.entries(source.photos)) {
        const clone = await preparePhotoAsset(photo.sourceBlob, frameId);
        clone.crop = { ...photo.crop };
        await savePhotoBlob(clone.blobKey, clone.sourceBlob);
        clonedPhotos[frameId] = clone;
      }
      const createdAt = now();
      const duplicate: ProjectPage = {
        ...source,
        id: crypto.randomUUID(),
        photos: clonedPhotos,
        createdAt,
        updatedAt: createdAt,
      };
      setPages((current) => {
        const index = current.findIndex((page) => page.id === pageId);
        const next = [...current];
        next.splice(index + 1, 0, duplicate);
        return next;
      });
      setNotice({ kind: "success", text: "Page duplicated." });
    } catch {
      await deletePagePhotos({ ...source, photos: clonedPhotos });
      setNotice({ kind: "error", text: "This page could not be duplicated. Your original is unchanged." });
    } finally {
      setBusy(null);
    }
  };

  const deletePage = async (pageId: string) => {
    const page = pagesRef.current.find((item) => item.id === pageId);
    if (!page || !window.confirm("Delete this page and its photographs from the project?")) return;
    await deletePagePhotos(page);
    setPages((current) => current.filter((item) => item.id !== pageId));
    if (activePageId === pageId) setActivePageId(null);
    setNotice({ kind: "success", text: "Page deleted." });
  };

  const movePage = (pageId: string, offset: -1 | 1) => {
    setPages((current) => moveProjectPageByOffset(current, pageId, offset));
  };

  const dragPageOver = (sourceId: string, targetId: string) => {
    setPages((current) => moveProjectPage(current, sourceId, targetId));
  };

  const exportPages = async (pageIds?: string[]) => {
    if (!format) return;
    const selectedPages = pageIds ? pages.filter((page) => pageIds.includes(page.id)) : pages;
    if (!selectedPages.length) {
      setNotice({ kind: "error", text: "Add a page before exporting." });
      return;
    }
    const incomplete = selectedPages.find((page) => !isPageComplete(page, getTemplate(page.templateId)));
    if (incomplete) {
      const pageNumber = pages.findIndex((page) => page.id === incomplete.id) + 1;
      setNotice({ kind: "error", text: `Finish page ${pageNumber} before exporting.` });
      return;
    }
    setBusy("export");
    setExportProgress({ current: 0, total: selectedPages.length });
    clearExportItems();
    const created: ExportItem[] = [];
    try {
      for (let index = 0; index < selectedPages.length; index += 1) {
        const page = selectedPages[index];
        const pageNumber = pages.findIndex((item) => item.id === page.id) + 1;
        setExportProgress({ current: index + 1, total: selectedPages.length });
        const blob = await renderComposition({
          format,
          template: getTemplate(page.templateId),
          background: page.background,
          gutter: page.gutter,
          photos: page.photos,
        });
        created.push({
          pageId: page.id,
          pageNumber,
          blob,
          url: URL.createObjectURL(blob),
          filename: createExportFilename(format, pageNumber),
        });
      }
      setExportItems(created);
      exportItemsRef.current = created;
      setScreen("export");
      setNotice({
        kind: "success",
        text: created.length === 1 ? "JPEG ready — tap Save to Photos / Share to finish." : `${created.length} JPEGs ready — tap Save all to Photos / Share to finish.`,
      });
    } catch (error) {
      created.forEach((item) => URL.revokeObjectURL(item.url));
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Export failed. Try closing other apps and exporting again." });
    } finally {
      setBusy(null);
      setExportProgress(null);
    }
  };

  const downloadBlob = (blob: Blob, url: string, filename: string) => {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  };

  const downloadExports = async () => {
    if (!exportItems.length) return;
    if (exportItems.length === 1) {
      const item = exportItems[0];
      downloadBlob(item.blob, item.url, item.filename);
      setNotice({ kind: "success", text: "JPEG opened or downloaded. On iPhone, use Share → Save Image." });
      return;
    }
    setBusy("export");
    setNotice({ kind: "info", text: "Packaging JPEGs into a ZIP…" });
    try {
      const zipped = await createExportZip(exportItems, projectName);
      const url = URL.createObjectURL(zipped.blob);
      downloadBlob(zipped.blob, url, zipped.filename);
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setNotice({ kind: "success", text: "ZIP downloaded. Open it in Files to see every JPEG." });
    } catch {
      setNotice({ kind: "error", text: "The ZIP could not be created. Try sharing the images instead." });
    } finally {
      setBusy(null);
    }
  };

  const shareExports = async () => {
    if (!exportItems.length) return;
    const files = exportItems.map((item) => new File([item.blob], item.filename, { type: "image/jpeg" }));
    if (!("share" in navigator) || !("canShare" in navigator) || !navigator.canShare({ files })) {
      await downloadExports();
      setNotice({ kind: "info", text: files.length === 1 ? "The share sheet is unavailable, so the JPEG was downloaded instead." : "The share sheet is unavailable, so a ZIP was downloaded instead." });
      return;
    }
    try {
      await navigator.share({ files, title: `${projectName || PRODUCT.name} export` });
      setNotice({
        kind: "success",
        text: files.length === 1 ? "Share sheet opened. Choose Save Image to add it to Photos." : `Share sheet opened. Choose Save ${files.length} Images to add them to Photos.`,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setNotice({ kind: "error", text: "The share sheet could not be opened. Use the download option instead." });
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
      <Header
        screen={screen}
        pageCount={pages.length}
        onBack={goBack}
        onProject={openProject}
        onNew={() => void startNew()}
      />
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        multiple
        accept={LOCAL_PHOTO_SOURCE.accept}
        onChange={(event) => void receivePhotos(Array.from(event.target.files ?? []))}
      />

      {screen === "format" ? (
        <main className="screen-shell max-w-[920px]">
          <section className="pt-9 sm:pt-14">
            <p className="eyebrow">Start a project</p>
            <h1 className="mt-3 max-w-[680px] text-[clamp(2.2rem,7vw,4.6rem)] font-medium leading-[0.95] tracking-[-0.055em]">
              Build a set of layouts, then export them together.
            </h1>
            <p className="mt-5 max-w-[560px] text-[15px] leading-6 text-neutral-600 sm:text-base">
              Add, edit and reorder pages. Your photographs and unfinished project stay privately on this device.
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
                  <span className="mt-1 block text-sm text-neutral-500">{item.aspectRatio} · {item.width} × {item.height}</span>
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

      {screen === "project" && format ? (
        <main className="screen-shell max-w-[1120px] py-7 sm:py-10">
          <section className="project-heading">
            <div className="min-w-0 flex-1">
              <p className="eyebrow">{format.name} · {format.aspectRatio}</p>
              <label className="sr-only" htmlFor="project-name">Project name</label>
              <input
                id="project-name"
                className="project-name-input mt-2"
                value={projectName}
                maxLength={60}
                onChange={(event) => setProjectName(event.target.value)}
                onBlur={() => !projectName.trim() && setProjectName("My project")}
              />
              <p className="mt-2 text-sm text-neutral-600">
                {pages.length ? `${completePageCount} of ${pages.length} ready to export` : "Choose a layout to add your first page."}
              </p>
            </div>
            <div className="grid w-full gap-2 sm:w-auto sm:min-w-[210px]">
              <button className="primary-button" type="button" disabled={!pages.length || Boolean(incompletePageCount) || busy !== null} onClick={() => void exportPages()}>
                {!pages.length ? "Add a page first" : incompletePageCount ? `Finish ${incompletePageCount} ${incompletePageCount === 1 ? "page" : "pages"}` : `Export all ${pages.length}`}
              </button>
              <button className="secondary-button" type="button" disabled={pages.length >= MAX_PROJECT_PAGES || busy !== null} onClick={addPage}>+ Add page</button>
            </div>
          </section>

          {pages.length ? (
            <>
              <section className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4" aria-label="Project pages">
                {pages.map((page, index) => (
                  <ProjectPageCard
                    key={page.id}
                    format={format}
                    page={page}
                    pageNumber={index + 1}
                    pageCount={pages.length}
                    template={getTemplate(page.templateId)}
                    dragging={draggingPageId === page.id}
                    onDragStart={setDraggingPageId}
                    onDragOver={dragPageOver}
                    onDragEnd={() => setDraggingPageId(null)}
                    onMove={movePage}
                    onEdit={editPage}
                    onDuplicate={(pageId) => void duplicatePage(pageId)}
                    onDelete={(pageId) => void deletePage(pageId)}
                    onExport={(pageId) => void exportPages([pageId])}
                  />
                ))}
              </section>
              <p className="mt-6 text-center text-xs leading-5 text-neutral-500">
                Drag the ⠿ handle to reorder, or use Earlier and Later. Order is preserved in export filenames and the share sheet.
              </p>
            </>
          ) : (
            <section className="project-empty mt-8">
              <div className="empty-page-stack" aria-hidden="true"><span /><span /><span /></div>
              <h2 className="mt-6 text-2xl font-medium tracking-[-0.035em]">Your project is empty.</h2>
              <p className="mt-2 max-w-[420px] text-sm leading-6 text-neutral-600">Add a page, choose a template and fill it with photographs. You can return here at any time.</p>
              <button className="primary-button mt-5" type="button" onClick={addPage}>Add first page</button>
            </section>
          )}
        </main>
      ) : null}

      {screen === "template" && format ? (
        <main className="screen-shell max-w-[1100px]">
          <section className="flex flex-wrap items-end justify-between gap-4 pt-7 sm:pt-10">
            <div>
              <p className="eyebrow">{activePage ? "Change page layout" : `Add page ${pages.length + 1}`} · {format.aspectRatio}</p>
              <h1 className="mt-2 text-3xl font-medium tracking-[-0.04em] sm:text-4xl">Choose a layout</h1>
              <p className="mt-2 text-sm text-neutral-600">All project pages export at {format.width} × {format.height}px.</p>
            </div>
            <button className="secondary-button" type="button" onClick={() => setShowInstallHelp(true)}>Installation help</button>
          </section>
          <section className="mt-7 grid grid-cols-2 gap-3 pb-10 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4" aria-label={`${format.name} templates`}>
            {templates.map((item) => (
              <button key={item.id} className="template-card" type="button" onClick={() => void selectTemplate(item)}>
                <span className="template-preview" style={{ aspectRatio: `${item.canvasWidth}/${item.canvasHeight}` }}>
                  <TemplateThumbnail template={item} selected={item.id === activePage?.templateId} />
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

      {screen === "editor" && format && template && activePage ? (
        <main className="editor-shell">
          <section className="min-w-0 rounded-[20px] bg-[#e8e8e4] p-3 sm:p-6 lg:min-h-[calc(100dvh-104px)] lg:p-8">
            <EditorCanvas
              format={format}
              template={template}
              background={activePage.background}
              gutter={activePage.gutter}
              photos={activePage.photos}
              selectedFrameId={activePage.selectedFrameId}
              rearrangeMode={rearrangeMode}
              onSelectFrame={(frameId) => updatePage(activePage.id, (page) => ({ ...page, selectedFrameId: frameId }))}
              onRequestPhoto={requestPhoto}
              onCropChange={updateCrop}
              onMovePhoto={movePhoto}
            />
          </section>
          <aside className="control-panel" aria-label="Editing controls">
            <div>
              <div className="flex items-center justify-between gap-3">
                <p className="eyebrow">Page {pages.findIndex((page) => page.id === activePage.id) + 1} · {template.name}</p>
                <button className="text-button min-h-0" type="button" onClick={() => setScreen("template")}>Change layout</button>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <h1 className="text-2xl font-medium tracking-[-0.035em]">Edit page</h1>
                <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-600">{Object.keys(activePage.photos).length}/{template.frames.length}</span>
              </div>
              <p className="mt-2 text-sm leading-5 text-neutral-600">
                {rearrangeMode ? "Drag a filled tile onto another tile to swap or move it. Changes autosave." : "Tap a frame, then drag the photo or pinch to zoom. You can select several photos at once."}
              </p>
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
                onChange={(event) => activePage.selectedFrameId && selectedPhoto && updateCrop(activePage.selectedFrameId, setCropZoom(selectedPhoto.crop, Number(event.target.value)))}
                aria-label="Photo zoom"
              />
              <div className="mt-4 grid grid-cols-3 gap-2">
                <button className="small-button" type="button" disabled={!activePage.selectedFrameId} onClick={() => activePage.selectedFrameId && requestPhoto(activePage.selectedFrameId)}>
                  {selectedPhoto ? "Replace" : "Add photo"}
                </button>
                <button className="small-button" type="button" disabled={!selectedPhoto} onClick={resetSelected}>Reset</button>
                <button className="small-button danger" type="button" disabled={!selectedPhoto} onClick={removeSelected}>Remove</button>
              </div>
              <button
                className={`secondary-button mt-2 w-full ${rearrangeMode ? "rearrange-active" : ""}`}
                type="button"
                aria-pressed={rearrangeMode}
                disabled={!Object.keys(activePage.photos).length || template.frames.length < 2}
                onClick={() => setRearrangeMode((current) => !current)}
              >
                {rearrangeMode ? "Done rearranging" : "Rearrange photos"}
              </button>
              <p className="mt-2 text-[11px] leading-4 text-neutral-500">
                Selecting multiple photos fills this tile first, then the other empty tiles.
              </p>
            </div>

            <div className="control-section">
              <label className="control-label" htmlFor="background">Background</label>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {BACKGROUNDS.map((colour) => (
                  <button
                    key={colour}
                    className={`colour-chip ${activePage.background.toLowerCase() === colour ? "selected" : ""}`}
                    style={{ backgroundColor: colour }}
                    type="button"
                    aria-label={`Use background ${colour}`}
                    onClick={() => updatePage(activePage.id, (page) => ({ ...page, background: colour }))}
                  />
                ))}
                <label className="colour-picker" title="Choose custom background">
                  <span aria-hidden="true">+</span>
                  <span className="sr-only">Choose a custom background colour</span>
                  <input id="background" type="color" value={activePage.background} onChange={(event) => updatePage(activePage.id, (page) => ({ ...page, background: event.target.value }))} />
                </label>
              </div>
            </div>

            <div className="control-section">
              <div className="flex items-center justify-between gap-3">
                <label className="control-label" htmlFor="gutter">Border and gutter</label>
                <span className="text-xs tabular-nums text-neutral-500">{activePage.gutter}px</span>
              </div>
              <input id="gutter" className="range mt-3" type="range" min="0" max="140" step="2" value={activePage.gutter} onChange={(event) => updatePage(activePage.id, (page) => ({ ...page, gutter: Number(event.target.value) }))} />
            </div>

            <div className="mt-auto grid gap-2 pt-5">
              <button className="primary-button w-full" type="button" disabled={busy !== null} onClick={() => {
                setScreen("project");
                setNotice({ kind: missingPhotoCount ? "info" : "success", text: missingPhotoCount ? `Draft saved with ${missingPhotoCount} ${missingPhotoCount === 1 ? "photo" : "photos"} still to add.` : "Page saved to your project." });
              }}>
                {missingPhotoCount ? "Save draft" : "Save page"}
              </button>
              <button className="secondary-button w-full" type="button" disabled={Boolean(missingPhotoCount) || busy !== null} onClick={() => void exportPages([activePage.id])}>Export this page</button>
              <p className="mt-1 text-center text-[11px] leading-4 text-neutral-500">Photos and project pages stay on this device.</p>
            </div>
          </aside>
        </main>
      ) : null}

      {screen === "export" && format && exportItems.length ? (
        <main className="screen-shell max-w-[1080px] py-7 sm:py-10">
          <div className="grid items-start gap-7 md:grid-cols-[minmax(0,1fr)_340px]">
            <aside className="rounded-[20px] bg-white p-5 shadow-[0_1px_0_rgba(0,0,0,0.05)] sm:p-6 md:col-start-2 md:row-start-1">
              <p className="eyebrow">Ready to save</p>
              <h1 ref={exportHeadingRef} className="mt-2 text-3xl font-medium tracking-[-0.04em] outline-none" tabIndex={-1}>
                {exportItems.length === 1 ? "Your JPEG is ready." : `${exportItems.length} JPEGs are ready.`}
              </h1>
              <p className="mt-3 text-sm leading-6 text-neutral-600">Each image is {format.width} × {format.height}px · high-quality JPEG</p>
              <div className="mt-6 grid gap-2">
                <button className="primary-button" type="button" onClick={() => void shareExports()}>
                  {exportItems.length === 1 ? "Save to Photos / Share" : `Save all ${exportItems.length} to Photos / Share`}
                </button>
                <button className="secondary-button" type="button" onClick={() => void downloadExports()}>
                  {exportItems.length === 1 ? "Download JPEG to Files" : "Download ZIP to Files"}
                </button>
                <button className="text-button mt-2 justify-center" type="button" onClick={() => setScreen("project")}>Back to project</button>
              </div>
              <p className="mt-5 rounded-xl bg-neutral-50 p-3 text-xs leading-5 text-neutral-600">
                Tap the black button, then choose <strong>{exportItems.length === 1 ? "Save Image" : `Save ${exportItems.length} Images`}</strong> in Apple’s share sheet. iOS controls the final wording and destination.
              </p>
            </aside>
            <section className="export-preview-grid md:col-start-1 md:row-start-1" aria-label="Exported images">
              {exportItems.map((item) => (
                <figure key={item.pageId} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element -- object URL is generated locally at runtime */}
                  <img className="block h-auto w-full shadow-[0_12px_35px_rgba(0,0,0,0.13)]" src={item.url} alt={`Exported project page ${item.pageNumber}`} />
                  <figcaption className="mt-2 text-center text-xs text-neutral-600">Page {item.pageNumber}</figcaption>
                </figure>
              ))}
            </section>
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
      {busy ? (
        <div className="busy-overlay" aria-live="polite">
          <span className="loading-ring" aria-hidden="true" />
          <span>
            {busy === "image" ? "Preparing photos…" : busy === "duplicate" ? "Duplicating page…" : exportProgress ? `Creating image ${exportProgress.current} of ${exportProgress.total}…` : "Preparing download…"}
          </span>
        </div>
      ) : null}
    </div>
  );
}
