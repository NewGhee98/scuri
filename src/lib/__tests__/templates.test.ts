import { describe, expect, it } from "vitest";
import { filterTemplates, getTemplateEdgeStyle, getTemplatesForFormat, TEMPLATES, validateTemplate } from "../templates";
import type { TemplateDefinition } from "../types";

describe("template library", () => {
  it("contains fourteen valid templates for each format", () => {
    expect(TEMPLATES).toHaveLength(42);
    expect(getTemplatesForFormat("instagram-post")).toHaveLength(14);
    expect(getTemplatesForFormat("instagram-square")).toHaveLength(14);
    expect(getTemplatesForFormat("instagram-story")).toHaveLength(14);
    for (const template of TEMPLATES) expect(validateTemplate(template)).toEqual([]);
  });

  it("includes a three-image post template", () => {
    const templates = getTemplatesForFormat("instagram-post");
    expect(templates.some((template) => template.frames.length === 3)).toBe(true);
  });

  it("filters templates by exact photo count and corner style", () => {
    const postTemplates = getTemplatesForFormat("instagram-post");
    const roundedThreePhotoTemplates = filterTemplates(postTemplates, {
      formatId: "all",
      photoCount: 3,
      edgeStyle: "rounded",
    });

    expect(roundedThreePhotoTemplates.map((template) => template.name)).toEqual([
      "Rounded stories",
      "Night frames",
    ]);
    expect(filterTemplates(postTemplates, { formatId: "all", photoCount: 2, edgeStyle: "straight" }))
      .toHaveLength(2);
  });

  it("identifies rounded, straight and mixed frame treatments", () => {
    expect(getTemplateEdgeStyle(TEMPLATES.find((template) => template.id === "instagram-post-rounded-stories")!)).toBe("rounded");
    expect(getTemplateEdgeStyle(TEMPLATES.find((template) => template.id === "instagram-post-full-frame")!)).toBe("straight");
    expect(getTemplateEdgeStyle({
      frames: [
        { id: "rounded", x: 0, y: 0, width: 0.5, height: 1, cornerRadius: 0.1 },
        { id: "straight", x: 0.5, y: 0, width: 0.5, height: 1 },
      ],
    })).toBe("mixed");
  });

  it("combines saved custom layouts with matching built-ins", () => {
    const custom: TemplateDefinition & {
      source: "custom";
      status: "saved";
      createdAt: string;
      updatedAt: string;
      syncState: "synced";
    } = {
      id: "custom-one",
      name: "Cloud collage",
      formatId: "instagram-post",
      canvasWidth: 1080,
      canvasHeight: 1350,
      defaultBackground: "#fff",
      defaultGutter: 0,
      frames: [{ id: "frame", x: 0.1, y: 0.1, width: 0.4, height: 0.4, cornerRadius: 0.16 }],
      source: "custom",
      status: "saved",
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
      syncState: "synced",
    };
    expect(getTemplatesForFormat("instagram-post", [custom])).toHaveLength(15);
    expect(getTemplatesForFormat("instagram-story", [custom])).toHaveLength(14);
  });

  it("reports invalid frame geometry and duplicate IDs", () => {
    const invalid: TemplateDefinition = {
      id: "invalid",
      name: "Invalid",
      formatId: "instagram-post",
      canvasWidth: 1080,
      canvasHeight: 1350,
      defaultBackground: "#fff",
      defaultGutter: 0,
      frames: [
        { id: "same", x: 0, y: 0, width: 1, height: 1 },
        { id: "same", x: 0.8, y: 0.8, width: 0.4, height: 0.4 },
      ],
    };
    expect(validateTemplate(invalid)).toEqual(
      expect.arrayContaining(["Frame IDs must be unique within a template.", "same falls outside the canvas."]),
    );
  });
});
