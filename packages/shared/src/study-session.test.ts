import { describe, expect, it } from "vitest";
import {
  BlockAnswers,
  GAME_QUIET_MS,
  DEFAULT_DESIGN,
  DesignInput,
  SESSION_TIMINGS,
  SESSION_TASK_IDS,
  SessionEnroll,
  SessionFinal,
  SessionMoment,
  SessionStep,
  blocksFor,
  cellCount,
  cellFor,
  leastFilledCell,
  gameDue,
  resumeAt,
  scaledTimings,
} from "./study-session";

const cellsOf = (design: Parameters<typeof cellFor>[0]) =>
  Array.from({ length: cellCount(design) }, (_, k) => cellFor(design, k));
const pairs = (design: Parameters<typeof cellFor>[0]) => new Set(cellsOf(design).map((c) => `${c.display}:${c.task}`));

describe("a setup's cells", () => {
  const four = { views: ["chat", "topics", "uptake", "stack"], tasks: ["trip", "birthday"] } as const;

  it("start session-2's setup on the baseline, as its sessions were made", () => {
    expect(DEFAULT_DESIGN).toEqual({ name: "between", views: ["chat", "topics", "uptake"], tasks: ["trip", "birthday"] });
    // The cells session-2's invites were made in, before setups could be chosen.
    expect(cellsOf(DEFAULT_DESIGN)).toEqual([
      { display: "chat", task: "trip" },
      { display: "topics", task: "birthday" },
      { display: "uptake", task: "trip" },
      { display: "chat", task: "birthday" },
      { display: "topics", task: "trip" },
      { display: "uptake", task: "birthday" },
    ]);
  });

  it("hold every view with every task exactly once, whatever the counts", () => {
    for (const design of [DEFAULT_DESIGN, four, { views: ["stack"], tasks: ["trip"] }] as const) {
      expect(pairs(design).size).toBe(cellCount(design));
    }
    // Four views and two tasks share a factor: still every pair, not each view with one task.
    expect(cellCount(four)).toBe(8);
    expect(new Set(cellsOf(four).filter((c) => c.display === "stack").map((c) => c.task))).toEqual(new Set(["trip", "birthday"]));
  });

  it("cover every view in any run as long as the views, and wrap around", () => {
    for (const design of [DEFAULT_DESIGN, four]) {
      const n = cellCount(design);
      for (let k = 0; k < n; k++) {
        const run = design.views.map((_, i) => cellFor(design, k + i).display);
        expect(new Set(run).size).toBe(design.views.length);
      }
      expect(cellFor(design, n + 1)).toEqual(cellFor(design, 1));
      expect(cellFor(design, -1)).toEqual(cellFor(design, n - 1));
    }
  });

  it("are one conversation each", () => {
    expect(blocksFor(DEFAULT_DESIGN, 4)).toEqual([{ position: 0, ...cellFor(DEFAULT_DESIGN, 4) }]);
  });

  it("are filled least first, the lowest on a tie", () => {
    expect(leastFilledCell([0, 0, 0])).toBe(0);
    expect(leastFilledCell([1, 0, 0])).toBe(1);
    expect(leastFilledCell([2, 1, 2, 1])).toBe(1);
    expect(leastFilledCell([3, 3, 3, 2])).toBe(3);
  });
});

describe("DesignInput", () => {
  it("takes views and tasks in their order, each once, with a plain name", () => {
    const parsed = DesignInput.parse({ name: "stack-pilot", views: ["stack", "chat"], tasks: ["move"] });
    expect(parsed).toEqual({ name: "stack-pilot", views: ["stack", "chat"], tasks: ["move"], completionCode: null, note: null });
    for (const bad of [
      { name: "Stack Pilot", views: ["chat"], tasks: ["trip"] },
      { name: "stack", views: [], tasks: ["trip"] },
      { name: "stack", views: ["chat", "chat"], tasks: ["trip"] },
      { name: "stack", views: ["mirror"], tasks: ["trip"] },
      { name: "stack", views: ["chat"], tasks: ["trip"], completionCode: "has space" },
    ]) {
      expect(DesignInput.safeParse(bad).success).toBe(false);
    }
    for (const task of DesignInput.parse({ name: "all", views: ["chat"], tasks: [...SESSION_TASK_IDS] }).tasks) {
      expect(SESSION_TASK_IDS).toContain(task);
    }
  });
});

describe("SessionEnroll", () => {
  it("is an invite's code or Prolific's participant, with consent", () => {
    expect(SessionEnroll.safeParse({ code: "a".repeat(24), consent: true }).success).toBe(true);
    expect(
      SessionEnroll.safeParse({ prolific: { pid: "5f8e0d1c2b3a49586a7b8c9d", studyId: "s1" }, consent: true }).success,
    ).toBe(true);
    expect(SessionEnroll.safeParse({ prolific: { pid: "x" }, consent: true }).success).toBe(false);
    expect(SessionEnroll.safeParse({ code: "a".repeat(24), consent: false }).success).toBe(false);
  });
});

