import { describe, expect, it } from "vitest";
import {
  EMPTY_CONVERSATION,
  applyMessage,
  createConversationStore,
  currentTitle,
  draftMajor,
  parseServerMessage,
  timeline,
  titlesForReconnect,
  type Conversation,
  type ConversationMessage,
  type MarkInput,
  type Run,
} from "./conversation";
import { allSignals, sparksFor } from "./signals";

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
    expect(state.sections[0]!.turns).toEqual([
      { id: "c-1", seq: 0, who: "agent", text: "The framing holds." },
    ]);
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

describe("the conversation, in order", () => {
  const draft = (draftId: string, major = 1): ConversationMessage => ({
    type: "mark",
    mark: { kind: "draft", draftId, major },
  });
  const spark = (ordinal: number, question?: string): ConversationMessage => ({
    type: "mark",
    mark: { kind: "spark", ordinal, spark: "say_back", ...(question ? { question } : {}) } satisfies MarkInput,
  });

  /** Each run as its headline and what is under it: turn ids, and marks by key. */
  function runs(state: Conversation) {
    return timeline(state).map((run: Run) => [
      run.isReturn ? `back to ${run.title}` : run.title,
      run.items.map((item) => (item.kind === "turn" ? item.turn.id : item.mark.key)),
    ]);
  }

  it("numbers turns as they first arrive, across both speakers and a reconnect", () => {
    const state = fold(
      title("Paper"),
      user("k1-4", "the intro"),
      agent("k1-5", "Start with the gap."),
      agent("k1-5", "Start with the gap in the literature."),
      user("k2-1", "and after the tunnel"),
    );
    expect(state.sections[0]!.turns.map((t) => [t.id, t.seq])).toEqual([
      ["k1-4", 0],
      ["k1-5", 1],
      ["k2-1", 2],
    ]);
    expect(state.nextSeq).toBe(3);
  });

  it("puts a return to a subject at the bottom, as a run of its own", () => {
    const state = fold(
      title("TÜV appointment"),
      user("c-1", "book it"),
      title("Paper intro"),
      user("c-2", "the intro"),
      agent("c-3", "Which part?"),
      title("TÜV appointment"),
      user("c-4", "back to the car"),
    );
    expect(runs(state)).toEqual([
      ["TÜV appointment", ["c-1"]],
      ["Paper intro", ["c-2", "c-3"]],
      ["back to TÜV appointment", ["c-4"]],
    ]);
    const all = timeline(state);
    expect(all.map((r) => r.current)).toEqual([false, false, true]);
    expect(all.map((r) => r.turns)).toEqual([1, 2, 1]);
  });

  it("starts the new subject's run where the talk turned to it, and keeps the runs' ids", () => {
    const before = fold(
      title("TÜV appointment"),
      user("c-1", "book it for Tuesday"),
      user("c-2", "anyway, the paper intro"),
      agent("c-3", "Start from switching costs."),
    );
    const after = applyMessage(before, title("Paper intro", "c-2"));
    expect(runs(after)).toEqual([
      ["TÜV appointment", ["c-1"]],
      ["Paper intro", ["c-2", "c-3"]],
    ]);
    expect(timeline(before)[0]!.id).toBe(timeline(after)[0]!.id);
    expect(after.sections[1]!.turns.map((t) => t.seq)).toEqual([1, 2]);
  });

  it("names the untitled start in place, under the same run", () => {
    const before = fold(user("c-1", "so the car"));
    const after = applyMessage(before, title("TÜV appointment"));
    expect(runs(before)).toEqual([[null, ["c-1"]]]);
    expect(runs(after)).toEqual([["TÜV appointment", ["c-1"]]]);
    expect(timeline(after)[0]!.id).toBe(timeline(before)[0]!.id);
  });

  it("shows a subject named before anything was said under it as the current run", () => {
    const state = fold(title("A"), user("c-1", "a"), title("B"));
    const all = timeline(state);
    expect(runs(state)).toEqual([
      ["A", ["c-1"]],
      ["B", []],
    ]);
    expect(all[1]).toMatchObject({ id: "now:b", current: true, turns: 0 });
  });

  it("places a draft after the agent's latest turn, once", () => {
    const state = fold(
      title("Email to William"),
      user("c-1", "draft me an email to William"),
      agent("c-2", "It's in a draft."),
      user("c-3", "thanks"),
      draft("d1"),
    );
    expect(runs(state)).toEqual([["Email to William", ["c-1", "c-2", "draft:d1:1", "c-3"]]]);
    expect(applyMessage(state, draft("d1"))).toBe(state);
  });

  it("adds a line for each version the agent writes, where it was asked for", () => {
    const state = fold(
      title("Email"),
      user("c-1", "draft it"),
      agent("c-2", "Done."),
      draft("d1"),
      user("c-3", "make it shorter"),
      agent("c-4", "Shorter now."),
      draft("d1", 2),
    );
    expect(runs(state)).toEqual([["Email", ["c-1", "c-2", "draft:d1:1", "c-3", "c-4", "draft:d1:2"]]]);
  });

  it("places a pulled spark after whatever was said last", () => {
    const state = fold(
      title("Intro"),
      agent("c-1", "The gap is clear."),
      user("c-2", "right"),
      spark(1, "Where did you land on the intro?"),
    );
    expect(runs(state)).toEqual([["Intro", ["c-1", "c-2", "spark:1"]]]);
    expect(state.marks[0]).toMatchObject({ question: "Where did you land on the intro?", after: 1 });
  });

  it("leads with drafts that came before any turn it could follow", () => {
    expect(runs(fold(draft("d0")))).toEqual([[null, ["draft:d0:1"]]]);
    expect(runs(fold(draft("d0"), user("c-1", "hello")))).toEqual([[null, ["draft:d0:1", "c-1"]]]);
  });

  it("keeps what is not a turn out of everything that judges a subject", () => {
    const talk = [
      title("Intro"),
      user("c-1", "the framing is switching costs and I think it holds for the pilot"),
      agent("c-2", "It holds if the pilot shows the cost of each switch, not only how often it happens."),
    ] as const;
    const plain = talk.reduce((state, m) => applyMessage(state, m, 1_000), EMPTY_CONVERSATION);
    const marked = [draft("d1"), spark(1)].reduce((state, m) => applyMessage(state, m, 9_000), plain);
    expect(marked.sections).toEqual(plain.sections);
    expect(allSignals(marked, 10_000)).toEqual(allSignals(plain, 10_000));
    expect(sparksFor(marked, 10_000)).toEqual(sparksFor(plain, 10_000));
  });

  it("reads which of the agent's attempts a draft version is", () => {
    expect(["v1", "v1.2", "v3.0", " v12.1", "", "draft"].map(draftMajor)).toEqual([1, 1, 3, 12, 1, 1]);
  });

  it("keeps the order and the marks through a change of subject", () => {
    const state = fold(title("A"), user("c-1", "a"), agent("c-2", "Noted."), draft("d1"), title("B"));
    expect(state.nextSeq).toBe(2);
    expect(state.marks.map((m) => m.key)).toEqual(["draft:d1:1"]);
  });
});

