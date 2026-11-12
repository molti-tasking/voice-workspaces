/**
 * What the agent is shown of their tasks: by topic, as the Stack shows them.
 *
 * Worth testing rather than eyeballing, because every property here is a
 * decision about the prompt: which states are omitted, what order the topics
 * and tasks arrive in, when staleness is worth a word, and what happens when the board is bigger
 * than the budget. Getting any of them wrong is invisible in the code and
 * expensive in a drive — a board that quietly sends forty cards doubles the
 * time to first token on every turn.
 *
 * Pure: builds ops in memory and folds them. No database.
 */
import { describe, expect, it } from "vitest";
import type { StoredOp } from "@voicemural/workspace";
import { MAX_BOARD_CHARS, buildBoardContext } from "./board-context";

let seq = 0;
const T0 = new Date("2026-09-13T08:00:00Z");

function op(payload: Record<string, unknown>, type: string, sessionId?: string): StoredOp {
  seq += 1;
  return {
    id: `op-${seq}`,
    seq,
    occurredAt: new Date(T0.getTime() + seq * 1000),
    captureSessionId: sessionId,
    sourceUtteranceIds: [],
    op: { type, ...payload },
  } as unknown as StoredOp;
}

function topic(id = "t", title = "Papers", sessionId?: string) {
  return op({ topicId: id, title }, "create_topic", sessionId);
}

function task(blockId: string, text: string, state: string, sessionId = "s1", topicId = "t") {
  return op(
    { blockId, topicId, kind: "task", text, state, spans: [] },
    "add_block",
    sessionId,
  );
}

function move(blockId: string, from: string, text: string, state: string, sessionId = "s1") {
  return op(
    { blockId, supersedesBlockId: from, topicId: "t", kind: "task", text, state, spans: [] },
    "revise_block",
    sessionId,
  );
}

const HEADING = "Their tasks, by topic — each topic's sheet in the Stack lists these under Tasks:";

describe("buildBoardContext", () => {
  it("says when nothing is open, and still names the topics a task could go in", () => {
    seq = 0;
    expect(buildBoardContext([topic()]).text).toBe("Their tasks: nothing open.\nTheir topics: Papers");
  });

  it("renders each live task under its topic, with its state and the handle to act on it", () => {
    seq = 0;
    const { text, shown } = buildBoardContext([topic(), task("b1", "Submit the EICS paper.", "next")]);
    expect(text).toBe(`${HEADING}\nPapers:\n- [next] Submit the EICS paper. (task b1)`);
    expect(shown).toBe(1);
  });

  it("omits done and dropped — the states a conversation about what to do next does not need", () => {
    seq = 0;
    const { text, total } = buildBoardContext([
      topic(),
      task("b1", "Live one.", "open"),
      task("b2", "Finished one.", "done"),
      task("b3", "Abandoned one.", "dropped"),
    ]);
    expect(text).toContain("Live one.");
    expect(text).not.toContain("Finished one.");
    expect(text).not.toContain("Abandoned one.");
    // `total` still counts every task, so the route can report how much was withheld.
    expect(total).toBe(3);
  });

  it("orders doing before next before open within a topic", () => {
    seq = 0;
    const { text } = buildBoardContext([
      topic(),
      task("b1", "An open one.", "open"),
      task("b2", "A next one.", "next"),
      task("b3", "A doing one.", "doing"),
    ]);
    const lines = text!.split("\n").filter((l) => l.startsWith("- "));
    expect(lines.map((l) => l.match(/^- \[(\w+)\]/)?.[1])).toEqual(["doing", "next", "open"]);
  });

  it("puts the topic whose sheet is open first, then this conversation's, then the rest", () => {
    seq = 0;
    const ops = [
      topic("a", "Thesis", "old"),
      task("a1", "Old thesis task.", "open", "old", "a"),
      topic("b", "Research stay", "old"),
      task("b1", "Email William.", "next", "old", "b"),
      topic("c", "Voice paper", "now"),
      task("c1", "Write the method.", "open", "now", "c"),
    ];
    const text = buildBoardContext(ops, { openTopic: "research stay", captureSessionId: "now" }).text!;
    const headers = text.split("\n").filter((l) => l.endsWith(":") && !l.startsWith("Their"));
    expect(headers).toEqual([
      "Research stay (its sheet is open on their screen):",
      "Voice paper (talked about in this conversation):",
      "Thesis:",
    ]);
  });

  it("names topics with nothing open, so a new task has somewhere to go", () => {
    seq = 0;
    const text = buildBoardContext([topic("a", "Papers"), task("a1", "One.", "open", "s1", "a"), topic("b", "Garden")])
      .text!;
    expect(text).toContain("Their other topics: Garden");
  });

  it("flags a task untouched across later drives, and stays quiet at one", () => {
    seq = 0;
    const ops = [
      topic(),
      task("b1", "Old one.", "doing", "s1"),
      // Two later drives that touched something else entirely.
      task("b2", "Newer.", "open", "s2"),
      task("b3", "Newest.", "open", "s3"),
    ];
    expect(buildBoardContext(ops).text).toContain("Old one. (task b1 · untouched for 2 drives)");

    seq = 0;
    const oneDrive = [topic(), task("b1", "Old one.", "doing", "s1"), task("b2", "Newer.", "open", "s2")];
    const text = buildBoardContext(oneDrive).text!;
    expect(text).toContain("Old one.");
    expect(text).not.toContain("untouched");
  });

  it("follows the task through a state change rather than showing it twice", () => {
    seq = 0;
    const { text, shown } = buildBoardContext([
      topic(),
      task("b1", "Email the host lab.", "next"),
      move("b2", "b1", "Email the host lab.", "doing"),
    ]);
    expect(shown).toBe(1);
    expect(text).toContain("- [doing] Email the host lab.");
    expect(text).not.toContain("[next]");
  });

  it("stays inside the prompt budget, keeping the topic in view rather than the last one", () => {
    seq = 0;
    const ops: StoredOp[] = [topic("a", "Papers"), topic("b", "Open now")];
    for (let i = 0; i < 60; i += 1) {
      ops.push(task(`b${i}`, `A task with a reasonably long description number ${i}.`, "open", "s1", "a"));
    }
    ops.push(task("z1", "The one on screen.", "open", "s1", "b"));
    const { text, shown, total } = buildBoardContext(ops, { openTopic: "Open now" });
    expect(total).toBe(61);
    expect(shown).toBeLessThan(61);
    expect(text).toContain("The one on screen.");
    expect(text!.length).toBeLessThanOrEqual(MAX_BOARD_CHARS + 400);
  });
});
