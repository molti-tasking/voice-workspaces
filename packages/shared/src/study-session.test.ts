import { describe, expect, it } from "vitest";
import { CONVERSATION_DISPLAYS } from "./contracts";
import {
  BlockAnswers,
  ESM_ITEMS,
  GAME_QUIET_MS,
  SESSION_ORDERS,
  SESSION_TIMINGS,
  SESSION_TASK_IDS,
  SessionFinal,
  SessionMoment,
  SessionStep,
  blocksFor,
  esmDue,
  esmSlots,
  gameDue,
  resumeAt,
  scaledTimings,
} from "./study-session";

const orders = Array.from({ length: SESSION_ORDERS }, (_, k) => blocksFor(k));

describe("the session's orders", () => {
  it("give every participant each display and each task once", () => {
    for (const blocks of orders) {
      expect(blocks.map((b) => b.position)).toEqual([0, 1, 2, 3]);
      expect(new Set(blocks.map((b) => b.display))).toEqual(new Set(CONVERSATION_DISPLAYS));
      expect(new Set(blocks.map((b) => b.task))).toEqual(new Set(SESSION_TASK_IDS));
    }
  });

  it("put every display and every task in every position once", () => {
    for (let position = 0; position < 4; position++) {
      const at = orders.map((blocks) => blocks[position]!);
      expect(new Set(at.map((b) => b.display)).size).toBe(4);
      expect(new Set(at.map((b) => b.task)).size).toBe(4);
    }
  });

  it("pair every display with every task exactly once", () => {
    const pairs = orders.flat().map((b) => `${b.display}:${b.task}`);
    expect(new Set(pairs).size).toBe(16);
  });

  it("wrap around, so any order index is one of the four", () => {
    expect(blocksFor(SESSION_ORDERS + 1)).toEqual(blocksFor(1));
    expect(blocksFor(-1)).toEqual(blocksFor(SESSION_ORDERS - 1));
  });
});

describe("scaledTimings", () => {
  it("speeds every timing up, within bounds", () => {
    const fast = scaledTimings(10);
    expect(fast).toMatchObject({ talkMinMs: 24_000, talkCapMs: 42_000, gameEarliestMs: 13_500, esmSpacingMs: 2_000 });
    expect(Object.keys(fast)).toEqual(Object.keys(SESSION_TIMINGS));
    expect(scaledTimings(1)).toEqual(SESSION_TIMINGS);
    expect(scaledTimings(0)).toEqual(scaledTimings(1));
    expect(scaledTimings(Number.NaN)).toEqual(scaledTimings(1));
    expect(scaledTimings(1000)).toEqual(scaledTimings(60));
  });

  it("ends the game, even at its latest, before the conversation's cap", () => {
    const t = SESSION_TIMINGS;
    expect(t.gameEarliestMs).toBeGreaterThan(t.esmFollowMs);
    expect(t.gameLatestMs + t.gameCapMs).toBeLessThan(t.talkCapMs);
  });
});

describe("gameDue", () => {
  const timings = SESSION_TIMINGS;

  it("waits for a quiet moment once it may come, and comes at the deadline regardless", () => {
    expect(gameDue({ elapsedMs: 100_000, quietMs: 10_000, timings })).toBe(false);
    expect(gameDue({ elapsedMs: 140_000, quietMs: 800, timings })).toBe(false);
    expect(gameDue({ elapsedMs: 140_000, quietMs: GAME_QUIET_MS, timings })).toBe(true);
    expect(gameDue({ elapsedMs: 180_000, quietMs: 0, timings })).toBe(true);
  });
});

