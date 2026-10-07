import { describe, expect, it } from "vitest";
import { isTimeZone, localDate, renderLocalTime, timeZoneOf } from "./clock";

// 08:00 UTC on 7 Oct 2026 is 10:00 in Copenhagen (CEST).
const NOW = new Date("2026-10-07T08:00:30Z");

describe("renderLocalTime", () => {
  it("says the time where they are, and names the zone", () => {
    expect(renderLocalTime(NOW, "Europe/Copenhagen")).toBe(
      `LOCAL TIME: ${localDate(NOW, "Europe/Copenhagen")}, 10:00 (Europe/Copenhagen).`,
    );
  });

  it("says UTC out loud when their zone is not known, rather than passing it off as theirs", () => {
    const line = renderLocalTime(NOW, null);
    expect(line).toContain("08:00 UTC");
    expect(line).toMatch(/not known/);
    expect(renderLocalTime(NOW, "Mars/Olympus_Mons")).toBe(line);
  });

  it("moves the date with the zone, so just after midnight is not yesterday", () => {
    const lateUtc = new Date("2026-10-06T22:30:00Z");
    expect(localDate(lateUtc, "Europe/Copenhagen")).toMatch(/7 October 2026/);
    expect(localDate(lateUtc, null)).toMatch(/6 October 2026/);
  });
});

describe("timeZoneOf", () => {
  it("reads the zone the browser sent with the drive, and nothing else", () => {
    expect(timeZoneOf({ userAgent: "x", timeZone: "Europe/Copenhagen" })).toBe("Europe/Copenhagen");
    expect(timeZoneOf({ timeZone: "not a zone" })).toBeNull();
    expect(timeZoneOf({})).toBeNull();
    expect(timeZoneOf(null)).toBeNull();
  });

  it("refuses anything that is not a string zone", () => {
    expect(isTimeZone(42)).toBe(false);
    expect(isTimeZone("")).toBe(false);
    expect(isTimeZone("x".repeat(100))).toBe(false);
    expect(isTimeZone("UTC")).toBe(true);
  });
});
