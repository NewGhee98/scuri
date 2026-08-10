import { describe, expect, it } from "vitest";
import { FORMATS, getExportDimensions, getFormat } from "../formats";

describe("format definitions", () => {
  it("includes portrait, square and Story formats", () => {
    expect(FORMATS.map((format) => format.id)).toEqual(["instagram-post", "instagram-square", "instagram-story"]);
  });

  it("returns exact export dimensions", () => {
    expect(getExportDimensions("instagram-post")).toEqual({ width: 1080, height: 1350 });
    expect(getExportDimensions("instagram-square")).toEqual({ width: 1080, height: 1080 });
    expect(getExportDimensions("instagram-story")).toEqual({ width: 1080, height: 1920 });
  });

  it("rejects unknown formats at runtime", () => {
    expect(() => getFormat("square" as never)).toThrow("Unknown canvas format");
  });
});
