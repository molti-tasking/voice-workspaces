import { describe, expect, it } from "vitest";
import {
  EMPTY_CONVERSATION,
  applyMessage,
  createConversationStore,
  currentTitle,
  parseServerMessage,
  titlesForReconnect,
  type Conversation,
  type ConversationMessage,
} from "./conversation";

function fold(...messages: ConversationMessage[]): Conversation {
  return messages.reduce((state, message) => applyMessage(state, message), EMPTY_CONVERSATION);
}

const user = (id: string, text: string): ConversationMessage => ({ type: "user", id, text });
const agent = (id: string, text: string): ConversationMessage => ({ type: "agent", id, text });
const title = (t: string, rehomeFrom?: string): ConversationMessage => ({
  type: "title",
  title: t,
  ...(rehomeFrom ? { rehomeFrom } : {}),
});

function shape(state: Conversation) {
  return state.sections.map((s) => [s.title, s.turns.map((t) => t.id)]);
}

describe("the conversation, by subject", () => {
  it("files talk said before any title under the first title", () => {
    const state = fold(user("c-1", "so the car"), agent("c-2", "The TÜV."), title("TÜV appointment"));
    expect(shape(state)).toEqual([["TÜV appointment", ["c-1", "c-2"]]]);
    expect(currentTitle(state)).toBe("TÜV appointment");
  });

  it("updates a streaming turn where it is rather than adding it again", () => {
    const state = fold(
      title("Paper intro"),
      agent("c-1", "The"),
      agent("c-1", "The framing"),
      agent("c-1", "The framing holds."),
    );
    expect(state.sections[0]!.turns).toEqual([{ id: "c-1", who: "agent", text: "The framing holds." }]);
  });

  it("moves the turns that changed the subject into the new section", () => {
    const state = fold(
      title("TÜV appointment"),
      user("c-1", "book it for Tuesday"),
      user("c-2", "anyway, the paper intro"),
      agent("c-3", "Start from switching costs."),
      title("Paper intro", "c-2"),
    );
    expect(shape(state)).toEqual([
      ["TÜV appointment", ["c-1"]],
      ["Paper intro", ["c-2", "c-3"]],
    ]);
  });

  it("goes back to a subject's section when the conversation does", () => {
    const state = fold(
      title("TÜV appointment"),
      user("c-1", "book it"),
      title("Paper intro"),
      user("c-2", "the intro"),
      title("tüv  APPOINTMENT"),
      user("c-3", "back to the car"),
    );
    expect(shape(state)).toEqual([
      ["TÜV appointment", ["c-1", "c-3"]],
      ["Paper intro", ["c-2"]],
    ]);
    expect(state.returns).toBe(1);
    expect(currentTitle(state)).toBe("TÜV appointment");
  });

  it("drops a section a move left empty, and keeps the one moved into", () => {
    const state = fold(title("Old"), user("c-1", "new thing"), title("New", "c-1"));
    expect(shape(state)).toEqual([["New", ["c-1"]]]);
  });

  it("ignores the same title again", () => {
    const state = fold(title("Paper intro"), user("c-1", "hi"));
    expect(applyMessage(state, title("PAPER INTRO"))).toBe(state);
  });

  it("keeps a cut-off mark once it is set", () => {
    const state = fold(
      title("Paper"),
      { type: "agent", id: "c-1", text: "The", interrupted: true },
      agent("c-1", "The"),
    );
    expect(state.sections[0]!.turns[0]!.interrupted).toBe(true);
  });

  it("hands a reconnect the titles it has, with their ordinals, the current one last", () => {
    const state = fold(title("A"), user("c-1", "a"), title("B"), user("c-2", "b"), title("A"));
    expect(titlesForReconnect(state)).toEqual([
      { title: "B", ordinal: 2 },
      { title: "A", ordinal: 1 },
    ]);
  });
});

