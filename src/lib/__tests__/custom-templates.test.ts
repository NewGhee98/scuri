import { describe, expect, it, vi } from "vitest";
import {
  copyAsCustomTemplate,
  createBlankCustomTemplate,
  createTemplateSyncPlan,
  describeTemplateSync,
  mergeTemplateLibraries,
} from "../custom-templates";
import { getTemplate } from "../templates";
import type { CustomTemplate } from "../types";

vi.stubGlobal("crypto", { randomUUID: vi.fn(() => `id-${Math.random()}`) });

describe("custom template library", () => {
  it("creates an empty format-specific draft", () => {
    const draft = createBlankCustomTemplate("instagram-square");
    expect(draft).toMatchObject({
      formatId: "instagram-square",
      canvasWidth: 1080,
      canvasHeight: 1080,
      status: "draft",
      syncState: "local",
      frames: [],
    });
  });

  it("copies a built-in template without reusing frame IDs", () => {
    const source = getTemplate("instagram-post-hero-trio");
    const copy = copyAsCustomTemplate(source, ["Hero trio copy"]);
    expect(copy.name).toBe("Hero trio copy 2");
    expect(copy.sourceTemplateId).toBe(source.id);
    expect(copy.frames).toHaveLength(source.frames.length);
    expect(copy.frames.map((frame) => frame.id)).not.toEqual(source.frames.map((frame) => frame.id));
  });

  it("keeps a newer pending local edit when merging cloud data", () => {
    const base: CustomTemplate = {
      ...createBlankCustomTemplate("instagram-post"),
      name: "Cloud collage",
      frames: [{ id: "frame", x: 0, y: 0, width: 1, height: 1 }],
      status: "saved",
      updatedAt: "2026-08-10T11:00:00.000Z",
      syncState: "pending",
    };
    const remote: CustomTemplate = {
      ...base,
      name: "Older cloud name",
      updatedAt: "2026-08-10T10:00:00.000Z",
      syncState: "synced",
    };
    expect(mergeTemplateLibraries([base], [remote])[0].name).toBe("Cloud collage");
  });

  it("uploads unsynced local work but applies cloud deletion to previously synced work", () => {
    const unsynced = {
      ...createBlankCustomTemplate("instagram-square"),
      id: "local-draft",
      syncState: "pending" as const,
    };
    const deletedElsewhere = {
      ...createBlankCustomTemplate("instagram-square"),
      id: "cloud-deleted",
      syncState: "synced" as const,
    };

    const plan = createTemplateSyncPlan([unsynced, deletedElsewhere], []);

    expect(plan.uploads.map((template) => template.id)).toEqual(["local-draft"]);
    expect(plan.templates.map((template) => template.id)).toEqual(["local-draft"]);
    expect(plan.removed).toBe(1);
  });

  it("describes both a no-op sync and transferred changes", () => {
    expect(describeTemplateSync({ uploaded: 0, downloaded: 0, removed: 0, failed: 0 }))
      .toBe("Templates are already up to date.");
    expect(describeTemplateSync({ uploaded: 1, downloaded: 2, removed: 1, failed: 0 }))
      .toBe("Sync complete: 1 template uploaded, 2 cloud changes downloaded, 1 cloud deletion applied.");
  });
});
