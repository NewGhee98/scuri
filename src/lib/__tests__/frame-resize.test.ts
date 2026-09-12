import { describe, expect, it } from "vitest";
import { resizeFrame } from "../frame-resize";

const frame = { id: "frame", x: 0.2, y: 0.2, width: 0.4, height: 0.4 };

describe("template frame resizing", () => {
  it("keeps the opposite side fixed for the normal resize mode", () => {
    const resized = resizeFrame(frame, "se", -0.1, 0, false);
    expect(resized.x).toBeCloseTo(0.2);
    expect(resized.y).toBeCloseTo(0.2);
    expect(resized.width).toBeCloseTo(0.3);
    expect(resized.height).toBeCloseTo(0.4);
  });

  it("resizes equally from both sides when centre-anchored", () => {
    const resized = resizeFrame(frame, "se", -0.1, 0, true);
    expect(resized.x).toBeCloseTo(0.3);
    expect(resized.y).toBeCloseTo(0.2);
    expect(resized.width).toBeCloseTo(0.2);
    expect(resized.height).toBeCloseTo(0.4);
    expect(resized.x + resized.width / 2).toBeCloseTo(frame.x + frame.width / 2);
  });

  it("does not let a centre-anchored resize go beyond the canvas edge", () => {
    const resized = resizeFrame(frame, "se", 1, 1, true);
    expect(resized.x).toBeCloseTo(0);
    expect(resized.y).toBeCloseTo(0);
    expect(resized.width).toBeCloseTo(0.8);
    expect(resized.height).toBeCloseTo(0.8);
  });
});
