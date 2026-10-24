import { describe, expect, it } from "vitest";
import type { DriveLine, StudyMoment } from "@voicemural/db/study-session";
import {
  buildJudgeItems,
  itemId,
  joinScores,
  judgeLinesOf,
  runJudge,
  scoreRow,
  type JudgeBlock,
} from "./session-judge";

const T0 = new Date("2026-10-21T10:00:00Z");
const line = (who: "user" | "agent", startMs: number, text: string): DriveLine => ({
  who,
  startMs,
  endMs: startMs + 2_000,
  text,
});
const moment = (m: Partial<StudyMoment> & Pick<StudyMoment, "kind" | "shownOffsetMs">): StudyMoment => ({
  id: `${m.kind}-${m.shownOffsetMs}`,
  blockId: "b",
  captureSessionId: "d",
  ordinal: 0,
  item: "x",
  answeredOffsetMs: null,
  value: null,
  text: null,
  meta: {},
  createdAt: T0,
  ...m,
});

const BLOCK: JudgeBlock = {
  ref: "F07",
  position: 2,
  display: "bubbles",
  task: "trip",
  summary: "The bubbles helped: we picked the train to Aarhus.",
  lines: [
    line("user", 1_000, "Should we take the train to Aarhus or the bus?"),
    line("agent", 4_000, "The train is faster and not much dearer for four people."),
    // Their microphone hearing the agent: dropped.
    line("user", 7_000, "The train is faster and not much dearer for four people."),
    line("user", 150_000, "ugh, lost again"),
    line("user", 210_000, "Right, so the train, we were on the tickets"),
    line("agent", 214_000, "Book them early and they are cheaper."),
  ],
  moments: [
    moment({ kind: "game", shownOffsetMs: 135_000, answeredOffsetMs: 196_000 }),
    moment({ kind: "probe", shownOffsetMs: 196_000, answeredOffsetMs: 204_000, text: "the train, on the screen" }),
    moment({ kind: "resume", shownOffsetMs: 205_000, answeredOffsetMs: 209_000 }),
  ],
};

describe("what the judge is shown", () => {
  it("leaves out the interruption and their echo of the agent", () => {
    const lines = judgeLinesOf(BLOCK);
    expect(lines.all.map((l) => `${l.who}: ${l.text}`)).toEqual([
      "Person: Should we take the train to Aarhus or the bus?",
      "Assistant: The train is faster and not much dearer for four people.",
      "Person: Right, so the train, we were on the tickets",
      "Assistant: Book them early and they are cheaper.",
    ]);
    expect(lines.before).toHaveLength(2);
    expect(lines.after.map((l) => l.who)).toEqual(["Person", "Assistant"]);
  });

  it("never names the block, its view or its place in the session", () => {
    const { items } = buildJudgeItems([BLOCK], { salt: "s", blindCheck: false });
    const everything = JSON.stringify(items);
    for (const giveaway of ["F07", "bubbles", "\"position\"", "trip"]) expect(everything).not.toContain(giveaway);
    // Their own words naming a view are scrubbed too.
    expect(everything).toContain("The […] helped");
    expect(everything).toContain("the train, […]");
  });
});

