import { describe, expect, it } from "vitest";
import {
  EMPTY_CONVERSATION,
  applyMessage,
  type Conversation,
  type ConversationMessage,
} from "./conversation";
import { mirrorTopics, topicDigest } from "./mirror";
import { allSignals, type Spark } from "./signals";

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
const title = (t: string, ordinal: number): ConversationMessage => ({ type: "title", title: t, ordinal });
const plain = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

describe("the conversation mirror", () => {
  const conversation = fold(
    [0, title("Denmark", 1)],
    [0, user(plain(40))],
    [0, agent(plain(10))],
    [1, title("Destinations", 2)],
    [1, user(plain(8))],
    [1, agent(plain(60))],
  );

  it("lists the named topics in the order they came up, each on the side whose words it mostly is", () => {
    const topics = mirrorTopics(conversation, allSignals(conversation, 2 * 60_000), []);
    expect(topics.map((t) => [t.title, t.side])).toEqual([
      ["Denmark", "user"],
      ["Destinations", "agent"],
    ]);
  });

  it("marks the topic being talked about, and fades one left long ago", () => {
    const now = fold(
      [0, title("Denmark", 1)],
      [0, user(plain(40))],
      [1, title("Budget", 2)],
      [2, title("Flights", 3)],
      [3, title("Hotel", 4)],
      [20, title("Dinner", 5)],
      [20, user(plain(5))],
    );
    const topics = mirrorTopics(now, allSignals(now, 20 * 60_000), []);
    expect(topics.find((t) => t.title === "Dinner")).toMatchObject({ active: true, faded: false });
    expect(topics.find((t) => t.title === "Denmark")).toMatchObject({ active: false, faded: true });
  });

  it("puts a spark on offer on its topic", () => {
    const destinations = conversation.sections.find((s) => s.title === "Destinations")!;
    const spark: Spark = { kind: "say_back", key: destinations.key, ordinal: 2, title: "Destinations", reason: "" };
    const topics = mirrorTopics(conversation, allSignals(conversation, 0), [spark]);
    expect(topics.find((t) => t.title === "Destinations")?.spark).toBe(spark);
    expect(topics.find((t) => t.title === "Denmark")?.spark).toBeNull();
  });

  it("asks for new bullets only when what was said on a topic changed", () => {
    const section = conversation.sections[0]!;
    const before = topicDigest(section);
    expect(before.lines.map((l) => l.who)).toEqual(["user", "agent"]);
    expect(topicDigest(section).signature).toBe(before.signature);
    const grown = applyMessage(conversation, { type: "agent", id: section.turns[1]!.id, text: `${plain(10)} more` }, 0);
    expect(topicDigest(grown.sections[0]!).signature).not.toBe(before.signature);
  });
});