describe("esmDue", () => {
  const timings = SESSION_TIMINGS;
  const base = { quietMs: 2_000, busy: false, shown: new Set<number>(), lastShownMs: null, resumedAtMs: null, timings };

  it("asks how easy it is to follow before the game, in a quiet moment only", () => {
    expect(esmDue({ ...base, elapsedMs: 100_000 })).toBeNull();
    expect(esmDue({ ...base, elapsedMs: 106_000 })).toMatchObject({ ordinal: 0, item: "esm_follow" });
    expect(esmDue({ ...base, elapsedMs: 106_000, quietMs: 500 })).toBeNull();
    expect(esmDue({ ...base, elapsedMs: 106_000, busy: true })).toBeNull();
  });

  it("asks it again a minute after the game, and the effort late on, spaced apart", () => {
    const shown = new Set([0]);
    // Nothing later until they are back from the game, the effort included.
    expect(esmDue({ ...base, shown, elapsedMs: 300_000 })).toBeNull();
    const after = { ...base, shown, resumedAtMs: 220_000 };
    expect(esmDue({ ...after, elapsedMs: 280_000 })).toMatchObject({ ordinal: 1, item: "esm_follow" });
    const both = { ...after, shown: new Set([0, 1]), lastShownMs: 280_000 };
    expect(esmDue({ ...both, elapsedMs: 290_000 })).toBeNull();
    expect(esmDue({ ...both, elapsedMs: 300_000 })).toMatchObject({ ordinal: 2, item: "esm_effort" });
    expect(esmDue({ ...both, shown: new Set([0, 1, 2]), elapsedMs: 400_000 })).toBeNull();
  });

  it("knows its three prompts' items", () => {
    expect(esmSlots(timings, null).map((s) => s.item)).toEqual(["esm_follow", "esm_follow", "esm_effort"]);
    for (const item of Object.keys(ESM_ITEMS)) expect(ESM_ITEMS[item as keyof typeof ESM_ITEMS].question).toMatch(/^Right now/);
  });
});

describe("a moment", () => {
  const esm = { kind: "esm", ordinal: 0, item: "esm_follow", shownOffsetMs: 106_000, answeredOffsetMs: 108_500, value: 5, text: null };

  it("is one of the four kinds, on the drive's clock", () => {
    expect(SessionMoment.safeParse(esm).success).toBe(true);
    expect(SessionMoment.safeParse({ ...esm, answeredOffsetMs: null, value: null }).success).toBe(true);
    expect(SessionMoment.safeParse({ ...esm, kind: "nap" }).success).toBe(false);
    expect(SessionMoment.safeParse({ ...esm, shownOffsetMs: -1 }).success).toBe(false);
    expect(SessionStep.safeParse({ step: "moment", position: 1, moment: { ...esm, meta: { rounds: 3 } } }).success).toBe(true);
  });
});

describe("the answers", () => {
  const answers = { summary: "We settled on Aarhus by train; the hotel is still open.", follow: 5, effort: 3, glance: 4 };

  it("take a summary and the ratings, with the game's rating optional", () => {
    expect(BlockAnswers.safeParse(answers).success).toBe(true);
    expect(BlockAnswers.safeParse({ ...answers, pickup: 6, helped: "" }).success).toBe(true);
  });

  it("refuse a summary too short to mean anything, a rating off the scale, and stray keys", () => {
    expect(BlockAnswers.safeParse({ ...answers, summary: "   short   " }).success).toBe(false);
    expect(BlockAnswers.safeParse({ ...answers, follow: 8 }).success).toBe(false);
    expect(BlockAnswers.safeParse({ ...answers, folow: 5 }).success).toBe(false);
  });

  it("rank each view exactly once", () => {
    const ranking = ["bubbles", "transcript", "track", "conversation"];
    expect(SessionFinal.safeParse({ ranking, contact: false }).success).toBe(true);
    expect(SessionFinal.safeParse({ ranking: ["bubbles", "bubbles", "track", "conversation"], contact: false }).success).toBe(false);
    expect(SessionFinal.safeParse({ ranking: ranking.slice(1), contact: true }).success).toBe(false);
  });

  it("are one step of the session's wire format", () => {
    expect(SessionStep.safeParse({ step: "answers", position: 2, answers }).success).toBe(true);
    expect(SessionStep.safeParse({ step: "arm", position: 4 }).success).toBe(false);
  });
});

describe("resumeAt", () => {
  const blocks = (answered: number, finished = answered) =>
    [0, 1, 2, 3].map((position) => ({ position, answered: position < answered, finished: position < finished }));

  it("opens on consent until they have given it", () => {
    expect(resumeAt({ consented: false, completed: false, blocks: blocks(0) })).toEqual({ at: "consent" });
  });

  it("opens on the first block not yet answered: its questions once talked, else its brief", () => {
    expect(resumeAt({ consented: true, completed: false, blocks: blocks(0) })).toEqual({ at: "brief", position: 0 });
    expect(resumeAt({ consented: true, completed: false, blocks: blocks(1, 2) })).toEqual({ at: "answers", position: 1 });
  });

  it("opens on the ranking after the fourth, and on the end once that is sent", () => {
    expect(resumeAt({ consented: true, completed: false, blocks: blocks(4) })).toEqual({ at: "final" });
    expect(resumeAt({ consented: true, completed: true, blocks: blocks(4) })).toEqual({ at: "done" });
  });
});
