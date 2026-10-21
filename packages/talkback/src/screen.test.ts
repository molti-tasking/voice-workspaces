import { describe, expect, it } from "vitest";
import { APP_MAP, SCREENS, STUDY_SCREEN, renderScreen, screenFor } from "./screen";

describe("screen", () => {
  it("names a route coarsely, never passing a raw URL on", () => {
    expect(screenFor("/record")).toBe("conversation");
    expect(screenFor("/p")).toBe("conversation");
    expect(screenFor("/p/recall")).toBe("conversation");
    expect(screenFor("/profile")).toBe("other");
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

  it("says a draft is a line in the conversation, never 'this recording's page'", () => {
    // 20 Oct 2026: "It's in your workspace and on this recording's page",
    // said to somebody looking at the recorder, which showed no drafts.
    const line = renderScreen("conversation");
    expect(line).toMatch(/A draft you write shows in it as a line with its title/);
    expect(line).not.toMatch(/this recording's page/);
    for (const s of [...SCREENS, null]) {
      expect(renderScreen(s)).toMatch(/A draft from the drive running now is a line in the conversation view/);
    }
  });

  it("describes the conversation as one column in order, and returns at the bottom", () => {
    const line = renderScreen("conversation");
    expect(line).toMatch(/one column, in the order it was said/);
    expect(line).toMatch(/new headline at the bottom/);
    expect(line).not.toMatch(/two panels/);
  });

  it("says they can rename a headline, and the agent cannot", () => {
    const line = renderScreen("conversation");
    expect(line).toMatch(/you do not name them/);
    expect(line).toMatch(/they can rename one with the pencil beside it/);
  });

  it("names the sparks row and Keep only on a drive that has them", () => {
    const plain = renderScreen("conversation");
    expect(plain).not.toMatch(/sparks|Keep/);
    const chosen = renderScreen("conversation", { sparks: true, keep: true });
    expect(chosen).toMatch(/a row of sparks/);
    expect(chosen).toMatch(/Each headline has Keep/);
    expect(renderScreen("conversation", { sparks: true })).not.toMatch(/Keep/);
    // Other screens are the same on every drive.
    expect(renderScreen("workspace", { sparks: true, keep: true })).toBe(renderScreen("workspace"));
  });

  it("says it does not know rather than guessing", () => {
    expect(renderScreen(null)).toMatch(/not known/);
    expect(renderScreen("../../etc")).toMatch(/not known/);
  });

  it("describes the display a drive forces, and only what that display has", () => {
    const transcript = renderScreen("conversation", { display: "transcript", sparks: false });
    expect(transcript).toMatch(/plain transcript.*no headlines, no topics, no sparks/);
    expect(transcript).not.toMatch(/row of sparks|Keep|pencil/);
    const track = renderScreen("conversation", { display: "track", sparks: true });
    expect(track).toMatch(/map of topics/);
    expect(track).toMatch(/written automatically from what was said, not by you/);
    expect(track).not.toMatch(/row of sparks/);
    expect(renderScreen("conversation", { display: "bubbles", sparks: true })).toMatch(/circles in one panel/);
    // Forced to the column, it reads exactly as the recorder's own view.
    expect(renderScreen("conversation", { display: "conversation", sparks: true })).toBe(
      renderScreen("conversation", { sparks: true }),
    );
  });

  it("gives the display study one line for every view, naming none and pointing nowhere", () => {
    expect(STUDY_SCREEN).not.toMatch(/transcript|headline|topic|circle|bubble|mirror|map|spark/i);
    expect(STUDY_SCREEN).not.toContain(APP_MAP);
    expect(STUDY_SCREEN).toMatch(/Do not describe what is on it/);
  });
});
