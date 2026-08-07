import { describe, expect, it } from "vitest";
import {
  chunkStartOffset,
  findCoverageGaps,
  formatOffset,
  toAbsoluteSegments,
} from "./offsets";

describe("toAbsoluteSegments", () => {
  it("lifts chunk-relative seconds onto the absolute session timeline", () => {
    const segments = [
      { start: 0, end: 2.5, text: "the argument only works if" },
      { start: 2.5, end: 4.0, text: "the premise holds" },
    ];
    // This chunk begins 5 minutes into the drive.
    expect(toAbsoluteSegments(segments, 300_000)).toEqual([
      { startOffsetMs: 300_000, endOffsetMs: 302_500, text: "the argument only works if" },
      { startOffsetMs: 302_500, endOffsetMs: 304_000, text: "the premise holds" },
    ]);
  });

  it("keeps the first chunk anchored at zero", () => {
    expect(toAbsoluteSegments([{ start: 0, end: 1, text: "hello" }], 0)).toEqual([
      { startOffsetMs: 0, endOffsetMs: 1000, text: "hello" },
    ]);
  });

  it("drops blank segments Whisper emits for silence", () => {
    const segments = [
      { start: 0, end: 1, text: "  " },
      { start: 1, end: 2, text: "real speech" },
      { start: 2, end: 3, text: "" },
    ];
    const result = toAbsoluteSegments(segments, 1000);
    expect(result).toHaveLength(1);
    expect(result[0]?.text).toBe("real speech");
  });

  it("trims surrounding whitespace from segment text", () => {
    expect(toAbsoluteSegments([{ start: 0, end: 1, text: "  padded  " }], 0)[0]?.text).toBe(
      "padded",
    );
  });

  it("clamps an inverted segment rather than dropping the utterance", () => {
    // Losing speech is worse than a slightly wrong boundary.
    const result = toAbsoluteSegments([{ start: 3, end: 1, text: "inverted" }], 0);
    expect(result[0]).toEqual({ startOffsetMs: 3000, endOffsetMs: 3000, text: "inverted" });
  });

  it("rounds fractional milliseconds rather than truncating", () => {
    const result = toAbsoluteSegments([{ start: 1.2345, end: 1.6789, text: "x" }], 0);
    expect(result[0]).toEqual({ startOffsetMs: 1235, endOffsetMs: 1679, text: "x" });
  });
});

describe("chunkStartOffset", () => {
  it("trusts the recorder's stamped offset", () => {
    expect(chunkStartOffset(45_000, [5000, 5000])).toBe(45_000);
  });

  it("accepts a legitimate zero offset for the first chunk", () => {
    // Guards against a `reported || fallback` regression, where 0 is falsy.
    expect(chunkStartOffset(0, [5000])).toBe(0);
  });

  it("falls back to accumulated durations when the client omitted the offset", () => {
    expect(chunkStartOffset(undefined, [5000, 5000, 4000])).toBe(14_000);
    expect(chunkStartOffset(null, [])).toBe(0);
  });

  it("ignores nonsensical reported offsets", () => {
    expect(chunkStartOffset(-1, [5000])).toBe(5000);
    expect(chunkStartOffset(Number.NaN, [5000])).toBe(5000);
  });
});

describe("findCoverageGaps", () => {
  it("reports no gaps for contiguous chunks", () => {
    const chunks = [
      { startOffsetMs: 0, durationMs: 5000 },
      { startOffsetMs: 5000, durationMs: 5000 },
      { startOffsetMs: 10_000, durationMs: 5000 },
    ];
    expect(findCoverageGaps(chunks)).toEqual([]);
  });

  it("finds audio lost to a dead zone", () => {
    const chunks = [
      { startOffsetMs: 0, durationMs: 5000 },
      { startOffsetMs: 30_000, durationMs: 5000 },
    ];
    expect(findCoverageGaps(chunks)).toEqual([{ fromMs: 5000, toMs: 30_000 }]);
  });

  it("detects a session that did not start at zero", () => {
    expect(findCoverageGaps([{ startOffsetMs: 8000, durationMs: 5000 }])).toEqual([
      { fromMs: 0, toMs: 8000 },
    ]);
  });

  it("handles chunks arriving out of order after an offline drain", () => {
    const chunks = [
      { startOffsetMs: 10_000, durationMs: 5000 },
      { startOffsetMs: 0, durationMs: 5000 },
      { startOffsetMs: 5000, durationMs: 5000 },
    ];
    expect(findCoverageGaps(chunks)).toEqual([]);
  });

  it("tolerates sub-threshold jitter between chunk boundaries", () => {
    const chunks = [
      { startOffsetMs: 0, durationMs: 4980 },
      { startOffsetMs: 5000, durationMs: 5000 },
    ];
    expect(findCoverageGaps(chunks)).toEqual([]);
  });

  it("does not report a gap for overlapping chunks", () => {
    const chunks = [
      { startOffsetMs: 0, durationMs: 6000 },
      { startOffsetMs: 5000, durationMs: 5000 },
    ];
    expect(findCoverageGaps(chunks)).toEqual([]);
  });
});

describe("formatOffset", () => {
  it("formats sub-hour offsets as m:ss", () => {
    expect(formatOffset(0)).toBe("0:00");
    expect(formatOffset(5000)).toBe("0:05");
    expect(formatOffset(65_000)).toBe("1:05");
  });

  it("formats hour-long commutes as h:mm:ss", () => {
    expect(formatOffset(3_600_000)).toBe("1:00:00");
    expect(formatOffset(3_725_000)).toBe("1:02:05");
  });

  it("clamps negatives", () => {
    expect(formatOffset(-500)).toBe("0:00");
  });
});
