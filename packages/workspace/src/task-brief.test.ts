/**
 * The brief is built from the record, so what it must never do is quote speech
 * the card did not come from.
 *
 * Two ways that could happen, both tested here: a board move copies the head
 * block's spans forwards, and an extraction op with no spans of its own is
 * stored with the whole batch in `sourceUtteranceIds`. Either one, quoted
 * under a task, would put words in the person's mouth — on a page whose whole
 * claim is that nothing on it was generated.
 *
 * Pure: no database, no React.
 */
import { describe, expect, it } from "vitest";
import { foldBoard } from "./board";
import { briefBoard, briefCard, cardFor, topicContext } from "./task-brief";
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
  return {
    type: "add_block",
    blockId: id,
    topicId: "t-a",
    kind: "task",
    text: TEXT,
    state,
    spans: [{ utteranceId: "u1" }],
  };
}

function move(
  id: string,
  supersedes: string,
  state: "open" | "next" | "doing" | "done" | "dropped",
  via?: "user" | "agent",
  text = TEXT,
  spans: { utteranceId: string }[] = [],
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
    spans,
  };
}

/** One topic, one task added in `next` on the first drive, citing `u1`. */
function base(): StoredOp[] {
  seq = 0;
  return [
    op(D1, { type: "create_topic", topicId: "t-a", title: "Research stay" }, { captureSessionId: "s1" }),
    op(D1, task("b1", "next"), {
      captureSessionId: "s1",
      extractionId: "x1",
      // What `appendOps` writes for an op that carries no spans: the whole
      // batch. The brief must not read quotes from here.
      sourceUtteranceIds: ["u1", "u-unrelated"],
    }),
  ];
}

/**
 * The fixture's own shape: speech adds, speech reports it done, the person
 * puts it back, then speech moves it on again.
 */
function chain(): StoredOp[] {
  return [
    ...base(),
    op(D2, move("b2", "b1", "next", undefined, "Email the host lab about a start date.", [{ utteranceId: "u2" }]), {
      captureSessionId: "s2",
    }),
    op(D3, move("b3", "b2", "done", "user")),
    op(D4, move("b4", "b3", "doing", undefined, "Email the host lab about a start date.", [
      { utteranceId: "u2" },
      { utteranceId: "u3" },
    ]), { captureSessionId: "s4" }),
  ];
}

describe("cardFor", () => {
  it("resolves a superseded block id to the live card", () => {
    const board = foldBoard(chain());
    // The link on the board was minted when `b1` was the head; three moves
    // later it must still open the same card.
    expect(cardFor(board, "b1")?.cardId).toBe("b1");
    expect(cardFor(board, "b2")?.block.id).toBe("b4");
    expect(cardFor(board, "b4")?.block.id).toBe("b4");
  });

  it("returns nothing for a retired card, a claim, or an unknown id", () => {
    const retired = foldBoard([
      ...base(),
      op(D2, { type: "retire_block", blockId: "b1", via: "user" }),
    ]);
    expect(cardFor(retired, "b1")).toBeUndefined();

    const withClaim = foldBoard([
      ...base(),
      op(D2, { type: "add_block", blockId: "c1", topicId: "t-a", kind: "claim", text: "A claim.", spans: [] }),
    ]);
    expect(cardFor(withClaim, "c1")).toBeUndefined();
    expect(cardFor(withClaim, "nope")).toBeUndefined();
  });
});

describe("briefCard", () => {
  it("walks the chain oldest first, naming who made each step", () => {
    const board = foldBoard(chain());
    const brief = briefCard(board, cardFor(board, "b1")!);

    expect(brief.steps.map((s) => s.block.id)).toEqual(["b1", "b2", "b3", "b4"]);
    expect(brief.steps.map((s) => s.via)).toEqual(["speech", "speech", "user", "speech"]);
  });

  it("carries the transition only for a step that actually moved the card", () => {
    const board = foldBoard(chain());
    const brief = briefCard(board, cardFor(board, "b1")!);

    // `b2` only sharpened the wording, so it is a step with no transition.
    expect(brief.steps[1]?.transition).toBeUndefined();
    expect(brief.steps[1]?.previousText).toBe(TEXT);
    expect(brief.steps[2]?.transition).toMatchObject({ from: "next", to: "done", via: "user" });
    expect(brief.steps[3]?.transition).toMatchObject({ from: "done", to: "doing", via: "speech" });
  });

  it("quotes only the spans of speech steps, deduped in the order first cited", () => {
    const board = foldBoard(chain());
    const brief = briefCard(board, cardFor(board, "b1")!);

    expect(brief.steps.map((s) => s.utteranceIds)).toEqual([
      ["u1"],
      ["u2"],
      // The person's move copied `b2`'s spans forwards. They said nothing.
      [],
      ["u2", "u3"],
    ]);
    expect(brief.utteranceIds).toEqual(["u1", "u2", "u3"]);
    // Never from the op's `sourceUtteranceIds`, which holds the whole batch.
    expect(brief.utteranceIds).not.toContain("u-unrelated");
  });

  it("cites nothing for a card the agent added, which has no spans", () => {
    seq = 0;
    const board = foldBoard([
      op(D1, { type: "create_topic", topicId: "t-a", title: "Research stay" }),
      op(
        D2,
        {
          type: "add_block",
          blockId: "a1",
          topicId: "t-a",
          kind: "task",
          text: "Book the flights.",
          state: "next",
          via: "agent",
          spans: [],
        },
        { captureSessionId: "s2" },
      ),
    ]);
    const brief = briefCard(board, cardFor(board, "a1")!);

    expect(brief.steps).toHaveLength(1);
    expect(brief.steps[0]?.via).toBe("agent");
    expect(brief.utteranceIds).toEqual([]);
  });

  it("stops the steps at asOf, like every other fold over this ledger", () => {
    const board = foldBoard(chain(), { asOf: D2 });
    const brief = briefCard(board, cardFor(board, "b1")!);

    expect(brief.steps.map((s) => s.block.id)).toEqual(["b1", "b2"]);
    expect(brief.card.state).toBe("next");
  });
});

