import { describe, expect, it } from "vitest";
import { levelFromRms, nextLevel } from "./mic-level";

describe("levelFromRms", () => {
  it("reads digital silence as zero rather than as -Infinity dB", () => {
    expect(levelFromRms(0)).toBe(0);
    expect(levelFromRms(Number.NaN)).toBe(0);
  });

  it("keeps a quiet room at zero, so a dead input looks dead", () => {
    // -60 dBFS: below the floor.
    expect(levelFromRms(0.001)).toBe(0);
  });

  it("puts ordinary speech well up the scale and clips loud speech at one", () => {
    // -26 dBFS.
    expect(levelFromRms(0.05)).toBeGreaterThan(0.5);
    // -6 dBFS.
    expect(levelFromRms(0.5)).toBe(1);
  });
});

describe("nextLevel", () => {
  it("rises halfway to a louder target in one frame", () => {
    expect(nextLevel(0, 1)).toBe(0.5);
  });

  it("falls slower than it rises, and never below the target", () => {
    expect(nextLevel(1, 0)).toBeCloseTo(0.9);
    expect(nextLevel(0.5, 0.48)).toBe(0.48);
  });
});
