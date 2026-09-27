import { describe, expect, it } from "vitest";
import { SCREENS, renderScreen, screenFor } from "./screen";

describe("screen", () => {
  it("names a route coarsely, never passing a raw URL on", () => {
    expect(screenFor("/record")).toBe("conversation");
    expect(screenFor("/workspace?since=2026-09-01")).toBe("workspace");
    expect(screenFor("/board/brief")).toBe("board");
    expect(screenFor("/sessions/abc")).toBe("session");
    expect(screenFor("/survey")).toBe("other");
  });

  it("tells the model what the screen can do, so directions are grounded", () => {
    expect(renderScreen("workspace")).toMatch(/nothing is dragged/);
    expect(renderScreen("board")).toMatch(/dragged between columns/);
    for (const s of SCREENS) expect(renderScreen(s)).toMatch(/^WHICH SCREEN: they have /);
  });

  it("says it does not know rather than guessing", () => {
    expect(renderScreen(null)).toMatch(/not known/);
    expect(renderScreen("../../etc")).toMatch(/not known/);
  });
});
