import { describe, expect, it } from "vitest";
import {
  EMPTY_CONVERSATION,
  applyMessage,
  type Conversation,
  type ConversationMessage,
} from "./conversation";
import { KEEP_SETTLE_MS, createKeepWatcher } from "./keep-watcher";

function fold(...messages: ConversationMessage[]): Conversation {
  return messages.reduce((state, message) => applyMessage(state, message, 0), EMPTY_CONVERSATION);
}

const user = (id: string, text: string): ConversationMessage => ({ type: "user", id, text });
const agent = (id: string, text: string): ConversationMessage => ({ type: "agent", id, text });
const title = (t: string, ordinal: number): ConversationMessage => ({ type: "title", title: t, ordinal });

describe("keeping by voice", () => {
  it("keeps the subject a keep command was said under, once it has settled", () => {
    const watcher = createKeepWatcher();
    const state = fold(title("Heat plan", 1), user("u1", "shade over the bus stops"), user("u2", "Keep this one."));
    // Still the newest line and just arrived: it may yet become a sentence.
    expect(watcher.observe(state, 0)).toEqual([]);
    expect(watcher.observe(state, KEEP_SETTLE_MS)).toEqual([
      { ordinal: 1, request: "keep", turnId: "u2" },
    ]);
  });

  it("acts at once when the next line has already started", () => {
    const watcher = createKeepWatcher();
    const state = fold(title("Heat plan", 1), user("u1", "Keep this one."), agent("a1", "…"));
    expect(watcher.observe(state, 0)).toEqual([{ ordinal: 1, request: "keep", turnId: "u1" }]);
  });

  it("waits again when the turn grows, and drops it if it grows into a sentence", () => {
    const watcher = createKeepWatcher();
    let state = fold(title("Budget", 1), user("u1", "Keep this"));
    watcher.observe(state, 0);
    state = applyMessage(state, user("u1", "Keep this simple, though"), 0);
    expect(watcher.observe(state, KEEP_SETTLE_MS * 2)).toEqual([]);
  });

  it("acts on a turn only once", () => {
    const watcher = createKeepWatcher();
    const state = fold(title("Budget", 1), user("u1", "Keep this one."), agent("a1", "…"));
    expect(watcher.observe(state, 0)).toHaveLength(1);
    expect(watcher.observe(state, 10_000)).toEqual([]);
  });

  it("hears taking a keep back", () => {
    const watcher = createKeepWatcher();
    const state = fold(title("Budget", 1), user("u1", "Don't keep this one."), agent("a1", "…"));
    expect(watcher.observe(state, 0)).toEqual([{ ordinal: 1, request: "unkeep", turnId: "u1" }]);
  });

  it("waits for a subject before keeping talk that has none yet", () => {
    const watcher = createKeepWatcher();
    const before = fold(user("u1", "Keep this one."), agent("a1", "…"));
    expect(watcher.observe(before, 0)).toEqual([]);
    const named = applyMessage(before, title("Pilot", 1), 0);
    expect(watcher.observe(named, 0)).toEqual([{ ordinal: 1, request: "keep", turnId: "u1" }]);
  });

  it("never acts on the agent's words", () => {
    const watcher = createKeepWatcher();
    const state = fold(title("Pilot", 1), agent("a1", "Keep this one."), user("u1", "right"));
    expect(watcher.observe(state, 10_000)).toEqual([]);
  });
});
