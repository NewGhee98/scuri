"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { User } from "@supabase/supabase-js";
import { PRODUCT } from "@/config/product";
import { DEFAULT_CROP, minimumPhotoZoom, resolveFrames, setCropZoom } from "@/lib/crop";
import { snapPhotoZoom, type AlignmentGuide } from "@/lib/editor-alignment";
import { movePageFrame, reorderPageFrame } from "@/lib/page-frames";
import { consolidateLibraryDuplicates, type DuplicateGroup, type DuplicateScan } from "@/lib/photo-duplicates";
import { PhotoZoomControl } from "./photo-zoom-control";
import { PagePreview } from "./page-preview";
import { PhotoPreviewContext } from "./photo-preview-context";
import { displayPagePhotos, EMPTY_PHOTO_PREVIEWS, PhotoPreviewCache } from "@/lib/photo-preview-cache";
import { createExportFilename, createExportZip, renderComposition } from "@/lib/export";
import type { ExportSize } from "@/lib/export-settings";
import { FORMATS, getFormat } from "@/lib/formats";
import Script from "next/script";
import { createPhotoPreview, disposePhotoAsset, validateImageFile } from "@/lib/image";
import {
  ensureProjectDriveFolders,
  isGoogleDriveConfigured,
  requestGoogleDriveAccessToken,
  revokeGoogleDriveAccess,
  uploadExportsToGoogleDrive,
  type DriveSyncProgress,
} from "@/lib/google-drive";
import { PhotoImportQueue, type PhotoImportSource, type PhotoImportItem } from "@/lib/photo-import-queue";
import { PhotoAnalysisClient } from "@/lib/photo-analysis-client";
import { fingerprintOriginal } from "@/lib/photo-fingerprint";
import { fingerprintCacheKey } from "@/lib/photo-duplicates";
import { previewStorageKey } from "@/lib/photo-preview-cache";
import { clearDerivedCache, listPhotoJobs, removePhotoJob, writePhotoJob, writeDerived } from "@/lib/photo-cache-storage";
import { openPhotoPicker, placeLibraryPhoto, type PhotoPickerIntent } from "@/lib/photo-picker";
import { clearLibraryViews } from "@/lib/photo-library-view";
import { photosImportConfigured } from "@/lib/google-photo-import";
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
  setTemplateCloudPassword,
  signInTemplateWithPassword,
  signOutTemplateCloud,
} from "@/lib/custom-templates";
import {
  MAX_PROJECT_PAGES,
  getDefaultProjectName,
  getBackScreen,
  getMissingPhotoCount,
  isPageComplete,
  isPageAssigned,
  moveProjectPage,
  moveProjectPageByOffset,
  sortProjectsByLastEdited,
} from "@/lib/project";
import {
  loadPhotoBlob,
  loadProjects,
  savePhotoBlob,
  saveProjects,
} from "@/lib/storage";
import {
  acknowledgeProjectPush,
  getProjectBackupCounts,
  getProjectCloudUser,
  getProjectSyncStatus,
  isProjectCloudConfigured,
  isProjectDirty,
  mergeCloudProjectLibrary,
  projectHasUnbackedAssets,
  pullProjectsFromCloud,
  pushProjectToCloud,
  resolveProjectConflict,
  reconcileProtectedProject,
  softDeleteCloudProject,
} from "@/lib/project-sync";
import { applyHydratedPhotos, hydrateProjectPhotos, movePagePhoto, reconcileProjectPages, recordPhotoDeletions, removePagePhoto, serializePage, updatePagePhotoCrop } from "@/lib/project-photos";
import { ProjectSyncQueue } from "@/lib/sync-queue";
import { applyPhotoBackupCheckpoint } from "@/lib/photo-backup";
import { backUpProjectPhotos, type PhotoBackupStatus } from "@/lib/project-photo-backup";
import { WorkspaceSession, workspaceKey } from "@/lib/workspace";
import { ProjectHistory, projectContentKey } from "@/lib/project-history";
import { nextProjectEditTime } from "@/lib/project-time";
import { createProjectBackup, inspectProjectBackup, materializeProjectBackup, type ProjectBackupPreview } from "@/lib/project-backup";
import { BackupReview } from "./backup-review";
import { ProjectPhotoPanel } from "./project-photo-panel";
import { ActionDialog } from "./action-dialog";
import { getProjectPhotos, mergePhotoLibraries, projectPhotoGroups } from "@/lib/project-photo-library";
import { applyArrangementAsCopy, type ArrangementProposal } from "@/lib/arrangements";
import { DEFAULT_TEMPLATE_FILTERS, filterTemplates, getTemplate, getTemplatesForFormat, TEMPLATES, type TemplateLibraryFilters } from "@/lib/templates";
import type {
  AppScreen,
  CropState,
  CustomTemplate,
  FormatId,
  PhotoAsset,
  ProjectPage,
  ProjectPhoto,
  StoredProject,
  TemplateDefinition,
} from "@/lib/types";
import type { TemplateSyncSummary } from "@/lib/custom-templates";
import { EditorCanvas } from "./editor-canvas";
import { ProjectLibraryCard } from "./project-library-card";
import { ProjectPageCard } from "./project-page-card";
import { TemplateThumbnail } from "./template-thumbnail";
import { TemplateDesigner } from "./template-designer";
import { TemplateFilterControls } from "./template-filter-controls";

type Notice = { kind: "error" | "success" | "info"; text: string } | null;
type BusyState = "image" | "export" | "duplicate" | "project" | "drive" | "backup" | null;
type ExportItem = { pageId: string; pageNumber: number; blob: Blob; url: string; filename: string; size: ExportSize };
type TemplatePickerIntent = { projectId: string } & ({ kind: "add" } | { kind: "replace"; pageId: string });

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
            <span className="brand-mark" aria-hidden="true">S</span>
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

