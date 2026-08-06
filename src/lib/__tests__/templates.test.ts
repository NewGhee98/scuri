import { describe, expect, it } from "vitest";
import { getTemplatesForFormat, TEMPLATES, validateTemplate } from "../templates";
import type { TemplateDefinition } from "../types";

describe("template library", () => {
  it("contains eight valid templates for each format", () => {
    expect(TEMPLATES).toHaveLength(16);
    expect(getTemplatesForFormat("instagram-post")).toHaveLength(8);
    expect(getTemplatesForFormat("instagram-story")).toHaveLength(8);
    for (const template of TEMPLATES) expect(validateTemplate(template)).toEqual([]);
  });

  it("includes a three-image post template", () => {
    const templates = getTemplatesForFormat("instagram-post");
    expect(templates.some((template) => template.frames.length === 3)).toBe(true);
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
