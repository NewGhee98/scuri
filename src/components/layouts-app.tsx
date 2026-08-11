"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { PRODUCT } from "@/config/product";
import { DEFAULT_CROP, MAX_ZOOM, MIN_ZOOM, setCropZoom } from "@/lib/crop";
import { createExportFilename, createExportZip, renderComposition } from "@/lib/export";
import { FORMATS, getFormat } from "@/lib/formats";
import { disposePhotoAsset, preparePhotoAsset, validateImageFile } from "@/lib/image";
import { LOCAL_PHOTO_SOURCE } from "@/lib/photo-sources";
import {
  cacheCustomTemplates,
  copyAsCustomTemplate,
  createTemplateSyncPlan,
  createBlankCustomTemplate,
  deleteCloudTemplate,
  describeTemplateSync,
  getTemplateCloudClient,
  getTemplateCloudUser,
  isTemplateCloudConfigured,
  loadCachedCustomTemplates,
  loadCloudTemplates,
  saveCloudTemplate,
  sendTemplateMagicLink,
  signOutTemplateCloud,
} from "@/lib/custom-templates";
import {
  MAX_PROJECT_PAGES,
  getDefaultProjectName,
  getBackScreen,
  getMissingPhotoCount,
  getPhotoFillTargets,
  isPageComplete,
  moveLayoutPhoto,
  moveProjectPage,
  moveProjectPageByOffset,
  sortProjectsByLastEdited,
} from "@/lib/project";
import {
  clearLegacySavedProject,
  deletePhotoBlob,
  loadPhotoBlob,
  loadProjects,
  savePhotoBlob,
  saveProjects,
} from "@/lib/storage";
import { getTemplate, getTemplatesForFormat, TEMPLATES } from "@/lib/templates";
import type {
  AppScreen,
  CropState,
  CustomTemplate,
  FormatId,
  PhotoAsset,
  ProjectPage,
  StoredProject,
  StoredProjectPage,
  TemplateDefinition,
} from "@/lib/types";
import type { TemplateSyncSummary } from "@/lib/custom-templates";
import { EditorCanvas } from "./editor-canvas";
import { ProjectLibraryCard } from "./project-library-card";
import { ProjectPageCard } from "./project-page-card";
import { TemplateThumbnail } from "./template-thumbnail";
import { TemplateDesigner } from "./template-designer";

type Notice = { kind: "error" | "success" | "info"; text: string } | null;
type BusyState = "image" | "export" | "duplicate" | "project" | null;
type ExportItem = { pageId: string; pageNumber: number; blob: Blob; url: string; filename: string };

const BACKGROUNDS = ["#ffffff", "#f3f1ec", "#d9d6cf", "#1b1b1b", "#c9d2cc", "#e1d2c6"];

function now(): string {
  return new Date().toISOString();
}

function Header({
  screen,
  pageCount,
  projectCount,
  onBack,
  onProjects,
  onTemplates,
  onNew,
  templatesSynced,
}: {
  screen: AppScreen;
  pageCount: number;
  projectCount: number;
  onBack: () => void;
  onProjects: () => void;
  onTemplates: () => void;
  onNew: () => void;
  templatesSynced: boolean;
}) {
  const templatesScreen = screen === "templates" || screen === "template-format" || screen === "template-editor";
  const subtitle =
    screen === "projects" ? `${projectCount} ${projectCount === 1 ? "project" : "projects"}` :
    screen === "templates" ? "Reusable photo layouts" :
    screen === "template-format" ? "Choose a template format" :
    screen === "template-editor" ? "Design a photo layout" :
    screen === "format" ? "Choose a project format" :
    screen === "template" ? "Choose a layout" :
    screen === "editor" ? "Edit project page" :
    screen === "project" ? `${pageCount} ${pageCount === 1 ? "page" : "pages"}` :
    "Export project";

  return (
    <header className="app-header">
      <div className="mx-auto flex h-full w-full max-w-[1240px] items-center justify-between px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          {screen !== "projects" && screen !== "templates" ? (
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
        <nav className="flex items-center gap-2" aria-label="Main navigation">
          <button className={`nav-button ${screen === "projects" ? "active" : ""}`} type="button" onClick={onProjects}>Projects</button>
          <button className={`nav-button ${templatesScreen ? "active" : ""}`} type="button" onClick={onTemplates}>
            Templates{templatesSynced ? <span className="nav-sync-dot" title="Templates synced" /> : null}
          </button>
          {screen === "projects" || screen === "templates" ? <button className="primary-button header-new-button" type="button" onClick={onNew}>+ New</button> : null}
        </nav>
      </div>
    </header>
  );
}

