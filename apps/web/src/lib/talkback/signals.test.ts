import { describe, expect, it } from "vitest";
import {
  EMPTY_CONVERSATION,
  applyMessage,
  type Conversation,
  type ConversationMessage,
} from "./conversation";
import { allSignals, driveContext, signalsFor, sparksFor, whyNoSparks } from "./signals";

/** Messages with the clock they arrived at, in minutes from the start. */
type Timed = [minute: number, message: ConversationMessage];

function fold(...messages: Timed[]): Conversation {
  return messages.reduce(
    (state, [minute, message]) => applyMessage(state, message, minute * 60_000),
    EMPTY_CONVERSATION,
  );
}

let seq = 0;
const user = (text: string): ConversationMessage => ({ type: "user", id: `u${++seq}`, text });
const agent = (text: string): ConversationMessage => ({ type: "agent", id: `a${++seq}`, text });
const title = (t: string, ordinal?: number): ConversationMessage => ({
  type: "title",
  title: t,
  ...(ordinal ? { ordinal } : {}),
});
const settled = (ordinal: number, value: boolean): ConversationMessage => ({
  type: "state",
  ordinal,
  settled: value,
});

/** `n` plain words, none of them a cue. */
const plain = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

describe("the conversation's subjects, for the signals", () => {
  it("numbers subjects in the order they came up and keeps the number on a return", () => {
    const state = fold(
      [0, title("TÜV appointment")],
      [0, user("book it")],
      [1, title("Paper intro")],
      [1, user("the framing")],
      [2, title("TÜV appointment")],
    );
    expect(state.sections.map((s) => [s.title, s.ordinal, s.visits])).toEqual([
      ["TÜV appointment", 1, 2],
      ["Paper intro", 2, 1],
    ]);
  });

  it("takes the container's ordinal when it sends one", () => {
    const state = fold([0, title("Paper intro", 4)], [0, user("hello")]);
    expect(state.sections[0]!.ordinal).toBe(4);
  });

  it("stamps when a subject was first and last talked about", () => {
    const state = fold(
      [0, title("TÜV appointment")],
      [1, user("book it")],
      [3, title("Paper intro")],
      [4, user("the framing")],
    );
    expect(state.sections.map((s) => [s.firstAt, s.lastAt])).toEqual([
      [0, 60_000],
      [180_000, 240_000],
    ]);
  });
});

describe("signalsFor", () => {
  it("does not say whose words a subject is built on until there are enough of them", () => {
    const state = fold([0, title("Intro")], [0, user(plain(10))], [0, agent(plain(20))]);
    const [signal] = allSignals(state, 0);
    expect(signal!.agentShare).toBeNull();
    expect(signal!.reasons).toEqual([]);
  });

  it("says when a subject is mostly the agent's words, in words", () => {
    const state = fold([0, title("Intro")], [0, user(plain(10))], [0, agent(plain(50))]);
    const [signal] = allSignals(state, 0);
    expect(signal!.agentShare).toBeCloseTo(50 / 60);
    expect(signal!.reasons).toContain("Mostly Souffleur's words");
    expect(signal!.reasons.join(" ")).not.toMatch(/\d/);
  });

  it("does not count a filler as one of their words", () => {
    const state = fold([0, title("Intro")], [0, user("um the uh intro")]);
    expect(allSignals(state, 0)[0]!.userWords).toBe(2);
  });

  it("knows when they said it back after the agent", () => {
    const state = fold(
      [0, title("Intro")],
      [0, user(plain(5))],
      [0, agent(plain(60))],
      [0, user(plain(25))],
    );
    expect(allSignals(state, 0)[0]!.restated).toBe(true);
  });

  it("judges hesitation against their own median, never alone", () => {
    const sure = `${plain(40)}`;
    const unsure = `maybe ${plain(10)} I think ${plain(10)} probably ${plain(10)} I mean ${plain(10)}`;
    const one = fold([0, title("A")], [0, user(unsure)]);
    expect(allSignals(one, 0)[0]!.hesitation).toBeNull();

    const both = fold(
      [0, title("A")],
      [0, user(sure)],
      [1, title("B")],
      [1, user(unsure)],
      [2, title("C")],
      [2, user(sure)],
    );
    const signals = allSignals(both, 0);
    // Their usual is no cues at all, so the sure subjects are "mid": typical for them.
    expect(signals.map((s) => s.hesitation)).toEqual(["mid", "high", "mid"]);
    expect(signals[1]!.reasons).toContain("You paused over this more than usual");
  });

  it("counts the container's pauses as hesitation", () => {
    const state = fold(
      [0, title("A")],
      [0, { type: "user", id: "p1", text: plain(40), pauses: 3 }],
    );
    const drive = driveContext(state, 0);
    const signal = signalsFor(state.sections[0]!, drive);
    expect(signal.pauses).toBe(3);
    expect(signal.hesitationRate).toBeCloseTo(7.5);
  });

  it("fades a subject that was left, was mostly the agent's, and never come back to", () => {
    const state = fold(
      [0, title("Old")],
      [0, user(plain(10))],
      [0, agent(plain(50))],
      [1, title("New")],
      [1, user(plain(50))],
    );
    const [old, fresh] = allSignals(state, 12 * 60_000);
    expect(old!.fade).toBeGreaterThan(fresh!.fade);
    expect(old!.fade).toBeLessThanOrEqual(1);
  });
});

