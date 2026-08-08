import { describe, expect, it } from "vitest";
import { diffWorkspace, foldWorkspace } from "./fold";
import type { StoredOp, WorkspaceOp } from "./types";

const T0 = new Date("2026-08-01T08:00:00Z");
const T1 = new Date("2026-08-01T08:10:00Z");
const T2 = new Date("2026-08-02T08:00:00Z");
const T3 = new Date("2026-08-03T08:00:00Z");

let seq = 0;
function op(occurredAt: Date, o: WorkspaceOp, extras: Partial<StoredOp> = {}): StoredOp {
  seq += 1;
  return { id: `op-${seq}`, seq, occurredAt, op: o, ...extras };
}

/** A topic with one claim, as a starting point for most tests. */
function baseline(): StoredOp[] {
  seq = 0;
  return [
    op(T0, { type: "create_topic", topicId: "topic-a", title: "Research stay", slug: "research-stay" }),
    op(T0, {
      type: "add_block",
      blockId: "block-1",
      topicId: "topic-a",
      kind: "claim",
      text: "I want to go somewhere with strong HCI.",
      spans: [{ utteranceId: "u1" }],
    }),
  ];
}

describe("foldWorkspace", () => {
  it("builds topics and visible blocks", () => {
    const state = foldWorkspace(baseline());

    expect(state.topics).toHaveLength(1);
    expect(state.topics[0]?.title).toBe("Research stay");
    expect(state.blocksByTopic.get("topic-a")).toHaveLength(1);
    expect(state.opCount).toBe(2);
  });

  it("is pure — folding the same ops twice gives identical state", () => {
    const ops = baseline();
    const a = foldWorkspace(ops);
    const b = foldWorkspace(ops);

    expect(serialise(a)).toEqual(serialise(b));
  });

  it("does not depend on the order rows arrive in", () => {
    // The database may return ops in any order; only `seq` may decide.
    const ops = baseline();
    const shuffled = [...ops].reverse();

    expect(serialise(foldWorkspace(shuffled))).toEqual(serialise(foldWorkspace(ops)));
  });

  it("does not mutate the ops it was given", () => {
    const ops = baseline();
    const snapshot = JSON.stringify(ops);
    foldWorkspace(ops);
    expect(JSON.stringify(ops)).toBe(snapshot);
  });
});

describe("time travel", () => {
  it("fold(ops, T) equals folding only the ops up to T", () => {
    // The property the entire design rests on.
    const ops = [
      ...baseline(),
      op(T2, {
        type: "add_block",
        blockId: "block-2",
        topicId: "topic-a",
        kind: "question",
        text: "Stanford or somewhere in Europe?",
        spans: [{ utteranceId: "u2" }],
      }),
    ];

    const asOf = foldWorkspace(ops, T1);
    const truncated = foldWorkspace(ops.filter((o) => o.occurredAt <= T1));

    expect(serialise(asOf)).toEqual(serialise(truncated));
    expect(asOf.blocksByTopic.get("topic-a")).toHaveLength(1);
  });

  it("includes ops exactly on the boundary", () => {
    const ops = baseline();
    expect(foldWorkspace(ops, T0).opCount).toBe(2);
  });

  it("returns an empty workspace before anything was said", () => {
    const state = foldWorkspace(baseline(), new Date("2020-01-01T00:00:00Z"));
    expect(state.topics).toEqual([]);
    expect(state.asOf).toBeNull();
  });
});

