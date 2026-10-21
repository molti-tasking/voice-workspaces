import { describe, expect, it } from "vitest";
import { CONVERSATION_DISPLAYS } from "./contracts";
import {
  BlockAnswers,
  SESSION_ORDERS,
  SESSION_TASK_IDS,
  SessionFinal,
  SessionStep,
  blocksFor,
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
  it("speeds the conversation up, within bounds", () => {
    expect(scaledTimings(10)).toEqual({ talkMinMs: 24_000, talkTargetMs: 30_000, talkCapMs: 42_000 });
    expect(scaledTimings(0)).toEqual(scaledTimings(1));
    expect(scaledTimings(Number.NaN)).toEqual(scaledTimings(1));
    expect(scaledTimings(1000)).toEqual(scaledTimings(60));
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
