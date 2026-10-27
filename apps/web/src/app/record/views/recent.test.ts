import { describe, expect, it } from "vitest";
import { EMPTY_CONVERSATION, applyMessage, type Conversation } from "@/lib/talkback/conversation";
import { LAST_WORDS, localGist, recentLadder, settleGists } from "./recent";

const NONE = new Map();

function talk(lines: [who: "user" | "agent", text: string][]): Conversation {
  let c: Conversation = applyMessage(EMPTY_CONVERSATION, { type: "title", title: "Trip", ordinal: 1 }, 0);
  lines.forEach(([who, text], i) => {
    c = applyMessage(c, { type: who, id: `t${i}`, text }, 0);
  });
  return c;
}

describe("the conversation shrunk by age", () => {
  const conversation = talk([
    ["user", "A weekend in Denmark, under 300 euros."],
    ["agent", "Aarhus, Skagen or Copenhagen?"],
    ["user", "Aarhus sounds good."],
    ["agent", "The train is slower but cheaper than flying."],
    ["user", "So if we take the 9:40 we'd be there by lunch, right?"],
  ]);

  it("keeps the newest turn in its words, the one before in two, earlier ones in one", () => {
    const ladder = recentLadder(conversation, NONE);
    expect(ladder.last).toMatchObject({
      who: "user",
      text: "So if we take the 9:40 we'd be there by lunch, right?",
      cut: false,
    });
    expect(ladder.previous?.who).toBe("agent");
    expect(ladder.previous?.text.split(" ")).toHaveLength(2);
    expect(ladder.earlier.map((w) => w.text.split(" ").length)).toEqual([1, 1, 1]);
  });

  it("takes the model's words for a turn once it has them", () => {
    const seq = (i: number) => conversation.sections[0]!.turns[i]!.seq;
    const before = recentLadder(conversation, NONE);
    expect(before.previous?.provisional).toBe(true);
    const gists = settleGists(NONE, [
      { seq: seq(3), two: "train cheaper", one: "train" },
      { seq: seq(1), two: "three places", one: "places" },
    ]);
    const ladder = recentLadder(conversation, gists);
    expect(ladder.previous).toMatchObject({ text: "train cheaper", provisional: false });
    expect(ladder.earlier.map((w) => w.text)[1]).toBe("places");
    expect(ladder.earlier[0]?.provisional).toBe(true);
  });

  it("changes a turn's words once, and never rewrites them after", () => {
    const first = settleGists(NONE, [{ seq: 4, two: "train cheaper", one: "train" }]);
    const again = settleGists(first, [{ seq: 4, two: "cheaper by rail", one: "rail" }]);
    expect(again).toBe(first);
    expect(again.get(4)?.two).toBe("train cheaper");
    expect(settleGists(first, [{ seq: 5, two: "a", one: "a" }]).size).toBe(2);
  });

  it("shows only the end of a long last turn, and says it was cut", () => {
    const long = Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ");
    const ladder = recentLadder(talk([["agent", long]]), NONE);
    expect(ladder.last?.cut).toBe(true);
    expect(ladder.last?.text.split(" ")).toHaveLength(LAST_WORDS);
    expect(ladder.last?.text.endsWith("w39")).toBe(true);
    expect(ladder.previous).toBeNull();
  });

  it("is empty before anything was said", () => {
    expect(recentLadder(EMPTY_CONVERSATION, NONE)).toEqual({
      earlier: [],
      previous: null,
      last: null,
    });
  });
});

describe("a turn in a few words, without a model", () => {
  it("keeps numbers and names, in the order said, and drops filler", () => {
    expect(localGist("A weekend in Denmark, under 300 euros.", 2)).toBe("Denmark 300");
    expect(localGist("Ja, das ist gut.", 1)).toBe("gut");
    expect(localGist("Okay.", 1)).toBe("Okay");
  });
});
