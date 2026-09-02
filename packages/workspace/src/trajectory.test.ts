import { describe, expect, it } from "vitest";
import { buildTrajectory, stackBands, stackHeight } from "./trajectory";
import type { StoredOp, WorkspaceOp } from "./types";

const D1 = new Date("2026-08-01T08:00:00Z");
const D2 = new Date("2026-08-02T08:00:00Z");
const D3 = new Date("2026-08-20T08:00:00Z");

let seq = 0;
function op(occurredAt: Date, o: WorkspaceOp, extras: Partial<StoredOp> = {}): StoredOp {
  seq += 1;
  return { id: `op-${seq}`, seq, occurredAt, op: o, ...extras };
}

function add(id: string, topicId: string, text: string): WorkspaceOp {
  return { type: "add_block", blockId: id, topicId, kind: "claim", text, spans: [] };
}

/** Three sessions: one topic grows, a second appears, one block is revised. */
function corpus(): StoredOp[] {
  seq = 0;
  return [
    op(D1, { type: "create_topic", topicId: "t-a", title: "Research stay" }, { captureSessionId: "s1" }),
    op(D1, add("b1", "t-a", "Somewhere with strong HCI."), { captureSessionId: "s1" }),
    op(D2, add("b2", "t-a", "Three to six months."), { captureSessionId: "s2" }),
    op(D2, { type: "create_topic", topicId: "t-b", title: "Ethics form" }, { captureSessionId: "s2" }),
    op(D2, add("b3", "t-b", "Needs a data-management plan."), { captureSessionId: "s2" }),
    op(
      D3,
      {
        type: "revise_block",
        blockId: "b4",
        supersedesBlockId: "b1",
        topicId: "t-a",
        kind: "claim",
        text: "What matters is who I'd work with.",
        spans: [],
      },
      { captureSessionId: "s3" },
    ),
  ];
}

describe("buildTrajectory", () => {
  it("returns an empty shape for an empty log rather than throwing", () => {
    const t = buildTrajectory([]);
    expect(t.buckets).toEqual([]);
    expect(t.tracks).toEqual([]);
    expect(t.final.topics).toEqual([]);
  });

  it("buckets by session, one per recording", () => {
    expect(buildTrajectory(corpus()).buckets).toHaveLength(3);
  });

  it("gives every track the same length, so buckets line up positionally", () => {
    const t = buildTrajectory(corpus());
    for (const track of t.tracks) expect(track.points).toHaveLength(t.buckets.length);
  });

  /**
   * A topic that did not exist yet still occupies its slots, at zero. Without
   * the back-fill a chart would index the wrong bucket for every topic that
   * appeared after the first.
   */
  it("back-fills a topic's buckets from before it existed", () => {
    const t = buildTrajectory(corpus());
    const ethics = t.tracks.find((x) => x.title === "Ethics form");
    expect(ethics?.points[0]).toMatchObject({ size: 0, added: 0 });
    expect(ethics?.points[1]).toMatchObject({ size: 1, added: 1 });
  });

  it("counts a revision as a revision, not as an addition", () => {
    const t = buildTrajectory(corpus());
    const stay = t.tracks.find((x) => x.title === "Research stay");
    expect(stay?.points[2]).toMatchObject({ added: 0, revised: 1 });
    // Superseding leaves the topic the same size: a mind changed, not grown.
    expect(stay?.points[2]?.size).toBe(2);
    expect(t.revisions).toHaveLength(1);
    expect(t.revisions[0]?.from.text).toBe("Somewhere with strong HCI.");
    expect(t.revisions[0]?.to.text).toBe("What matters is who I'd work with.");
  });

  /**
   * Ordering is by first appearance rather than by weight. A stacked chart
   * sorted by activity would have its bands change places between renders,
   * making a picture of change over time change for reasons that are not time.
   */
  it("orders tracks by first appearance", () => {
    expect(buildTrajectory(corpus()).tracks.map((t) => t.title)).toEqual([
      "Research stay",
      "Ethics form",
    ]);
  });

  it("honours asOf, and agrees with the workspace at the same instant", () => {
    const t = buildTrajectory(corpus(), { asOf: D2 });
    expect(t.buckets).toHaveLength(2);
    expect(t.revisions).toHaveLength(0);
    expect(t.final.topics).toHaveLength(2);
    expect(t.tracks.find((x) => x.title === "Research stay")?.current).toBe(2);
  });

  /**
   * Event-dense buckets. D3 is nearly three weeks after D2; bucketing by
   * calendar day would put nineteen empty columns between them and compress
   * everything that actually happened into the edges.
   */
  it("bucketing by day yields one bucket per day with activity, not per calendar day", () => {
    expect(buildTrajectory(corpus(), { bucket: "day" }).buckets).toHaveLength(3);
  });

  it("does not mutate the ops it was given", () => {
    const ops = corpus();
    const snapshot = JSON.stringify(ops);
    buildTrajectory(ops);
    expect(JSON.stringify(ops)).toBe(snapshot);
  });
});

describe("stacking", () => {
  it("stacks bands without gaps or overlaps", () => {
    const t = buildTrajectory(corpus());
    const bands = stackBands(t.tracks);
    for (let bucket = 0; bucket < t.buckets.length; bucket += 1) {
      let expected = 0;
      bands.forEach((band, track) => {
        const lower = band[bucket]![0]!;
        const upper = band[bucket]![1]!;
        expect(lower).toBe(expected);
        expect(upper - lower).toBe(t.tracks[track]!.points[bucket]!.size);
        expected = upper;
      });
    }
  });

  it("reports the tallest stack, and never zero", () => {
    expect(stackHeight(buildTrajectory(corpus()).tracks)).toBe(3);
    expect(stackHeight([])).toBe(1);
  });
});
