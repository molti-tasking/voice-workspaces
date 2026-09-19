/**
 * What the agent is shown of the board.
 *
 * Worth testing rather than eyeballing, because every property here is a
 * decision about the prompt: which columns are omitted, what order they arrive
 * in, when staleness is worth a word, and what happens when the board is bigger
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

function topic(id = "t") {
  return op({ topicId: id, title: "Papers" }, "create_topic");
}

function task(blockId: string, text: string, state: string, sessionId = "s1") {
  return op(
    { blockId, topicId: "t", kind: "task", text, state, spans: [] },
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

describe("buildBoardContext", () => {
  it("says an empty board is empty, and still names the topics a task could go in", () => {
    seq = 0;
    expect(buildBoardContext([topic()]).text).toBe(
      "Their task board right now: nothing open.\nTheir topics: Papers",
    );
  });

  it("renders each live task with its column, the handle to act on it, and its topic", () => {
    seq = 0;
    const { text, shown } = buildBoardContext([
      topic(),
      task("b1", "Submit the EICS paper.", "next"),
    ]);
    expect(text).toBe(
      "Their task board right now:\n- [next] Submit the EICS paper. (card b1 · Papers)\nTheir topics: Papers",
    );
    expect(shown).toBe(1);
  });

  it("omits done and dropped — the columns a conversation about what to do next does not need", () => {
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
    // `total` still counts the whole board, so the route can report how much
    // was withheld rather than implying the board is three cards smaller.
    expect(total).toBe(3);
  });

  it("orders doing before next before open", () => {
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

  it("flags a card untouched across later drives, and stays quiet at one", () => {
    seq = 0;
    const ops = [
      topic(),
      task("b1", "Old one.", "doing", "s1"),
      // Two later drives that touched something else entirely.
      task("b2", "Newer.", "open", "s2"),
      task("b3", "Newest.", "open", "s3"),
    ];
    expect(buildBoardContext(ops).text).toContain("Old one. (card b1 · Papers · untouched for 2 drives)");

    seq = 0;
    const oneDrive = [topic(), task("b1", "Old one.", "doing", "s1"), task("b2", "Newer.", "open", "s2")];
    const text = buildBoardContext(oneDrive).text!;
    expect(text).toContain("Old one.");
    expect(text).not.toContain("untouched");
  });

  it("follows the card through a move rather than showing it twice", () => {
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

  it("stays inside the prompt budget when the board is large", () => {
    seq = 0;
    const ops: StoredOp[] = [topic()];
    for (let i = 0; i < 60; i += 1) {
      ops.push(task(`b${i}`, `A task with a reasonably long description number ${i}.`, "open"));
    }
    const { text, shown, total } = buildBoardContext(ops);
    expect(total).toBe(60);
    expect(shown).toBeLessThan(60);
    expect(text!.length).toBeLessThanOrEqual(
      MAX_BOARD_CHARS + "Their task board right now:\n".length + "\nTheir topics: Papers".length,
    );
  });
});