describe("server messages", () => {
  it("accepts the three kinds and refuses everything else", () => {
    expect(parseServerMessage({ type: "title", title: " Paper " })).toEqual({ type: "title", title: "Paper" });
    expect(parseServerMessage({ type: "title", title: "Paper", rehomeFrom: "c-1" })).toEqual({
      type: "title",
      title: "Paper",
      rehomeFrom: "c-1",
    });
    expect(parseServerMessage({ type: "agent", id: "c-1", text: "Hi.", interrupted: true })).toEqual({
      type: "agent",
      id: "c-1",
      text: "Hi.",
      interrupted: true,
    });
    for (const bad of [null, "title", { type: "title" }, { type: "user", id: 1, text: "x" }, { type: "board" }]) {
      expect(parseServerMessage(bad)).toBeNull();
    }
  });
});

describe("the store", () => {
  it("tells its subscribers only when something changed", () => {
    const store = createConversationStore();
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.dispatch(title("Paper"));
    store.dispatch(title("paper"));
    store.dispatch(user("c-1", "hi"));
    off();
    store.dispatch(user("c-2", "again"));
    expect(calls).toBe(2);
    expect(store.getSnapshot().sections[0]!.turns.map((t) => t.id)).toEqual(["c-1", "c-2"]);
  });
});

describe("what the sparks need from the container's messages", () => {
  it("reads an ordinal, a pause count and a judgement, and drops what is malformed", () => {
    expect(parseServerMessage({ type: "title", title: "Intro", ordinal: 3 })).toEqual({
      type: "title",
      title: "Intro",
      ordinal: 3,
    });
    expect(parseServerMessage({ type: "title", title: "Intro", ordinal: "3" })).toEqual({
      type: "title",
      title: "Intro",
    });
    expect(parseServerMessage({ type: "user", id: "c-1", text: "so", pauses: 2 })).toEqual({
      type: "user",
      id: "c-1",
      text: "so",
      pauses: 2,
    });
    expect(parseServerMessage({ type: "state", ordinal: 1, settled: true })).toEqual({
      type: "state",
      ordinal: 1,
      settled: true,
    });
    expect(parseServerMessage({ type: "state", ordinal: 1 })).toBeNull();
  });

  it("files a judgement under the subject with that ordinal, and nowhere else", () => {
    const state = fold(
      title("TÜV appointment"),
      user("c-1", "book it"),
      title("Paper intro"),
      user("c-2", "the framing"),
      { type: "state", ordinal: 1, settled: true },
      { type: "state", ordinal: 9, settled: false },
    );
    expect(state.sections.map((s) => s.settled)).toEqual([true, undefined]);
  });
});

describe("keeping a subject", () => {
  const keep = (ordinal: number, kept = true, via: "tap" | "voice" = "tap"): ConversationMessage => ({
    type: "keep",
    ordinal,
    kept,
    via,
  });
  const twoSubjects = () =>
    fold(
      user("c-1", "the heat plan"),
      { type: "title", title: "Heat plan", ordinal: 1 },
      user("c-2", "and the budget"),
      { type: "title", title: "Budget", ordinal: 2 },
    );

  it("files a keep on the subject by its ordinal, with how and when it was made", () => {
    const state = applyMessage(twoSubjects(), keep(1, true, "voice"), 1_000);
    expect(state.sections.find((s) => s.ordinal === 1)?.kept).toEqual({ via: "voice", at: 1_000 });
    expect(state.sections.find((s) => s.ordinal === 2)?.kept).toBeUndefined();
  });

  it("takes a keep back, and keeps the first keep when kept again", () => {
    const kept = applyMessage(twoSubjects(), keep(2, true, "tap"), 1_000);
    expect(applyMessage(kept, keep(2, true, "voice"), 2_000)).toBe(kept);
    const back = applyMessage(kept, keep(2, false), 3_000);
    expect(back.sections.find((s) => s.ordinal === 2)?.kept).toBeUndefined();
  });

  it("is not a touch: keeping a subject does not make it current or fresher", () => {
    const before = twoSubjects();
    const after = applyMessage(before, keep(1), 9_999);
    expect(after.current).toBe(before.current);
    expect(after.sections[0]?.lastAt).toBe(before.sections[0]?.lastAt);
  });

  it("ignores a keep for a subject it does not have", () => {
    const state = twoSubjects();
    expect(applyMessage(state, keep(7))).toBe(state);
  });

  it("never takes a keep from the container", () => {
    expect(parseServerMessage({ type: "keep", ordinal: 1, kept: true, via: "voice" })).toBeNull();
  });
});
