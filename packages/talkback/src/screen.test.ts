import { describe, expect, it } from "vitest";
import { SCREENS, renderScreen, screenFor } from "./screen";

describe("screen", () => {
  it("names a route coarsely, never passing a raw URL on", () => {
    expect(screenFor("/record")).toBe("conversation");
    expect(screenFor("/workspace?since=2026-09-01")).toBe("workspace");
    expect(screenFor("/board/brief")).toBe("board");
    expect(screenFor("/sessions/abc")).toBe("session");
    expect(screenFor("/conversations?q=deadline")).toBe("conversations");
    expect(screenFor("/survey")).toBe("other");
  });

  it("tells the model what the screen can do, so directions are grounded", () => {
    expect(renderScreen("workspace")).toMatch(/nothing is dragged/);
    expect(renderScreen("board")).toMatch(/dragged between columns/);
    for (const s of SCREENS) expect(renderScreen(s)).toMatch(/^WHICH SCREEN: they have /);
  });

  it("always says where past transcripts are, so it never guesses", () => {
    // "You can see the transcript of our last session in the conversation
    // view" — which shows nothing from earlier drives (28 Sep 2026).
    // Conversations since 7 Oct 2026, where drives are named and searchable.
    for (const s of [...SCREENS, null]) expect(renderScreen(s)).toMatch(/Conversations \(every past recording/);
    expect(renderScreen("conversation")).toMatch(/nothing from earlier drives/);
  });

  it("says it does not know rather than guessing", () => {
    expect(renderScreen(null)).toMatch(/not known/);
    expect(renderScreen("../../etc")).toMatch(/not known/);
  });
});