describe("renaming a subject", () => {
  const rename = (ordinal: number, t: string): ConversationMessage => ({ type: "rename", ordinal, title: t });
  const drive = () =>
    fold(
      { type: "title", title: "CHI reviews", ordinal: 1 },
      user("c-1", "two papers to review"),
      { type: "title", title: "Web forms", ordinal: 2 },
      user("c-2", "and the forms paper"),
    );

  it("shows their name on every run of the subject, and keeps its key, turns and ordinal", () => {
    const state = applyMessage(drive(), rename(1, "  CHI 2027   reviews "), 5_000);
    expect(state.sections[0]).toMatchObject({ key: "chi reviews", title: "CHI 2027 reviews", ordinal: 1 });
    expect(state.sections[0]!.turns.map((t) => t.id)).toEqual(["c-1"]);
    expect(state.sections[0]!.lastAt).toBe(drive().sections[0]!.lastAt);
    expect(timeline(state)[0]!.title).toBe("CHI 2027 reviews");
  });

  it("hands the new name to a reconnect, under the same ordinal", () => {
    const state = applyMessage(drive(), rename(1, "CHI 2027 reviews"));
    expect(titlesForReconnect(state)).toEqual([
      { title: "CHI 2027 reviews", ordinal: 1 },
      { title: "Web forms", ordinal: 2 },
    ]);
  });

  it("finds the subject again when the container comes back to it by either name", () => {
    const renamed = applyMessage(drive(), rename(1, "CHI 2027 reviews"));
    // A container that was told: the new name, the same ordinal.
    const told = applyMessage(renamed, { type: "title", title: "CHI 2027 reviews", ordinal: 1 });
    // One that was not: the old name.
    const untold = applyMessage(renamed, { type: "title", title: "CHI reviews", ordinal: 1 });
    for (const state of [told, untold]) {
      expect(state.sections.map((s) => s.title)).toEqual(["CHI 2027 reviews", "Web forms"]);
      expect(state.current).toBe("chi reviews");
    }
    // And by the new name alone, from a container that sends no ordinal.
    const bare = applyMessage(renamed, title("chi 2027 REVIEWS"));
    expect(bare.sections).toHaveLength(2);
    expect(bare.current).toBe("chi reviews");
  });

  it("refuses an empty name, an unknown subject, and a name another subject has", () => {
    const state = drive();
    expect(applyMessage(state, rename(1, "   "))).toBe(state);
    expect(applyMessage(state, rename(9, "Anything"))).toBe(state);
    expect(applyMessage(state, rename(1, "web FORMS"))).toBe(state);
    expect(applyMessage(state, rename(1, "CHI reviews"))).toBe(state);
    // A change of case of its own name is a rename.
    expect(applyMessage(state, rename(1, "CHI Reviews")).sections[0]!.title).toBe("CHI Reviews");
  });

  it("caps a name at what the container keeps", () => {
    const state = applyMessage(drive(), rename(2, "x".repeat(200)));
    expect(state.sections[1]!.title).toHaveLength(64);
  });

  it("never takes a rename from the container", () => {
    expect(parseServerMessage({ type: "rename", ordinal: 1, title: "X" })).toBeNull();
  });
});
