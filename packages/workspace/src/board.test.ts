import { describe, expect, it } from "vitest";
import {
  columnDistributionByBucket,
  foldBoard,
  judge,
  reversals,
  taskOpStats,
  transitionsOf,
} from "./board";
import { foldWorkspace } from "./fold";
import { buildTrajectory } from "./trajectory";
import type { StoredOp, WorkspaceOp } from "./types";

const D1 = new Date("2026-09-14T08:00:00Z");
const D2 = new Date("2026-09-15T08:00:00Z");
const D3 = new Date("2026-09-16T08:00:00Z");
const D4 = new Date("2026-09-17T08:00:00Z");

let seq = 0;
function op(occurredAt: Date, o: WorkspaceOp, extras: Partial<StoredOp> = {}): StoredOp {
  seq += 1;
  return { id: `op-${seq}`, seq, occurredAt, op: o, ...extras };
}

const TEXT = "Email William about the start date.";

function task(id: string, state: "open" | "next" | "doing" | "done" | "dropped"): WorkspaceOp {
  return { type: "add_block", blockId: id, topicId: "t-a", kind: "task", text: TEXT, state, spans: [{ utteranceId: "u1" }] };
}

function move(
  id: string,
  supersedes: string,
  state: "open" | "next" | "doing" | "done" | "dropped",
  via?: "user",
  text = TEXT,
): WorkspaceOp {
  return {
    type: "revise_block",
    blockId: id,
    supersedesBlockId: supersedes,
    topicId: "t-a",
    kind: "task",
    text,
    state,
    ...(via ? { via } : {}),
    spans: [],
  };
}

/** One topic, one task added in `next` on the first drive. */
function base(): StoredOp[] {
  seq = 0;
  return [
    op(D1, { type: "create_topic", topicId: "t-a", title: "Research stay" }, { captureSessionId: "s1" }),
    op(D1, task("b1", "next"), { captureSessionId: "s1", extractionId: "x1" }),
  ];
}

describe("foldBoard", () => {
  it("always has every column, even when empty", () => {
    const board = foldBoard([]);
    expect(Object.keys(board.columns).sort()).toEqual(["doing", "done", "dropped", "next", "open"]);
    expect(board.cards).toEqual([]);
    expect(board.asOf).toBeNull();
  });

  it("places a card in the column its state names", () => {
    const board = foldBoard(base());
    expect(board.columns.next.map((c) => c.block.text)).toEqual([TEXT]);
    expect(board.cards[0]?.topic.title).toBe("Research stay");
  });

  it("keeps the card id stable across three revisions", () => {
    const ops = [
      ...base(),
      op(D2, move("b2", "b1", "doing"), { captureSessionId: "s2" }),
      op(D3, move("b3", "b2", "doing", undefined, "Email William and Sarah about the start date."), { captureSessionId: "s3" }),
      op(D4, move("b4", "b3", "done"), { captureSessionId: "s4" }),
    ];
    const board = foldBoard(ops);

    expect(board.cards).toHaveLength(1);
    expect(board.cards[0]?.cardId).toBe("b1");
    expect(board.cards[0]?.block.id).toBe("b4");
    expect(board.columns.done).toHaveLength(1);
    expect(board.transitions.every((t) => t.cardId === "b1")).toBe(true);
  });

  it("counts the drives since a card last moved, not counting the one that moved it", () => {
    const ops = [
      ...base(),
      op(D2, { type: "add_block", blockId: "c1", topicId: "t-a", kind: "claim", text: "Later claim.", spans: [] }, { captureSessionId: "s2" }),
      op(D3, { type: "add_block", blockId: "c2", topicId: "t-a", kind: "claim", text: "Even later.", spans: [] }, { captureSessionId: "s3" }),
    ];
    expect(foldBoard(ops).cards[0]?.staleSessions).toBe(2);
    expect(foldBoard(base()).cards[0]?.staleSessions).toBe(0);
  });

  it("honours asOf, like the workspace it is folded from", () => {
    const ops = [...base(), op(D2, move("b2", "b1", "done"), { captureSessionId: "s2" })];
    expect(foldBoard(ops, { asOf: D1 }).columns.next).toHaveLength(1);
    expect(foldBoard(ops, { asOf: D1 }).columns.done).toHaveLength(0);
    expect(foldBoard(ops).columns.done).toHaveLength(1);
  });
});

describe("transitionsOf", () => {
  it("records the first add as a transition from nowhere", () => {
    const [t] = transitionsOf(base());
    expect(t).toMatchObject({ cardId: "b1", blockId: "b1", from: null, to: "next", via: "speech", extractionId: "x1" });
  });

  it("ignores a revise that only sharpened the wording", () => {
    const ops = [
      ...base(),
      op(D2, move("b2", "b1", "next", undefined, "Email William about a start date in March."), { captureSessionId: "s2" }),
    ];
    expect(transitionsOf(ops)).toHaveLength(1);
  });

  it("tells a manual move from a spoken one", () => {
    const ops = [
      ...base(),
      op(D2, move("b2", "b1", "done"), { captureSessionId: "s2" }),
      op(D3, move("b3", "b2", "next", "user")),
    ];
    expect(transitionsOf(ops).map((t) => `${t.via}:${t.from}->${t.to}`)).toEqual([
      "speech:null->next",
      "speech:next->done",
      "user:done->next",
    ]);
  });

  it("records a retire as a transition out of the board", () => {
    const ops = [...base(), op(D2, { type: "retire_block", blockId: "b1", via: "user" })];
    const last = transitionsOf(ops).at(-1);
    expect(last).toMatchObject({ from: "next", to: "retired", via: "user" });
    expect(foldBoard(ops).cards).toEqual([]);
  });
});