describe("topicContext", () => {
  const withNotes = () => [
    ...base(),
    op(D2, { type: "add_block", blockId: "q1", topicId: "t-a", kind: "question", text: "Funding?", spans: [] }),
    op(D2, { type: "add_block", blockId: "c1", topicId: "t-a", kind: "claim", text: "A claim.", spans: [] }),
    op(D2, { type: "add_block", blockId: "f1", topicId: "t-a", kind: "fact", label: "Duration", text: "Six months.", spans: [] }),
    op(D2, { type: "add_block", blockId: "x1", topicId: "t-a", kind: "context", text: "An aside.", spans: [] }),
  ];

  it("reads questions first, then claims, facts and the asides", () => {
    const board = foldBoard(withNotes());
    const context = topicContext(board, board.cards[0]!.topic);

    expect(context.questions.map((b) => b.id)).toEqual(["q1"]);
    expect(context.notes.map((b) => b.id)).toEqual(["c1", "f1", "x1"]);
  });

  it("leaves out superseded and retired blocks", () => {
    const board = foldBoard([
      ...withNotes(),
      op(D3, {
        type: "revise_block",
        blockId: "c2",
        supersedesBlockId: "c1",
        topicId: "t-a",
        kind: "claim",
        text: "A sharper claim.",
        spans: [],
      }),
      op(D3, { type: "retire_block", blockId: "f1", via: "user" }),
    ]);
    const context = topicContext(board, board.cards[0]!.topic);

    expect(context.notes.map((b) => b.text)).toEqual(["A sharper claim.", "An aside."]);
  });

  it("sorts the topic's tasks doing, next, open, done, dropped", () => {
    seq = 0;
    const board = foldBoard([
      op(D1, { type: "create_topic", topicId: "t-a", title: "Research stay" }),
      op(D1, task("b1", "done")),
      op(D1, task("b2", "open")),
      op(D1, task("b3", "doing")),
      op(D1, task("b4", "dropped")),
      op(D1, task("b5", "next")),
    ]);
    const context = topicContext(board, board.cards[0]!.topic);

    expect(context.tasks.map((c) => c.state)).toEqual(["doing", "next", "open", "done", "dropped"]);
  });

  it("shows a merged-away topic's blocks under the topic that absorbed it", () => {
    seq = 0;
    const board = foldBoard([
      op(D1, { type: "create_topic", topicId: "t-a", title: "Research stay" }),
      op(D1, { type: "create_topic", topicId: "t-b", title: "The stay" }),
      op(D1, { type: "add_block", blockId: "c1", topicId: "t-b", kind: "claim", text: "From the other topic.", spans: [] }),
      op(D1, task("b1", "next")),
      op(D2, { type: "merge_topics", fromTopicId: "t-b", intoTopicId: "t-a" }),
    ]);
    const context = topicContext(board, board.cards[0]!.topic);

    expect(context.topic.id).toBe("t-a");
    expect(context.notes.map((b) => b.text)).toEqual(["From the other topic."]);
  });
});

describe("briefBoard", () => {
  it("is empty for an empty board", () => {
    expect(briefBoard(foldBoard([]))).toEqual([]);
  });

  it("leaves out done and dropped cards, but keeps them in the topic's tasks", () => {
    seq = 0;
    const board = foldBoard([
      op(D1, { type: "create_topic", topicId: "t-a", title: "Research stay" }),
      op(D1, task("b1", "next")),
      op(D1, task("b2", "done")),
      op(D1, task("b3", "dropped")),
    ]);
    const [brief] = briefBoard(board);

    expect(brief?.cards.map((c) => c.card.state)).toEqual(["next"]);
    expect(brief?.tasks.map((c) => c.state)).toEqual(["next", "done", "dropped"]);
  });

  it("lets the most urgent card place its topic", () => {
    seq = 0;
    const board = foldBoard([
      // `t-a` is touched last, so the board and the workspace both lead with
      // it. The brief must not: `t-b` holds the only card in `doing`.
      op(D1, { type: "create_topic", topicId: "t-b", title: "Ethics form" }),
      op(D1, {
        type: "add_block",
        blockId: "b-b",
        topicId: "t-b",
        kind: "task",
        text: "Write the data management plan.",
        state: "doing",
        spans: [],
      }),
      op(D2, { type: "create_topic", topicId: "t-a", title: "Research stay" }),
      op(D2, task("b-a", "next")),
    ]);

    expect(briefBoard(board).map((b) => b.topic.title)).toEqual(["Ethics form", "Research stay"]);
  });
});
