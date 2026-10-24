import { describe, expect, it } from "vitest";
import { EMPTY_CONVERSATION, applyMessage, timeline, type Conversation } from "./conversation";
import { atCursor, cursorLabel, lastSeq, turnsInOrder } from "./cursor";
import { replayConversation, seedMessages, type DriveRecord } from "./replay";

const drive: DriveRecord = {
  lines: [
    { who: "user", startMs: 500, endMs: 2000, text: "A weekend in Denmark." },
    { who: "agent", startMs: 2500, endMs: 4000, text: "City or sea?" },
    { who: "user", startMs: 5000, endMs: 6000, text: "What would you suggest?" },
    { who: "agent", startMs: 6500, endMs: 9000, text: "Aarhus or Skagen." },
    { who: "user", startMs: 10_000, endMs: 11_000, text: "Back to the budget: three hundred." },
  ],
  visits: [
    { ordinal: 1, title: "Weekend", startMs: 0 },
    { ordinal: 2, title: "Destinations", startMs: 5000 },
    { ordinal: 1, title: "Weekend", startMs: 10_000 },
  ],
  subjects: [{ ordinal: 2, settled: true, kept: false }],
};

describe("a conversation read back from storage", () => {
  it("files every line under the subject it was said in, in order", () => {
    const conversation = replayConversation([drive]);
    expect(conversation.sections.map((s) => [s.title, s.turns.length])).toEqual([
      ["Weekend", 3],
      ["Destinations", 2],
    ]);
    expect(timeline(conversation).map((r) => [r.title, r.turns, r.isReturn])).toEqual([
      ["Weekend", 2, false],
      ["Destinations", 2, false],
      ["Weekend", 1, true],
    ]);
    expect(conversation.current).toBe("weekend");
  });

  it("keeps when each line was said, and what was judged of each subject", () => {
    const conversation = replayConversation([drive]);
    expect(turnsInOrder(conversation).map((t) => t.at)).toEqual([500, 2500, 5000, 6500, 10_000]);
    expect(conversation.sections.find((s) => s.ordinal === 2)?.settled).toBe(true);
  });

  it("puts a draft after the turn that wrote it", () => {
    const conversation = replayConversation([{ ...drive, drafts: [{ draftId: "d1", major: 2, startMs: 7000 }] }]);
    expect(conversation.marks).toEqual([{ kind: "draft", draftId: "d1", major: 2, key: "draft:d1:2", after: 3 }]);
  });

  it("names talk before the first visit by the first title", () => {
    const early: DriveRecord = {
      lines: [{ who: "user", startMs: 0, endMs: 900, text: "Hello." }, ...drive.lines],
      visits: drive.visits.map((v) => ({ ...v, startMs: v.startMs + 1000 })),
    };
    const conversation = replayConversation([early]);
    expect(conversation.sections[0]?.title).toBe("Weekend");
    expect(conversation.sections[0]?.turns[0]?.text).toBe("Hello.");
  });

  it("lays a continuation after the drive it continued, marked where it picked up", () => {
    const later: DriveRecord = {
      lines: [{ who: "user", startMs: 200, endMs: 900, text: "So, Aarhus it is." }],
      visits: [{ ordinal: 2, title: "Destinations", startMs: 0 }],
    };
    const conversation = replayConversation([drive, later]);
    const turns = turnsInOrder(conversation);
    expect(turns).toHaveLength(6);
    expect(turns.at(-1)?.at).toBeGreaterThan(11_000);
    expect(conversation.marks.map((m) => [m.kind, m.after])).toEqual([["continued", 4]]);
    expect(conversation.current).toBe("destinations");
  });
});

describe("seeding a live store with a stored conversation", () => {
  it("rebuilds the same subjects, turns and judgements, then marks the pick-up", () => {
    const stored = replayConversation([drive]);
    let live: Conversation = EMPTY_CONVERSATION;
    for (const message of seedMessages(stored)) live = applyMessage(live, message, 0);
    expect(live.sections.map((s) => [s.title, s.ordinal, s.turns.map((t) => t.text)])).toEqual(
      stored.sections.map((s) => [s.title, s.ordinal, s.turns.map((t) => t.text)]),
    );
    expect(live.sections.find((s) => s.ordinal === 2)?.settled).toBe(true);
    expect(live.marks.at(-1)?.kind).toBe("continued");
    expect(live.current).toBe("weekend");
  });
});

describe("the cursor", () => {
  const conversation = replayConversation([drive]);

  it("is the whole conversation at now", () => {
    expect(atCursor(conversation, null)).toBe(conversation);
    expect(atCursor(conversation, lastSeq(conversation))).toBe(conversation);
  });

  it("cuts back to what had been said, with the subject being talked about then", () => {
    const then = atCursor(conversation, 3);
    expect(turnsInOrder(then)).toHaveLength(4);
    expect(then.sections.map((s) => s.title)).toEqual(["Weekend", "Destinations"]);
    expect(then.current).toBe("destinations");
    const before = atCursor(conversation, 1);
    expect(before.sections.map((s) => s.title)).toEqual(["Weekend"]);
  });

  it("does not show a subject as settled before it was", () => {
    let live: Conversation = EMPTY_CONVERSATION;
    for (const message of [
      { type: "title", title: "Where", ordinal: 1 },
      { type: "user", id: "a", text: "Aarhus or Skagen?" },
      { type: "user", id: "b", text: "Aarhus." },
      { type: "state", ordinal: 1, settled: true },
    ] as const) live = applyMessage(live, message, 0);
    expect(atCursor(live, 1).sections[0]?.settled).toBe(true);
    expect(atCursor(live, 0).sections[0]?.settled).toBeUndefined();
  });

  it("labels a turn by its subject and its time", () => {
    expect(cursorLabel(conversation, 3)).toEqual({ title: "Destinations", at: 6500 });
  });

  it("has nothing to point at in an empty conversation", () => {
    expect(lastSeq(EMPTY_CONVERSATION)).toBeNull();
  });
});