describe("judge", () => {
  const spoken = () => [...base(), op(D2, move("b2", "b1", "done"), { captureSessionId: "s2" })];

  it("calls a speech move reversed when the person puts the card back", () => {
    const ops = [...spoken(), op(D3, move("b3", "b2", "next", "user"))];
    const verdicts = judge(transitionsOf(ops), { withinSessions: 2 });
    expect(verdicts.map((j) => j.outcome)).toEqual(["superseded", "reversed"]);
    expect(verdicts[1]?.decidedBy?.via).toBe("user");
  });

  it("calls it corrected when the person moves it somewhere else", () => {
    const ops = [...spoken(), op(D3, move("b3", "b2", "doing", "user"))];
    expect(judge(transitionsOf(ops), { withinSessions: 2 }).at(-1)?.outcome).toBe("corrected");
  });

  it("calls it retired when the person says it was not a task", () => {
    const ops = [...spoken(), op(D3, { type: "retire_block", blockId: "b2", via: "user" })];
    expect(judge(transitionsOf(ops), { withinSessions: 2 }).at(-1)?.outcome).toBe("retired");
  });

  it("calls it kept once enough later drives have passed untouched", () => {
    const ops = [
      ...spoken(),
      op(D3, { type: "add_block", blockId: "c1", topicId: "t-a", kind: "claim", text: "Another drive.", spans: [] }, { captureSessionId: "s3" }),
      op(D4, { type: "add_block", blockId: "c2", topicId: "t-a", kind: "claim", text: "And another.", spans: [] }, { captureSessionId: "s4" }),
    ];
    const board = foldBoard(ops);
    const verdicts = judge(board.transitions, { withinSessions: 2, sessions: board.sessions });
    expect(verdicts.at(-1)?.outcome).toBe("kept");
  });

  it("holds it pending while the window is still open", () => {
    const board = foldBoard(spoken());
    expect(judge(board.transitions, { withinSessions: 2, sessions: board.sessions }).at(-1)?.outcome).toBe("pending");
  });

  it("judges speech only — a manual move is the verdict, not the defendant", () => {
    const ops = [...spoken(), op(D3, move("b3", "b2", "next", "user"))];
    expect(judge(transitionsOf(ops), { withinSessions: 2 }).every((j) => j.transition.via === "speech")).toBe(true);
  });

  it("lists the reversals", () => {
    const ops = [...spoken(), op(D3, move("b3", "b2", "next", "user"))];
    expect(reversals(transitionsOf(ops), { withinSessions: 2 })).toHaveLength(1);
  });
});

describe("columnDistributionByBucket", () => {
  it("counts the columns at the end of every session", () => {
    const ops = [...base(), op(D2, move("b2", "b1", "done"), { captureSessionId: "s2" })];
    const buckets = columnDistributionByBucket(ops, { bucket: "session" });
    expect(buckets).toHaveLength(2);
    expect(buckets[0]?.counts).toMatchObject({ next: 1, done: 0 });
    expect(buckets[1]?.counts).toMatchObject({ next: 0, done: 1 });
  });
});

describe("taskOpStats", () => {
  it("counts a state-changing revise as a transition and a same-state one as an op only", () => {
    const before = foldWorkspace(base());
    expect(taskOpStats([move("b2", "b1", "done")], before)).toEqual({ taskOps: 1, taskTransitions: 1 });
    expect(taskOpStats([move("b2", "b1", "next")], before)).toEqual({ taskOps: 1, taskTransitions: 0 });
    // An omitted state inherits, so it cannot be a move either.
    const sharpened = move("b2", "b1", "next");
    if (sharpened.type === "revise_block") delete sharpened.state;
    expect(taskOpStats([sharpened], before)).toEqual({ taskOps: 1, taskTransitions: 0 });
  });

  it("counts an add as an op, not a transition, and ignores claims", () => {
    const before = foldWorkspace(base());
    expect(
      taskOpStats(
        [
          task("b9", "open"),
          { type: "add_block", blockId: "c1", topicId: "t-a", kind: "claim", text: "x", spans: [] },
          { type: "retire_block", blockId: "b1" },
        ],
        before,
      ),
    ).toEqual({ taskOps: 2, taskTransitions: 1 });
  });
});

describe("trajectory", () => {
  it("does not count a board move as the thinking changing its mind", () => {
    const ops = [
      ...base(),
      op(D2, move("b2", "b1", "done"), { captureSessionId: "s2" }),
      op(D3, move("b3", "b2", "next", "user")),
    ];
    const t = buildTrajectory(ops);
    expect(t.revisions).toHaveLength(1);
    expect(t.revisions[0]?.to.id).toBe("b2");
  });
});