describe("scaledTimings", () => {
  it("speeds every timing up, within bounds", () => {
    const fast = scaledTimings(10);
    expect(fast).toMatchObject({ talkMinMs: 24_000, talkCapMs: 42_000, gameEarliestMs: 13_500, gameMinMs: 6_000 });
    expect(Object.keys(fast)).toEqual(Object.keys(SESSION_TIMINGS));
    expect(scaledTimings(1)).toEqual(SESSION_TIMINGS);
    expect(scaledTimings(0)).toEqual(scaledTimings(1));
    expect(scaledTimings(Number.NaN)).toEqual(scaledTimings(1));
    expect(scaledTimings(1000)).toEqual(scaledTimings(60));
  });

  it("ends the game, even at its latest, before the conversation's cap", () => {
    const t = SESSION_TIMINGS;
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

describe("a moment", () => {
  const esm = { kind: "esm", ordinal: 0, item: "esm_follow", shownOffsetMs: 106_000, answeredOffsetMs: 108_500, value: 5, text: null };

  it("is one of the three kinds, on the drive's clock", () => {
    expect(SessionMoment.safeParse(esm).success).toBe(true);
    // Session-1's "where were you?" is asked after the conversation now.
    expect(SessionMoment.safeParse({ ...esm, kind: "probe", item: "where_were_we" }).success).toBe(false);
    expect(SessionMoment.safeParse({ ...esm, answeredOffsetMs: null, value: null }).success).toBe(true);
    expect(SessionMoment.safeParse({ ...esm, kind: "nap" }).success).toBe(false);
    expect(SessionMoment.safeParse({ ...esm, shownOffsetMs: -1 }).success).toBe(false);
    expect(SessionStep.safeParse({ step: "moment", position: 0, moment: { ...esm, meta: { rounds: 3 } } }).success).toBe(true);
  });
});

describe("the answers", () => {
  const answers = { summary: "We settled on Aarhus by train; the hotel is still open.", follow: 5, effort: 3, glance: 4 };

  it("take a summary and the ratings, with the game's questions optional", () => {
    expect(BlockAnswers.safeParse(answers).success).toBe(true);
    expect(BlockAnswers.safeParse({ ...answers, pickup: 6, helped: "" }).success).toBe(true);
    const game = { beforeGame: "The hotel, I think", wayBack: "I looked at the screen first." };
    expect(BlockAnswers.safeParse({ ...answers, pickup: 6, ...game }).success).toBe(true);
    // Asked, they need an answer: "I don't remember" is one, an empty box is not.
    expect(BlockAnswers.safeParse({ ...answers, ...game, beforeGame: "   " }).success).toBe(false);
  });

  it("refuse a summary too short to mean anything, a rating off the scale, and stray keys", () => {
    expect(BlockAnswers.safeParse({ ...answers, summary: "   short   " }).success).toBe(false);
    expect(BlockAnswers.safeParse({ ...answers, follow: 8 }).success).toBe(false);
    expect(BlockAnswers.safeParse({ ...answers, folow: 5 }).success).toBe(false);
  });

  it("end with anything else and whether we may get back to them, and no ranking", () => {
    expect(SessionFinal.safeParse({ contact: false }).success).toBe(true);
    expect(SessionFinal.safeParse({ more: "It was fun.", contact: true }).success).toBe(true);
    expect(SessionFinal.safeParse({ more: "It was fun." }).success).toBe(false);
    expect(SessionFinal.safeParse({ ranking: ["chat", "topics", "uptake"], contact: true }).success).toBe(false);
  });

  it("are one step of the session's wire format", () => {
    expect(SessionStep.safeParse({ step: "answers", position: 0, answers }).success).toBe(true);
    // One conversation: there is no second block to step to.
    expect(SessionStep.safeParse({ step: "arm", position: 1 }).success).toBe(false);
  });
});

describe("resumeAt", () => {
  const blocks = (answered: number, finished = answered) =>
    [0].map((position) => ({ position, answered: position < answered, finished: position < finished }));

  it("opens on consent until they have given it", () => {
    expect(resumeAt({ consented: false, completed: false, blocks: blocks(0) })).toEqual({ at: "consent" });
  });

  it("opens on the conversation not yet answered: its questions once talked, else its brief", () => {
    expect(resumeAt({ consented: true, completed: false, blocks: blocks(0) })).toEqual({ at: "brief", position: 0 });
    expect(resumeAt({ consented: true, completed: false, blocks: blocks(0, 1) })).toEqual({ at: "answers", position: 0 });
  });

  it("opens on the last questions once it is answered, and on the end once those are sent", () => {
    expect(resumeAt({ consented: true, completed: false, blocks: blocks(1) })).toEqual({ at: "final" });
    expect(resumeAt({ consented: true, completed: true, blocks: blocks(1) })).toEqual({ at: "done" });
  });
});