export function LayoutsApp() {
  const [screen, setScreenState] = useState<AppScreen>("projects");
  const [pageTemplateFilters, setPageTemplateFilters] = useState<TemplateLibraryFilters>(DEFAULT_TEMPLATE_FILTERS);
  // Navigation selection can change during sync. It must never decide whether
  // choosing a template appends a page or deliberately replaces one.
  const [templatePickerIntent, setTemplatePickerIntent] = useState<TemplatePickerIntent | null>(null);
  const templatePickerRef = useRef<TemplatePickerIntent | null>(null);
  const setTemplatePicker = useCallback((intent: TemplatePickerIntent | null) => {
    templatePickerRef.current = intent;
    setTemplatePickerIntent(intent);
    if (intent) setPageTemplateFilters(DEFAULT_TEMPLATE_FILTERS);
  }, []);
  const [photoPickerIntent, setPhotoPickerIntent] = useState<PhotoPickerIntent | null>(null);
  const photoPickerRef = useRef<PhotoPickerIntent | null>(null);
  const photoPickerWorkspaceRef = useRef<(() => boolean) | null>(null);
  const [showPhotoLibrary, setShowPhotoLibrary] = useState(false);
  const [choosePhotoSource, setChoosePhotoSource] = useState(false);
  const [initiallyImport, setInitiallyImport] = useState(false);
  const [selectExportPages, setSelectExportPages] = useState(false);
  const [selectedExportIds, setSelectedExportIds] = useState<string[]>([]);
  const setScreen = useCallback((next: AppScreen) => {
    // Invalidate immediately, including a second click before React rerenders.
    if (next !== "template") setTemplatePicker(null);
    photoPickerRef.current = null; setPhotoPickerIntent(null); setShowPhotoLibrary(false); setChoosePhotoSource(false); setSelectExportPages(false);
    setScreenState(next);
  }, [setTemplatePicker]);
  const [projects, setProjects] = useState<StoredProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [projectName, setProjectName] = useState("Untitled project");
  const [projectCreatedAt, setProjectCreatedAt] = useState("");
  const [projectUpdatedAt, setProjectUpdatedAt] = useState("");
  const [formatId, setFormatId] = useState<FormatId | null>(null);
  const [pages, setPages] = useState<ProjectPage[]>([]);
  const [projectPhotoLibrary, setProjectPhotoLibrary] = useState<ProjectPhoto[]>([]);
  const [pendingDeletions, setPendingDeletions] = useState<StoredProject["pendingDeletions"]>();
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<BusyState>(null);
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number } | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [backupPreview, setBackupPreview] = useState<ProjectBackupPreview | null>(null);
  const [historyState, setHistoryState] = useState({ undo: false, redo: false });
  const [deletedProjects, setDeletedProjects] = useState<StoredProject[]>([]);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const [exportItems, setExportItems] = useState<ExportItem[]>([]);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [draggingPageId, setDraggingPageId] = useState<string | null>(null);
  const [rearrangeMode, setRearrangeMode] = useState(false);
  const [moveFrameMode, setMoveFrameMode] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [compositionGuides, setCompositionGuides] = useState(true);
  // Selection is editing UI, not a saved page edit. Keep old saved selections
  // as the initial fallback without rewriting them when the user changes focus.
  const [editorSelectedFrameId, setEditorSelectedFrameId] = useState<string | null>(null);
  const [photoPreviews] = useState(() => new PhotoPreviewCache());
  const previewSnapshot = useSyncExternalStore(photoPreviews.subscribe, photoPreviews.getSnapshot, () => EMPTY_PHOTO_PREVIEWS);
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([]);
  const [editorWidth, setEditorWidth] = useState(320);
  const [showPagePreview, setShowPagePreview] = useState(false);
  const [exportReviewIds, setExportReviewIds] = useState<string[] | null>(null);
  // Session-only output choice, deliberately excluded from saved project state.
  const [exportWidth, setExportWidth] = useState(1080);
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>([]);
  const [templateDraft, setTemplateDraft] = useState<CustomTemplate | null>(null);
  const [templateFilters, setTemplateFilters] = useState<TemplateLibraryFilters>(DEFAULT_TEMPLATE_FILTERS);
  const [templateUser, setTemplateUser] = useState<User | null>(null);
  const [templateAuthReady, setTemplateAuthReady] = useState(() => !isTemplateCloudConfigured());
  const [templateCloudBusy, setTemplateCloudBusy] = useState(false);
  const [showTemplateSignIn, setShowTemplateSignIn] = useState(false);
  const [showPasswordSetup, setShowPasswordSetup] = useState(false);
  const [signInMethod, setSignInMethod] = useState<"magic-link" | "password">("magic-link");
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const importQueueRef = useRef<PhotoImportQueue | null>(null);
  const [importItems, setImportItems] = useState<readonly PhotoImportItem[]>([]);
  const exportHeadingRef = useRef<HTMLHeadingElement>(null);
  const pagesRef = useRef(pages);
  const exportItemsRef = useRef(exportItems);
  const customTemplatesRef = useRef(customTemplates);
  const templateUserRef = useRef<User | null>(null);
  const templateSyncTimersRef = useRef(new Map<string, number>());

  // --- Project cloud sync (Supabase = source of truth) + Drive asset backup ---
  const [googleScriptReady, setGoogleScriptReady] = useState(false);
  const [driveAccessToken, setDriveAccessToken] = useState<string | null>(null);
  const [driveProgress, setDriveProgress] = useState<DriveSyncProgress | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [projectSyncErrors, setProjectSyncErrors] = useState<Record<string, boolean>>({});
  const [syncingProjectIds, setSyncingProjectIds] = useState<Record<string, boolean>>({});
  const driveAccessTokenRef = useRef<string | null>(null);
  const driveTokenExpiresAtRef = useRef(0);
  const projectsRef = useRef<StoredProject[]>([]);
  const activeProjectRef = useRef<StoredProject | null>(null);
  const projectPushInFlightRef = useRef(new Set<string>());
  const syncQueueRef = useRef<ProjectSyncQueue | null>(null);
  const backupQueueRef = useRef<ProjectSyncQueue | null>(null);
  const [photoBackupStatus, setPhotoBackupStatus] = useState<Record<string, PhotoBackupStatus>>({});
  const pendingPullRef = useRef(false);
  const workspaceRef = useRef(new WorkspaceSession());
  const initializedWorkspaceRef = useRef(false);
  const retainedPhotosRef = useRef(new Map<string, PhotoAsset>());
  const volatileBlobsRef = useRef(new Map<string, Map<string, Blob>>());
  const historyRef = useRef(new ProjectHistory());
  const historyGroupRef = useRef<string | undefined>(undefined);
  const [driveExpiry, setDriveExpiry] = useState(0);

  const format = formatId ? getFormat(formatId) : null;
  const templates = useMemo(() => formatId ? getTemplatesForFormat(formatId, customTemplates) : [], [formatId, customTemplates]);
  const filteredPageTemplates = useMemo(
    () => filterTemplates(templates, { ...pageTemplateFilters, formatId: formatId ?? "all" }),
    [templates, pageTemplateFilters, formatId],
  );
  const filteredCustomTemplates = useMemo(() => filterTemplates(customTemplates, templateFilters), [customTemplates, templateFilters]);
  const filteredBuiltInTemplates = useMemo(() => filterTemplates(TEMPLATES, templateFilters), [templateFilters]);
  const activePage = pages.find((page) => page.id === activePageId) ?? null;
  const previewPages = exportReviewIds ? pages.filter(page => exportReviewIds.includes(page.id)) : pages;
  const pickerPage = templatePickerIntent?.kind === "replace" && templatePickerIntent.projectId === projectId
    ? pages.find(page => page.id === templatePickerIntent.pageId) ?? null : null;
  const resolvePageTemplate = useCallback((page: Pick<ProjectPage, "templateId" | "templateSnapshot">): TemplateDefinition => (
    page.templateSnapshot ?? getTemplate(page.templateId, customTemplates)
  ), [customTemplates]);
  const template = activePage ? resolvePageTemplate(activePage) : null;
  const selectedFrameId = editorSelectedFrameId && template?.frames.some(frame => frame.id === editorSelectedFrameId)
    ? editorSelectedFrameId : activePage?.selectedFrameId ?? null;
  const libraryPhotos = getProjectPhotos({ photoLibrary: projectPhotoLibrary, pages: pages.map(serializePage) });
  const assignedPhotos = pages.flatMap(page => Object.values(serializePage(page).photos));
  const backedUpOriginalCount = libraryPhotos.filter(photo => photo.driveOriginalId).length;
  const backedUpPreviewCount = libraryPhotos.filter(photo => photo.drivePreviewId).length;
  const displayedPhotos = displayPagePhotos(activePage, previewSnapshot);
  const selectedPhoto = selectedFrameId ? displayedPhotos[selectedFrameId] : undefined;
  const selectedResolvedFrame = template && format && activePage ? resolveFrames(template, activePage.gutter, format.width, format.height).find(frame => frame.id === selectedFrameId) : undefined;
  const selectedStoredPhoto = activePage && selectedFrameId ? serializePage(activePage).photos[selectedFrameId] : undefined;
  const editorContext = `${projectId}:${activePageId}:${screen}`;
  const [previousEditorContext, setPreviousEditorContext] = useState(editorContext);
  if (previousEditorContext !== editorContext) {
    setPreviousEditorContext(editorContext); setAlignmentGuides([]); setMoveFrameMode(false); setShowPagePreview(false);
    setEditorSelectedFrameId(null);
  }
  const unavailablePhotoCount = pages.reduce((count, page) => count + Object.keys(page.unavailablePhotos ?? {}).length, 0);
  const missingPhotoCount = activePage && template ? getMissingPhotoCount(serializePage(activePage), template) : 0;
  const missingEditorPreviews = activePage ? Object.values(activePage.unavailablePhotos ?? {}).filter(photo => !previewSnapshot.has(photo.blobKey)).length : 0;
  const completePageCount = pages.reduce((count, page) => count + (isPageAssigned(page, resolvePageTemplate(page)) ? 1 : 0), 0);
  const incompletePageCount = pages.length - completePageCount;
  const hasAnyPhotos = libraryPhotos.length > 0;
  const templateCloudConfigured = isTemplateCloudConfigured();
  const templateLibrarySynced = Boolean(templateUser) && customTemplates.every((item) => item.syncState === "synced");
  // Projects and templates deliberately share one sign-in (see src/lib/supabase-client.ts).
  const projectCloudConfigured = isProjectCloudConfigured();
  const projectCloudSignedIn = Boolean(templateUser);
  const driveConfigured = isGoogleDriveConfigured();
  // Expiry is checked where it matters (getValidDriveToken, called from
  // event handlers/effects); render only reflects whether a token was
  // obtained, to keep this component pure.
  const driveConnected = Boolean(driveAccessToken && driveExpiry > 0);
  const driveRestorePreferenceKey = workspaceKey("scuri-google-drive-restore", templateUser?.id);

  const saveWorkspaceProjects = useCallback((next: StoredProject[], ownerId = workspaceRef.current.ownerId) => {
    try { saveProjects(next, ownerId); }
    catch (error) {
      setStorageError(error instanceof Error ? error.message : "This browser could not save the project. Download a backup before closing it.");
      throw error;
    }
  }, []);

  const getVolatileBlob = useCallback((key: string): Blob | undefined => (
    retainedPhotosRef.current.get(key)?.sourceBlob ?? volatileBlobsRef.current.get(workspaceRef.current.ownerId ?? "local")?.get(key)
  ), []);

  const retainVolatileForOwner = useCallback((ownerId: string | null, key: string, blob: Blob) => {
    const owner = ownerId ?? "local";
    const blobs = volatileBlobsRef.current.get(owner) ?? new Map<string, Blob>();
    blobs.set(key, blob);
    volatileBlobsRef.current.set(owner, blobs);
  }, []);

  const getValidDriveToken = useCallback((): string | null => {
    if (!driveAccessTokenRef.current || driveTokenExpiresAtRef.current <= Date.now() + 30_000) return null;
    return driveAccessTokenRef.current;
  }, []);

  const replaceCustomTemplates = useCallback((next: CustomTemplate[]) => {
    const sorted = [...next].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    customTemplatesRef.current = sorted;
    setCustomTemplates(sorted);
    cacheCustomTemplates(sorted, workspaceRef.current.ownerId);
  }, []);

  const syncTemplateCloud = useCallback(async (): Promise<TemplateSyncSummary | null> => {
    if (!isTemplateCloudConfigured()) return null;
    const isCurrent = workspaceRef.current.capture();
    const user = await getTemplateCloudUser();
    if (!isCurrent() || !user || user.id !== workspaceRef.current.ownerId) return null;
    const local = customTemplatesRef.current;
    const remote = await loadCloudTemplates();
    if (!isCurrent()) return null;
    const plan = createTemplateSyncPlan(local, remote);
    let merged = plan.templates;
    let uploaded = 0;
    let failed = 0;
    for (const template of plan.uploads) {
      if (!isCurrent()) return null;
      try {
        const saved = await saveCloudTemplate({ ...template, syncState: "pending" }, { ownerId: user.id, isCurrent });
        merged = merged.map((item) => item.id === saved.id ? saved : item);
        uploaded += 1;
      } catch {
        merged = merged.map((item) => item.id === template.id ? { ...item, syncState: "error" } : item);
        failed += 1;
      }
    }
    if (!isCurrent()) return null;
    // Don't replace drafts edited while this pull/upload was in flight.
    const starting = new Map(local.map(item => [item.id, item]));
    for (const current of customTemplatesRef.current) {
      if (starting.get(current.id) !== current) merged = [current, ...merged.filter(item => item.id !== current.id)];
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

  const connectGoogleDrive = async () => {
    const isCurrent = workspaceRef.current.capture();
    if (!isGoogleDriveConfigured()) {
      setNotice({ kind: "error", text: "Add the Google Drive client ID before connecting Scuri." });
      return;
    }
    if (!googleScriptReady) {
      setNotice({ kind: "info", text: "Google sign-in is still loading. Try again in a moment." });
      return;
    }
    setBusy("drive");
    try {
      const token = await requestGoogleDriveAccessToken(driveAccessTokenRef.current ? "" : "consent");
      if (!isCurrent()) return;
      driveAccessTokenRef.current = token.accessToken;
      driveTokenExpiresAtRef.current = token.expiresAt;
      setDriveAccessToken(token.accessToken);
      setDriveExpiry(token.expiresAt);
      window.localStorage.setItem(driveRestorePreferenceKey, "true");
      setNotice({ kind: "success", text: templateUserRef.current ? "Google Drive connected. Original photos will back up automatically." : "Google Drive connected for loading local photos. Sign in to back up account projects automatically." });
      const current = persistActiveProject().find((item) => item.id === projectId);
      if (current) { syncQueueRef.current?.enqueue(current.id, current.updatedAt, true); backupQueueRef.current?.enqueue(current.id, current.updatedAt, true); }
    } catch (error) {
      if (!isCurrent()) return;
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Google Drive could not be connected." });
    } finally {
      if (isCurrent()) setBusy(null);
    }
  };

  const disconnectGoogleDrive = async () => {
    const token = driveAccessTokenRef.current;
    driveAccessTokenRef.current = null;
    driveTokenExpiresAtRef.current = 0;
    setDriveExpiry(0);
    setDriveAccessToken(null);
    window.localStorage.removeItem(driveRestorePreferenceKey);
    if (token) await revokeGoogleDriveAccess(token);
    setNotice({ kind: "success", text: "Google Drive disconnected from this device. Existing backups are unchanged." });
  };

  const syncCurrentProjectNow = async () => {
    const current = persistActiveProject().find((item) => item.id === projectId);
    if (!current) return;
    if (!templateUserRef.current) {
      setNotice({ kind: "info", text: "Sign in to back up this project across your devices." });
      return;
    }
    syncQueueRef.current?.enqueue(current.id, current.updatedAt, true);
    backupQueueRef.current?.enqueue(current.id, current.updatedAt, true);
  };

  const saveTemplateDraftLocally = useCallback((draft: CustomTemplate) => {
    const isCurrent = workspaceRef.current.capture();
    const ownerId = workspaceRef.current.ownerId;
    const nextDraft = {
      ...draft,
      syncState: draft.syncState === "synced" ? "pending" as const : draft.syncState,
    };
    const next = [nextDraft, ...customTemplatesRef.current.filter((item) => item.id !== nextDraft.id)];
    replaceCustomTemplates(next);
    setTemplateDraft(nextDraft);
    const existingTimer = templateSyncTimersRef.current.get(nextDraft.id);
    if (existingTimer) window.clearTimeout(existingTimer);
    if (isTemplateCloudConfigured() && templateUserRef.current && ownerId) {
      const timer = window.setTimeout(() => {
        if (!isCurrent()) return;
        templateSyncTimersRef.current.delete(nextDraft.id);
        void saveCloudTemplate({ ...nextDraft, syncState: "pending" }, { ownerId, isCurrent }).then((saved) => {
          if (!isCurrent()) return;
          const current = customTemplatesRef.current.find((item) => item.id === saved.id);
          if (!current || current.updatedAt !== saved.updatedAt || current.status !== saved.status) return;
          replaceCustomTemplates([saved, ...customTemplatesRef.current.filter((item) => item.id !== saved.id)]);
        }).catch(() => {
          if (!isCurrent()) return;
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

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useEffect(() => {
    const updateOnlineStatus = () => setIsOnline(navigator.onLine);
    updateOnlineStatus();
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
  }, []);

  const clearExportItems = () => {
    for (const item of exportItemsRef.current) URL.revokeObjectURL(item.url);
    exportItemsRef.current = [];
    setExportItems([]);
  };

  const disposePagePreviews = (page: ProjectPage) => {
    Object.values(page.photos).forEach(disposePhotoAsset);
  };

  const retainPagePhotos = (page: ProjectPage) => {
    for (const photo of Object.values(page.photos)) retainedPhotosRef.current.set(photo.blobKey, photo);
  };

  // Library and active editor must adopt the same metadata in one synchronous
  // step. Bytes hydrate later and cannot create a transient empty project.
  const adoptActiveProject = useCallback((project: StoredProject | null, keepHistory = false) => {
    if (project) project = { ...project, photoLibrary: getProjectPhotos(project) };
    const previous = activeProjectRef.current;
    const sameProject = project?.id === previous?.id;
    if (!sameProject) {
      photoPickerRef.current = null; setPhotoPickerIntent(null); setShowPhotoLibrary(false); setSelectedExportIds([]);
      setExportWidth(project ? getFormat(project.formatId).width : 1080);
      setExportReviewIds(null);
      if (templatePickerRef.current) setScreen(project ? "project" : "projects");
      const urls = new Map([...retainedPhotosRef.current.values(), ...pagesRef.current.flatMap(page => Object.values(page.photos))].map(photo => [photo.previewUrl, photo]));
      urls.forEach(disposePhotoAsset);
      retainedPhotosRef.current.clear();
    } else {
      pagesRef.current.forEach(page => Object.values(page.photos).forEach(photo => retainedPhotosRef.current.set(photo.blobKey, photo)));
    }
    const cacheBase = pagesRef.current[0] ?? project?.pages[0];
    const cachePages = sameProject && cacheBase ? [{ ...cacheBase, photos: Object.fromEntries([...retainedPhotosRef.current].map(([key, photo]) => [key, photo])) }] : [];
    const restored = project ? reconcileProjectPages(project, cachePages) : [];
    if (!project || !sameProject || (!keepHistory && previous && projectContentKey(project) !== projectContentKey(previous))) {
      historyRef.current.reset(project ?? undefined);
      setHistoryState({ undo: false, redo: false });
    }
    pagesRef.current = restored;
    activeProjectRef.current = project;
    setPages(restored);
    setProjectPhotoLibrary(project?.photoLibrary ?? []);
    setPendingDeletions(project?.pendingDeletions);
    setProjectId(project?.id ?? "");
    setProjectName(project?.name ?? "Untitled project");
    setProjectCreatedAt(project?.createdAt ?? "");
    setProjectUpdatedAt(project?.updatedAt ?? "");
    setFormatId(project?.formatId ?? null);
    setActivePageId(restored.some((page) => page.id === project?.activePageId) ? project!.activePageId : restored[0]?.id ?? null);
    if (!project) setScreen("projects");
  }, [setScreen]);

  const syncProjectsFromCloud = useCallback(async (): Promise<void> => {
    if (!isProjectCloudConfigured()) return;
    // Never query project tables as the anon role. The migration intentionally
    // revokes anon privileges, so doing so produces a permission error (and,
    // more importantly, an empty remote library must never be interpreted as
    // "everything was deleted" while the user is signed out).
    const isCurrent = workspaceRef.current.capture();
    const user = await getProjectCloudUser();
    if (!isCurrent() || !user || user.id !== workspaceRef.current.ownerId) return;
    try {
      const remote = await pullProjectsFromCloud();
      if (!isCurrent()) return;
      if (projectPushInFlightRef.current.size) { pendingPullRef.current = true; return; }
      const active = activeProjectRef.current;
      const localSnapshot = active ? [...projectsRef.current.filter((item) => item.id !== active.id), active] : projectsRef.current;
      const { projects: merged, metadataRecoveredIds } = mergeCloudProjectLibrary(localSnapshot, remote, () => crypto.randomUUID());
      if (metadataRecoveredIds.length) setNotice({ kind: "info", text: "Library details restored from this device. Reload Scuri on other devices before editing; older versions can omit newer library settings." });
      const sorted = sortProjectsByLastEdited(merged);
      projectsRef.current = sorted;
      setProjects(sorted);
      saveWorkspaceProjects(sorted, user.id);
      if (active) {
        const reconciled = sorted.find((item) => item.id === active.id) ?? null;
        if (reconciled !== active) adoptActiveProject(reconciled);
      }
    } catch {
      if (!isCurrent()) return;
      setNotice({ kind: "error", text: "Cloud projects could not be loaded. Your local projects are unchanged." });
    }
  }, [adoptActiveProject, saveWorkspaceProjects]);

  const pushProjectNow = useCallback(async (project: StoredProject): Promise<boolean> => {
    const ownerId = workspaceRef.current.ownerId;
    if (!isProjectCloudConfigured() || !ownerId || !templateUserRef.current) return true;
    const sameWorkspace = workspaceRef.current.capture();
    const queue = syncQueueRef.current;
    const isCurrent = () => sameWorkspace() && !queue?.isBlocked(project.id);
    if (!isCurrent()) return true;
    projectPushInFlightRef.current.add(project.id);
    setSyncingProjectIds(current => ({ ...current, [project.id]: true }));
    const working = project;
    try {
      // No need to bump a cloud revision solely because bytes remain unavailable.
      if (!isProjectDirty(working)) {
        setProjectSyncErrors(current => ({ ...current, [project.id]: false }));
        return true;
      }
      const result = await pushProjectToCloud(working, { ownerId, isCurrent });
      if (!isCurrent()) return true;
      const latest = activeProjectRef.current?.id === working.id ? activeProjectRef.current : projectsRef.current.find(item => item.id === working.id);
      if (!latest) return true;
      if ("assetProtection" in result) {
        const { canonical, copy } = reconcileProtectedProject(latest, result.remote, crypto.randomUUID());
        const next = sortProjectsByLastEdited([...projectsRef.current.filter(item => item.id !== working.id), canonical, ...(copy ? [copy] : [])]);
        // Copy runtime-only originals before changing the active project.
        for (const photo of retainedPhotosRef.current.values()) retainVolatileForOwner(ownerId, photo.blobKey, photo.sourceBlob);
        for (const page of pagesRef.current) for (const photo of Object.values(page.photos)) retainVolatileForOwner(ownerId, photo.blobKey, photo.sourceBlob);
        saveWorkspaceProjects(next, ownerId);
        projectsRef.current = next;
        setProjects(next);
        if (activeProjectRef.current?.id === working.id) adoptActiveProject(copy ?? canonical);
        setNotice({ kind: "info", text: copy ? "Cloud photos were protected. Your local edits were kept in a separate recovered project." : "Cloud photo assignments restored. Unavailable photos will load when Drive is connected." });
        setProjectSyncErrors(current => ({ ...current, [working.id]: false }));
        return true;
      }
      if (result.conflict) {
        const duplicate = resolveProjectConflict(latest, result.remote, crypto.randomUUID()).duplicate;
        for (const page of pagesRef.current) for (const photo of Object.values(page.photos)) retainVolatileForOwner(ownerId, photo.blobKey, photo.sourceBlob);
        const next = sortProjectsByLastEdited([...projectsRef.current.filter(item => item.id !== working.id), result.remote, duplicate]);
        saveWorkspaceProjects(next, ownerId);
        projectsRef.current = next;
        setProjects(next);
        if (activeProjectRef.current?.id === working.id) adoptActiveProject(duplicate);
        setNotice({ kind: "info", text: "This project changed elsewhere. Both versions have been kept; open the conflicted copy to review your edits." });
        return true;
      }
      const acknowledged = acknowledgeProjectPush(latest, working, result);
      const next = sortProjectsByLastEdited([...projectsRef.current.filter(item => item.id !== acknowledged.id), acknowledged]);
      projectsRef.current = next;
      setProjects(next);
      if (activeProjectRef.current?.id === acknowledged.id) adoptActiveProject(acknowledged, true);
      saveWorkspaceProjects(next, ownerId);
      setProjectSyncErrors(current => ({ ...current, [working.id]: result.partial }));
      return !result.partial;
    } catch (error) {
      if (isCurrent()) {
        setProjectSyncErrors(current => ({ ...current, [project.id]: true }));
        if (error instanceof Error && error.message.startsWith("Cloud photo library setup")) setNotice({ kind: "error", text: error.message });
      }
      return false;
    } finally {
      if (sameWorkspace()) {
        projectPushInFlightRef.current.delete(project.id);
        setSyncingProjectIds(current => { const next = { ...current }; delete next[project.id]; return next; });
        if (pendingPullRef.current && !projectPushInFlightRef.current.size) {
          pendingPullRef.current = false;
          void syncProjectsFromCloud();
        }
      }
    }
  }, [adoptActiveProject, saveWorkspaceProjects, syncProjectsFromCloud, retainVolatileForOwner]);

  const changeWorkspace = useCallback((user: User | null) => {
    const ownerId = user?.id ?? null;
    if (initializedWorkspaceRef.current && workspaceRef.current.ownerId === ownerId) {
      templateUserRef.current = user; setTemplateUser(user); setTemplateAuthReady(true); return;
    }
    if (initializedWorkspaceRef.current && activeProjectRef.current) {
      const active = activeProjectRef.current;
      try { saveWorkspaceProjects([...projectsRef.current.filter(item => item.id !== active.id), active]); } catch { /* error remains visible */ }
    }
    workspaceRef.current.switchTo(ownerId);
    photoPreviews.setWorkspace(ownerId);
    initializedWorkspaceRef.current = true;
    backupQueueRef.current?.stop();
    setPhotoBackupStatus({});
    syncQueueRef.current?.stop();
    syncQueueRef.current = null;
    projectPushInFlightRef.current.clear();
    pendingPullRef.current = false;
    templateSyncTimersRef.current.forEach(timer => window.clearTimeout(timer));
    templateSyncTimersRef.current.clear();
    adoptActiveProject(null);
    setTemplateDraft(null); setDeletedProjects([]); setBackupPreview(null); setBusy(null); setStorageError(null);
    setProjectSyncErrors({}); setSyncingProjectIds({}); setDriveProgress(null);
    driveAccessTokenRef.current = null; driveTokenExpiresAtRef.current = 0;
    setDriveAccessToken(null); setDriveExpiry(0);
    exportItemsRef.current.forEach(item => URL.revokeObjectURL(item.url));
    exportItemsRef.current = []; setExportItems([]);
    let saved: StoredProject[] = [];
    let savedTemplates: CustomTemplate[] = [];
    try { saved = sortProjectsByLastEdited(loadProjects(ownerId)); savedTemplates = loadCachedCustomTemplates(ownerId); }
    catch (error) { setStorageError(error instanceof Error ? error.message : "Saved data could not be read. It has been retained."); }
    projectsRef.current = saved; setProjects(saved);
    customTemplatesRef.current = savedTemplates; setCustomTemplates(savedTemplates);
    templateUserRef.current = user; setTemplateUser(user);
    setTemplateAuthReady(true); setReady(true);
  }, [adoptActiveProject, saveWorkspaceProjects, photoPreviews]);

  useEffect(() => {
    const client = getTemplateCloudClient();
    let cancelled = false;
    let authEvents = 0;
    const accept = (user: User | null) => {
      if (cancelled) return;
      changeWorkspace(user);
      if (user) {
        const isCurrent = workspaceRef.current.capture();
        window.setTimeout(() => {
          if (!isCurrent() || cancelled) return;
          void syncTemplateCloud().catch(() => undefined);
          void syncProjectsFromCloud();
        }, 0);
      }
    };
    if (!client) { const timer = window.setTimeout(() => accept(null), 0); return () => { cancelled = true; window.clearTimeout(timer); }; }
    void client.auth.getSession().then(({ data }) => { if (!authEvents) accept(data.session?.user ?? null); }).catch(() => { if (!authEvents) accept(null); });
    const { data } = client.auth.onAuthStateChange((_event, session) => { authEvents++; accept(session?.user ?? null); });
    return () => { cancelled = true; data.subscription.unsubscribe(); };
  }, [changeWorkspace, syncProjectsFromCloud, syncTemplateCloud]);

  // Google Identity Services deliberately gives the browser a short-lived
  // Drive token, rather than an application-held refresh token. Remembering
  // only that this browser was explicitly connected lets us request a fresh
  // token without a prompt after a reload, while keeping a manual Connect
  // fallback if the user's Google browser session has ended.
  useEffect(() => {
    if (!ready || !templateUser || !driveConfigured || !googleScriptReady || driveAccessTokenRef.current) return;
    if (window.localStorage.getItem(driveRestorePreferenceKey) !== "true") return;

    let cancelled = false;
    const isCurrent = workspaceRef.current.capture();
    void requestGoogleDriveAccessToken("").then((token) => {
      if (cancelled || !isCurrent()) return;
      driveAccessTokenRef.current = token.accessToken;
      driveTokenExpiresAtRef.current = token.expiresAt;
      setDriveAccessToken(token.accessToken);
      setDriveExpiry(token.expiresAt);
    }).catch(() => {
      // Silent restoration is best-effort. The Connect button remains
      // available when Google needs the user to sign in or re-consent.
    });

    return () => {
      cancelled = true;
    };
  }, [driveConfigured, driveRestorePreferenceKey, googleScriptReady, ready, templateUser]);

  useEffect(() => {
    if (!driveExpiry) return;
    const timer = window.setTimeout(() => setDriveExpiry(0), Math.max(0, driveExpiry - Date.now() - 30_000));
    return () => window.clearTimeout(timer);
  }, [driveExpiry]);

  useEffect(() => {
    const templateSyncTimers = templateSyncTimersRef.current;
    const retainedPhotos = retainedPhotosRef.current;
    return () => {
      pagesRef.current.forEach(disposePagePreviews);
      retainedPhotos.forEach(disposePhotoAsset);
      photoPreviews.clear();
      exportItemsRef.current.forEach((item) => URL.revokeObjectURL(item.url));
      templateSyncTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [photoPreviews]);

  const buildStoredProject = useCallback((): StoredProject | null => {
    if (!projectId || !formatId) return null;
    const existing = projectsRef.current.find((project) => project.id === projectId);
    return {
      version: 3,
      id: projectId,
      name: projectName.trim() || "Untitled project",
      formatId,
      activePageId,
      pages: pages.map(serializePage),
      photoLibrary: getProjectPhotos({ photoLibrary: mergePhotoLibraries(existing?.photoLibrary, projectPhotoLibrary), pages: pages.map(serializePage) }),
      revision: existing?.revision,
      cloudSyncedAt: existing?.cloudSyncedAt,
      driveFolderId: existing?.driveFolderId,
      pendingDeletions,
      createdAt: projectCreatedAt || now(),
      updatedAt: projectUpdatedAt || projectCreatedAt || now(),
    };
  }, [activePageId, formatId, pages, pendingDeletions, projectCreatedAt, projectId, projectName, projectUpdatedAt, projectPhotoLibrary]);

  useEffect(() => {
    const project = buildStoredProject();
    activeProjectRef.current = project;
    if (project) {
      pagesRef.current.forEach(page => Object.values(page.photos).forEach(photo => retainedPhotosRef.current.set(photo.blobKey, photo)));
      historyRef.current.observe(project, historyGroupRef.current);
      const referenced = historyRef.current.referencedBlobKeys();
      for (const [key, photo] of retainedPhotosRef.current) {
        if (!referenced.has(key)) { disposePhotoAsset(photo); retainedPhotosRef.current.delete(key); }
      }
      setHistoryState({ undo: historyRef.current.canUndo, redo: historyRef.current.canRedo });
    }
  }, [buildStoredProject]);

  // Browsing and the editor request small previews. Originals are hydrated only
  // for an explicit original inspection, page preview or export.
  useEffect(() => {
    photoPreviews.setWorkspace(templateUser?.id ?? null);
    if (!activePage || screen !== "editor") return;
    const photos = [...Object.values(activePage.photos), ...Object.values(activePage.unavailablePhotos ?? {})];
    const release = photos.map(photo => photoPreviews.pin(photo.blobKey));
    for (const photo of photos) void photoPreviews.request(photo, getValidDriveToken, getVolatileBlob, -2);
    return () => release.forEach(fn => fn());
  }, [activePage, screen, photoPreviews, driveExpiry, getValidDriveToken, getVolatileBlob, templateUser?.id]);

  useEffect(() => {
    if (!ready || !projectId || !formatId) return;
    const isCurrent = workspaceRef.current.capture();
    const timer = window.setTimeout(() => {
      if (!isCurrent()) return;
      const saved = activeProjectRef.current;
      if (!saved) return;
      try {
        const next = sortProjectsByLastEdited([...projectsRef.current.filter((project) => project.id !== saved.id), saved]);
        projectsRef.current = next;
        saveWorkspaceProjects(next);
        setProjects(next);
      } catch {
        setNotice({ kind: "error", text: "This project could not be autosaved in this browser." });
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [buildStoredProject, formatId, projectId, ready, saveWorkspaceProjects]);

  useEffect(() => {
    if (!ready) return;
    const queue: ProjectSyncQueue = new ProjectSyncQueue(async id => {
      const latest = activeProjectRef.current?.id === id ? activeProjectRef.current : projectsRef.current.find(item => item.id === id);
      return latest ? pushProjectNow(latest) : true;
    });
    syncQueueRef.current = queue;
    return () => { queue.stop(); if (syncQueueRef.current === queue) syncQueueRef.current = null; };
  }, [pushProjectNow, ready, templateUser?.id]);

  useEffect(() => {
    if (!ready || !templateUser?.id) return;
    const ownerId = templateUser.id, sameWorkspace = workspaceRef.current.capture(), abort = new AbortController();
    const queue: ProjectSyncQueue = new ProjectSyncQueue(async id => {
      const project = () => activeProjectRef.current?.id === id ? activeProjectRef.current : projectsRef.current.find(item => item.id === id);
      const current = () => sameWorkspace() && !abort.signal.aborted && !queue.isBlocked(id) && Boolean(project());
      if (!current() || !getValidDriveToken()) return true;
      return backUpProjectPhotos({ ownerId, project, current, token: getValidDriveToken, signal: abort.signal,
        source: async key => await loadPhotoBlob(key).catch(() => null) ?? getVolatileBlob(key) ?? null,
        progress: status => { if (current()) setPhotoBackupStatus(previous => ({ ...previous, [id + ":" + status.blobKey]: status })); },
        checkpoint: async checkpoint => {
          if (!current()) throw new Error("The workspace or project changed.");
          const latest = project()!;
          const saved = applyPhotoBackupCheckpoint(latest, checkpoint, now());
          const next = projectsRef.current.map(item => item.id === id ? saved : item);
          saveWorkspaceProjects(next, ownerId);
          projectsRef.current = next; setProjects(next);
          if (activeProjectRef.current?.id === id) adoptActiveProject(saved, true);
          const accepted = await syncQueueRef.current?.flush(id, saved.updatedAt);
          if (!accepted || !current()) throw new Error("Backup checkpoint awaits cloud metadata. Reconnect or retry; completed files are preserved.");
          const photo = getProjectPhotos(project()!).find(photo => photo.blobKey === checkpoint.blobKey);
          if (!photo) throw new Error("This photo is no longer in the destination project.");
          return photo;
        },
      });
    }, 2500);
    backupQueueRef.current = queue;
    return () => { abort.abort(); queue.stop(); if (backupQueueRef.current === queue) backupQueueRef.current = null; };
  }, [ready, templateUser?.id, getValidDriveToken, getVolatileBlob, adoptActiveProject, saveWorkspaceProjects]);

  useEffect(() => {
    const queue = syncQueueRef.current;
    if (!queue) return;
    queue.setEnabled(Boolean(isOnline && templateUser && isProjectCloudConfigured()));
    backupQueueRef.current?.setEnabled(Boolean(isOnline && templateUser && driveConnected && isProjectCloudConfigured()));
    const active = buildStoredProject();
    const library = active ? [...projects.filter(item => item.id !== active.id), active] : projects;
    for (const project of library) {
      if (isProjectDirty(project)) queue.enqueue(project.id, project.updatedAt);
      if (driveConnected && projectHasUnbackedAssets(project)) backupQueueRef.current?.enqueue(project.id, JSON.stringify([getProjectPhotos(project), driveExpiry]));
    }
  }, [buildStoredProject, projects, isOnline, templateUser, driveExpiry, driveConnected, ready]);

  useEffect(() => {
    const refresh = () => { if (navigator.onLine) void syncProjectsFromCloud(); };
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    return () => { window.removeEventListener("online", refresh); window.removeEventListener("focus", refresh); };
  }, [syncProjectsFromCloud]);

  useEffect(() => {
    const project = buildStoredProject();
    if (!storageError && (!project || !hasAnyPhotos || (!isProjectDirty(project) && getProjectBackupCounts(project).originals === getProjectBackupCounts(project).total))) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasAnyPhotos, storageError, buildStoredProject]);

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
    setProjectPhotoLibrary(current => mergePhotoLibraries(current, pagesRef.current.flatMap(page => Object.values(serializePage(page).photos))));
    historyGroupRef.current = undefined;
    const timestamp = nextProjectEditTime(activeProjectRef.current);
    setProjectUpdatedAt(timestamp);
    setPages((current) => current.map((page) => page.id === pageId ? { ...updater(page), updatedAt: timestamp } : page));
  };

  const selectEditorFrame = (frameId: string) => {
    if (!activePage || !template?.frames.some(frame => frame.id === frameId)) return;
    setEditorSelectedFrameId(frameId);
  };

  const persistActiveProject = (): StoredProject[] => {
    const saved = buildStoredProject();
    if (!saved) return projectsRef.current;
    const next = sortProjectsByLastEdited([...projectsRef.current.filter((project) => project.id !== saved.id), saved]);
    projectsRef.current = next;
    saveWorkspaceProjects(next);
    setProjects(next);
    return next;
  };

  const travelProjectHistory = (direction: "undo" | "redo") => {
    const latest = buildStoredProject();
    if (!latest) return;
    historyRef.current.observe(latest, historyGroupRef.current);
    const restored = historyRef.current.travel(direction, latest, now());
    if (!restored) return;
    const next = projectsRef.current.map(item => item.id === restored.id ? restored : item);
    projectsRef.current = next; setProjects(next);
    adoptActiveProject(restored, true);
    setHistoryState({ undo: historyRef.current.canUndo, redo: historyRef.current.canRedo });
    try { saveWorkspaceProjects(next); } catch { /* Keep the restored in-memory work and storage warning. */ }
  };

  useEffect(() => {
    if (!ready) return;
    const current = workspaceRef.current.capture(), ownerId = workspaceRef.current.ownerId;
    const journalPrefix = workspaceKey("scuri.import", ownerId) + "/";
    const project = (id: string) => activeProjectRef.current?.id === id ? activeProjectRef.current : projectsRef.current.find(item => item.id === id);
    const commit = (updated: StoredProject) => {
      if (!current() || !project(updated.id)) throw new Error("The destination project changed.");
      const next = sortProjectsByLastEdited([...projectsRef.current.filter(item => item.id !== updated.id), updated]);
      saveWorkspaceProjects(next, ownerId);
      projectsRef.current = next; setProjects(next);
      if (activeProjectRef.current?.id === updated.id) adoptActiveProject(updated, true);
      syncQueueRef.current?.enqueue(updated.id, updated.updatedAt, true);
      backupQueueRef.current?.enqueue(updated.id, updated.updatedAt, true);
    };
    let worker: PhotoAnalysisClient | undefined;
    try { worker = new PhotoAnalysisClient(); } catch { /* SubtleCrypto fallback remains asynchronous. */ }
    const queue = new PhotoImportQueue({
      current, project, validate: validateImageFile,
      fingerprint: file => worker ? worker.fingerprint(file) : fingerprintOriginal(file),
      knownFingerprint: photo => { try { return localStorage.getItem(fingerprintCacheKey(photo, ownerId)) ?? undefined; } catch { return undefined; } },
      prepare: async (file, blobKey) => {
        const preview = await createPhotoPreview(file);
        const photo: ProjectPhoto = { blobKey, sourceWidth: preview.width, sourceHeight: preview.height, sourceName: file.name, fileSize: file.size, mimeType: file.type };
        try {
          await writeDerived(previewStorageKey(photo, ownerId, 2200), { blob: preview.blob });
          const small = await createPhotoPreview(preview.blob, { longEdge: 640, quality: 0.72 });
          try { await writeDerived(previewStorageKey(photo, ownerId), { blob: small.blob }); if (current()) photoPreviews.rememberThumbnail(photo, small.blob, 640); }
          finally { URL.revokeObjectURL(small.previewUrl); }
          return photo;
        } finally { URL.revokeObjectURL(preview.previewUrl); }
      },
      saveOriginal: async (key, file) => {
        try { await savePhotoBlob(key, file); }
        catch { await clearDerivedCache(); await savePhotoBlob(key, file); }
      }, commit,
      checkpoint: (projectId, photo) => writePhotoJob(journalPrefix + photo.blobKey, { projectId, photo }),
      complete: photo => removePhotoJob(journalPrefix + photo.blobKey),
    });
    importQueueRef.current = queue;
    const unsubscribe = queue.subscribe(() => setImportItems(queue.getSnapshot()));
    // Recover an original committed just before an interrupted metadata save.
    void listPhotoJobs<{ projectId: string; photo: ProjectPhoto }>(journalPrefix).then(async jobs => {
      for (const job of jobs) {
        if (!current()) return;
        const latest = project(job.value.projectId);
        if (!latest || !await loadPhotoBlob(job.value.photo.blobKey).catch(() => null) || !current()) continue;
        if (!getProjectPhotos(latest).some(photo => photo.blobKey === job.value.photo.blobKey)) {
          const fresh = project(job.value.projectId); if (!fresh) continue;
          commit({ ...fresh, photoLibrary: mergePhotoLibraries(getProjectPhotos(fresh), [job.value.photo]), updatedAt: nextProjectEditTime(fresh) });
        }
        await removePhotoJob(job.key).catch(() => {});
      }
    }).catch(() => {});
    return () => { unsubscribe(); queue.stop(); worker?.dispose(); if (importQueueRef.current === queue) importQueueRef.current = null; clearLibraryViews(); };
  }, [ready, templateUser?.id, adoptActiveProject, saveWorkspaceProjects, photoPreviews]);

  const importLibraryPhotos = (sources: PhotoImportSource[], destinationId: string, ownerId: string | null) => {
    const initial = activeProjectRef.current?.id === destinationId ? activeProjectRef.current : projectsRef.current.find(project => project.id === destinationId);
    if (!initial || workspaceRef.current.ownerId !== ownerId || !sources.length) { sources.forEach(source => source.release?.()); return; }
    void navigator.storage?.persist?.().catch(() => false);
    importQueueRef.current?.add(destinationId, sources);
  };
  const closePhotoLibrary = () => {
    photoPickerRef.current = null; setPhotoPickerIntent(null); setShowPhotoLibrary(false); setChoosePhotoSource(false);
  };
  const chooseLibraryPhoto = (photo: ProjectPhoto) => {
    const intent = photoPickerRef.current, current = buildStoredProject();
    if (!intent || !current || !photoPickerWorkspaceRef.current?.()) return;
    const page = current.pages.find(page => page.id === intent.pageId);
    try {
      const updated = placeLibraryPhoto(current, intent, photo, page ? resolvePageTemplate(page).frames.map(frame => frame.id) : []);
      photoPickerRef.current = null; setPhotoPickerIntent(null); setShowPhotoLibrary(false);
      if (updated === current) return;
      historyRef.current.observe(current);
      const next = projectsRef.current.map(item => item.id === updated.id ? updated : item);
      saveWorkspaceProjects(next); projectsRef.current = next; setProjects(next); adoptActiveProject(updated, true);
    } catch (error) { closePhotoLibrary(); setNotice({ kind: "error", text: error instanceof Error ? error.message : "The photo could not be placed." }); }
  };
  const setPhotoColour = (key: string, colourOverride: ProjectPhoto["colourOverride"]) => {
    const current = buildStoredProject(); if (!current) return;
    const group = projectPhotoGroups(current).find(group => group.photo.blobKey === key); if (!group) return;
    const keys = new Set(group.members.map(photo => photo.blobKey));
    const updated = { ...current, photoLibrary: getProjectPhotos(current).map(photo => keys.has(photo.blobKey) ? { ...photo, colourOverride } : photo),
      updatedAt: nextProjectEditTime(current) };
    historyRef.current.observe(current);
    const next = projectsRef.current.map(item => item.id === updated.id ? updated : item);
    saveWorkspaceProjects(next); projectsRef.current = next; setProjects(next); adoptActiveProject(updated, true);
  };

  const combineLibraryDuplicates = (scan: DuplicateScan, groups: DuplicateGroup[]) => {
    const current = buildStoredProject();
    if (!current) throw new Error("Open the project again before combining duplicates.");
    const updated = consolidateLibraryDuplicates(current, scan, groups);
    if (updated === current) return;
    historyRef.current.observe(current, historyGroupRef.current);
    historyGroupRef.current = undefined;
    setProjectPhotoLibrary(updated.photoLibrary ?? []);
    setProjectUpdatedAt(updated.updatedAt);
    setNotice({ kind: "success", text: "Duplicate library entries combined. All page placements and crops are preserved. Use Undo to separate the entries again." });
  };

  const applySuggestedArrangement = (proposal: ArrangementProposal) => {
    const source = buildStoredProject();
    if (!source) return;
    try {
      const copy = applyArrangementAsCopy(source, proposal);
      // Persist the source and the new copy together; never replace its pages.
      const next = sortProjectsByLastEdited([copy, source, ...projectsRef.current.filter(item => item.id !== source.id)]);
      saveWorkspaceProjects(next);
      projectsRef.current = next; setProjects(next);
      adoptActiveProject(copy); setScreen("project");
      setNotice({ kind: "success", text: "Arrangement applied to a new project. The previous project and every library photo have been kept." });
    } catch (error) { setNotice({ kind: "error", text: error instanceof Error ? error.message : "The suggestion could not be saved; your arrangement is unchanged." }); }
  };

  const downloadProjectBackup = async () => {
    const project = buildStoredProject();
    if (!project) return;
    const isCurrent = workspaceRef.current.capture();
    setBusy("backup");
    try {
      const backup = await createProjectBackup(project, async key => (
        await loadPhotoBlob(key).catch(() => null) ?? (isCurrent() ? getVolatileBlob(key) : null) ?? null
      ), resolvePageTemplate);
      if (!isCurrent()) return;
      if (backup.missingOriginals && !window.confirm('This backup is missing ' + backup.missingOriginals + ' original photos. Download the incomplete backup with its saved layouts and crops?')) return;
      const url = URL.createObjectURL(backup.blob);
      downloadBlob(backup.blob, url, backup.filename);
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setNotice({ kind: backup.missingOriginals ? "info" : "success", text: backup.missingOriginals ? "Incomplete backup downloaded. Missing originals are listed inside the backup." : "Project backup downloaded with its layouts, crops and original photos." });
    } catch (error) {
      if (isCurrent()) setNotice({ kind: "error", text: error instanceof Error ? error.message : "The backup could not be created." });
    } finally { if (isCurrent()) setBusy(null); }
  };

  const retryLocalSave = async () => {
    const isCurrent = workspaceRef.current.capture();
    const blobs = volatileBlobsRef.current.get(workspaceRef.current.ownerId ?? "local");
    try {
      for (const [key, blob] of blobs ?? []) {
        if (!isCurrent()) return;
        await savePhotoBlob(key, blob);
        blobs?.delete(key);
      }
      if (!isCurrent()) return;
      persistActiveProject();
      setStorageError(null);
      setNotice({ kind: "success", text: "Local project data saved successfully." });
    } catch (error) {
      if (isCurrent()) setStorageError(error instanceof Error ? error.message : "Local storage is still unavailable. Download a backup before closing.");
    }
  };

  const reviewProjectBackup = async (file?: File) => {
    if (!file) return;
    const isCurrent = workspaceRef.current.capture();
    setBusy("backup");
    try {
      const preview = await inspectProjectBackup(file);
      if (isCurrent()) setBackupPreview(preview);
    } catch (error) {
      if (isCurrent()) setNotice({ kind: "error", text: error instanceof Error ? error.message : "This backup could not be opened." });
    } finally { if (isCurrent()) { setBusy(null); if (backupInputRef.current) backupInputRef.current.value = ""; } }
  };

  const restoreProjectBackup = async () => {
    if (!backupPreview) return;
    const isCurrent = workspaceRef.current.capture();
    const ownerId = workspaceRef.current.ownerId;
    setBusy("backup");
    try {
      const restored = materializeProjectBackup(backupPreview);
      for (const [key, blob] of restored.originals) {
        if (!isCurrent()) return;
        await savePhotoBlob(key, blob);
      }
      if (!isCurrent()) return;
      const existing = persistActiveProject();
      const next = sortProjectsByLastEdited([restored.project, ...existing]);
      saveWorkspaceProjects(next, ownerId);
      projectsRef.current = next; setProjects(next);
      adoptActiveProject(restored.project); setScreen("project"); setBackupPreview(null);
      setNotice({ kind: "success", text: "Backup restored as a new project. Existing projects are unchanged." });
    } catch (error) {
      if (isCurrent()) setNotice({ kind: "error", text: error instanceof Error ? error.message : "The backup could not be stored. Existing projects are unchanged." });
    } finally { if (isCurrent()) setBusy(null); }
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
    saveWorkspaceProjects(nextProjects);
    setProjects(nextProjects);
    projectsRef.current = nextProjects;
    adoptActiveProject(project);
    setRearrangeMode(false);
    setScreen("project");
    setShowPhotoLibrary(true);
  };

  const selectTemplate = async (nextTemplate: TemplateDefinition) => {
    const intent = templatePickerIntent;
    if (!intent || templatePickerRef.current !== intent || activeProjectRef.current?.id !== intent.projectId) return;
    historyGroupRef.current = undefined;
    if (!formatId || nextTemplate.formatId !== formatId) return;
    const targetPage = intent.kind === "replace" ? pagesRef.current.find(page => page.id === intent.pageId) : null;
    if (intent.kind === "replace" && !targetPage) {
      setScreen("project");
      setNotice({ kind: "info", text: "That page is no longer available. Choose a page or add a new one." });
      return;
    }
    if (targetPage) {
      if (targetPage.templateId === nextTemplate.id) {
        setActivePageId(targetPage.id);
        setRearrangeMode(false);
        setScreen("editor");
        return;
      }
      const removedPhotos = Object.values(serializePage(targetPage).photos);
      if (removedPhotos.length && !window.confirm("Change this page layout and clear its frames? All photos, including unavailable ones, stay in the project library.")) return;
      setPendingDeletions((current) => recordPhotoDeletions(current, targetPage.id, removedPhotos));
      retainPagePhotos(targetPage);
      updatePage(targetPage.id, (page) => ({
        ...page,
        templateId: nextTemplate.id,
        templateSnapshot: { ...nextTemplate, frames: nextTemplate.frames.map((frame) => ({ ...frame })) },
        background: nextTemplate.defaultBackground,
        gutter: nextTemplate.defaultGutter,
        selectedFrameId: nextTemplate.frames[0]?.id ?? null,
        photos: {},
        unavailablePhotos: {},
      }));
      setActivePageId(targetPage.id);
      setRearrangeMode(false);
      setScreen("editor");
      return;
    }
    if (pagesRef.current.length >= MAX_PROJECT_PAGES) {
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
    setProjectUpdatedAt(nextProjectEditTime(activeProjectRef.current, createdAt));
    setActivePageId(page.id);
    setRearrangeMode(false);
    setScreen("editor");
  };

  const requestPhoto = (frameId: string) => {
    const project = buildStoredProject(); if (!project || !activePage) return;
    const intent = openPhotoPicker(project, activePage.id, frameId);
    photoPickerRef.current = intent; photoPickerWorkspaceRef.current = workspaceRef.current.capture();
    setPhotoPickerIntent(intent); setChoosePhotoSource(true);
  };

  const updateCrop = (frameId: string, crop: CropState) => {
    if (!activePage) return;
    updatePage(activePage.id, page => updatePagePhotoCrop(page, frameId, crop));
    historyGroupRef.current = `crop:${activePage.id}:${frameId}`;
  };

  const updatePhotoZoom = (frameId: string, zoom: number, tolerance = 5 * (format?.width ?? 1080) / editorWidth) => {
    if (!activePage || !template) return;
    const frames = resolveFrames(template, activePage.gutter);
    const frame = frames.find(item => item.id === frameId), photo = displayedPhotos[frameId];
    if (!frame || !photo) return;
    const minimum = Math.min(photo.crop.zoom, minimumPhotoZoom(photo.sourceWidth, photo.sourceHeight, frame));
    const result = snapPhotoZoom(displayedPhotos, frames, frameId, zoom, snapEnabled ? tolerance : -1, minimum);
    if (!result) return;
    setAlignmentGuides(result.guides);
    updateCrop(frameId, result.crop);
  };

  const updateFramePosition = (frameId: string, x: number, y: number) => {
    if (!activePage || !template) return;
    const moved = movePageFrame(activePage, template, frameId, x, y);
    if (moved === activePage) return;
    updatePage(activePage.id, page => movePageFrame(page, resolvePageTemplate(page), frameId, x, y));
    historyGroupRef.current = `frame-move:${activePage.id}:${frameId}`;
  };

  const changeFrameLayer = (offset: -1 | 1) => {
    if (!activePage || !selectedFrameId || !template) return;
    updatePage(activePage.id, page => reorderPageFrame(page, resolvePageTemplate(page), selectedFrameId, offset));
    setAlignmentGuides([]);
  };

  const movePhoto = (sourceFrameId: string, targetFrameId: string) => {
    if (!activePage || sourceFrameId === targetFrameId) return;
    const stored = serializePage(activePage).photos;
    if (!stored[sourceFrameId]) return;
    setPendingDeletions((current) => recordPhotoDeletions(current, activePage.id,
      [stored[sourceFrameId], stored[targetFrameId]].filter(Boolean)));
    updatePage(activePage.id, page => movePagePhoto(page, sourceFrameId, targetFrameId));
    setEditorSelectedFrameId(targetFrameId);
  };

  const removeSelected = () => {
    if (!activePage || !selectedFrameId) return;
    const frameId = selectedFrameId;
    const removed = serializePage(activePage).photos[frameId];
    if (!removed) return;
    if (!window.confirm("Remove this photo from this frame? It will remain in Project photos.")) return;
    setPendingDeletions((current) => recordPhotoDeletions(current, activePage.id, [removed]));
    retainPagePhotos(activePage);
    updatePage(activePage.id, (page) => removePagePhoto(page, frameId));
  };

  const resetSelected = () => {
    if (selectedFrameId && selectedPhoto) updateCrop(selectedFrameId, { ...DEFAULT_CROP });
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
    const isCurrent = workspaceRef.current.capture();
    const ownerId = workspaceRef.current.ownerId;
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
      if (!ownerId) return;
      const saved = await saveCloudTemplate(pending, { ownerId, isCurrent });
      if (!isCurrent()) return;
      replaceCustomTemplates([saved, ...customTemplatesRef.current.filter((item) => item.id !== saved.id)]);
      setTemplateDraft(null);
      setScreen("templates");
      setNotice({ kind: "success", text: "Template saved to the cloud and available on your signed-in devices." });
    } catch {
      if (!isCurrent()) return;
      replaceCustomTemplates(customTemplatesRef.current.map((item) => item.id === pending.id ? { ...item, syncState: "error" } : item));
      setNotice({ kind: "error", text: "The template is safe on this device but could not reach the cloud. Try again when online." });
    } finally {
      if (isCurrent()) setTemplateCloudBusy(false);
    }
  };

  const deleteLibraryTemplate = async (templateId: string) => {
    const isCurrent = workspaceRef.current.capture();
    const target = customTemplatesRef.current.find((item) => item.id === templateId);
    if (!target || !window.confirm(`Delete “${target.name}” permanently? Existing project pages will keep their saved layout.`)) return;
    if (templateCloudConfigured && !templateUser && target.syncState !== "local") {
      setShowTemplateSignIn(true);
      setNotice({ kind: "info", text: "Sign in first so deletion is applied permanently to every device." });
      return;
    }
    const next = customTemplatesRef.current.filter((item) => item.id !== templateId);
    const timer = templateSyncTimersRef.current.get(templateId);
    if (timer) window.clearTimeout(timer);
    templateSyncTimersRef.current.delete(templateId);
    replaceCustomTemplates(next);
    if (templateUser && templateCloudConfigured) {
      try {
        await deleteCloudTemplate(templateId);
        if (!isCurrent()) return;
        setNotice({ kind: "success", text: "Template deleted. Existing project pages are unchanged." });
      } catch {
        if (!isCurrent()) return;
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

  const signInWithTemplatePassword = async () => {
    const email = signInEmail.trim();
    if (!email || !signInPassword) return;
    setTemplateCloudBusy(true);
    try {
      await signInTemplateWithPassword(email, signInPassword);
      setSignInPassword("");
      setShowTemplateSignIn(false);
      setNotice({ kind: "success", text: "Signed in. Your templates and projects will now sync on this device." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not sign in with that email and password." });
    } finally {
      setTemplateCloudBusy(false);
    }
  };

  const saveTemplatePassword = async () => {
    if (newPassword.length < 8) {
      setNotice({ kind: "error", text: "Use a password with at least 8 characters." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setNotice({ kind: "error", text: "The passwords do not match." });
      return;
    }
    setTemplateCloudBusy(true);
    try {
      await setTemplateCloudPassword(newPassword);
      setNewPassword("");
      setConfirmPassword("");
      setShowPasswordSetup(false);
      setNotice({ kind: "success", text: "Password saved. You can now sign in on other devices without requesting an email link." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not save your password." });
    } finally {
      setTemplateCloudBusy(false);
    }
  };

  const signOutTemplates = async () => {
    try {
      persistActiveProject();
      await signOutTemplateCloud();
      changeWorkspace(null);
      setNotice({ kind: "success", text: "Signed out. Your account's projects are kept in its separate workspace." });
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
    setBusy("project");
    clearExportItems();
    try {
      adoptActiveProject(stored);
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
    const project = savedProjects.find(item => item.id === id);
    if (!project || !window.confirm('Delete “' + project.name + '”? You can restore a copy during this session.')) return;
    const isCurrent = workspaceRef.current.capture();
    const ownerId = workspaceRef.current.ownerId;
    if (project.revision !== undefined && (!ownerId || !isOnline)) {
      setNotice({ kind: "info", text: "Reconnect before deleting a cloud project." }); return;
    }
    const queue = syncQueueRef.current;
    setBusy("project");
    try {
      // Block further jobs and await any already-issued writes before tombstoning.
      const stoppingBackup = backupQueueRef.current?.cancel(id);
      await queue?.cancel(id);
      await stoppingBackup;
      if (!isCurrent()) return;
      if (ownerId && isProjectCloudConfigured()) {
        if (!isOnline) throw new Error("Reconnect before completing this deletion.");
        // Even an apparently new project may have been inserted by the in-flight save.
        await softDeleteCloudProject(id, { ownerId, isCurrent });
      }
      if (!isCurrent()) return;
      const latest = activeProjectRef.current?.id === id ? activeProjectRef.current : projectsRef.current.find(item => item.id === id) ?? project;
      for (const page of pagesRef.current) for (const photo of Object.values(page.photos)) retainVolatileForOwner(ownerId, photo.blobKey, photo.sourceBlob);
      const next = projectsRef.current.filter(item => item.id !== id);
      saveWorkspaceProjects(next, ownerId);
      projectsRef.current = next; setProjects(next);
      setDeletedProjects(current => [...current.slice(-9), latest]);
      if (activeProjectRef.current?.id === id) adoptActiveProject(null);
      // Drive originals may be shared by surviving projects. Keep bytes; media
      // cleanup is separate from intentional removal of project assignments.
      setNotice({ kind: "success", text: "Project removed. Restore a copy from Projects during this session." });
    } catch (error) {
      queue?.allow(id); backupQueueRef.current?.allow(id);
      if (isCurrent()) setNotice({ kind: "error", text: error instanceof Error ? error.message : "The project could not be removed." });
    } finally { if (isCurrent()) setBusy(null); }
  };

  const restoreDeletedProject = () => {
    const deleted = deletedProjects.at(-1);
    if (!deleted) return;
    const restored = { ...resolveProjectConflict(deleted, deleted, crypto.randomUUID()).duplicate, name: (deleted.name + " (restored)").slice(0, 120) };
    const next = sortProjectsByLastEdited([restored, ...projectsRef.current]);
    saveWorkspaceProjects(next);
    projectsRef.current = next; setProjects(next);
    setDeletedProjects(current => current.slice(0, -1));
    adoptActiveProject(restored); setScreen("project");
    setNotice({ kind: "success", text: "A new copy was restored with its original photo assignments." });
  };

  const addPage = () => {
    if (pages.length >= MAX_PROJECT_PAGES) {
      setNotice({ kind: "error", text: `A project can contain up to ${MAX_PROJECT_PAGES} pages.` });
      return;
    }
    if (!projectId) return;
    setTemplatePicker({ kind: "add", projectId });
    setRearrangeMode(false);
    setScreen("template");
  };

  const changePageLayout = () => {
    if (!activePage || !projectId) return;
    setTemplatePicker({ kind: "replace", projectId, pageId: activePage.id });
    setScreen("template");
  };

  const editPage = (pageId: string) => {
    setActivePageId(pageId);
    setRearrangeMode(false);
    setScreen("editor");
  };

  const duplicatePage = async (pageId: string) => {
    const source = pagesRef.current.find(page => page.id === pageId);
    if (!source) return;
    if (pagesRef.current.length >= MAX_PROJECT_PAGES) { setNotice({ kind: "info", text: `A project can contain up to ${MAX_PROJECT_PAGES} pages.` }); return; }
    const timestamp = nextProjectEditTime(activeProjectRef.current);
    const stored = serializePage(source);
    // A new placement shares the immutable original, while keeping its own crop.
    const duplicate: ProjectPage = { ...source, id: crypto.randomUUID(), photos: {},
      unavailablePhotos: Object.fromEntries(Object.entries(stored.photos).map(([frameId, photo]) => [frameId, { ...photo, cloudAssetId: undefined, crop: { ...photo.crop } }])),
      createdAt: timestamp, updatedAt: timestamp };
    historyGroupRef.current = undefined;
    setPages(current => { const next = [...current]; next.splice(next.findIndex(page => page.id === pageId) + 1, 0, duplicate); return next; });
    setProjectUpdatedAt(timestamp);
    setNotice({ kind: "success", text: "Page duplicated. Photo originals are shared; crops can be edited independently." });
  };

  const deletePage = async (pageId: string) => {
    historyGroupRef.current = undefined;
    const page = pagesRef.current.find((item) => item.id === pageId);
    if (!page || !window.confirm("Delete this page? Its photos stay in the project library.")) return;
    setProjectPhotoLibrary(current => mergePhotoLibraries(current, Object.values(serializePage(page).photos)));
    setPendingDeletions((current) => recordPhotoDeletions(current, pageId, Object.values(serializePage(page).photos), true));
    retainPagePhotos(page);
    setPages((current) => current.filter((item) => item.id !== pageId));
    setProjectUpdatedAt(nextProjectEditTime(activeProjectRef.current));
    if (activePageId === pageId) setActivePageId(null);
    setNotice({ kind: "success", text: "Page deleted." });
  };

  const movePage = (pageId: string, offset: -1 | 1) => {
    historyGroupRef.current = undefined;
    setPages((current) => moveProjectPageByOffset(current, pageId, offset));
    setProjectUpdatedAt(nextProjectEditTime(activeProjectRef.current));
  };

  const dragPageOver = (sourceId: string, targetId: string) => {
    historyGroupRef.current = "page-order";
    setPages((current) => moveProjectPage(current, sourceId, targetId));
    setProjectUpdatedAt(nextProjectEditTime(activeProjectRef.current));
  };

  const reviewExportPages = (pageIds?: string[]) => {
    const selectedPages = pages.filter(page => (!pageIds || pageIds.includes(page.id)) && isPageAssigned(page, resolvePageTemplate(page)));
    if (!selectedPages.length) {
      setNotice({ kind: "error", text: "Complete at least one page before exporting." });
      return;
    }
    setExportReviewIds(selectedPages.map(page => page.id));
    setShowPagePreview(true);
  };

  const exportPages = async (outputSize: ExportSize, pageIds: string[]) => {
    const isWorkspaceCurrent = workspaceRef.current.capture();
    const exportProjectId = projectId;
    const isCurrent = () => isWorkspaceCurrent() && activeProjectRef.current?.id === exportProjectId;
    if (!format) return;
    const requestedPages = pageIds ? pages.filter((page) => pageIds.includes(page.id)) : pages;
    const selectedPages = pageIds
      ? requestedPages
      : requestedPages.filter((page) => isPageComplete(page, resolvePageTemplate(page)));
    if (!selectedPages.length) {
      setNotice({ kind: "error", text: pages.length ? "Complete at least one page before exporting." : "Add a page before exporting." });
      return;
    }
    const incomplete = pageIds ? selectedPages.find((page) => !isPageAssigned(page, resolvePageTemplate(page))) : undefined;
    if (incomplete) {
      const pageNumber = pages.findIndex((page) => page.id === incomplete.id) + 1;
      setNotice({ kind: "error", text: `Finish page ${pageNumber} before exporting.` });
      return;
    }
    setBusy("export");
    setShowPagePreview(false);
    setExportProgress({ current: 0, total: selectedPages.length });
    clearExportItems();
    const created: ExportItem[] = [];
    try {
      for (let index = 0; index < selectedPages.length; index += 1) {
        if (!isCurrent()) throw new Error("Workspace changed.");
        const sourcePage = selectedPages[index];
        const hydrated = await hydrateProjectPhotos([sourcePage], () => isCurrent() ? getValidDriveToken() : null, getVolatileBlob, { current: isCurrent });
        const page = applyHydratedPhotos([sourcePage], hydrated)[0];
        if (!isCurrent() || !isPageComplete(page, resolvePageTemplate(page))) {
          hydrated.forEach(item => disposePhotoAsset(item.photo));
          throw new Error("Original photos could not be loaded for export. Reconnect Drive or restore them and retry.");
        }
        const pageNumber = pages.findIndex((item) => item.id === page.id) + 1;
        setExportProgress({ current: index + 1, total: selectedPages.length });
        let blob: Blob;
        try { blob = await renderComposition({
          format,
          template: resolvePageTemplate(page),
          background: page.background,
          gutter: page.gutter,
          photos: page.photos,
          outputSize,
        }); } finally { hydrated.forEach(item => disposePhotoAsset(item.photo)); }
        created.push({
          pageId: page.id,
          pageNumber,
          blob,
          url: URL.createObjectURL(blob),
          filename: createExportFilename(format, pageNumber, outputSize),
          size: outputSize,
        });
      }
      if (!isCurrent()) throw new Error("Workspace changed.");
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
      if (isCurrent()) setNotice({ kind: "error", text: error instanceof Error ? error.message : "Export failed. Try closing other apps and exporting again." });
    } finally {
      if (isWorkspaceCurrent()) { setBusy(null); setExportProgress(null); }
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

  const saveExportsToDrive = async () => {
    const isCurrent = workspaceRef.current.capture();
    const ownerId = workspaceRef.current.ownerId;
    const driveToken = getValidDriveToken();
    if (!driveToken) {
      setNotice({ kind: "info", text: "Connect Google Drive from Projects before saving exports there." });
      return;
    }
    const current = persistActiveProject().find((item) => item.id === projectId);
    if (!current || !exportItems.length) return;
    setBusy("drive");
    try {
      const folders = await ensureProjectDriveFolders(driveToken, current.id, current.name, current.driveFolderId);
      if (!isCurrent()) return;
      await uploadExportsToGoogleDrive(
        driveToken,
        folders.projectFolderId,
        current.id,
        exportItems.map((item) => ({ filename: item.filename, blob: item.blob })),
      );
      if (!isCurrent()) return;
      if (!current.driveFolderId) {
        const latest = activeProjectRef.current?.id === current.id ? activeProjectRef.current : projectsRef.current.find(item => item.id === current.id);
        if (latest) {
          const updated = { ...latest, driveFolderId: folders.projectFolderId, updatedAt: nextProjectEditTime(latest) };
          const next = projectsRef.current.map(item => item.id === updated.id ? updated : item);
          projectsRef.current = next; setProjects(next);
          if (activeProjectRef.current?.id === updated.id) adoptActiveProject(updated, true);
          saveWorkspaceProjects(next, ownerId);
        }
      }
      setNotice({ kind: "success", text: `${exportItems.length === 1 ? "Export" : "Exports"} saved in this project's Google Drive folder.` });
    } catch (error) {
      if (isCurrent()) setNotice({ kind: "error", text: error instanceof Error ? error.message : "The exports could not be saved to Google Drive." });
    } finally {
      if (isCurrent()) setBusy(null);
    }
  };

  const formatCards = useMemo(
    () => FORMATS.map((item) => ({ ...item, ratio: item.width / item.height })),
    [],
  );

  const previewSession = useMemo(() => ({ cache: photoPreviews, getDriveToken: getValidDriveToken, getVolatileBlob, accessRevision: driveExpiry }),
    [photoPreviews, getValidDriveToken, getVolatileBlob, driveExpiry]);

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
    <PhotoPreviewContext.Provider value={previewSession}>
    <div className="min-h-dvh bg-[#f5f5f2] text-[#11110f]">
      {isGoogleDriveConfigured() || photosImportConfigured() ? (
        <Script
          src="https://accounts.google.com/gsi/client"
          strategy="afterInteractive"
          onLoad={() => setGoogleScriptReady(true)}
        />
      ) : null}
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
      {storageError ? (
        <aside role="alert" className="mx-auto mt-4 max-w-[1120px] rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p>{storageError}</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" className="small-button" onClick={() => void retryLocalSave()}>Retry local save</button>
            {projectId ? <span className="flex flex-wrap items-center gap-2"><button type="button" className="small-button" disabled={busy !== null} onClick={() => void downloadProjectBackup()}>Download project backup</button><span className="text-xs">ZIP · up to 256 MB</span></span> : null}
          </div>
        </aside>
      ) : null}
      {projectId && ["project", "editor", "template"].includes(screen) ? (
        <section className="mx-auto mt-4 flex max-w-[1120px] flex-wrap items-center gap-3 px-4" aria-label="Project history and backup">
          <button type="button" className="small-button" disabled={!historyState.undo || busy !== null} onClick={() => travelProjectHistory("undo")}>Undo</button>
          <button type="button" className="small-button" disabled={!historyState.redo || busy !== null} onClick={() => travelProjectHistory("redo")}>Redo</button>
          <span className="flex flex-wrap items-center gap-2"><button type="button" className="small-button" disabled={busy !== null} onClick={() => void downloadProjectBackup()}>Download project backup</button><span className="text-xs text-neutral-600">ZIP · up to 256 MB</span></span>
          {pages.length > 0 ? <button type="button" className="small-button" disabled={busy !== null} onClick={() => { setExportReviewIds(null); setShowPagePreview(true); }}>Preview</button> : null}
          <p className="w-full text-xs leading-5 text-neutral-600">Undo history resets when you open another project, reload or change accounts. Originals backed up: {backedUpOriginalCount}/{libraryPhotos.length} · Previews: {backedUpPreviewCount}/{libraryPhotos.length} · Original detail loads on demand ({assignedPhotos.length - unavailablePhotoCount} currently loaded).</p>
        </section>
      ) : null}
      {missingEditorPreviews > 0 && screen === "editor" ? (
        <p role="status" className="mx-auto mt-4 max-w-[1240px] px-4 text-sm text-neutral-600 sm:px-6">
          {missingEditorPreviews} photo previews are awaiting availability. Their saved assignments and crops are preserved. Reconnect Drive or inspect the original in Project photos.
        </p>
      ) : null}

      <input ref={backupInputRef} className="hidden" type="file" accept=".zip,.scuri" aria-label="Choose a Scuri project backup"
        onChange={event => void reviewProjectBackup(event.target.files?.[0])} />
      {backupPreview ? <BackupReview preview={backupPreview} busy={busy === "backup"} onCancel={() => setBackupPreview(null)} onRestore={() => void restoreProjectBackup()} /> : null}

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
                {!templateCloudConfigured
                  ? "Cloud connection required"
                  : !templateAuthReady
                    ? "Restoring your saved sign-in…"
                    : templateUser
                      ? `Signed in as ${templateUser.email ?? "your account"}`
                      : "Sign in for permanent cross-device templates"}
              </p>
              <p className="mt-1 text-xs leading-5 text-neutral-500">
                {!templateCloudConfigured
                  ? "The editor works now, but Supabase must be connected before a template can sync to iPhone, iPad and desktop."
                  : !templateAuthReady
                    ? "Scuri is checking this browser for your existing session."
                    : templateUser
                      ? templateLibrarySynced
                        ? "Every saved template is backed up to the cloud. This device stays signed in."
                        : "Some local changes are waiting to sync. This device stays signed in."
                      : "Use the same email on every device. You only need to sign in once on each browser or installed app."}
              </p>
            </div>
            {templateCloudConfigured ? (
              !templateAuthReady ? <span className="template-status pending">Checking…</span> : templateUser ? (
                <div className="flex gap-2">
                  <button className="secondary-button" type="button" disabled={templateCloudBusy} onClick={() => void manuallySyncTemplates()}>
                    {templateCloudBusy ? "Syncing…" : "Sync now"}
                  </button>
                  <button className="text-button" type="button" disabled={templateCloudBusy} onClick={() => setShowPasswordSetup(true)}>Set password</button>
                  <button className="text-button" type="button" disabled={templateCloudBusy} onClick={() => void signOutTemplates()}>Sign out</button>
                </div>
              ) : <button className="secondary-button" type="button" onClick={() => setShowTemplateSignIn(true)}>Sign in by email</button>
            ) : <span className="template-status pending">Setup pending</span>}
          </section>

          <TemplateFilterControls templates={[...TEMPLATES, ...customTemplates]} filters={templateFilters} onChange={setTemplateFilters} />

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
            {filteredCustomTemplates.length ? (
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
                {filteredCustomTemplates.map((item) => (
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
                <p className="text-sm font-semibold">No custom templates match these filters.</p>
                <button className="primary-button mt-4" type="button" onClick={beginNewTemplate}>Create your first template</button>
              </div>
            )}
          </section>

          <section className="mt-11" aria-labelledby="built-in-templates-heading">
            <p className="eyebrow">Scuri originals</p>
            <h2 id="built-in-templates-heading" className="mt-2 text-2xl font-medium tracking-[-0.035em]">Built-in templates</h2>
            <p className="mt-2 text-sm text-neutral-600">Edit or duplicate one to create your own copy. The original always stays available.</p>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
              {filteredBuiltInTemplates.map((item) => (
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
              <p className="mt-4 max-w-[560px] text-sm leading-6 text-neutral-600">Open a project to edit, reorder and export its pages. Sign in to keep them - and their full-resolution photos - available on every device.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="secondary-button" type="button" disabled={busy !== null} onClick={() => backupInputRef.current?.click()}>Restore backup</button>
              <button className="primary-button" type="button" onClick={beginNewProject}>+ New project</button>
            </div>
          </section>

          {deletedProjects.length ? <div className="mt-4 rounded-xl border border-neutral-300 p-4 text-sm">
            <p>Recently removed: {deletedProjects.at(-1)?.name}. Restore is available during this session.</p>
            <button type="button" className="small-button mt-2" disabled={busy !== null} onClick={restoreDeletedProject}>Restore a copy</button>
          </div> : null}

          <section className="account-banner mt-7" aria-label="Project cloud sync status">
            <div>
              <p className="text-sm font-semibold">
                {!projectCloudConfigured
                  ? "Cloud connection required"
                  : !templateAuthReady
                    ? "Restoring your saved sign-in…"
                    : templateUser
                      ? `Signed in as ${templateUser.email ?? "your account"}`
                      : "Local workspace · sign in for cloud projects"}
              </p>
              <p className="mt-1 text-xs leading-5 text-neutral-500">
                {!projectCloudConfigured
                  ? "The editor works now, but Supabase must be connected before a project can sync to iPhone, iPad and desktop."
                  : !templateAuthReady
                    ? "Scuri is checking this browser for your existing session."
                    : templateUser
                      ? "Project structure, layouts and photo metadata sync automatically. Connect Google Drive below to back up full-resolution originals."
                      : "Local and older on-device projects stay here. To transfer one to your account, download its backup, sign in, then restore it."}
              </p>
            </div>
            {projectCloudConfigured ? (
              !templateAuthReady ? <span className="template-status pending">Checking…</span> : templateUser ? (
                <button className="text-button" type="button" disabled={templateCloudBusy} onClick={() => void signOutTemplates()}>Sign out</button>
              ) : <button className="secondary-button" type="button" onClick={() => setShowTemplateSignIn(true)}>Sign in by email</button>
            ) : <span className="template-status pending">Setup pending</span>}
          </section>

          {projectCloudConfigured && templateUser ? (
            <section className="account-banner mt-3" aria-label="Google Drive photo backup status">
              <div>
                <p className="text-sm font-semibold">
                  {!driveConfigured
                    ? "Google Drive setup required"
                    : driveConnected
                      ? "Google Drive photo backup is connected"
                      : busy === "drive"
                        ? driveProgress?.label ?? "Connecting Google Drive…"
                        : "Connect Drive to upload or download photos"}
                </p>
                <p className="mt-1 text-xs leading-5 text-neutral-500">
                  {!driveConfigured
                    ? "Add Scuri's Google OAuth client ID to enable private, cross-device photo backup."
                    : driveConnected
                      ? "Original photos and lightweight previews back up to a private Scuri folder in your Drive."
                      : "Connect Drive so full-resolution originals open on other devices too. Project structure syncs either way."}
                </p>
              </div>
              {driveConfigured ? (
                driveConnected ? (
                  <button className="text-button" type="button" onClick={() => void disconnectGoogleDrive()}>Disconnect</button>
                ) : (
                  <button className="secondary-button" type="button" disabled={!googleScriptReady || busy !== null} onClick={() => void connectGoogleDrive()}>
                    {googleScriptReady ? (driveAccessToken ? "Reconnect Google Drive" : "Connect Google Drive") : "Loading Google…"}
                  </button>
                )
              ) : <span className="template-status pending">Setup pending</span>}
            </section>
          ) : null}

          {projects.length ? (
            <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Saved projects">
              {sortProjectsByLastEdited(projects).map((project) => (
                <ProjectLibraryCard
                  key={project.id}
                  format={getFormat(project.formatId)}
                  project={project}
                  syncState={getProjectSyncStatus(project, {
                    online: isOnline,
                    signedIn: projectCloudSignedIn,
                    isSyncing: Boolean(syncingProjectIds[project.id]),
                    hasError: Boolean(projectSyncErrors[project.id]),
                    driveConfigured,
                    driveTokenValid: driveConnected,
                  })}
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
                  historyGroupRef.current = "project-name";
                  setProjectName(event.target.value);
                  setProjectUpdatedAt(nextProjectEditTime(activeProjectRef.current));
                }}
                onBlur={() => {
                  if (projectName.trim()) return;
                  setProjectName(getDefaultProjectName(projects.filter((project) => project.id !== projectId).map((project) => project.name)));
                  setProjectUpdatedAt(nextProjectEditTime(activeProjectRef.current));
                }}
              />
              <p className="mt-2 text-sm text-neutral-600">
                {pages.length ? `${completePageCount} of ${pages.length} ready to export` : "Choose a layout to add your first page."}
              </p>
            </div>
            <div className="grid w-full gap-2 sm:w-auto sm:min-w-[210px]">
              <button className="primary-button" type="button" disabled={!completePageCount || busy !== null} onClick={() => reviewExportPages()}>
                {!pages.length ? "Add a page first" : !completePageCount ? "Complete a page to export" : `Export all ${completePageCount}`}
              </button>
              <button className="secondary-button" type="button" disabled={!completePageCount || busy !== null} onClick={() => {
                setSelectedExportIds(pages.filter(page => isPageAssigned(page, resolvePageTemplate(page))).map(page => page.id)); setSelectExportPages(true);
              }}>Export selected pages…</button>
              <button className="secondary-button" type="button" disabled={pages.length >= MAX_PROJECT_PAGES || busy !== null} onClick={addPage}>+ Add page ({pages.length}/{MAX_PROJECT_PAGES})</button>
              {projectCloudConfigured && templateUser ? (
                <button className="text-button justify-center" type="button" disabled={Boolean(syncingProjectIds[projectId]) || busy !== null} onClick={() => void syncCurrentProjectNow()}>
                  {syncingProjectIds[projectId] ? "Syncing…" : "Sync now"}
                </button>
              ) : null}
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
                    onExport={(pageId) => reviewExportPages([pageId])}
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
              <p className="eyebrow">{templatePickerIntent?.kind === "replace" ? "Change page layout" : `Add page ${pages.length + 1}`} · {format.aspectRatio}</p>
              <h1 className="mt-2 text-3xl font-medium tracking-[-0.04em] sm:text-4xl">Choose a layout</h1>
              <p className="mt-2 text-sm text-neutral-600">Standard output is {format.width} × {format.height}px. Choose a larger size when exporting.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="secondary-button" type="button" onClick={goBack}>Cancel</button>
              <button className="secondary-button" type="button" onClick={() => setShowInstallHelp(true)}>Installation help</button>
            </div>
          </section>
          <TemplateFilterControls templates={templates} filters={pageTemplateFilters} onChange={setPageTemplateFilters} fixedFormat={format.id} />
          <p className="mt-4 text-sm text-neutral-600" role="status">{filteredPageTemplates.length} of {templates.length} templates</p>
          {!filteredPageTemplates.length ? (
            <div className="mt-5 rounded-[18px] border border-dashed border-black/15 bg-white/40 p-8 text-center">
              <p className="text-sm font-semibold">No templates match these filters.</p>
              <p className="mt-2 text-sm text-neutral-600">Try another photo count or corner style, or clear the filters above.</p>
            </div>
          ) : null}
          <section className="mt-7 grid grid-cols-2 gap-3 pb-10 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4" aria-label={`${format.name} templates`}>
            {filteredPageTemplates.map((item) => (
              <button key={item.id} className="template-card" type="button" onClick={() => void selectTemplate(item)}>
                <span className="template-preview" style={{ aspectRatio: `${item.canvasWidth}/${item.canvasHeight}` }}>
                  <TemplateThumbnail template={item} selected={item.id === pickerPage?.templateId} />
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
            <EditorCanvas key={activePage.id}
              format={format}
              template={template}
              background={activePage.background}
              gutter={activePage.gutter}
              photos={displayedPhotos}
              unavailableFrameIds={Object.keys(activePage.unavailablePhotos ?? {})}
              selectedFrameId={selectedFrameId}
              rearrangeMode={rearrangeMode}
              moveFrameMode={moveFrameMode} snapEnabled={snapEnabled} guides={alignmentGuides}
              compositionGuides={compositionGuides}
              onZoomChange={updatePhotoZoom} onFrameMove={updateFramePosition}
              onGuidesChange={setAlignmentGuides} onViewWidthChange={setEditorWidth}
              onSelectFrame={selectEditorFrame}
              onRequestPhoto={requestPhoto}
              onCropChange={updateCrop}
              onMovePhoto={movePhoto}
            />
          </section>
          <aside className="control-panel" aria-label="Editing controls">
            <div>
              <div className="flex items-center justify-between gap-3">
                <p className="eyebrow">Page {pages.findIndex((page) => page.id === activePage.id) + 1} · {template.name}</p>
                <button className="text-button min-h-0" type="button" onClick={changePageLayout}>Change layout</button>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <h1 className="text-2xl font-medium tracking-[-0.035em]">Edit page</h1>
                <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-600">{template.frames.length - missingPhotoCount}/{template.frames.length}</span>
              </div>
              <p className="mt-2 text-sm leading-5 text-neutral-600">
                {moveFrameMode ? "Drag a frame with its photo. Edges snap gently; keep dragging to move past. Changes apply to this page." : rearrangeMode ? "Drag a filled tile onto another tile to swap or move it. Changes autosave." : "Tap a frame, then drag the photo or pinch to zoom. Add or replace photos from your project library."}
              </p>
            </div>

            <div className="control-section">
              {selectedPhoto && selectedResolvedFrame ? <PhotoZoomControl key={`${activePage.id}:${selectedPhoto.frameId}:${selectedPhoto.blobKey}`}
                zoom={selectedPhoto.crop.zoom} minimum={Math.min(selectedPhoto.crop.zoom, minimumPhotoZoom(selectedPhoto.sourceWidth, selectedPhoto.sourceHeight, selectedResolvedFrame))}
                onChange={(zoom, snap) => {
                  if (snap) updatePhotoZoom(selectedPhoto.frameId, zoom);
                  else { setAlignmentGuides([]); updateCrop(selectedPhoto.frameId, setCropZoom(selectedPhoto.crop, zoom)); }
                }} onGestureEnd={() => setAlignmentGuides([])} /> :
                <p className="control-label">Selected photo · {selectedStoredPhoto ? "Photo unavailable" : "Empty frame"}</p>}
              <p id="photo-zoom-help" className="mt-2 text-xs text-neutral-500">0% fills the frame. Negative zoom centres the image and reveals the page background. Type a percentage for an exact size.</p>
              <label className="mt-3 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={snapEnabled} onChange={event => { setSnapEnabled(event.target.checked); setAlignmentGuides([]); }} /> Snap to edges</label>
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={compositionGuides} onChange={event => setCompositionGuides(event.target.checked)} /> Guides</label>
              <p className="text-xs text-neutral-500">Thirds and centre of the selected frame. Hidden in previews and exports.</p>
              {selectedPhoto && selectedFrameId && activePage.unavailablePhotos?.[selectedFrameId] ? <p role="status" className="mt-2 text-xs text-neutral-500">Editing a lightweight preview. Page previews and exports load the full-resolution original.</p> : null}
              <div className="mt-4 grid grid-cols-3 gap-2">
                <button className="small-button" type="button" disabled={!selectedFrameId} onClick={() => selectedFrameId && requestPhoto(selectedFrameId)}>
                  {selectedStoredPhoto ? "Replace" : "Add photo"}
                </button>
                <button className="small-button" type="button" disabled={!selectedPhoto} onClick={resetSelected}>Reset</button>
                <button className="small-button danger" type="button" disabled={!selectedStoredPhoto} onClick={removeSelected}>Remove</button>
              </div>
              <button
                className={`secondary-button mt-2 w-full ${rearrangeMode ? "rearrange-active" : ""}`}
                type="button"
                aria-pressed={rearrangeMode}
                disabled={missingPhotoCount === template.frames.length || template.frames.length < 2}
                onClick={() => { setRearrangeMode((current) => !current); setMoveFrameMode(false); setAlignmentGuides([]); }}
              >
                {rearrangeMode ? "Done rearranging" : "Rearrange photos"}
              </button>
              <button type="button" className={`secondary-button mt-2 w-full ${moveFrameMode ? "rearrange-active" : ""}`}
                aria-pressed={moveFrameMode} onClick={() => { setMoveFrameMode(value => !value); setRearrangeMode(false); setAlignmentGuides([]); }}>
                {moveFrameMode ? "Done moving frames" : "Move frames"}
              </button>
              {moveFrameMode ? <div className="mt-3 grid gap-2">
                <label className="text-xs font-medium" htmlFor="selected-page-frame">Selected frame</label>
                <select id="selected-page-frame" className="rounded-lg border border-black/15 bg-white p-2 text-sm" value={selectedFrameId ?? ""}
                  onChange={event => { setAlignmentGuides([]); selectEditorFrame(event.target.value); }}>
                  <option value="" disabled>Choose a frame</option>
                  {template.frames.map((frame, index) => <option key={frame.id} value={frame.id}>Frame {index + 1}{selectedStoredPhoto?.frameId === frame.id ? " · selected" : ""}</option>)}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className="small-button" disabled={!selectedFrameId || template.frames[0]?.id === selectedFrameId} onClick={() => changeFrameLayer(-1)}>Send backward</button>
                  <button type="button" className="small-button" disabled={!selectedFrameId || template.frames.at(-1)?.id === selectedFrameId} onClick={() => changeFrameLayer(1)}>Bring forward</button>
                </div>
                <p className="text-xs text-neutral-500">Frames can overlap. Select a covered frame above. Arrow keys move by 1px; Shift moves by 10px. Hold Alt while dragging to bypass snapping.</p>
                <p className="text-xs text-neutral-500">Moving keeps the current spacing. The gutter slider then adds extra space around frames.</p>
              </div> : null}
              <p className="mt-2 text-[11px] leading-4 text-neutral-500">
                Import multiple photos to the library, then choose which photo to use in each frame.
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
              <button className="secondary-button w-full" type="button" disabled={!isPageAssigned(activePage, template!) || busy !== null} onClick={() => reviewExportPages([activePage.id])}>Export this page</button>
              <p className="mt-1 text-center text-[11px] leading-4 text-neutral-500">Signed-in projects save automatically. Original photos back up when Drive is connected.</p>
            </div>
          </aside>
        </main>
      ) : null}

      {format && projectId && (screen === "project" || screen === "editor") ? (
        <div className="screen-shell max-w-[1120px] pb-8">
          <ProjectPhotoPanel key={`${templateUser?.id ?? "local"}:${projectId}`} project={{ version: 3, id: projectId, name: projectName, formatId: format.id,
            activePageId, pages: pages.map(serializePage), photoLibrary: projectPhotoLibrary, createdAt: projectCreatedAt, updatedAt: projectUpdatedAt }}
            templates={templates} ownerId={templateUser?.id} accessRevision={driveExpiry} busy={busy !== null}
            getVolatileBlob={getVolatileBlob} getDriveToken={getValidDriveToken}
            onImport={sources => importLibraryPhotos(sources, projectId, templateUser?.id ?? null)} onApply={applySuggestedArrangement} onCombineDuplicates={combineLibraryDuplicates}
            open={showPhotoLibrary} onOpen={() => { photoPickerRef.current = null; setPhotoPickerIntent(null); setShowPhotoLibrary(true); }}
            onClose={closePhotoLibrary} targetLabel={photoPickerIntent ? `Page ${pages.findIndex(page => page.id === photoPickerIntent.pageId) + 1} · frame ${photoPickerIntent.frameId}` : undefined}
            onOverride={setPhotoColour} imports={importItems} onRetryImport={id => importQueueRef.current?.retry(id)} initiallyImport={initiallyImport}
            backupStatus={Object.entries(photoBackupStatus).filter(([key]) => key.startsWith(projectId + ":")).map(([, status]) => status)}
            onRetryBackup={() => { if (driveConnected) { backupQueueRef.current?.enqueue(projectId, now(), true); } else void connectGoogleDrive(); }}
            onChoose={photoPickerIntent ? chooseLibraryPhoto : undefined} />
        </div>
      ) : null}

      {choosePhotoSource ? <ActionDialog title="Choose photo source" onClose={closePhotoLibrary}><section className="photo-source-choice">
        <h2>Add or replace photo</h2><p>Choose an existing project photo, or import new candidates.</p>
        <button type="button" className="primary-button" onClick={() => { setInitiallyImport(false); setChoosePhotoSource(false); setShowPhotoLibrary(true); }}>Scuri photos</button>
        <button type="button" className="secondary-button" onClick={() => { setInitiallyImport(true); setChoosePhotoSource(false); setShowPhotoLibrary(true); }}>Upload from device or Google</button>
        <button type="button" className="text-button" onClick={closePhotoLibrary}>Cancel</button>
      </section></ActionDialog> : null}

      {selectExportPages ? <ActionDialog title="Choose pages to export" onClose={() => setSelectExportPages(false)}><section className="photo-source-choice">
        <h2>Choose pages to export</h2><p>Alternative pages stay saved in your project.</p>
        <div className="export-page-options">{pages.map((page, index) => <label key={page.id}><input type="checkbox" disabled={!isPageAssigned(page, resolvePageTemplate(page))}
          checked={selectedExportIds.includes(page.id)} onChange={event => setSelectedExportIds(ids => event.target.checked ? [...ids, page.id] : ids.filter(id => id !== page.id))} />
          Page {index + 1}{!isPageAssigned(page, resolvePageTemplate(page)) ? " · unfinished" : ""}</label>)}</div>
        <button type="button" className="primary-button" disabled={!selectedExportIds.length} onClick={() => { setSelectExportPages(false); reviewExportPages(selectedExportIds); }}>Review selected pages</button>
        <button type="button" className="text-button" onClick={() => setSelectExportPages(false)}>Cancel</button>
      </section></ActionDialog> : null}

      {showPagePreview && format && projectId && previewPages.length ? <PagePreview key={projectId} pages={previewPages} initialPageId={activePageId}
        format={format} resolveTemplate={resolvePageTemplate} onClose={() => setShowPagePreview(false)}
        outputWidth={exportWidth} onOutputWidthChange={setExportWidth} pageNumbers={previewPages.map(page => pages.findIndex(item => item.id === page.id) + 1)}
        onExport={exportReviewIds ? size => void exportPages(size, exportReviewIds) : undefined} /> : null}

      {screen === "export" && format && exportItems.length ? (
        <main className="screen-shell max-w-[1080px] py-7 sm:py-10">
          <div className="grid items-start gap-7 md:grid-cols-[minmax(0,1fr)_340px]">
            <aside className="rounded-[20px] bg-white p-5 shadow-[0_1px_0_rgba(0,0,0,0.05)] sm:p-6 md:col-start-2 md:row-start-1">
              <p className="eyebrow">Ready to save</p>
              <h1 ref={exportHeadingRef} className="mt-2 text-3xl font-medium tracking-[-0.04em] outline-none" tabIndex={-1}>
                {exportItems.length === 1 ? "Your JPEG is ready." : `${exportItems.length} JPEGs are ready.`}
              </h1>
              <p className="mt-3 text-sm leading-6 text-neutral-600">Each image is {exportItems[0].size.width} × {exportItems[0].size.height}px · high-quality JPEG</p>
              <div className="mt-6 grid gap-2">
                <button className="primary-button" type="button" onClick={() => void shareExports()}>
                  {exportItems.length === 1 ? "Save to Photos / Share" : `Save all ${exportItems.length} to Photos / Share`}
                </button>
                <button className="secondary-button" type="button" onClick={() => void downloadExports()}>
                  {exportItems.length === 1 ? "Download JPEG to Files" : "Download ZIP to Files"}
                </button>
                {driveConnected ? (
                  <button className="secondary-button" type="button" onClick={() => void saveExportsToDrive()}>
                    Save {exportItems.length === 1 ? "export" : "exports"} to Google Drive
                  </button>
                ) : null}
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
                <h2 id="template-sign-in-title" className="mt-2 text-2xl font-medium tracking-[-0.035em]">Sign in to Scuri</h2>
              </div>
              <button className="icon-button" type="button" aria-label="Close sign-in" onClick={() => setShowTemplateSignIn(false)}>×</button>
            </div>
            <p className="mt-4 text-sm leading-6 text-neutral-600">Use the same account on your iPhone, iPad and desktop.</p>
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
                if (event.key === "Enter") void (signInMethod === "password" ? signInWithTemplatePassword() : requestTemplateMagicLink());
              }}
            />
            {signInMethod === "password" ? (
              <>
                <label className="control-label mt-4 block" htmlFor="template-password">Password</label>
                <input id="template-password" className="mt-2 min-h-[48px] w-full rounded-xl border border-black/15 bg-white px-3" type="password" autoComplete="current-password" value={signInPassword} onChange={(event) => setSignInPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void signInWithTemplatePassword(); }} />
              </>
            ) : <p className="mt-2 text-xs leading-5 text-neutral-500">We’ll email a secure one-time link. Once you set a password, you won’t need an email for future devices.</p>}
            <button className="primary-button mt-4 w-full" type="button" disabled={!signInEmail.trim() || (signInMethod === "password" && !signInPassword) || templateCloudBusy} onClick={() => void (signInMethod === "password" ? signInWithTemplatePassword() : requestTemplateMagicLink())}>
              {templateCloudBusy ? (signInMethod === "password" ? "Signing in…" : "Sending link…") : (signInMethod === "password" ? "Sign in with password" : "Email me a sign-in link")}
            </button>
            <button className="text-button mt-3 w-full justify-center" type="button" disabled={templateCloudBusy} onClick={() => setSignInMethod((current) => current === "password" ? "magic-link" : "password")}>
              {signInMethod === "password" ? "Use an email link instead" : "Use a password instead"}
            </button>
            <p className="mt-4 text-xs leading-5 text-neutral-500">Each account has its own workspace. Local projects stay separate; use a project backup to transfer them.</p>
          </section>
        </div>
      ) : null}

      {showPasswordSetup ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowPasswordSetup(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="set-password-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="eyebrow">Account access</p>
                <h2 id="set-password-title" className="mt-2 text-2xl font-medium tracking-[-0.035em]">Set a password</h2>
              </div>
              <button className="icon-button" type="button" aria-label="Close password setup" onClick={() => setShowPasswordSetup(false)}>×</button>
            </div>
            <p className="mt-4 text-sm leading-6 text-neutral-600">This keeps the same Scuri account and cloud library. You can then sign in on another device without waiting for an email link.</p>
            <label className="control-label mt-5 block" htmlFor="new-template-password">New password</label>
            <input id="new-template-password" className="mt-2 min-h-[48px] w-full rounded-xl border border-black/15 bg-white px-3" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
            <label className="control-label mt-4 block" htmlFor="confirm-template-password">Confirm password</label>
            <input id="confirm-template-password" className="mt-2 min-h-[48px] w-full rounded-xl border border-black/15 bg-white px-3" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveTemplatePassword(); }} />
            <button className="primary-button mt-5 w-full" type="button" disabled={templateCloudBusy || !newPassword || !confirmPassword} onClick={() => void saveTemplatePassword()}>{templateCloudBusy ? "Saving…" : "Save password"}</button>
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
            {busy === "backup" ? "Preparing project backup…" : busy === "project" ? "Updating project…" : busy === "image" ? "Preparing photos…" : busy === "duplicate" ? "Duplicating page…" : busy === "drive" ? driveProgress?.label ?? "Working with Google Drive…" : exportProgress ? `Creating image ${exportProgress.current} of ${exportProgress.total}…` : "Preparing download…"}
          </span>
        </div>
      ) : null}
    </div>
    </PhotoPreviewContext.Provider>
  );
}
