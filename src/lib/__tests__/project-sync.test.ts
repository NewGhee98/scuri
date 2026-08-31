import { describe, expect, it } from "vitest";
import {
  getProjectSyncStatus,
  mergeCloudProjectLibrary,
  projectHasUnbackedAssets,
  resolveProjectConflict,
  rowsToStoredProject,
  type ProjectSyncContext,
} from "../project-sync";
import type { StoredProject } from "../types";

function project(overrides: Partial<StoredProject> = {}): StoredProject {
  return {
    version: 3,
    id: "project-1",
    name: "Trip to Belgium",
    formatId: "instagram-post",
    activePageId: null,
    pages: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

const baseContext: ProjectSyncContext = {
  online: true,
  signedIn: true,
  isSyncing: false,
  hasError: false,
  driveConfigured: false,
  driveTokenValid: false,
};

describe("resolveProjectConflict", () => {
  it("keeps the remote copy canonical and preserves local edits as an unsynced duplicate", () => {
    const local = project({ name: "My project", revision: 3, cloudSyncedAt: "2026-08-30T10:00:00.000Z", updatedAt: "2026-08-30T11:00:00.000Z" });
    const remote = project({ name: "My project (from iPad)", revision: 4, cloudSyncedAt: "2026-08-30T10:30:00.000Z", updatedAt: "2026-08-30T10:30:00.000Z" });

    const { canonical, duplicate } = resolveProjectConflict(local, remote, "new-id", "2026-08-30T12:00:00.000Z");

    expect(canonical).toBe(remote);
    expect(duplicate.id).toBe("new-id");
    expect(duplicate.name).toBe("My project (conflicted copy)");
    expect(duplicate.revision).toBeUndefined();
    expect(duplicate.cloudSyncedAt).toBeUndefined();
    // Nothing from the device's own edit is lost: page/photo content carries over untouched.
    expect(duplicate.pages).toBe(local.pages);
  });
});

describe("projectHasUnbackedAssets", () => {
  it("is true when any photo has not been uploaded to Drive", () => {
    const withPhoto = project({
      pages: [{
        id: "page-1",
        templateId: "t1",
        background: "#fff",
        gutter: 0,
        selectedFrameId: null,
        photos: { frame1: { frameId: "frame1", blobKey: "blob1", sourceWidth: 100, sourceHeight: 100, crop: { positionX: 0, positionY: 0, zoom: 1 } } },
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      }],
    });
    expect(projectHasUnbackedAssets(withPhoto)).toBe(true);

    const backedUp = {
      ...withPhoto,
      pages: [{ ...withPhoto.pages[0], photos: { frame1: { ...withPhoto.pages[0].photos.frame1, driveOriginalId: "drive-1" } } }],
    };
    expect(projectHasUnbackedAssets(backedUp)).toBe(false);
  });

  it("is false for a project with no photos", () => {
    expect(projectHasUnbackedAssets(project())).toBe(false);
  });
});

describe("getProjectSyncStatus", () => {
  it("reports local-only when signed out", () => {
    expect(getProjectSyncStatus(project(), { ...baseContext, signedIn: false })).toBe("local-only");
  });

  it("reports syncing and sync-error before anything else", () => {
    expect(getProjectSyncStatus(project(), { ...baseContext, isSyncing: true })).toBe("syncing");
    expect(getProjectSyncStatus(project(), { ...baseContext, hasError: true })).toBe("sync-error");
  });

  it("reports saved-locally for a never-synced project while online", () => {
    expect(getProjectSyncStatus(project(), baseContext)).toBe("saved-locally");
  });

  it("reports waiting-for-connection for unsynced edits while offline", () => {
    const dirty = project({ cloudSyncedAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:05:00.000Z" });
    expect(getProjectSyncStatus(dirty, { ...baseContext, online: false })).toBe("waiting-for-connection");
  });

  it("reports synced once cloudSyncedAt is not behind updatedAt", () => {
    const clean = project({ cloudSyncedAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" });
    expect(getProjectSyncStatus(clean, baseContext)).toBe("synced");
  });

  it("reports drive-reconnect-required when synced but photos still need a Drive upload", () => {
    const clean = project({
      cloudSyncedAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      pages: [{
        id: "page-1",
        templateId: "t1",
        background: "#fff",
        gutter: 0,
        selectedFrameId: null,
        photos: { frame1: { frameId: "frame1", blobKey: "blob1", sourceWidth: 100, sourceHeight: 100, crop: { positionX: 0, positionY: 0, zoom: 1 } } },
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      }],
    });
    expect(getProjectSyncStatus(clean, { ...baseContext, driveConfigured: true, driveTokenValid: false })).toBe("drive-reconnect-required");
    expect(getProjectSyncStatus(clean, { ...baseContext, driveConfigured: true, driveTokenValid: true })).toBe("synced");
  });
});

describe("mergeCloudProjectLibrary", () => {
  it("keeps a never-synced local project so it can be pushed as new", () => {
    const local = [project({ id: "draft", revision: undefined })];
    const { projects, removedLocalIds } = mergeCloudProjectLibrary(local, [], () => "generated-id");
    expect(projects.map((item) => item.id)).toEqual(["draft"]);
    expect(removedLocalIds).toEqual([]);
  });

  it("drops a previously-synced local project that is confirmed deleted elsewhere and has no local edits", () => {
    const local = [project({ id: "gone", revision: 2, cloudSyncedAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" })];
    const { projects, removedLocalIds } = mergeCloudProjectLibrary(local, [], () => "generated-id");
    expect(projects).toEqual([]);
    expect(removedLocalIds).toEqual(["gone"]);
  });

  it("recovers a previously-synced local project as a new unsynced project when it has unsynced edits but is gone remotely", () => {
    const local = [project({ id: "gone", name: "Recital", revision: 2, cloudSyncedAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:05:00.000Z" })];
    const { projects, removedLocalIds } = mergeCloudProjectLibrary(local, [], () => "generated-id");
    expect(removedLocalIds).toEqual([]);
    expect(projects).toHaveLength(1);
    expect(projects[0].id).toBe("generated-id");
    expect(projects[0].name).toBe("Recital (recovered)");
    expect(projects[0].revision).toBeUndefined();
  });

  it("prefers the device's dirty local copy over remote, otherwise adopts remote", () => {
    const dirtyLocal = project({ id: "shared", name: "Local edit", revision: 1, cloudSyncedAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:10:00.000Z" });
    const remote = project({ id: "shared", name: "Remote edit", revision: 2, cloudSyncedAt: "2026-08-01T00:05:00.000Z", updatedAt: "2026-08-01T00:05:00.000Z" });
    const { projects } = mergeCloudProjectLibrary([dirtyLocal], [remote], () => "generated-id");
    expect(projects[0].name).toBe("Local edit");

    const cleanLocal = project({ id: "shared2", name: "Old local", revision: 1, cloudSyncedAt: "2026-08-01T00:05:00.000Z", updatedAt: "2026-08-01T00:05:00.000Z" });
    const newerRemote = project({ id: "shared2", name: "Newer remote", revision: 2, cloudSyncedAt: "2026-08-01T00:10:00.000Z", updatedAt: "2026-08-01T00:10:00.000Z" });
    const merged2 = mergeCloudProjectLibrary([cleanLocal], [newerRemote], () => "generated-id");
    expect(merged2.projects[0].name).toBe("Newer remote");
  });

  it("adds a remote project the device has never seen", () => {
    const remote = project({ id: "new-from-ipad" });
    const { projects } = mergeCloudProjectLibrary([], [remote], () => "generated-id");
    expect(projects.map((item) => item.id)).toEqual(["new-from-ipad"]);
  });
});

describe("rowsToStoredProject", () => {
  it("reconstructs a project's pages in position order with their photos keyed by frame", () => {
    const stored = rowsToStoredProject(
      {
        id: "p1",
        owner_id: "u1",
        name: "Trip",
        format_id: "instagram-post",
        active_page_id: "page-2",
        drive_folder_id: "drive-folder-1",
        revision: 5,
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-02T00:00:00.000Z",
        deleted_at: null,
      },
      [
        { id: "page-2", project_id: "p1", owner_id: "u1", position: 1, template_id: "t1", template_snapshot: null, background: "#fff", gutter: 0, selected_frame_id: null, created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-01T00:00:00.000Z" },
        { id: "page-1", project_id: "p1", owner_id: "u1", position: 0, template_id: "t1", template_snapshot: null, background: "#fff", gutter: 0, selected_frame_id: null, created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-01T00:00:00.000Z" },
      ],
      [
        { id: "blob-1", project_id: "p1", page_id: "page-1", owner_id: "u1", frame_id: "frame-a", blob_key: "blob-1", drive_file_id: "drive-a", drive_preview_id: "drive-a-preview", source_filename: "a.jpg", mime_type: "image/jpeg", width: 10, height: 10, file_size: 100, crop: { positionX: 0, positionY: 0, zoom: 1 }, created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-01T00:00:00.000Z" },
      ],
    );

    expect(stored.pages.map((page) => page.id)).toEqual(["page-1", "page-2"]);
    expect(stored.pages[0].photos["frame-a"].driveOriginalId).toBe("drive-a");
    expect(stored.revision).toBe(5);
    expect(stored.driveFolderId).toBe("drive-folder-1");
    expect(stored.cloudSyncedAt).toBe("2026-08-02T00:00:00.000Z");
  });
});