describe("supersession", () => {
  const revised = () => [
    ...baseline(),
    op(T1, {
      type: "revise_block",
      blockId: "block-2",
      supersedesBlockId: "block-1",
      topicId: "topic-a",
      kind: "claim",
      text: "Actually the real constraint is who I would work with.",
      spans: [{ utteranceId: "u2" }],
    }),
  ];

  it("shows only the current version", () => {
    const visible = foldWorkspace(revised()).blocksByTopic.get("topic-a")!;

    expect(visible).toHaveLength(1);
    expect(visible[0]?.id).toBe("block-2");
  });

  it("keeps the superseded text reachable", () => {
    const state = foldWorkspace(revised());
    const old = state.allBlocks.get("block-1")!;

    expect(old.text).toContain("strong HCI");
    expect(old.supersededById).toBe("block-2");
    expect(state.allBlocks.get("block-2")?.supersedes).toBe("block-1");
  });

  it("keeps a chain of revisions down to one visible block", () => {
    const ops = [
      ...revised(),
      op(T2, {
        type: "revise_block",
        blockId: "block-3",
        supersedesBlockId: "block-2",
        topicId: "topic-a",
        kind: "claim",
        text: "No — it is about the method, not the people.",
        spans: [{ utteranceId: "u3" }],
      }),
    ];

    const visible = foldWorkspace(ops).blocksByTopic.get("topic-a")!;
    expect(visible).toHaveLength(1);
    expect(visible[0]?.id).toBe("block-3");
  });

  it("keeps the content when the superseded block is unknown", () => {
    // The model can cite a block id that never existed; losing the new thought
    // would be worse than a missing revision link.
    const ops = [
      ...baseline(),
      op(T1, {
        type: "revise_block",
        blockId: "block-9",
        supersedesBlockId: "does-not-exist",
        topicId: "topic-a",
        kind: "claim",
        text: "A thought with a bad backreference.",
        spans: [],
      }),
    ];

    const visible = foldWorkspace(ops).blocksByTopic.get("topic-a")!;
    expect(visible.map((b) => b.id).sort()).toEqual(["block-1", "block-9"]);
  });
});

describe("retire and move", () => {
  it("hides a retired block but keeps it in the record", () => {
    const ops = [...baseline(), op(T1, { type: "retire_block", blockId: "block-1" })];
    const state = foldWorkspace(ops);

    expect(state.blocksByTopic.get("topic-a") ?? []).toHaveLength(0);
    expect(state.allBlocks.get("block-1")?.retiredAt).toEqual(T1);
  });

  it("moves a block to another topic", () => {
    const ops = [
      ...baseline(),
      op(T1, { type: "create_topic", topicId: "topic-b", title: "CHI paper" }),
      op(T1, { type: "move_block", blockId: "block-1", toTopicId: "topic-b" }),
    ];
    const state = foldWorkspace(ops);

    expect(state.blocksByTopic.get("topic-a") ?? []).toHaveLength(0);
    expect(state.blocksByTopic.get("topic-b")).toHaveLength(1);
  });
});

describe("merging topics", () => {
  const merged = () => [
    ...baseline(),
    op(T1, { type: "create_topic", topicId: "topic-b", title: "Research visit" }),
    op(T1, {
      type: "add_block",
      blockId: "block-2",
      topicId: "topic-b",
      kind: "context",
      text: "Right now I live in Aarhus.",
      spans: [{ utteranceId: "u2" }],
    }),
    op(T2, { type: "merge_topics", fromTopicId: "topic-b", intoTopicId: "topic-a" }),
  ];

  it("keeps blocks from both topics, with no orphans", () => {
    const state = foldWorkspace(merged());

    expect(state.topics).toHaveLength(1);
    expect(state.topics[0]?.id).toBe("topic-a");
    expect(state.blocksByTopic.get("topic-a")).toHaveLength(2);

    const placed = [...state.blocksByTopic.values()].flat().length;
    expect(placed).toBe(state.allBlocks.size);
  });

  it("routes blocks added to a merged-away topic onto the survivor", () => {
    const ops = [
      ...merged(),
      op(T3, {
        type: "add_block",
        blockId: "block-3",
        topicId: "topic-b", // the id the model still remembers
        kind: "claim",
        text: "Late arrival addressed to the old topic.",
        spans: [],
      }),
    ];

    expect(foldWorkspace(ops).blocksByTopic.get("topic-a")).toHaveLength(3);
  });

  it("survives a merge cycle without hanging", () => {
    const ops = [
      ...merged(),
      op(T3, { type: "merge_topics", fromTopicId: "topic-a", intoTopicId: "topic-b" }),
    ];

    // A -> B and B -> A. Must terminate and still place every block somewhere.
    const state = foldWorkspace(ops);
    expect([...state.blocksByTopic.values()].flat().length).toBe(2);
  });
});

