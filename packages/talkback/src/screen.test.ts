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

  it("says the recorder leads nowhere while it records, and where the way out is", () => {
    // 14 Oct 2026: told the conversation view had no dock while the map said
    // "the dock at the bottom", the agent invented a menu at the top right and
    // an icon next to Stop, and kept on after four corrections.
    const line = renderScreen("conversation");
    expect(line).toMatch(/no dock, no menu, no other icon or button/);
    expect(line).toMatch(/those places open once they stop the recording/);
    expect(line).toMatch(/never point them at a button there/);
  });

  it("says the topic headings are not the agent's to name or rearrange", () => {
    // 14 Oct 2026: "I'll make sure to keep … as separate topics", said about
    // panel sections it has no control over.
    expect(renderScreen("conversation")).toMatch(/named automatically.*cannot move anything between them/);
  });

  it("says it does not know rather than guessing", () => {
    expect(renderScreen(null)).toMatch(/not known/);
    expect(renderScreen("../../etc")).toMatch(/not known/);
  });
});
