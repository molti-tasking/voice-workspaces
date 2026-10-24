/**
 * The display study's export: the measures each conversation is compared
 * on, from a conversation built by hand, and the files end to end.
 *
 * The end-to-end half needs the local Postgres; skipped when it is
 * unreachable — check the counts.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DriveLine, StudyMoment, SubjectVisitRow } from "@voicemural/db/study-session";

const { closeDb, eq, getDb, inArray } = await import("@voicemural/db");
const schema = await import("@voicemural/db/schema");
const { isDatabaseReachable } = await import("@voicemural/db/testing");
const { recordSubjectVisit } = await import("@voicemural/db/subjects");
const sessions = await import("@voicemural/db/study-session");
const { blockMeasures, buildSessionExport, pauseWindow, subjectAt } = await import("./session-export");

const T0 = new Date("2026-10-21T10:00:00Z");

let momentId = 0;
function moment(m: Partial<StudyMoment> & Pick<StudyMoment, "kind" | "shownOffsetMs">): StudyMoment {
  momentId += 1;
  return {
    id: `m${momentId}`,
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
  };
}

const line = (who: "user" | "agent", startMs: number, text: string, spark: string | null = null): DriveLine => ({
  who,
  startMs,
  endMs: startMs + 2_000,
  text,
  spark,
});

// A conversation: talk, a game from 2:15 to 3:16, straight back into the
// conversation, their first words 2.4 s after it, and a spark-asked turn.
const LINES: DriveLine[] = [
  line("user", 1_000, "We should go to Aarhus by train"),
  line("agent", 6_000, "Aarhus works, the train is cheaper."),
  line("user", 150_000, "ugh I lost"),
  line("user", 198_400, "Okay, back to the train tickets"),
  line("agent", 212_000, "So where did you land on the train?", "say_back"),
];
const VISITS: SubjectVisitRow[] = [
  { ordinal: 1, title: "Where to go", startMs: 0, endMs: 100_000 },
  { ordinal: 2, title: "Getting there", startMs: 100_000, endMs: null },
];
const MOMENTS: StudyMoment[] = [
  moment({ kind: "esm", ordinal: 0, item: "esm_follow", shownOffsetMs: 105_000, answeredOffsetMs: 107_000, value: 5 }),
  moment({
    kind: "game",
    item: "tic_tac_toe",
    shownOffsetMs: 135_000,
    answeredOffsetMs: 196_000,
    meta: { rounds: 3, won: 1, lost: 1, drawn: 1, moves: 12, cutOff: false, promptBeforeMissed: false },
  }),
  moment({ kind: "resume", item: "first_speech", shownOffsetMs: 196_000, answeredOffsetMs: 198_000 }),
  moment({ kind: "esm", ordinal: 1, item: "esm_follow", shownOffsetMs: 265_000 }),
];

describe("the interruption and the subjects", () => {
  it("runs from the game to the conversation coming back, or to the game's end", () => {
    expect(pauseWindow(MOMENTS)).toEqual({ fromMs: 135_000, toMs: 196_000 });
    expect(pauseWindow(MOMENTS.filter((m) => m.kind === "game"))).toEqual({ fromMs: 135_000, toMs: 196_000 });
    // Session-1's way back came later than the game's end.
    const later = [MOMENTS[1]!, moment({ kind: "resume", shownOffsetMs: 205_000 })];
    expect(pauseWindow(later)).toEqual({ fromMs: 135_000, toMs: 205_000 });
    expect(pauseWindow([])).toBeNull();
  });

  it("finds the subject of a moment, an open visit running on", () => {
    expect(subjectAt(VISITS, 50_000)).toBe(1);
    expect(subjectAt(VISITS, 100_000)).toBe(2);
    expect(subjectAt(VISITS, 9_999_999)).toBe(2);
    expect(subjectAt([], 1_000)).toBeNull();
  });
});

describe("blockMeasures", () => {
  const measures = blockMeasures({
    startedAt: T0,
    endedAt: new Date(T0.getTime() + 320_000),
    lines: LINES,
    visits: VISITS,
    moments: MOMENTS,
  });

  it("times the talk without the interruption, and counts nobody's words in it", () => {
    expect(measures).toMatchObject({ drive_seconds: 320, pause_seconds: 61, talk_seconds: 259 });
    expect(measures).toMatchObject({ user_turns: 2, user_words: 13, agent_turns: 2, agent_words: 14 });
    expect(measures.words_in_pause).toBe(3);
    expect(measures.spark_turns).toBe(1);
  });

  it("times picking the conversation up both ways, and says whether it was the same subject", () => {
    expect(measures.resume_first_speech_ms).toBe(2_000);
    expect(measures.resume_first_utterance_ms).toBe(2_400);
    expect(measures).toMatchObject({ subject_before_game: 2, subject_after_game: 2, same_subject: true });
  });

  it("carries the game and the prompts", () => {
    expect(measures).toMatchObject({
      game_at_seconds: 135,
      game_seconds: 61,
      game_rounds: 3,
      game_won: 1,
      game_cut_off: false,
    });
    expect(measures).not.toHaveProperty("probe");
    expect(measures).toMatchObject({
      esm_follow_before: 5,
      esm_follow_before_state: "answered",
      esm_follow_after: null,
      esm_follow_after_state: "expired",
      esm_effort_state: "not_shown",
    });
  });

  it("says when the prompt before the game was missed, and when they never spoke again", () => {
    const missed = blockMeasures({
      startedAt: T0,
      endedAt: null,
      lines: LINES.slice(0, 2),
      visits: VISITS,
      moments: [
        moment({ kind: "game", shownOffsetMs: 180_000, answeredOffsetMs: 240_000, meta: { promptBeforeMissed: true } }),
        moment({ kind: "resume", shownOffsetMs: 250_000 }),
      ],
    });
    expect(missed.esm_follow_before_state).toBe("missed");
    expect(missed).toMatchObject({ resume_first_speech_ms: null, resume_first_utterance_ms: null, same_subject: null });
    expect(missed.talk_seconds).toBeNull();
  });
});

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

describeIfDb("buildSessionExport", () => {
  const USER = "test-session-export-user";
  const REF = "TST-EXPORT-1";
  /** A session made and never opened: its row must have every column too. */
  const UNOPENED = "TST-EXPORT-2";
  // This file's own ids: another test file's would collide when turbo runs them in parallel.
  const DRIVE = "00000000-0000-4000-8000-0000000ee501";
  const CHUNK = "00000000-0000-4000-8000-0000000ee502";

  beforeAll(async () => {
    const db = getDb();
    await db.delete(schema.studySession).where(inArray(schema.studySession.ref, [REF, UNOPENED]));
    await db.delete(schema.user).where(eq(schema.user.id, USER));
    await db.insert(schema.user).values({ id: USER, name: "Guest", email: `${USER}@test.local`, isAnonymous: true });

    const { session } = await sessions.createSession({ ref: REF, orderIndex: 0 });
    await sessions.createSession({ ref: UNOPENED, orderIndex: 1 });
    await sessions.claimSession({ code: session.inviteCode!, userId: USER, now: T0 });
    await sessions.armBlock(USER, 0, T0);
    await db.insert(schema.captureSession).values({
      id: DRIVE,
      userId: USER,
      startedAt: T0,
      endedAt: new Date(T0.getTime() + 320_000),
    });
    await sessions.linkArmedBlock((await sessions.armedBlockFor(USER, T0))!, DRIVE);

    await db.insert(schema.audioChunk).values({
      id: CHUNK,
      captureSessionId: DRIVE,
      seq: 0,
      startOffsetMs: 0,
      durationMs: 320_000,
      mimeType: "audio/webm",
      byteSize: 1,
      checksum: "x",
      status: "transcribed",
    });
    for (const l of LINES.filter((l) => l.who === "user")) {
      await db.insert(schema.utterance).values({
        captureSessionId: DRIVE,
        chunkId: CHUNK,
        startOffsetMs: l.startMs,
        endOffsetMs: l.endMs,
        text: l.text,
      });
    }
    for (const [seq, l] of LINES.filter((l) => l.who === "agent").entries()) {
      const [turn] = await db
        .insert(schema.agentTurn)
        .values({ captureSessionId: DRIVE, seq, startOffsetMs: l.startMs, endOffsetMs: l.endMs, text: l.text, generatedText: l.text })
        .returning({ id: schema.agentTurn.id });
      if (l.spark) {
        await db.insert(schema.agentDecision).values({
          captureSessionId: DRIVE,
          seq,
          offsetMs: l.startMs,
          trigger: "poke",
          outcome: "spoke",
          sparkKind: "say_back",
          agentTurnId: turn!.id,
        });
      }
    }
    for (const v of VISITS) {
      await recordSubjectVisit({
        captureSessionId: DRIVE,
        ordinal: v.ordinal,
        title: v.title,
        startOffsetMs: v.startMs,
        ...(v.endMs !== null ? { endOffsetMs: v.endMs } : {}),
      });
    }
    for (const m of MOMENTS) {
      // The table's kinds still include session-1's probe; none of these is one.
      if (m.kind === "probe") continue;
      await sessions.saveMoment(USER, 0, {
        kind: m.kind,
        ordinal: m.ordinal,
        item: m.item,
        shownOffsetMs: m.shownOffsetMs,
        answeredOffsetMs: m.answeredOffsetMs,
        value: m.value,
        text: m.text,
        meta: m.meta as Record<string, string | number | boolean | null>,
      });
    }
    await sessions.finishBlock(USER, 0, T0);
    await sessions.saveBlockAnswers(
      USER,
      0,
      {
        summary: "Train to Aarhus; where to stay is open.",
        follow: 6,
        effort: 2,
        pickup: 5,
        beforeGame: "the train",
        wayBack: "I read the last line",
        glance: 3,
      },
      T0,
    );
  });

  afterAll(async () => {
    await getDb().delete(schema.studySession).where(inArray(schema.studySession.ref, [REF, UNOPENED]));
    await getDb().delete(schema.user).where(eq(schema.user.id, USER));
    await closeDb();
  });

  it("writes a talked block's measures, the moments and the transcript, keyed by the session's ref", async () => {
    const out = await buildSessionExport({ text: true });
    const mine = out.blocks.filter((b) => b.ref === REF);
    expect(mine).toHaveLength(1);
    const [talked] = mine;
    const untalked = out.blocks.find((b) => b.ref === UNOPENED);
    expect(talked).toMatchObject({
      position: 0,
      display: "transcript",
      task: "trip",
      attempts: 1,
      talk_seconds: 259,
      user_words: 13,
      spark_turns: 1,
      resume_first_speech_ms: 2_000,
      resume_first_utterance_ms: 2_400,
      same_subject: true,
      subjects: 2,
      summary: "Train to Aarhus; where to stay is open.",
      pickup: 5,
      before_game: "the train",
      way_back: "I read the last line",
    });
    // Every row has every column, an untalked block's included.
    expect(Object.keys(untalked!)).toEqual(Object.keys(talked!));
    expect(untalked!.talk_seconds).toBeNull();

    const moments = out.moments.filter((m) => m.ref === REF);
    expect(moments.map((m) => m.kind)).toEqual(["esm", "game", "resume", "esm"]);
    expect(moments.find((m) => m.kind === "resume")!.latency_ms).toBe(2_000);

    const transcript = out.transcripts.find((t) => t.ref === REF)!;
    expect(transcript.pause).toEqual({ from_ms: 135_000, to_ms: 196_000 });
    expect(transcript.lines.filter((l) => l.in_pause).map((l) => l.text)).toEqual(["ugh I lost"]);
    expect(transcript.lines.find((l) => l.spark)?.spark).toBe("say_back");

    const row = out.sessions.find((s) => s.ref === REF);
    expect(row).toMatchObject({ design: "between", order_index: 0, display: "transcript", task: "trip", blocks_answered: 1 });
    expect(row).not.toHaveProperty("rank_1");
  });

  it("leaves the transcripts out unless asked", async () => {
    expect((await buildSessionExport()).transcripts).toEqual([]);
  });
});
