import { describe, expect, it } from "vitest";
import { EMPTY_CONVERSATION, applyMessage, type ConversationMessage } from "./conversation";
import { transcriptLines } from "./transcript";

const fold = (...messages: ConversationMessage[]) =>
  messages.reduce((state, message) => applyMessage(state, message, 0), EMPTY_CONVERSATION);

describe("the transcript control", () => {
  it("lists every line in the order it was said, across topics and returns to them", () => {
    const state = fold(
      { type: "title", title: "Trip", ordinal: 1 },
      { type: "user", id: "u1", text: "A weekend away." },
      { type: "agent", id: "a1", text: "Where to?" },
      { type: "title", title: "Budget", ordinal: 2 },
      { type: "user", id: "u2", text: "Three hundred." },
      { type: "title", title: "Trip", ordinal: 1 },
      { type: "agent", id: "a2", text: "Back to the trip, then." },
    );
    expect(transcriptLines(state).map((t) => t.id)).toEqual(["u1", "a1", "u2", "a2"]);
  });

  it("is empty before anything was said", () => {
    expect(transcriptLines(EMPTY_CONVERSATION)).toEqual([]);
  });
});