describe("malformed op logs", () => {
  it("skips blocks whose topic was never created", () => {
    const ops = [
      op(T0, {
        type: "add_block",
        blockId: "orphan",
        topicId: "never-created",
        kind: "claim",
        text: "Nowhere to live.",
        spans: [],
      }),
    ];
    expect(foldWorkspace(ops).topics).toEqual([]);
  });

  it("ignores a duplicated create_topic instead of resetting the topic", () => {
    const ops = [
      ...baseline(),
      op(T1, { type: "rename_topic", topicId: "topic-a", title: "Renamed" }),
      op(T2, { type: "create_topic", topicId: "topic-a", title: "Research stay" }),
    ];
    expect(foldWorkspace(ops).topics[0]?.title).toBe("Renamed");
  });

  it("ignores a duplicated block id rather than overwriting content", () => {
    const ops = [
      ...baseline(),
      op(T1, {
        type: "add_block",
        blockId: "block-1",
        topicId: "topic-a",
        kind: "meta",
        text: "Different text, same id.",
        spans: [],
      }),
    ];
    expect(foldWorkspace(ops).allBlocks.get("block-1")?.text).toContain("strong HCI");
  });
});

describe("diffWorkspace", () => {
  it("reports what a drive contributed", () => {
    const before = foldWorkspace(baseline());
    const ops = [
      ...baseline(),
      op(T2, { type: "create_topic", topicId: "topic-b", title: "CHI paper" }),
      op(T2, {
        type: "add_block",
        blockId: "block-2",
        topicId: "topic-b",
        kind: "question",
        text: "What is the actual contribution?",
        spans: [],
      }),
    ];
    const after = foldWorkspace(ops);

    const diff = diffWorkspace(before, after);
    expect(diff.addedTopics.map((t) => t.id)).toEqual(["topic-b"]);
    expect(diff.addedBlocks.map((b) => b.id)).toEqual(["block-2"]);
    expect(diff.revisedBlocks).toEqual([]);
  });

  it("separates revisions from additions", () => {
    const before = foldWorkspace(baseline());
    const ops = [
      ...baseline(),
      op(T2, {
        type: "revise_block",
        blockId: "block-2",
        supersedesBlockId: "block-1",
        topicId: "topic-a",
        kind: "claim",
        text: "Changed my mind.",
        spans: [],
      }),
    ];

    const diff = diffWorkspace(before, foldWorkspace(ops));
    expect(diff.addedBlocks).toEqual([]);
    expect(diff.revisedBlocks).toHaveLength(1);
    expect(diff.revisedBlocks[0]?.from.id).toBe("block-1");
    expect(diff.revisedBlocks[0]?.to.id).toBe("block-2");
  });

  it("reports a block retired during the window", () => {
    const before = foldWorkspace(baseline());
    const ops = [...baseline(), op(T2, { type: "retire_block", blockId: "block-1" })];

    const diff = diffWorkspace(before, foldWorkspace(ops));
    expect(diff.retiredBlocks.map((b) => b.id)).toEqual(["block-1"]);
  });

  it("is empty when nothing happened", () => {
    const state = foldWorkspace(baseline());
    const diff = diffWorkspace(state, foldWorkspace(baseline()));

    expect(diff.addedTopics).toEqual([]);
    expect(diff.addedBlocks).toEqual([]);
    expect(diff.revisedBlocks).toEqual([]);
    expect(diff.retiredBlocks).toEqual([]);
  });
});

/** Comparable snapshot of folded state, for equality assertions. */
function serialise(state: ReturnType<typeof foldWorkspace>) {
  return {
    topics: state.topics.map((t) => ({ id: t.id, title: t.title })),
    blocks: [...state.blocksByTopic.entries()].map(([topicId, blocks]) => [
      topicId,
      blocks.map((b) => `${b.kind}:${b.text}`),
    ]),
    asOf: state.asOf?.toISOString() ?? null,
    opCount: state.opCount,
  };
}
