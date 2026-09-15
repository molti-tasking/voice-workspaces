import { describe, expect, it } from "vitest";
import { foldBoard, judge, transitionsOf } from "./board";
import { cardHandle, planBoardEdit, type PlannedEdit } from "./board-edit";
import type { StoredOp, WorkspaceOp } from "./types";

const D1 = new Date("2026-09-14T08:00:00Z");
const D2 = new Date("2026-09-15T08:00:00Z");

const CARD = "59e0e9a0-eb22-4a95-ba49-7317791225b3";
const OTHER = "d70e95bb-39c3-49e1-9061-941598afc5d6";
const OP_ID = "7c513962-476d-4463-b484-fc3f92aad08e";

let seq = 0;
function op(o: WorkspaceOp, extras: Partial<StoredOp> = {}): StoredOp {
  seq += 1;
  return { id: `op-${seq}`, seq, occurredAt: D1, op: o, ...extras };
}

/** A topic with one task speech put in `next`, and one in `open`. */
function board(): StoredOp[] {
  seq = 0;
  return [
    op({ type: "create_topic", topicId: "t-a", title: "Voice paper" }, { captureSessionId: "s1" }),
    op(
      {
        type: "add_block",
        blockId: CARD,
        topicId: "t-a",
        kind: "task",
        text: "Write up the asymmetry argument.",
        state: "next",
        spans: [{ utteranceId: "u1" }],
      },
      { captureSessionId: "s1", extractionId: "x1" },
    ),
    op(
      { type: "add_block", blockId: OTHER, topicId: "t-a", kind: "task", text: "Build the evaluation system.", state: "open", spans: [] },
      { captureSessionId: "s1", extractionId: "x1" },
    ),
  ];
}

/** Append what a plan says, as the route does. */
function applied(ops: StoredOp[], plan: PlannedEdit, extras: Partial<StoredOp> = {}): StoredOp[] {
  if (plan.status !== "apply") throw new Error(`not applied: ${plan.status}`);
  return [...ops, ...plan.ops.map((p) => op(p.op, { id: p.id, occurredAt: D2, ...extras }))];
}

describe("cardHandle", () => {
  it("is the tail of the id, so fixture ids with a shared zero prefix stay distinct", () => {
    expect(cardHandle(CARD)).toBe("1225b3");
    expect(cardHandle("00000000-0000-4000-8000-00000000f1a7")).not.toBe(
      cardHandle("00000000-0000-4000-8000-0000000000b3"),
    );
  });
});

