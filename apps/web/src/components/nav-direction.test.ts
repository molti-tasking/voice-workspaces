import { describe, expect, it } from "vitest";
import { directionBetween } from "./nav-direction";

describe("which way a navigation moves", () => {
  it("cuts plainly between screens at the same depth", () => {
    // Every dock tap from the record screen to the timeline used to slide a
    // whole new sheet up, mid-drive (27 Sep 2026).
    expect(directionBetween("/record", "/timeline")).toBe("none");
    expect(directionBetween("/timeline", "/trajectory")).toBe("none");
  });

  it("still rises onto a sheet and drops back off it", () => {
    expect(directionBetween("/timeline", "/workspace")).toBe("forward");
    expect(directionBetween("/workspace", "/timeline")).toBe("back");
  });

  it("gives going to the recorder its own transition", () => {
    expect(directionBetween("/workspace", "/record")).toBe("record");
  });
});
