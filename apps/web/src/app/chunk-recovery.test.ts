import { describe, expect, it } from "vitest";
import { isChunkLoadError, shouldReload } from "./chunk-recovery";

describe("isChunkLoadError", () => {
  it("matches the error name webpack gives a failed chunk load", () => {
    const error = new Error("Failed to load chunk /_next/static/chunks/17.js");
    error.name = "ChunkLoadError";
    expect(isChunkLoadError(error)).toBe(true);
  });

  it("matches the reported message even without the name", () => {
    expect(
      isChunkLoadError(
        new Error("Failed to load chunk /_next/static/chunks/17-qs-nc2u8ji.js"),
      ),
    ).toBe(true);
  });

  it("matches the browser's dynamic import wording", () => {
    expect(
      isChunkLoadError(new Error("error loading dynamically imported module")),
    ).toBe(true);
    expect(
      isChunkLoadError(new Error("Importing a module script failed.")),
    ).toBe(true);
  });

  it("ignores ordinary errors", () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(
      false,
    );
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError("ChunkLoadError")).toBe(false);
  });
});

describe("shouldReload", () => {
  const guardMs = 10_000;

  it("reloads the first time, when no reload has been recorded", () => {
    expect(shouldReload({ now: 1_000, lastReloadAt: null, guardMs })).toBe(true);
  });

  it("suppresses a second reload inside the guard window", () => {
    expect(shouldReload({ now: 5_000, lastReloadAt: 1_000, guardMs })).toBe(false);
  });

  it("reloads again once the guard window has passed", () => {
    expect(shouldReload({ now: 12_000, lastReloadAt: 1_000, guardMs })).toBe(true);
  });
});