describe("sparksFor", () => {
  it("offers to say back a subject that is mostly the agent's words", () => {
    const state = fold([0, title("Intro")], [0, user(plain(10))], [0, agent(plain(50))]);
    expect(sparksFor(state, 0)).toEqual([
      expect.objectContaining({ kind: "say_back", ordinal: 1, title: "Intro" }),
    ]);
  });

  it("stops offering it once they have said it back", () => {
    const state = fold(
      [0, title("Intro")],
      [0, user(plain(10))],
      [0, agent(plain(50))],
      [0, user(plain(25))],
    );
    expect(sparksFor(state, 0).map((s) => s.kind)).not.toContain("say_back");
  });

  it("offers to decide an open subject they have said enough about", () => {
    const state = fold([0, title("Budget")], [0, user(plain(70))], [1, settled(1, false)]);
    expect(sparksFor(state, 0).map((s) => s.kind)).toEqual(["decide"]);
  });

  it("does not offer to decide a settled one, or one barely talked about", () => {
    expect(sparksFor(fold([0, title("A")], [0, user(plain(70))], [0, settled(1, true)]), 0)).toEqual([]);
    expect(sparksFor(fold([0, title("A")], [0, user(plain(20))], [0, settled(1, false)]), 0)).toEqual([]);
  });

  it("offers to revisit a faded subject only once it has been left", () => {
    const state = fold(
      [0, title("Old")],
      [0, user(plain(30))],
      [1, title("New")],
      [1, user(plain(30))],
    );
    const sparks = sparksFor(state, 20 * 60_000);
    expect(sparks.map((s) => [s.kind, s.title])).toEqual([["revisit", "Old"]]);
  });

  it("shows at most three, the most faded first, and none for a subject already pulled", () => {
    const messages: Timed[] = [];
    for (let i = 0; i < 5; i++) {
      messages.push([i, title(`S${i}`)], [i, user(plain(10))], [i, agent(plain(50))]);
    }
    const state = fold(...messages);
    const sparks = sparksFor(state, 10 * 60_000);
    expect(sparks).toHaveLength(3);
    expect(sparks.map((s) => s.title)).toEqual(["S0", "S1", "S2"]);
    const pulled = sparksFor(state, 10 * 60_000, new Set([1]));
    expect(pulled.map((s) => s.title)).toEqual(["S1", "S2", "S3"]);
  });

  it("never offers a spark for talk that has no subject yet", () => {
    const state = fold([0, user(plain(10))], [0, agent(plain(50))]);
    expect(sparksFor(state, 0)).toEqual([]);
  });
});

describe("sparksFor, when the person chooses (sparkSelection: chosen)", () => {
  const keep = (ordinal: number, via: "tap" | "voice" = "tap"): ConversationMessage => ({
    type: "keep",
    ordinal,
    kept: true,
    via,
  });

  it("offers nothing on a subject they did not keep, however much a rule fits it", () => {
    // Mostly the agent's words: suggested would offer say_back here.
    const state = fold([0, title("Intro")], [0, user(plain(10))], [0, agent(plain(50))]);
    expect(sparksFor(state, 0, new Set(), "suggested")).toHaveLength(1);
    expect(sparksFor(state, 0, new Set(), "chosen")).toEqual([]);
  });

  it("offers a spark on every kept subject: the rule that fits, or else say it back", () => {
    const state = fold(
      [0, title("Budget")],
      [0, user(plain(70))],
      [1, settled(1, false)],
      [1, title("Pilot")],
      [1, user(plain(30))],
      [2, keep(1)],
      [2, keep(2, "voice")],
    );
    const sparks = sparksFor(state, 2 * 60_000, new Set(), "chosen");
    expect(sparks.map((s) => [s.title, s.kind]).sort()).toEqual([
      ["Budget", "decide"],
      ["Pilot", "say_back"],
    ]);
    expect(sparks.find((s) => s.title === "Pilot")?.reason).toBe("You're keeping this one");
  });

  it("drops a kept subject's spark once it has been pulled, like any other", () => {
    const state = fold([0, title("Pilot")], [0, user(plain(30))], [1, keep(1)]);
    expect(sparksFor(state, 0, new Set([1]), "chosen")).toEqual([]);
  });

  it("says which subjects were kept, and how, in the signals", () => {
    const state = fold([0, title("Pilot")], [0, user(plain(30))], [3, keep(1, "voice")]);
    const [signal] = allSignals(state, 0);
    expect(signal).toMatchObject({ keptVia: "voice", keptAt: 3 * 60_000 });
    expect(signal?.reasons).toContain("You're keeping this one");
  });
});

describe("whyNoSparks: what an empty spark row says", () => {
  const keep = (ordinal: number): ConversationMessage => ({ type: "keep", ordinal, kept: true, via: "tap" });

  it("asks them to keep a subject when they choose and have kept nothing", () => {
    const state = fold([0, title("Pilot")], [0, user(plain(30))]);
    expect(whyNoSparks(state, new Set(), "chosen")).toBe("keep");
  });

  it("says every kept subject has had its spark once they have all been pulled", () => {
    const state = fold([0, title("Pilot")], [0, user(plain(30))], [1, keep(1)]);
    expect(whyNoSparks(state, new Set([1]), "chosen")).toBe("asked");
    expect(whyNoSparks(state, new Set(), "chosen")).toBe("keep");
  });

  it("says they come with talk when the signals choose", () => {
    const state = fold([0, title("Pilot")], [0, user(plain(30))], [1, keep(1)]);
    expect(whyNoSparks(state, new Set(), "suggested")).toBe("talk");
  });
});
