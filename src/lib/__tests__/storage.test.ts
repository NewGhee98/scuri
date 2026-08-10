import { describe, expect, it, vi } from "vitest";
import { loadProjects, migrateLegacyProject, migrateMultiPageProject, saveProjects } from "../storage";
import type { LegacyStoredMultiPageProject, LegacyStoredProject, StoredProject } from "../types";

function stubLocalStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  });
  return values;
}

describe("project storage migration", () => {
  it("turns the previous single composition into the first project page", () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValueOnce("page-id").mockReturnValueOnce("project-id") });
    const legacy: LegacyStoredProject = {
      version: 1,
      screen: "editor",
      formatId: "instagram-post",
      templateId: "instagram-post-hero-trio",
      background: "#ffffff",
      gutter: 24,
      selectedFrameId: "photo-1",
      photos: {},
      updatedAt: "2026-08-06T00:00:00.000Z",
    };

    const migrated = migrateLegacyProject(legacy);

    expect(migrated).toMatchObject({
      version: 3,
      id: "project-id",
      activePageId: "page-id",
      formatId: "instagram-post",
      pages: [{ id: "page-id", templateId: legacy.templateId }],
    });
    vi.unstubAllGlobals();
  });

  it("migrates the existing multi-page project into the library model", () => {
    const existing: LegacyStoredMultiPageProject = {
      version: 2,
      id: "project-id",
      name: "Belgium",
      screen: "editor",
      formatId: "instagram-post",
      activePageId: null,
      pages: [],
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-07T00:00:00.000Z",
    };

    expect(migrateMultiPageProject(existing)).toEqual({
      version: 3,
      id: "project-id",
      name: "Belgium",
      formatId: "instagram-post",
      activePageId: null,
      pages: [],
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    });
  });

  it("rejects an incomplete legacy composition", () => {
    expect(migrateLegacyProject({
      version: 1,
      screen: "format",
      formatId: null,
      templateId: null,
      background: "#ffffff",
      gutter: 24,
      selectedFrameId: null,
      photos: {},
      updatedAt: "2026-08-06T00:00:00.000Z",
    })).toBeNull();
  });

  it("saves and loads every project in the versioned library", () => {
    stubLocalStorage();
    const projects: StoredProject[] = [
      {
        version: 3,
        id: "one",
        name: "First",
        formatId: "instagram-post",
        activePageId: null,
        pages: [],
        createdAt: "2026-08-06T00:00:00.000Z",
        updatedAt: "2026-08-07T00:00:00.000Z",
      },
      {
        version: 3,
        id: "two",
        name: "Second",
        formatId: "instagram-story",
        activePageId: null,
        pages: [],
        createdAt: "2026-08-08T00:00:00.000Z",
        updatedAt: "2026-08-09T00:00:00.000Z",
      },
    ];

    saveProjects(projects);

    expect(loadProjects()).toEqual(projects);
    vi.unstubAllGlobals();
  });
});
