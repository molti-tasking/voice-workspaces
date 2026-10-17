import { describe, expect, it } from "vitest";
import { renderRecentDrives } from "./recent-drives";

const NOW = new Date("2026-10-14T16:27:00Z"); // 18:27 in Copenhagen

describe("renderRecentDrives", () => {
  it("names each drive and says when, in their own time zone", () => {
    const section = renderRecentDrives(
      [
        {
          title: "User Interface",
          startedAt: new Date("2026-10-14T16:14:00Z"),
          endedAt: new Date("2026-10-14T16:18:30Z"),
        },
        { title: null, startedAt: new Date("2026-10-13T07:05:00Z"), endedAt: null },
        {
          title: "Car inspection",
          startedAt: new Date("2026-10-10T06:30:00Z"),
          endedAt: new Date("2026-10-10T06:52:00Z"),
        },
      ],
      NOW,
      "Europe/Copenhagen",
    )!;
    // 14 Oct 2026: "What did we discuss last time?" — the answer was right
    // there, thirteen minutes earlier.
    expect(section).toContain('- "User Interface", today at 18:14, 5 min');
    expect(section).toContain("- an unnamed drive, yesterday at 09:05");
    expect(section).toContain('- "Car inspection", Saturday 10 October at 08:30, 22 min');
    expect(section).not.toMatch(/UTC/);
  });

  it("says the names are all it has, so a name is not filled in", () => {
    const section = renderRecentDrives(
      [{ title: "Tone of Voice", startedAt: NOW, endedAt: null }],
      NOW,
      null,
    )!;
    expect(section).toMatch(/You have the names, not the words/);
    expect(section).toMatch(/never fill a name in/);
    expect(section).toMatch(/The times are UTC/);
  });

  it("is absent before a person's first drive is over", () => {
    expect(renderRecentDrives([], NOW, "Europe/Copenhagen")).toBeNull();
  });
});
