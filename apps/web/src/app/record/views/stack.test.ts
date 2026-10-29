import { describe, expect, it } from "vitest";
import { EMPTY_DIGEST, type ConversationDigest } from "@voicemural/talkback/digest";
import { EMPTY_CONVERSATION, applyMessage, type Conversation, type ConversationMessage } from "@/lib/talkback/conversation";
import { STACK_LIVE_WORDS, STACK_NAMED_SLOTS, stackModel } from "./stack";

const NONE = new Map();

function play(messages: ConversationMessage[]): Conversation {
  return messages.reduce((c, m) => applyMessage(c, m, 0), EMPTY_CONVERSATION);
}
const title = (t: string, ordinal: number): ConversationMessage => ({ type: "title", title: t, ordinal });
const user = (id: string, text: string): ConversationMessage => ({ type: "user", id, text });
const agent = (id: string, text: string): ConversationMessage => ({ type: "agent", id, text });

const trip = [
  title("Train to Hamburg", 1),
  user("u1", "We take the ICE at 9:12 on Saturday and reserve seats."),
  agent("a1", "Seats reserved."),
  title("Hotel in Altona", 2),
  user("u2", "The hotel in Altona is booked for two nights."),
  agent("a2", "Breakfast is not listed on the booking."),
  title("Saturday dinner", 3),
  user("u3", "Where can we eat by the harbour on Saturday?"),
];

