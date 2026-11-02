import { describe, expect, it } from "vitest";
import { foldWorkspace } from "./fold";
import { topicCards, topicsTouchedBy } from "./topic-cards";
import type { StoredOp, WorkspaceOp } from "./types";

const T0 = new Date("2026-10-01T08:00:00Z");
const T1 = new Date("2026-10-02T08:00:00Z");
const T2 = new Date("2026-10-03T08:00:00Z");

let seq = 0;
function op(occurredAt: Date, o: WorkspaceOp, captureSessionId?: string): StoredOp {
  seq += 1;
  return { id: `op-${seq}`, seq, occurredAt, op: o, ...(captureSessionId ? { captureSessionId } : {}) };
}

function ops(): StoredOp[] {
  seq = 0;
  return [
    op(T0, { type: "create_topic", topicId: "trip", title: "Lisbon trip", slug: "lisbon-trip" }, "drive-1"),
    op(T0, { type: "create_topic", topicId: "trip2", title: "Porto trip budget", slug: "porto-trip-budget" }, "drive-2"),
    op(T0, { type: "add_block", blockId: "b1", topicId: "trip", kind: "claim", text: "Train, not plane.", spans: [] }, "drive-1"),
    op(T1, { type: "add_block", blockId: "b2", topicId: "trip", kind: "task", text: "Book the hostel", spans: [] }, "drive-1"),
    op(T2, { type: "add_block", blockId: "b3", topicId: "trip", kind: "question", text: "Which week?", spans: [] }, "drive-1"),
    op(T2, { type: "add_block", blockId: "b4", topicId: "trip", kind: "meta", text: "start a list", spans: [] }, "drive-1"),
    op(T1, { type: "add_block", blockId: "b5", topicId: "trip2", kind: "fact", label: "Budget", text: "400 €", spans: [] }, "drive-2"),
  ];
}

describe("topicCards", () => {
  it("finds the workspace topic by name and orders its cards: tasks, claims, questions, facts", () => {
    const log = ops();
    const result = topicCards(foldWorkspace(log), log, "Lisbon trip", null);
    expect(result.topic?.id).toBe("trip");
    expect(result.cards.map((c) => c.id)).toEqual(["b2", "b1", "b3"]);
    expect(result.cards[0]?.state).toBe("open");
  });

  it("leaves out meta blocks", () => {
    const log = ops();
    expect(topicCards(foldWorkspace(log), log, "Lisbon trip", null).cards.some((c) => c.kind === "meta")).toBe(false);
  });

  it("prefers a topic the drive wrote to when the name is loose", () => {
    const log = ops();
    // "trip" alone is too short and ambiguous across all topics, but "porto trip" only fits one.
    expect(topicCards(foldWorkspace(log), log, "Porto trip", "drive-2").topic?.id).toBe("trip2");
  });

  it("returns no cards rather than a guess", () => {
    const log = ops();
    expect(topicCards(foldWorkspace(log), log, "Dinner party", "drive-1")).toEqual({ topic: null, cards: [] });
  });

  it("lists the topics a drive touched", () => {
    expect([...topicsTouchedBy(ops(), "drive-1")].sort()).toEqual(["trip"]);
  });
});
