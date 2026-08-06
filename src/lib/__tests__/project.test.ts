import { describe, expect, it } from "vitest";
import {
  getMissingPhotoCount,
  getPhotoFillTargets,
  isPageComplete,
  moveLayoutPhoto,
  moveProjectPage,
  moveProjectPageByOffset,
} from "../project";
import type { ProjectPage, TemplateDefinition } from "../types";

const template: TemplateDefinition = {
  id: "test-template",
  name: "Test template",
  formatId: "instagram-post",
  canvasWidth: 1080,
  canvasHeight: 1350,
  defaultBackground: "#ffffff",
  defaultGutter: 24,
  frames: [
    { id: "one", x: 0, y: 0, width: 0.5, height: 1 },
    { id: "two", x: 0.5, y: 0, width: 0.5, height: 1 },
  ],
};

function page(id: string, photoIds: string[] = []): ProjectPage {
  return {
    id,
    templateId: template.id,
    background: "#ffffff",
    gutter: 24,
    selectedFrameId: null,
    photos: Object.fromEntries(photoIds.map((frameId) => [frameId, {}])) as ProjectPage["photos"],
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
  };
}

describe("project pages", () => {
  it("reports missing photographs and page readiness", () => {
    expect(getMissingPhotoCount(page("a", ["one"]), template)).toBe(1);
    expect(isPageComplete(page("a", ["one"]), template)).toBe(false);
    expect(isPageComplete(page("a", ["one", "two"]), template)).toBe(true);
  });

  it("moves a page to the target position", () => {
    const pages = [page("a"), page("b"), page("c")];
    expect(moveProjectPage(pages, "c", "a").map((item) => item.id)).toEqual(["c", "a", "b"]);
    expect(moveProjectPage(pages, "a", "c").map((item) => item.id)).toEqual(["b", "c", "a"]);
  });

  it("moves pages one place and keeps boundary moves unchanged", () => {
    const pages = [page("a"), page("b"), page("c")];
    expect(moveProjectPageByOffset(pages, "b", -1).map((item) => item.id)).toEqual(["b", "a", "c"]);
    expect(moveProjectPageByOffset(pages, "b", 1).map((item) => item.id)).toEqual(["a", "c", "b"]);
    expect(moveProjectPageByOffset(pages, "a", -1)).toBe(pages);
  });

  it("fills the tapped frame first, then empty frames before replacements", () => {
    const photos = page("a", ["two"]).photos;
    expect(getPhotoFillTargets(template, photos, "two", 1)).toEqual(["two"]);
    expect(getPhotoFillTargets(template, photos, "two", 2)).toEqual(["two", "one"]);
    expect(getPhotoFillTargets(template, photos, "missing", 2)).toEqual([]);
  });

  it("moves a photo into an empty frame and updates its frame identity", () => {
    const photos = { one: { frameId: "one", name: "first" } };
    expect(moveLayoutPhoto(photos, "one", "two")).toEqual({
      two: { frameId: "two", name: "first" },
    });
  });

  it("swaps filled frames while preserving each photo's state", () => {
    const photos = {
      one: { frameId: "one", name: "first", zoom: 1.2 },
      two: { frameId: "two", name: "second", zoom: 1.8 },
    };
    expect(moveLayoutPhoto(photos, "one", "two")).toEqual({
      one: { frameId: "one", name: "second", zoom: 1.8 },
      two: { frameId: "two", name: "first", zoom: 1.2 },
    });
  });
});
