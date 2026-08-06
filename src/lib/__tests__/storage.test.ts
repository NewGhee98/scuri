import { describe, expect, it, vi } from "vitest";
import { migrateLegacyProject } from "../storage";
import type { LegacyStoredProject } from "../types";

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
      version: 2,
      id: "project-id",
      activePageId: "page-id",
      formatId: "instagram-post",
      pages: [{ id: "page-id", templateId: legacy.templateId }],
    });
    vi.unstubAllGlobals();
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
});