function serializePage(page: ProjectPage): StoredProjectPage {
  return {
    id: page.id,
    templateId: page.templateId,
    templateSnapshot: page.templateSnapshot,
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
  const [screen, setScreen] = useState<AppScreen>("projects");
  const [projects, setProjects] = useState<StoredProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [projectName, setProjectName] = useState("Untitled project");
  const [projectCreatedAt, setProjectCreatedAt] = useState("");
  const [projectUpdatedAt, setProjectUpdatedAt] = useState("");
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
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>([]);
  const [templateDraft, setTemplateDraft] = useState<CustomTemplate | null>(null);
  const [templateFilter, setTemplateFilter] = useState<FormatId | "all">("all");
  const [templateUser, setTemplateUser] = useState<User | null>(null);
  const [templateCloudBusy, setTemplateCloudBusy] = useState(false);
  const [showTemplateSignIn, setShowTemplateSignIn] = useState(false);
  const [signInEmail, setSignInEmail] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const fileTargetRef = useRef<{ pageId: string; frameId: string } | null>(null);
  const exportHeadingRef = useRef<HTMLHeadingElement>(null);
  const pagesRef = useRef(pages);
  const exportItemsRef = useRef(exportItems);
  const customTemplatesRef = useRef(customTemplates);
  const templateUserRef = useRef<User | null>(null);
  const templateSyncTimersRef = useRef(new Map<string, number>());

  const format = formatId ? getFormat(formatId) : null;
  const templates = formatId ? getTemplatesForFormat(formatId, customTemplates) : [];
  const activePage = pages.find((page) => page.id === activePageId) ?? null;
  const resolvePageTemplate = useCallback((page: Pick<ProjectPage, "templateId" | "templateSnapshot">): TemplateDefinition => (
    page.templateSnapshot ?? getTemplate(page.templateId, customTemplates)
  ), [customTemplates]);
  const template = activePage ? resolvePageTemplate(activePage) : null;
  const selectedPhoto = activePage?.selectedFrameId ? activePage.photos[activePage.selectedFrameId] : undefined;
  const missingPhotoCount = activePage && template ? getMissingPhotoCount(activePage, template) : 0;
  const completePageCount = pages.reduce((count, page) => count + (isPageComplete(page, resolvePageTemplate(page)) ? 1 : 0), 0);
  const incompletePageCount = pages.length - completePageCount;
  const hasAnyPhotos = pages.some((page) => Object.keys(page.photos).length > 0);
  const templateCloudConfigured = isTemplateCloudConfigured();
  const templateLibrarySynced = Boolean(templateUser) && customTemplates.every((item) => item.syncState === "synced");

  const replaceCustomTemplates = useCallback((next: CustomTemplate[]) => {
    const sorted = [...next].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    customTemplatesRef.current = sorted;
    setCustomTemplates(sorted);
    cacheCustomTemplates(sorted);
  }, []);

  const syncTemplateCloud = useCallback(async (): Promise<TemplateSyncSummary | null> => {
    if (!isTemplateCloudConfigured()) return null;
    const user = await getTemplateCloudUser();
    templateUserRef.current = user;
    setTemplateUser(user);
    if (!user) return null;
    const local = customTemplatesRef.current;
    const remote = await loadCloudTemplates();
    const plan = createTemplateSyncPlan(local, remote);
    let merged = plan.templates;
    let uploaded = 0;
    let failed = 0;
    for (const template of plan.uploads) {
      try {
        const saved = await saveCloudTemplate({ ...template, syncState: "pending" });
        merged = merged.map((item) => item.id === saved.id ? saved : item);
        uploaded += 1;
      } catch {
        merged = merged.map((item) => item.id === template.id ? { ...item, syncState: "error" } : item);
        failed += 1;
      }
    }
    replaceCustomTemplates(merged);
    return { uploaded, downloaded: plan.downloaded, removed: plan.removed, failed };
  }, [replaceCustomTemplates]);

  const manuallySyncTemplates = async () => {
    if (templateCloudBusy) return;
    setTemplateCloudBusy(true);
    setNotice(null);
    try {
      const summary = await syncTemplateCloud();
      if (!summary) {
        setNotice({ kind: "info", text: "Sign in before syncing templates across devices." });
        return;
      }
      setNotice({
        kind: summary.failed > 0 ? "error" : "success",
        text: describeTemplateSync(summary),
      });
    } catch {
      setNotice({ kind: "error", text: "Cloud sync could not be completed. Your local templates are unchanged." });
    } finally {
      setTemplateCloudBusy(false);
    }
  };

  const saveTemplateDraftLocally = useCallback((draft: CustomTemplate) => {
    const nextDraft = {
      ...draft,
      syncState: draft.syncState === "synced" ? "pending" as const : draft.syncState,
    };
    const next = [nextDraft, ...customTemplatesRef.current.filter((item) => item.id !== nextDraft.id)];
    replaceCustomTemplates(next);
    setTemplateDraft(nextDraft);
    const existingTimer = templateSyncTimersRef.current.get(nextDraft.id);
    if (existingTimer) window.clearTimeout(existingTimer);
    if (isTemplateCloudConfigured() && templateUserRef.current) {
      const timer = window.setTimeout(() => {
        templateSyncTimersRef.current.delete(nextDraft.id);
        void saveCloudTemplate({ ...nextDraft, syncState: "pending" }).then((saved) => {
          const current = customTemplatesRef.current.find((item) => item.id === saved.id);
          if (!current || current.updatedAt !== saved.updatedAt || current.status !== saved.status) return;
          replaceCustomTemplates([saved, ...customTemplatesRef.current.filter((item) => item.id !== saved.id)]);
        }).catch(() => {
          const current = customTemplatesRef.current.find((item) => item.id === nextDraft.id);
          if (!current || current.updatedAt !== nextDraft.updatedAt) return;
          replaceCustomTemplates(customTemplatesRef.current.map((item) => item.id === nextDraft.id ? { ...item, syncState: "error" } : item));
        });
      }, 700);
      templateSyncTimersRef.current.set(nextDraft.id, timer);
    }
  }, [replaceCustomTemplates]);

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  useEffect(() => {
    customTemplatesRef.current = customTemplates;
  }, [customTemplates]);

  useEffect(() => {
    templateUserRef.current = templateUser;
  }, [templateUser]);

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

  const deleteStoredProjectPhotos = async (project: StoredProject) => {
    for (const page of project.pages) {
      for (const photo of Object.values(page.photos)) {
        try {
          await deletePhotoBlob(photo.blobKey);
        } catch {
          // Project metadata can still be removed if a stored blob is already missing.
        }
      }
    }
  };

  const hydrateProjectPages = async (project: StoredProject): Promise<ProjectPage[]> => {
    const restoredFormat = getFormat(project.formatId);
    const restoredPages: ProjectPage[] = [];
    for (const storedPage of project.pages) {
      const restoredTemplate = storedPage.templateSnapshot ?? getTemplate(storedPage.templateId, customTemplatesRef.current);
      if (restoredTemplate.formatId !== restoredFormat.id) continue;
      const restoredPhotos: Record<string, PhotoAsset> = {};
      for (const item of Object.values(storedPage.photos)) {
        const blob = await loadPhotoBlob(item.blobKey).catch(() => null);
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
    return restoredPages;
  };

  useEffect(() => {
    const restore = () => {
      try {
        const saved = sortProjectsByLastEdited(loadProjects());
        setProjects(saved);
        const savedTemplates = loadCachedCustomTemplates();
        customTemplatesRef.current = savedTemplates;
        setCustomTemplates(savedTemplates);
        clearLegacySavedProject();
      } catch {
        setNotice({ kind: "error", text: "Your saved projects could not be restored in this browser." });
      } finally {
        setReady(true);
      }
    };
    restore();
  }, []);

  useEffect(() => {
    const client = getTemplateCloudClient();
    if (!client) return;
    const initialSync = window.setTimeout(() => {
      void syncTemplateCloud().catch(() => {
        setNotice({ kind: "error", text: "Cloud templates could not be loaded. Your local drafts are unchanged." });
      });
    }, 0);
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      templateUserRef.current = session?.user ?? null;
      setTemplateUser(session?.user ?? null);
      if (session?.user) {
        window.setTimeout(() => void syncTemplateCloud().catch(() => undefined), 0);
      }
    });
    return () => {
      window.clearTimeout(initialSync);
      data.subscription.unsubscribe();
    };
  }, [syncTemplateCloud]);

  useEffect(() => {
    const templateSyncTimers = templateSyncTimersRef.current;
    return () => {
      pagesRef.current.forEach(disposePagePreviews);
      exportItemsRef.current.forEach((item) => URL.revokeObjectURL(item.url));
      templateSyncTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    if (!ready || !projectId || !formatId) return;
    const timer = window.setTimeout(() => {
      const saved: StoredProject = {
        version: 3,
        id: projectId,
        name: projectName.trim() || "Untitled project",
        formatId,
        activePageId,
        pages: pages.map(serializePage),
        createdAt: projectCreatedAt || now(),
        updatedAt: projectUpdatedAt || projectCreatedAt || now(),
      };
      try {
        setProjects((current) => {
          const next = sortProjectsByLastEdited([...current.filter((project) => project.id !== saved.id), saved]);
          saveProjects(next);
          return next;
        });
      } catch {
        setNotice({ kind: "error", text: "This project could not be autosaved in this browser." });
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [activePageId, formatId, pages, projectCreatedAt, projectId, projectName, projectUpdatedAt, ready]);

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
    setProjectUpdatedAt(now());
    setPages((current) => current.map((page) => page.id === pageId ? { ...updater(page), updatedAt: now() } : page));
  };

  const persistActiveProject = (): StoredProject[] => {
    if (!projectId || !formatId) return projects;
    const saved: StoredProject = {
      version: 3,
      id: projectId,
      name: projectName.trim() || "Untitled project",
      formatId,
      activePageId,
      pages: pages.map(serializePage),
      createdAt: projectCreatedAt || now(),
      updatedAt: projectUpdatedAt || projectCreatedAt || now(),
    };
    const next = sortProjectsByLastEdited([...projects.filter((project) => project.id !== saved.id), saved]);
    saveProjects(next);
    setProjects(next);
    return next;
  };

  const selectFormat = (nextFormatId: FormatId) => {
    const savedProjects = persistActiveProject();
    const createdAt = now();
    const id = crypto.randomUUID();
    const name = getDefaultProjectName(savedProjects.map((project) => project.name));
    const project: StoredProject = {
      version: 3,
      id,
      name,
      formatId: nextFormatId,
      activePageId: null,
      pages: [],
      createdAt,
      updatedAt: createdAt,
    };
    const nextProjects = sortProjectsByLastEdited([project, ...savedProjects]);
    saveProjects(nextProjects);
    pagesRef.current.forEach(disposePagePreviews);
    pagesRef.current = [];
    setProjects(nextProjects);
    setProjectId(id);
    setProjectName(name);
    setProjectCreatedAt(createdAt);
    setProjectUpdatedAt(createdAt);
    setRearrangeMode(false);
    setFormatId(nextFormatId);
    setActivePageId(null);
    setPages([]);
    setScreen("project");
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
        templateSnapshot: { ...nextTemplate, frames: nextTemplate.frames.map((frame) => ({ ...frame })) },
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
      templateSnapshot: { ...nextTemplate, frames: nextTemplate.frames.map((frame) => ({ ...frame })) },
      background: nextTemplate.defaultBackground,
      gutter: nextTemplate.defaultGutter,
      selectedFrameId: nextTemplate.frames[0]?.id ?? null,
      photos: {},
      createdAt,
      updatedAt: createdAt,
    };
    setPages((current) => [...current, page]);
    setProjectUpdatedAt(createdAt);
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
    const currentTemplate = resolvePageTemplate(currentPage);
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

  const openTemplates = () => {
    persistActiveProject();
    clearExportItems();
    setTemplateDraft(null);
    setScreen("templates");
  };

  const beginNewTemplate = () => {
    persistActiveProject();
    setTemplateDraft(null);
    setScreen("template-format");
  };

  const selectTemplateFormat = (nextFormatId: FormatId) => {
    const draft = createBlankCustomTemplate(nextFormatId);
    saveTemplateDraftLocally(draft);
    setTemplateDraft(draft);
    setScreen("template-editor");
  };

  const editLibraryTemplate = (source: TemplateDefinition | CustomTemplate) => {
    if ("source" in source && source.source === "custom") {
      setTemplateDraft(source);
    } else {
      const draft = copyAsCustomTemplate(source, customTemplatesRef.current.map((item) => item.name));
      saveTemplateDraftLocally(draft);
      setTemplateDraft(draft);
    }
    setScreen("template-editor");
  };

  const duplicateLibraryTemplate = (source: TemplateDefinition | CustomTemplate) => {
    const draft = copyAsCustomTemplate(source, customTemplatesRef.current.map((item) => item.name));
    saveTemplateDraftLocally(draft);
    setTemplateDraft(draft);
    setScreen("template-editor");
  };

  const saveDesignedTemplate = async (draft: CustomTemplate) => {
    const pending = { ...draft, status: "saved" as const, syncState: "pending" as const };
    saveTemplateDraftLocally(pending);
    if (!templateCloudConfigured) {
      setNotice({ kind: "error", text: "The template is saved on this device, but cloud storage must be connected before it can sync across devices." });
      return;
    }
    if (!templateUser) {
      setShowTemplateSignIn(true);
      setNotice({ kind: "info", text: "Your template is ready locally. Sign in to save it permanently across devices." });
      return;
    }
    setTemplateCloudBusy(true);
    try {
      const saved = await saveCloudTemplate(pending);
      replaceCustomTemplates([saved, ...customTemplatesRef.current.filter((item) => item.id !== saved.id)]);
      setTemplateDraft(null);
      setScreen("templates");
      setNotice({ kind: "success", text: "Template saved to the cloud and available on your signed-in devices." });
    } catch {
      replaceCustomTemplates(customTemplatesRef.current.map((item) => item.id === pending.id ? { ...item, syncState: "error" } : item));
      setNotice({ kind: "error", text: "The template is safe on this device but could not reach the cloud. Try again when online." });
    } finally {
      setTemplateCloudBusy(false);
    }
  };

  const deleteLibraryTemplate = async (templateId: string) => {
    const target = customTemplatesRef.current.find((item) => item.id === templateId);
    if (!target || !window.confirm(`Delete “${target.name}” permanently? Existing project pages will keep their saved layout.`)) return;
    if (templateCloudConfigured && !templateUser && target.syncState !== "local") {
      setShowTemplateSignIn(true);
      setNotice({ kind: "info", text: "Sign in first so deletion is applied permanently to every device." });
      return;
    }
    const next = customTemplatesRef.current.filter((item) => item.id !== templateId);
    replaceCustomTemplates(next);
    if (templateUser && templateCloudConfigured) {
      try {
        await deleteCloudTemplate(templateId);
        setNotice({ kind: "success", text: "Template deleted. Existing project pages are unchanged." });
      } catch {
        replaceCustomTemplates([target, ...next]);
        setNotice({ kind: "error", text: "The cloud template could not be deleted, so it was restored." });
      }
    } else {
      setNotice({ kind: "success", text: "Local template deleted. Existing project pages are unchanged." });
    }
  };

  const requestTemplateMagicLink = async () => {
    const email = signInEmail.trim();
    if (!email) return;
    setTemplateCloudBusy(true);
    try {
      await sendTemplateMagicLink(email);
      setShowTemplateSignIn(false);
      setNotice({ kind: "success", text: `Sign-in link sent to ${email}. Open it on this device to finish.` });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "The sign-in link could not be sent." });
    } finally {
      setTemplateCloudBusy(false);
    }
  };

  const signOutTemplates = async () => {
    try {
      await signOutTemplateCloud();
      templateUserRef.current = null;
      setTemplateUser(null);
      setNotice({ kind: "success", text: "Signed out. Synced templates remain cached on this device." });
    } catch {
      setNotice({ kind: "error", text: "Could not sign out. Try again." });
    }
  };

  const beginNewProject = () => {
    persistActiveProject();
    clearExportItems();
    setActivePageId(null);
    setRearrangeMode(false);
    setScreen("format");
  };

  const goBack = () => {
    setRearrangeMode(false);
    if (screen === "template-format" || screen === "template-editor") {
      setTemplateDraft(null);
      setScreen("templates");
      return;
    }
    const nextScreen = getBackScreen(screen);
    if (nextScreen === "projects") {
      clearExportItems();
    }
    setScreen(nextScreen);
  };

  const openProjects = () => {
    setDraggingPageId(null);
    setRearrangeMode(false);
    clearExportItems();
    setScreen("projects");
  };

  const openStoredProject = async (id: string) => {
    const savedProjects = persistActiveProject();
    const stored = savedProjects.find((project) => project.id === id);
    if (!stored) return;
    if (projectId === id && formatId === stored.formatId) {
      setScreen("project");
      return;
    }
    setBusy("project");
    clearExportItems();
    try {
      const restoredPages = await hydrateProjectPages(stored);
      pagesRef.current.forEach(disposePagePreviews);
      pagesRef.current = restoredPages;
      const restoredActiveId = restoredPages.some((page) => page.id === stored.activePageId)
        ? stored.activePageId
        : restoredPages[0]?.id ?? null;
      setProjectId(stored.id);
      setProjectName(stored.name);
      setProjectCreatedAt(stored.createdAt);
      setProjectUpdatedAt(stored.updatedAt);
      setFormatId(stored.formatId);
      setPages(restoredPages);
      setActivePageId(restoredActiveId);
      setRearrangeMode(false);
      setScreen("project");
    } catch {
      setNotice({ kind: "error", text: "This project could not be opened. Its saved record is unchanged." });
    } finally {
      setBusy(null);
    }
  };

  const deleteProject = async (id: string) => {
    const savedProjects = persistActiveProject();
    const project = savedProjects.find((item) => item.id === id);
    if (!project || !window.confirm(`Delete “${project.name}” and all of its photographs permanently?`)) return;
    if (projectId === id) {
      await deleteAllProjectPhotos(pagesRef.current);
      pagesRef.current = [];
      setProjectId("");
      setProjectName("Untitled project");
      setProjectCreatedAt("");
      setProjectUpdatedAt("");
      setFormatId(null);
      setPages([]);
      setActivePageId(null);
    } else {
      await deleteStoredProjectPhotos(project);
    }
    const next = savedProjects.filter((item) => item.id !== id);
    setProjects(next);
    saveProjects(next);
    setNotice({ kind: "success", text: "Project deleted permanently." });
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
      setProjectUpdatedAt(now());
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
    setProjectUpdatedAt(now());
    if (activePageId === pageId) setActivePageId(null);
    setNotice({ kind: "success", text: "Page deleted." });
  };

  const movePage = (pageId: string, offset: -1 | 1) => {
    setPages((current) => moveProjectPageByOffset(current, pageId, offset));
    setProjectUpdatedAt(now());
  };

  const dragPageOver = (sourceId: string, targetId: string) => {
    setPages((current) => moveProjectPage(current, sourceId, targetId));
    setProjectUpdatedAt(now());
  };

  const exportPages = async (pageIds?: string[]) => {
    if (!format) return;
    const requestedPages = pageIds ? pages.filter((page) => pageIds.includes(page.id)) : pages;
    const selectedPages = pageIds
      ? requestedPages
      : requestedPages.filter((page) => isPageComplete(page, resolvePageTemplate(page)));
    if (!selectedPages.length) {
      setNotice({ kind: "error", text: pages.length ? "Complete at least one page before exporting." : "Add a page before exporting." });
      return;
    }
    const incomplete = pageIds ? selectedPages.find((page) => !isPageComplete(page, resolvePageTemplate(page))) : undefined;
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
          template: resolvePageTemplate(page),
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
        text: created.length === 1
          ? "JPEG ready — tap Save to Photos / Share to finish."
          : `${created.length} JPEGs ready in project order — tap Save all to Photos / Share to finish.`,
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
        projectCount={projects.length}
        onBack={goBack}
        onProjects={openProjects}
        onTemplates={openTemplates}
        onNew={screen === "templates" ? beginNewTemplate : beginNewProject}
        templatesSynced={templateLibrarySynced}
      />
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        multiple
        accept={LOCAL_PHOTO_SOURCE.accept}
        onChange={(event) => void receivePhotos(Array.from(event.target.files ?? []))}
      />

      {screen === "templates" ? (
        <main className="screen-shell max-w-[1180px] py-8 sm:py-12">
          <section className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="eyebrow">Reusable layouts</p>
              <h1 className="mt-2 text-[clamp(2.4rem,7vw,4.8rem)] font-medium leading-[0.95] tracking-[-0.055em]">Templates</h1>
              <p className="mt-4 max-w-[620px] text-sm leading-6 text-neutral-600">Build photo-frame layouts once, then use them in any project with the same format.</p>
            </div>
            <button className="primary-button" type="button" onClick={beginNewTemplate}>+ Create template</button>
          </section>

          <section className="account-banner mt-7" aria-label="Template cloud status">
            <div>
              <p className="text-sm font-semibold">
                {!templateCloudConfigured ? "Cloud connection required" : templateUser ? `Synced as ${templateUser.email ?? "your account"}` : "Sign in for permanent cross-device templates"}
              </p>
              <p className="mt-1 text-xs leading-5 text-neutral-500">
                {!templateCloudConfigured
                  ? "The editor works now, but Supabase must be connected before a template can sync to iPhone, iPad and desktop."
                  : templateUser
                    ? templateLibrarySynced ? "Every saved template is backed up to the cloud." : "Some local changes are waiting to sync."
                    : "Use the same email on every device. Drafts remain cached locally until you sign in."}
              </p>
            </div>
            {templateCloudConfigured ? (
              templateUser ? (
                <div className="flex gap-2">
                  <button className="secondary-button" type="button" disabled={templateCloudBusy} onClick={() => void manuallySyncTemplates()}>
                    {templateCloudBusy ? "Syncing…" : "Sync now"}
                  </button>
                  <button className="text-button" type="button" disabled={templateCloudBusy} onClick={() => void signOutTemplates()}>Sign out</button>
                </div>
              ) : <button className="secondary-button" type="button" onClick={() => setShowTemplateSignIn(true)}>Sign in by email</button>
            ) : <span className="template-status pending">Setup pending</span>}
          </section>

          <div className="mt-7 flex flex-wrap gap-2" aria-label="Filter templates by format">
            <button className={`nav-button ${templateFilter === "all" ? "active" : ""}`} type="button" onClick={() => setTemplateFilter("all")}>All</button>
            {FORMATS.map((item) => (
              <button key={item.id} className={`nav-button ${templateFilter === item.id ? "active" : ""}`} type="button" onClick={() => setTemplateFilter(item.id)}>{item.shortLabel}</button>
            ))}
          </div>

          <section className="mt-8" aria-labelledby="my-templates-heading">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="eyebrow">Cloud library</p>
                <h2 id="my-templates-heading" className="mt-2 text-2xl font-medium tracking-[-0.035em]">My templates</h2>
              </div>
              <span className="text-xs text-neutral-500">
                {customTemplates.filter((item) => item.status === "saved").length} saved · {customTemplates.filter((item) => item.status === "draft").length} drafts
              </span>
            </div>
            {customTemplates.filter((item) => templateFilter === "all" || item.formatId === templateFilter).length ? (
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
                {customTemplates.filter((item) => templateFilter === "all" || item.formatId === templateFilter).map((item) => (
                  <article key={item.id} className="template-library-card">
                    <button className="project-library-open" type="button" onClick={() => editLibraryTemplate(item)}>
                      <span className="template-preview" style={{ aspectRatio: `${item.canvasWidth}/${item.canvasHeight}` }}><TemplateThumbnail template={item} /></span>
                      <span className="block p-3 text-left">
                        <span className="block truncate text-sm font-semibold">{item.name}</span>
                        <span className="mt-1 block text-xs text-neutral-500">{getFormat(item.formatId).shortLabel} · {item.frames.length} frames</span>
                      </span>
                    </button>
                    <div className="flex items-center justify-between gap-2 px-3 pb-3">
                      <span className={`template-status ${item.syncState}`}>
                        {item.status === "draft" ? (item.syncState === "synced" ? "Cloud draft" : "Draft") : item.syncState === "synced" ? "Cloud saved" : item.syncState === "error" ? "Sync failed" : "Waiting to sync"}
                      </span>
                      <div className="flex gap-1">
                        <button className="card-action" type="button" onClick={() => duplicateLibraryTemplate(item)}>Copy</button>
                        <button className="card-action danger" type="button" onClick={() => void deleteLibraryTemplate(item.id)}>Delete</button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-[18px] border border-dashed border-black/15 bg-white/40 p-8 text-center">
                <p className="text-sm font-semibold">No custom templates in this view.</p>
                <button className="primary-button mt-4" type="button" onClick={beginNewTemplate}>Create your first template</button>
              </div>
            )}
          </section>

          <section className="mt-11" aria-labelledby="built-in-templates-heading">
            <p className="eyebrow">Scuri originals</p>
            <h2 id="built-in-templates-heading" className="mt-2 text-2xl font-medium tracking-[-0.035em]">Built-in templates</h2>
            <p className="mt-2 text-sm text-neutral-600">Edit or duplicate one to create your own copy. The original always stays available.</p>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
              {TEMPLATES.filter((item) => templateFilter === "all" || item.formatId === templateFilter).map((item) => (
                <article key={item.id} className="template-library-card">
                  <button className="project-library-open" type="button" onClick={() => editLibraryTemplate(item)}>
                    <span className="template-preview" style={{ aspectRatio: `${item.canvasWidth}/${item.canvasHeight}` }}><TemplateThumbnail template={item} /></span>
                    <span className="block p-3 text-left">
                      <span className="block truncate text-sm font-semibold">{item.name}</span>
                      <span className="mt-1 block text-xs text-neutral-500">{getFormat(item.formatId).shortLabel} · {item.frames.length} frames</span>
                    </span>
                  </button>
                  <div className="grid grid-cols-2 gap-2 px-3 pb-3">
                    <button className="card-action" type="button" onClick={() => editLibraryTemplate(item)}>Edit copy</button>
                    <button className="card-action" type="button" onClick={() => duplicateLibraryTemplate(item)}>Duplicate</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </main>
      ) : null}

      {screen === "template-format" ? (
        <main className="screen-shell max-w-[1040px]">
          <section className="pt-9 sm:pt-14">
            <p className="eyebrow">New template</p>
            <h1 className="mt-3 max-w-[720px] text-[clamp(2.2rem,7vw,4.6rem)] font-medium leading-[0.95] tracking-[-0.055em]">Choose the canvas format.</h1>
            <p className="mt-5 max-w-[570px] text-[15px] leading-6 text-neutral-600">The format stays fixed after you add the first frame. The layout can then be reused in matching projects.</p>
          </section>
          <section className="mt-9 grid gap-3 pb-12 sm:mt-12 sm:grid-cols-3" aria-label="Template formats">
            {formatCards.map((item) => (
              <button key={item.id} className="format-card group" type="button" onClick={() => selectTemplateFormat(item.id)}>
                <span className="format-ratio" style={{ aspectRatio: `${item.width}/${item.height}`, width: item.id === "instagram-story" ? 44 : 58 }} aria-hidden="true" />
                <span className="min-w-0 flex-1 text-left">
                  <span className="block text-lg font-semibold tracking-[-0.025em]">{item.name}</span>
                  <span className="mt-1 block text-sm text-neutral-500">{item.aspectRatio}</span>
                </span>
                <span className="text-xl" aria-hidden="true">→</span>
              </button>
            ))}
          </section>
        </main>
      ) : null}

      {screen === "template-editor" && templateDraft ? (
        <TemplateDesigner
          key={templateDraft.id}
          initialTemplate={templateDraft}
          saving={templateCloudBusy}
          onCancel={() => {
            setTemplateDraft(null);
            setScreen("templates");
          }}
          onDraftChange={saveTemplateDraftLocally}
          onSave={(draft) => void saveDesignedTemplate(draft)}
        />
      ) : null}

      {screen === "projects" ? (
        <main className="screen-shell max-w-[1120px] py-8 sm:py-12">
          <section className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="eyebrow">Your workspace</p>
              <h1 className="mt-2 text-[clamp(2.4rem,7vw,4.8rem)] font-medium leading-[0.95] tracking-[-0.055em]">Projects</h1>
              <p className="mt-4 max-w-[560px] text-sm leading-6 text-neutral-600">Open a project to edit, reorder and export its pages. Everything stays privately on this device.</p>
            </div>
            <button className="primary-button" type="button" onClick={beginNewProject}>+ New project</button>
          </section>

          {projects.length ? (
            <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Saved projects">
              {sortProjectsByLastEdited(projects).map((project) => (
                <ProjectLibraryCard
                  key={project.id}
                  format={getFormat(project.formatId)}
                  project={project}
                  onOpen={(id) => void openStoredProject(id)}
                  onDelete={(id) => void deleteProject(id)}
                />
              ))}
            </section>
          ) : (
            <section className="project-empty mt-9">
              <div className="empty-page-stack" aria-hidden="true"><span /><span /><span /></div>
              <h2 className="mt-6 text-2xl font-medium tracking-[-0.035em]">No projects yet.</h2>
              <p className="mt-2 max-w-[420px] text-sm leading-6 text-neutral-600">Create a project, choose one Instagram format, then build its pages.</p>
              <button className="primary-button mt-5" type="button" onClick={beginNewProject}>Create first project</button>
            </section>
          )}
          <button className="mt-8 text-sm font-medium underline decoration-neutral-300 underline-offset-4" type="button" onClick={() => setShowInstallHelp(true)}>
            Install on iPhone or iPad
          </button>
        </main>
      ) : null}

      {screen === "format" ? (
        <main className="screen-shell max-w-[920px]">
          <section className="pt-9 sm:pt-14">
            <p className="eyebrow">New project</p>
            <h1 className="mt-3 max-w-[680px] text-[clamp(2.2rem,7vw,4.6rem)] font-medium leading-[0.95] tracking-[-0.055em]">
              Choose one format for this project.
            </h1>
            <p className="mt-5 max-w-[560px] text-[15px] leading-6 text-neutral-600 sm:text-base">
              Every page in the project will use this Instagram format. You can start adding layouts from the empty project page next.
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
                onChange={(event) => {
                  setProjectName(event.target.value);
                  setProjectUpdatedAt(now());
                }}
                onBlur={() => {
                  if (projectName.trim()) return;
                  setProjectName(getDefaultProjectName(projects.filter((project) => project.id !== projectId).map((project) => project.name)));
                  setProjectUpdatedAt(now());
                }}
              />
              <p className="mt-2 text-sm text-neutral-600">
                {pages.length ? `${completePageCount} of ${pages.length} ready to export` : "Choose a layout to add your first page."}
              </p>
            </div>
            <div className="grid w-full gap-2 sm:w-auto sm:min-w-[210px]">
              <button className="primary-button" type="button" disabled={!completePageCount || busy !== null} onClick={() => void exportPages()}>
                {!pages.length ? "Add a page first" : !completePageCount ? "Complete a page to export" : `Export all ${completePageCount}`}
              </button>
              <button className="secondary-button" type="button" disabled={pages.length >= MAX_PROJECT_PAGES || busy !== null} onClick={addPage}>+ Add page</button>
            </div>
          </section>

          {incompletePageCount > 0 && completePageCount > 0 ? (
            <p className="mt-3 text-right text-xs text-neutral-500">Export all will skip {incompletePageCount} unfinished {incompletePageCount === 1 ? "page" : "pages"}.</p>
          ) : null}

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
                    template={resolvePageTemplate(page)}
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

      {showTemplateSignIn ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowTemplateSignIn(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="template-sign-in-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="eyebrow">Cross-device templates</p>
                <h2 id="template-sign-in-title" className="mt-2 text-2xl font-medium tracking-[-0.035em]">Sign in by email</h2>
              </div>
              <button className="icon-button" type="button" aria-label="Close sign-in" onClick={() => setShowTemplateSignIn(false)}>×</button>
            </div>
            <p className="mt-4 text-sm leading-6 text-neutral-600">We’ll email you a secure sign-in link. Use the same address on your iPhone, iPad and desktop.</p>
            <label className="control-label mt-5 block" htmlFor="template-email">Email address</label>
            <input
              id="template-email"
              className="mt-2 min-h-[48px] w-full rounded-xl border border-black/15 bg-white px-3"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={signInEmail}
              onChange={(event) => setSignInEmail(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void requestTemplateMagicLink();
              }}
            />
            <button className="primary-button mt-4 w-full" type="button" disabled={!signInEmail.trim() || templateCloudBusy} onClick={() => void requestTemplateMagicLink()}>
              {templateCloudBusy ? "Sending link…" : "Email me a sign-in link"}
            </button>
            <p className="mt-4 text-xs leading-5 text-neutral-500">Projects and photographs remain on this device in the templates-first release.</p>
          </section>
        </div>
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
            {busy === "project" ? "Opening project…" : busy === "image" ? "Preparing photos…" : busy === "duplicate" ? "Duplicating page…" : exportProgress ? `Creating image ${exportProgress.current} of ${exportProgress.total}…` : "Preparing download…"}
          </span>
        </div>
      ) : null}
    </div>
  );
}