describe("the topic stack", () => {
  it("shows the current topic apart and the earlier ones in the order they came up", () => {
    const model = stackModel(play(trip), EMPTY_DIGEST, NONE);
    expect(model.current?.title).toBe("Saturday dinner");
    expect(model.slots.map((s) => [s.kind, s.topic.title])).toEqual([
      ["topic", "Train to Hamburg"],
      ["topic", "Hotel in Altona"],
    ]);
  });

  it("carries each topic's decision, and none before the digest has one", () => {
    const digest: ConversationDigest = {
      ...EMPTY_DIGEST,
      topics: [{ ordinal: 1, you: [], ai: [], ideas: [], decision: "Sat 9:12 ICE, seats reserved" }],
    };
    const model = stackModel(play(trip), digest, NONE);
    expect(model.slots[0]?.topic.decision).toBe("Sat 9:12 ICE, seats reserved");
    expect(model.slots[1]?.topic.decision).toBeNull();
  });

  it("keeps a returned topic's slot as a gap, so nothing else on the shelf moves", () => {
    const back = play([...trip, agent("a3", "The fish place takes bookings until six."), title("Hotel in Altona", 2), user("u4", "Going back to the hotel: is breakfast included?")]);
    const model = stackModel(back, EMPTY_DIGEST, NONE);
    expect(model.current?.title).toBe("Hotel in Altona");
    expect(model.slots.map((s) => [s.kind, s.topic.title])).toEqual([
      ["topic", "Train to Hamburg"],
      ["gap", "Hotel in Altona"],
      ["topic", "Saturday dinner"],
    ]);
  });

  it("hides the line from the topic just left, right after a return", () => {
    const back = play([...trip, agent("a3", "The fish place takes bookings until six."), title("Hotel in Altona", 2), user("u4", "Is breakfast included?")]);
    expect(stackModel(back, EMPTY_DIGEST, NONE).previous).toBeNull();
    const answered = applyMessage(back, agent("a4", "Not yet, ask at check-in."), 0);
    expect(stackModel(answered, EMPTY_DIGEST, NONE).previous).toMatchObject({ who: "user", text: "Is breakfast included?" });
  });

  it("can show the topic before a return for the moment it is cued", () => {
    const back = play([...trip, title("Hotel in Altona", 2), user("u4", "Going back to the hotel")]);
    const cued = stackModel(back, EMPTY_DIGEST, NONE, "saturday dinner");
    expect(cued.current?.title).toBe("Saturday dinner");
    expect(cued.slots.map((s) => s.kind)).toEqual(["topic", "topic"]);
  });

  it("folds the earliest topics into one bubble", () => {
    const many = play(
      Array.from({ length: STACK_NAMED_SLOTS + 3 }, (_, i) => [title(`Topic ${i + 1}`, i + 1), user(`u${i}`, `About topic ${i + 1}.`)]).flat(),
    );
    const model = stackModel(many, EMPTY_DIGEST, NONE);
    expect(model.slots).toHaveLength(STACK_NAMED_SLOTS);
    expect(model.folded.map((t) => t.title)).toEqual(["Topic 1", "Topic 2"]);
  });

  it("marks a topic as theirs, the agent's or both by who said its words", () => {
    const model = stackModel(play(trip), EMPTY_DIGEST, NONE);
    expect(model.slots[0]?.topic.whose).toBe("user");
    expect(model.slots[1]?.topic.whose).toBe("both");
    expect(model.current?.whose).toBe("user");
  });

  it("shows the newest turn's last page, and the turn before as a line", () => {
    // One sentence longer than a page: the last page starts inside it.
    const long = Array.from({ length: STACK_LIVE_WORDS + 4 }, (_, i) => `w${i}`).join(" ");
    const model = stackModel(play([...trip, agent("a3", long)]), EMPTY_DIGEST, new Map([[4, { seq: 4, two: "eat?", one: "eat", line: "Somewhere to eat by the harbour" }]]));
    expect(model.live).toMatchObject({ who: "agent", cut: true, spoken: false });
    expect(model.live?.words.map((w) => w.text)).toEqual(["w14", "w15", "w16", "w17"]);
    expect(model.previous).toEqual({ seq: 4, who: "user", text: "Somewhere to eat by the harbour", provisional: false });
  });

  it("holds the sentence being said in place while the voice says it", () => {
    const text = "The fish place by the pier is good. It opens at six.";
    const voiced = (upTo: string) => text.indexOf(upTo) + upTo.length;
    const live = (v: number) => stackModel(play([...trip, { type: "agent", id: "a3", text, voiced: v }]), EMPTY_DIGEST, NONE).live!;
    const early = live(voiced("place"));
    expect(early).toMatchObject({ spoken: true, cut: false });
    expect(early.words.map((w) => w.text).join(" ")).toBe("The fish place by the pier is good.");
    expect(early.words.filter((w) => w.said)).toHaveLength(3);
    // The same words, at the same offsets, as more is said: nothing shifts.
    expect(live(voiced("pier")).words.map((w) => w.start)).toEqual(early.words.map((w) => w.start));
    expect(live(voiced("It")).words.map((w) => w.text).join(" ")).toBe("It opens at six.");
  });

  it("cuts a turn without a line to its first words, as a guess", () => {
    const model = stackModel(play([...trip, agent("a3", "Okay.")]), EMPTY_DIGEST, NONE);
    expect(model.previous).toMatchObject({ text: "Where can we eat by the harbour on…", provisional: true });
  });

  it("puts a search between their question and the answer", () => {
    const asked = play([...trip, { type: "mark", mark: { kind: "lookup", id: "c1", query: "fish restaurant harbour Hamburg" } }]);
    const searching = stackModel(asked, EMPTY_DIGEST, NONE);
    expect(searching.lookup).toMatchObject({ query: "fish restaurant harbour Hamburg", found: null });
    expect(searching.previous?.who).toBe("user");
    expect(searching.live).toBeNull();

    const found = applyMessage(asked, { type: "mark", mark: { kind: "lookup", id: "c1", query: "fish restaurant harbour Hamburg", found: "3 results found" } }, 0);
    const answering = stackModel(applyMessage(found, agent("a3", "I found three."), 0), EMPTY_DIGEST, NONE);
    expect(answering.lookup?.found).toBe("3 results found");
    expect(answering.live).toMatchObject({ who: "agent" });
    expect(answering.live?.words.map((w) => w.text)).toEqual(["I", "found", "three."]);

    const later = stackModel(applyMessage(applyMessage(found, agent("a3", "I found three."), 0), user("u5", "Great."), 0), EMPTY_DIGEST, NONE);
    expect(later.lookup).toBeNull();
  });
});
