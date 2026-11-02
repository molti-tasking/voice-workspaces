import { describe, expect, it } from "vitest";
import { needsRethink, monitorRequest, seenNow, topicsDue, type MonitorSeen } from "./comprehension-monitor";
import { EMPTY_CONVERSATION, applyMessage, type Conversation, type ConversationMessage } from "./conversation";

let seq = 0;
const user = (text: string): ConversationMessage => ({ type: "user", id: `u${++seq}`, text });
const agent = (text: string): ConversationMessage => ({ type: "agent", id: `a${++seq}`, text });
const title = (t: string, ordinal: number): ConversationMessage => ({ type: "title", title: t, ordinal });
const plain = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

function fold(...messages: ConversationMessage[]): Conversation {
  return messages.reduce((state, m, i) => applyMessage(state, m, i * 1000), EMPTY_CONVERSATION);
}

describe("topicsDue", () => {
  it("waits for real talk on a topic", () => {
    const conv = fold(title("Trip", 1), user(plain(20)), agent(plain(20)));
    expect(topicsDue(conv, new Map())).toEqual([]);
  });

  it("looks at a topic once it has had real talk, the one left first", () => {
    const conv = fold(title("Trip", 1), user(plain(40)), agent(plain(40)), title("Dinner", 2), user(plain(70)));
    expect(topicsDue(conv, new Map()).map((s) => s.ordinal)).toEqual([1, 2]);
  });

  it("looks again at a current topic only once it has grown a lot, and at a left one on any new line", () => {
    const conv = fold(title("Trip", 1), user(plain(40)), agent(plain(40)), title("Dinner", 2), user(plain(70)));
    const seen = new Map<number, MonitorSeen>(conv.sections.map((s) => [s.ordinal!, seenNow(conv, s)]));
    expect(topicsDue(conv, seen)).toEqual([]);

    const more = fold(
      title("Trip", 1), user(plain(40)), agent(plain(40)), title("Dinner", 2), user(plain(70)), agent(plain(30)),
    );
    expect(topicsDue(more, seen)).toEqual([]);

    const back = fold(
      title("Trip", 1), user(plain(40)), agent(plain(40)), title("Dinner", 2), user(plain(70)), title("Trip", 1), user(plain(5)), title("Dinner", 2),
    );
    expect(topicsDue(back, seen).map((s) => s.ordinal)).toEqual([1]);
  });
});

describe("monitorRequest", () => {
  it("sends the topic's lines and the local signals as evidence", () => {
    const conv = fold(title("Trip", 1), agent(plain(80)), user("okay sounds good"));
    const req = monitorRequest(conv, conv.sections[0]!, 5000);
    expect(req?.title).toBe("Trip");
    expect(req?.lines.map((l) => l.who)).toEqual(["agent", "user"]);
    expect(req?.evidence.agentShare).toBeGreaterThan(0.9);
  });
});

describe("needsRethink", () => {
  it("is true for a check or a borrowed idea, false when all is held", () => {
    expect(needsRethink(undefined)).toBe(false);
    expect(needsRethink({ ordinal: 1, ideas: [{ text: "x", origin: "you", hold: "held", why: "" }], check: null })).toBe(false);
    expect(needsRethink({ ordinal: 1, ideas: [{ text: "x", origin: "assistant", hold: "borrowed", why: "" }], check: null })).toBe(true);
  });
});