describe("planBoardEdit", () => {
  it("moves a card the way a drag does, keeping its words and speech provenance", () => {
    const ops = board();
    const plan = planBoardEdit(ops, { action: "move", state: "dropped" }, {
      via: "agent",
      opId: OP_ID,
      target: { handle: cardHandle(CARD) },
    });
    expect(plan).toMatchObject({ status: "apply", from: "next", card: { state: "dropped", handle: "1225b3" } });
    if (plan.status !== "apply") return;
    expect(plan.ops).toHaveLength(1);
    expect(plan.ops[0]).toMatchObject({
      id: OP_ID,
      op: { type: "revise_block", supersedesBlockId: CARD, state: "dropped", via: "agent", spans: [{ utteranceId: "u1" }] },
    });

    const after = foldBoard(applied(ops, plan));
    expect(after.columns.dropped.map((c) => c.cardId)).toEqual([CARD]);
    expect(after.columns.next).toEqual([]);
  });

  it("plans the same op for a person aiming at the block they were shown", () => {
    const byAgent = planBoardEdit(board(), { action: "move", state: "done" }, {
      via: "agent",
      opId: OP_ID,
      target: { handle: "1225b3" },
    });
    const byUser = planBoardEdit(board(), { action: "move", state: "done" }, {
      via: "user",
      opId: OP_ID,
      target: { blockId: CARD },
    });
    if (byAgent.status !== "apply" || byUser.status !== "apply") throw new Error("expected apply");
    expect({ ...byUser.ops[0]!.op, via: "agent" }).toEqual(byAgent.ops[0]!.op);
  });

  it("follows a card that has moved since, when aimed at an older block", () => {
    const moved = applied(
      board(),
      planBoardEdit(board(), { action: "move", state: "doing" }, { via: "user", opId: OP_ID, target: { blockId: CARD } }),
    );
    const plan = planBoardEdit(moved, { action: "retire" }, {
      via: "user",
      opId: "00000000-0000-4000-8000-000000000999",
      target: { blockId: CARD },
    });
    expect(plan).toMatchObject({ status: "apply", ops: [{ op: { type: "retire_block", blockId: OP_ID } }] });
  });

  it("does not record a move to the column the card is already in", () => {
    expect(
      planBoardEdit(board(), { action: "move", state: "next" }, { via: "agent", opId: OP_ID, target: { handle: "1225b3" } })
        .status,
    ).toBe("unchanged");
  });

  it("rewords a card without moving it", () => {
    const plan = planBoardEdit(board(), { action: "reword", text: "Draft the asymmetry section." }, {
      via: "agent",
      opId: OP_ID,
      target: { handle: "1225b3" },
    });
    expect(plan).toMatchObject({ status: "apply", card: { text: "Draft the asymmetry section.", state: "next" } });
    // A reword is not a transition, so it adds nothing to judge.
    expect(transitionsOf(applied(board(), plan))).toHaveLength(2);
  });

  it("adds a task to an existing topic by its title, case aside", () => {
    const plan = planBoardEdit(board(), { action: "add", text: "Email William.", topic: "voice PAPER", state: "next" }, {
      via: "agent",
      opId: OP_ID,
    });
    expect(plan).toMatchObject({ status: "apply", card: { topicTitle: "Voice paper", state: "next" } });
    if (plan.status !== "apply") return;
    expect(plan.ops.map((p) => p.op.type)).toEqual(["add_block"]);
    expect(foldBoard(applied(board(), plan)).columns.next).toHaveLength(2);
  });

  it("opens a topic for a task that fits none, with an id a retry reproduces", () => {
    const first = planBoardEdit(board(), { action: "add", text: "Book the flights.", topic: "Research stay" }, {
      via: "agent",
      opId: OP_ID,
    });
    const retry = planBoardEdit(board(), { action: "add", text: "Book the flights.", topic: "Research stay" }, {
      via: "agent",
      opId: OP_ID,
    });
    expect(first).toEqual(retry);
    if (first.status !== "apply") throw new Error("expected apply");
    expect(first.ops.map((p) => p.op.type)).toEqual(["create_topic", "add_block"]);
    expect(first.ops[0]!.op).toMatchObject({ title: "Research stay", via: "agent" });
    expect(foldBoard(applied(board(), first)).columns.open.map((c) => c.topic.title)).toContain("Research stay");
  });

  it("does not add a second card for a task already on the board", () => {
    const plan = planBoardEdit(board(), { action: "add", text: "write up the asymmetry argument", topic: "Voice paper" }, {
      via: "agent",
      opId: OP_ID,
    });
    expect(plan).toMatchObject({ status: "exists", card: { handle: "1225b3" } });
  });

  it("refuses an unknown or ambiguous handle rather than guessing", () => {
    expect(
      planBoardEdit(board(), { action: "retire" }, { via: "agent", opId: OP_ID, target: { handle: "ffffff" } }).status,
    ).toBe("not_found");
  });

  it("refuses a block that is not a task card", () => {
    const ops = [
      ...board(),
      op({ type: "add_block", blockId: "claim-1", topicId: "t-a", kind: "claim", text: "Voice first.", spans: [] }),
    ];
    expect(
      planBoardEdit(ops, { action: "move", state: "done" }, { via: "user", opId: OP_ID, target: { blockId: "claim-1" } })
        .status,
    ).toBe("not_a_task");
  });
});

describe("judging the agent's edits", () => {
  it("records the agent as its own source, and judges it like speech", () => {
    const dropped = applied(
      board(),
      planBoardEdit(board(), { action: "move", state: "dropped" }, { via: "agent", opId: OP_ID, target: { handle: "1225b3" } }),
      { captureSessionId: "s2" },
    );
    // The person drags it back to `next`: the agent's move was reversed.
    const reversed = applied(
      dropped,
      planBoardEdit(dropped, { action: "move", state: "next" }, {
        via: "user",
        opId: "00000000-0000-4000-8000-000000000abc",
        target: { blockId: OP_ID },
      }),
    );
    const transitions = transitionsOf(reversed).filter((t) => t.cardId === CARD);
    expect(transitions.map((t) => `${t.via}:${t.from}->${t.to}`)).toEqual([
      "speech:null->next",
      "agent:next->dropped",
      "user:dropped->next",
    ]);
    const verdicts = judge(transitionsOf(reversed), { withinSessions: 2 }).filter((j) => j.transition.cardId === CARD);
    expect(verdicts.map((j) => `${j.transition.via}:${j.outcome}`)).toEqual(["speech:superseded", "agent:reversed"]);
  });
});