describe("the items and their key", () => {
  it("makes a summary and a resumption item, each as often as asked, under ids that say nothing", () => {
    const { items, key } = buildJudgeItems([BLOCK], { salt: "s", repeats: 2, random: () => 0 });
    expect(items.map((i) => i.kind).sort()).toEqual(["resumption", "resumption", "summary", "summary"]);
    expect(new Set(items.map((i) => i.id)).size).toBe(4);
    expect(key).toContainEqual({ id: itemId("s", "F07", 2, "summary", 1), ref: "F07", position: 2, display: "bubbles", task: "trip", kind: "summary", repeat: 1 });
    expect(items.find((i) => i.kind === "resumption")!.afterLines).toBe(2);
  });

  it("gives a block the same ids under the same salt, and others under another", () => {
    expect(itemId("s", "F07", 2, "summary", 0)).toBe(itemId("s", "F07", 2, "summary", 0));
    expect(itemId("s", "F07", 2, "summary", 0)).not.toBe(itemId("t", "F07", 2, "summary", 0));
    expect(itemId("s", "F07", 2, "summary", 0)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("asks for the view only in the blind check, and skips what has nothing to judge", () => {
    expect(buildJudgeItems([BLOCK], { salt: "s" }).items.some((i) => i.kind === "blind")).toBe(false);
    expect(buildJudgeItems([BLOCK], { salt: "s", blindCheck: true }).items.filter((i) => i.kind === "blind")).toHaveLength(1);
    const silent = { ...BLOCK, lines: [], summary: null };
    expect(buildJudgeItems([silent], { salt: "s", blindCheck: true }).items).toEqual([]);
    const noGame = { ...BLOCK, moments: [] };
    expect(buildJudgeItems([noGame], { salt: "s" }).items.map((i) => i.kind)).toEqual(["summary"]);
  });
});

describe("scoring and joining", () => {
  const { items, key } = buildJudgeItems([BLOCK], { salt: "s", blindCheck: true, random: () => 0.5 });
  const answers: Record<string, string> = {
    summary: '{"key_points": [{"point": "Train", "in_summary": "present"}], "invented": 0, "coverage": 4, "accuracy": 5, "specificity": 3, "reason": "ok"}',
    resumption: '{"probe_accuracy": 5, "resumed_same_topic": "yes", "first_on_topic_line": 1, "asked_assistant": false, "reason": "back"}',
    blind: '{"guess": "D", "confidence": 2}',
  };

  it("scores each answer by its id alone, and keeps a bad one as an error", async () => {
    const rows = await runJudge(items, async (item) => ({ content: answers[item.kind]!, model: "m", latencyMs: 10 }));
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.kind === "summary")).toMatchObject({ coverage: 4, present: 1, coverage_share: 1, error: null });
    expect(rows.find((r) => r.kind === "resumption")).toMatchObject({ probe_accuracy: 5, first_on_topic_line: 1 });
    expect(JSON.stringify(rows)).not.toContain("bubbles");
    expect(scoreRow(items[0]!, { content: "no idea", model: "m", latencyMs: 1 }).error).toMatch(/no JSON/);
    const failing = await runJudge(items.slice(0, 1), async () => {
      throw new Error("LiteLLM down");
    });
    expect(failing[0]).toMatchObject({ error: "LiteLLM down" });
  });

  it("puts the view next to the scores only when joined, and reads the blind guess back", async () => {
    const rows = await runJudge(items, async (item) => ({ content: answers[item.kind]!, model: "m", latencyMs: 10 }));
    const joined = joinScores(rows, key);
    expect(joined.find((r) => r.kind === "blind")).toMatchObject({ display: "bubbles", guessed_view: "bubbles", guessed_right: true });
    expect(joined.find((r) => r.kind === "summary")).toMatchObject({ ref: "F07", display: "bubbles", coverage: 4 });
  });
});

describe("the files the join reads back", () => {
  it("round-trips through CSV, commas, quotes and newlines included", async () => {
    const { fromCsv, toCsv } = await import("./prolific-export");
    const rows = [
      { id: "a1", reason: 'Said "train", then, later,\nthe bus', coverage: 4, error: null },
      { id: "b2", reason: "plain", coverage: 2, error: "no JSON" },
    ];
    expect(fromCsv(toCsv(rows))).toEqual([
      { id: "a1", reason: 'Said "train", then, later,\nthe bus', coverage: "4", error: null },
      { id: "b2", reason: "plain", coverage: "2", error: "no JSON" },
    ]);
    expect(fromCsv("")).toEqual([]);
  });

  it("allows Langfuse only on a host someone named", async () => {
    const { langfuseAllowed } = await import("./session-judge");
    const config = { baseUrl: "https://langfuse.cavi.au.dk", publicKey: "p", secretKey: "s", environment: undefined };
    expect(langfuseAllowed(config, {})).toBe(false);
    expect(langfuseAllowed(config, { STUDY_JUDGE_LANGFUSE_HOSTS: "cloud.langfuse.com" })).toBe(false);
    expect(langfuseAllowed(config, { STUDY_JUDGE_LANGFUSE_HOSTS: "cloud.langfuse.com, langfuse.cavi.au.dk" })).toBe(true);
  });
});
