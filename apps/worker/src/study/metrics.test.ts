/**
 * The measures, against a seeded drive built to look like Pilot 01.
 *
 * The fixture is not arbitrary. It reproduces, in miniature, every failure
 * that pilot produced — an answer the agent declined, a stretch of silence the
 * participant had to break themselves, a correction, a repeat request, a
 * moment that ran two completions — so the assertions below are the statement
 * that those failures are now VISIBLE. A metrics module that cannot see them
 * would pass a suite built from a clean drive.
 *
 * It also asserts the privacy boundary the way `export.test.ts` does: a
 * sentinel in every free-text column, and a failure if it appears anywhere in
 * the output. This module is the one place in the study pipeline that reads
 * transcript text, so it is the one place where that has to be proved rather
 * than assumed.
 *
 * Needs the local Postgres; skipped when it is unreachable — check the counts.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SECRET = "ZEBRA-CONFIDENTIAL";

const { closeDb, eq, getDb } = await import("@voicemural/db");
const schema = await import("@voicemural/db/schema");
const { isDatabaseReachable } = await import("@voicemural/db/testing");
const { median, participantMetrics, share } = await import("./metrics");

const USER_ID = "test-study-metrics-user";
const SESSION = "00000000-0000-4000-8000-00000000f501";
const CHUNK = "00000000-0000-4000-8000-00000000f502";
const CARD = "00000000-0000-4000-8000-00000000f503";

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

/** Ms into the drive → an utterance row, with the text the classifiers read. */
function said(id: string, startOffsetMs: number, endOffsetMs: number, text: string) {
  return {
    id,
    captureSessionId: SESSION,
    chunkId: CHUNK,
    startOffsetMs,
    endOffsetMs,
    text,
    kind: "content" as const,
  };
}

async function seed() {
  const db = getDb();
  await db.delete(schema.user).where(eq(schema.user.id, USER_ID));
  await db.insert(schema.user).values({
    id: USER_ID,
    name: `${SECRET} name`,
    email: `${USER_ID}@test.local`,
    studyParticipantId: "PMETRICS",
  });
  await db.insert(schema.captureSession).values({
    id: SESSION,
    userId: USER_ID,
    startedAt: new Date("2026-09-19T09:00:00Z"),
    endedAt: new Date("2026-09-19T09:20:00Z"),
    endedBy: "client",
    setting: "desk",
    settingSource: "chosen",
    // Stop opened the debrief at 15 minutes; done closed it at 17.
    debriefStartedOffsetMs: 900_000,
    debriefEndedOffsetMs: 1_020_000,
  });
  await db.insert(schema.audioChunk).values({
    id: CHUNK,
    captureSessionId: SESSION,
    seq: 0,
    startOffsetMs: 0,
    durationMs: 1_200_000,
    mimeType: "audio/webm",
    byteSize: 1_024,
    checksum: "x",
    storageKey: `${SECRET}/key.webm`,
    status: "transcribed",
  });

  /* THE DRIVE, as a sequence of offsets.
   *
   *   0s   they speak
   *   2s   the agent replies (1.2s latency, no tool)
   *   10s  they speak again
   *   20s  the agent replies after a lookup (8.4s latency, one tool call)
   *   40s  they speak; NOTHING comes back
   *   50s  they speak again — a RE-PROMPT, 7s of agent silence
   *   54s  the agent finally replies
   *   60s  they ask for a repeat — which is NOT a re-prompt: it answered
   *   70s  the agent asks a question
   *   75s  they answer "Ja." — and the agent DECLINES it
   *   90s  they correct the agent, shortly after it spoke
   *   900s the debrief starts; what they say in it is not the drive
   */
  await db.insert(schema.utterance).values([
    said("00000000-0000-4000-8000-00000000f601", 0, 3_000, `${SECRET} where did I leave the intro`),
    said("00000000-0000-4000-8000-00000000f602", 10_000, 13_000, "what are the opening hours"),
    said("00000000-0000-4000-8000-00000000f603", 40_000, 43_000, "so the next thing is the method"),
    said("00000000-0000-4000-8000-00000000f604", 50_000, 52_000, "hallo bist du noch da"),
    said("00000000-0000-4000-8000-00000000f605", 60_000, 62_000, "wie bitte"),
    said("00000000-0000-4000-8000-00000000f606", 75_000, 76_000, "Ja."),
    said("00000000-0000-4000-8000-00000000f607", 90_000, 93_000, "Nein, das andere."),
    // A LONG RUN of thinking aloud, with a repair in the middle of it: three
    // utterances less than RUN_GAP_MS apart, no agent turn between them, and
    // far enough from the last one that the repair is plainly addressed to
    // their own sentence rather than to anything the agent said.
    said("00000000-0000-4000-8000-00000000f609", 200_000, 206_000, "also der vergleich traegt"),
    said(
      "00000000-0000-4000-8000-00000000f610",
      207_000,
      214_000,
      "beziehungsweise eher nur fuer die erste haelfte des korpus",
    ),
    said("00000000-0000-4000-8000-00000000f611", 215_000, 220_000, "das muss ich pruefen"),
    said("00000000-0000-4000-8000-00000000f608", 950_000, 960_000, `${SECRET} the debrief answer`),
  ]);

  await db.insert(schema.agentTurn).values([
    {
      captureSessionId: SESSION,
      seq: 0,
      startOffsetMs: 4_200,
      endOffsetMs: 7_000,
      endOffsetMeasured: true,
      kind: "reply",
      text: `${SECRET} halfway through the method`,
      generatedText: `${SECRET} halfway through the method`,
      totalLatencyMs: 1_200,
    },
    // The filler spoken while the lookup ran. Never a reply: counting it as
    // one would hide the 8.4s wait it was covering.
    {
      captureSessionId: SESSION,
      seq: 1,
      startOffsetMs: 13_500,
      endOffsetMs: 15_000,
      kind: "backchannel",
      text: "Ich schaue noch.",
      generatedText: "Ich schaue noch.",
      totalLatencyMs: 500,
    },
    {
      captureSessionId: SESSION,
      seq: 2,
      startOffsetMs: 21_400,
      endOffsetMs: 26_000,
      endOffsetMeasured: true,
      kind: "reply",
      text: `${SECRET} they open at nine`,
      generatedText: `${SECRET} they open at nine`,
      totalLatencyMs: 8_400,
      toolCalls: [{ name: "search_web", latencyMs: 6_900 }],
    },
    {
      captureSessionId: SESSION,
      seq: 3,
      startOffsetMs: 54_000,
      endOffsetMs: 56_000,
      kind: "reply",
      text: `${SECRET} still here`,
      generatedText: `${SECRET} still here`,
      totalLatencyMs: 1_300,
    },
    {
      captureSessionId: SESSION,
      seq: 4,
      startOffsetMs: 70_000,
      endOffsetMs: 73_000,
      kind: "reply",
      text: `${SECRET} shall I drop it?`,
      generatedText: `${SECRET} shall I drop it?`,
      totalLatencyMs: 1_400,
      error: "tts stalled",
    },
    // SPOKEN OVER THEM: this turn begins at 91s, while they are still talking
    // (90–93s). The prompt's central rule is that this never happens, and
    // until the thinking group existed nothing counted it.
    {
      captureSessionId: SESSION,
      seq: 6,
      startOffsetMs: 91_000,
      endOffsetMs: 92_000,
      kind: "reply",
      text: `${SECRET} the second half then`,
      generatedText: `${SECRET} the second half then`,
      totalLatencyMs: 900,
    },
    // And an answer at 95s, so the long silence before the run at 200s is the
    // person choosing to think rather than the system having gone quiet.
    {
      captureSessionId: SESSION,
      seq: 7,
      startOffsetMs: 95_000,
      endOffsetMs: 97_000,
      kind: "reply",
      text: `${SECRET} that one then`,
      generatedText: `${SECRET} that one then`,
      totalLatencyMs: 1_000,
    },
    {
      captureSessionId: SESSION,
      seq: 5,
      startOffsetMs: 85_000,
      endOffsetMs: 88_000,
      kind: "reply",
      text: `${SECRET} dropped the asymmetry argument`,
      generatedText: `${SECRET} dropped the asymmetry argument`,
      totalLatencyMs: 1_100,
    },
  ]);

  await db.insert(schema.agentDecision).values([
    { captureSessionId: SESSION, seq: 0, offsetMs: 3_000, opportunitySeq: 1, attempt: 0, trigger: "user_turn", outcome: "spoke" },
    // ONE MOMENT, TWO COMPLETIONS: the first declined, the second spoke. It
    // counts once, as what the person heard.
    { captureSessionId: SESSION, seq: 1, offsetMs: 13_000, opportunitySeq: 2, attempt: 0, trigger: "user_turn", outcome: "declined" },
    { captureSessionId: SESSION, seq: 2, offsetMs: 13_000, opportunitySeq: 2, attempt: 1, trigger: "user_turn", outcome: "spoke" },
    { captureSessionId: SESSION, seq: 3, offsetMs: 43_000, opportunitySeq: 3, attempt: 0, trigger: "user_turn", outcome: "declined" },
    { captureSessionId: SESSION, seq: 4, offsetMs: 62_000, opportunitySeq: 4, attempt: 0, trigger: "user_turn", outcome: "spoke" },
    // THE PILOT 01 FAILURE, as the ledger now records it: the guard refused a
    // completion that would have met their answer with silence, wrote nothing
    // for the refusal, and marked the moment the re-run produced.
    { captureSessionId: SESSION, seq: 5, offsetMs: 76_000, opportunitySeq: 5, attempt: 0, trigger: "user_turn", outcome: "spoke", forcedAnswer: true },
    { captureSessionId: SESSION, seq: 6, offsetMs: 93_000, opportunitySeq: 6, attempt: 0, trigger: "user_turn", outcome: "spoke" },
  ]);

  // A stated intent that reached the board, and one that did not.
  await db.insert(schema.directive).values([
    {
      utteranceId: "00000000-0000-4000-8000-00000000f603",
      captureSessionId: SESSION,
      verb: "mark",
      object: `${SECRET} the method section`,
      restatement: `${SECRET} mark the method section`,
      confidence: 90,
    },
    {
      utteranceId: "00000000-0000-4000-8000-00000000f607",
      captureSessionId: SESSION,
      verb: "drop",
      object: `${SECRET} the asymmetry argument`,
      restatement: `${SECRET} drop the asymmetry argument`,
      confidence: 80,
    },
  ]);

  await db.insert(schema.workspaceOp).values([
    {
      userId: USER_ID,
      type: "create_topic",
      payload: { topicId: "t", title: `${SECRET} the paper` },
      occurredAt: new Date("2026-09-19T09:00:40Z"),
      captureSessionId: SESSION,
      sourceUtteranceIds: [],
    },
    {
      userId: USER_ID,
      type: "add_block",
      payload: {
        blockId: CARD,
        topicId: "t",
        kind: "task",
        state: "next",
        text: `${SECRET} write up the method`,
        spans: [],
        via: "speech",
      },
      occurredAt: new Date("2026-09-19T09:00:41Z"),
      captureSessionId: SESSION,
      // The first directive's utterance: an intent that became a board write.
      sourceUtteranceIds: ["00000000-0000-4000-8000-00000000f603"],
    },
  ]);

  // The relief measures: a pre/post pair, the two post items, one day-7
  // verdict, and an open on a later day.
  await db.insert(schema.studyResponse).values([
    { userId: USER_ID, captureSessionId: SESSION, phase: "pre", item: "mental_load", value: 6 },
    { userId: USER_ID, captureSessionId: SESSION, phase: "post", item: "mental_load", value: 4 },
    { userId: USER_ID, captureSessionId: SESSION, phase: "post", item: "liveness_perceived", value: 2 },
    { userId: USER_ID, captureSessionId: SESSION, phase: "post", item: "can_correct", value: 3 },
  ]);
  await db.insert(schema.studyItemReview).values({
    userId: USER_ID,
    cardId: CARD,
    outcome: "lost",
  });
  await db.insert(schema.studyEvent).values([
    { userId: USER_ID, kind: "board_open", occurredAt: new Date("2026-09-22T08:00:00Z") },
    { userId: USER_ID, kind: "card_open", cardId: CARD, occurredAt: new Date("2026-09-22T08:00:05Z") },
  ]);
}

describe("median and share", () => {
  it("say nothing rather than zero when there is nothing to say", () => {
    expect(median([])).toBeNull();
    expect(share(0, 0)).toBeNull();
    expect(median([1_200, 8_400])).toBe(4_800);
    expect(median([1, 2, 3])).toBe(2);
    expect(share(1, 4)).toBe(0.25);
  });
});

describeIfDb("participantMetrics", () => {
  let metrics: Awaited<ReturnType<typeof participantMetrics>>;

  beforeAll(async () => {
    await seed();
    metrics = await participantMetrics(USER_ID, { now: new Date("2026-09-26T09:00:00Z") });
  });

  afterAll(async () => {
    await getDb().delete(schema.user).where(eq(schema.user.id, USER_ID));
    await closeDb();
  });

  it("carries no transcript, no agent speech and no workspace text", () => {
    expect(JSON.stringify(metrics)).not.toContain(SECRET);
  });

  it("splits response latency by whether a tool ran", () => {
    const [session] = metrics.sessions;
    expect(session?.tier1.latencyMsMedianWithTool).toBe(8_400);
    // 900, 1000, 1100, 1200, 1300, 1400 — every turn that answered without a
    // lookup, against the one that needed one.
    expect(session?.tier1.latencyMsMedianWithoutTool).toBe(1_150);
  });

  it("keeps fillers out of the reply count", () => {
    const [session] = metrics.sessions;
    expect(session?.tier1.turns).toBe(7);
    expect(session?.tier1.fillers).toBe(1);
  });

  it("counts one moment once, however many completions it ran", () => {
    const [session] = metrics.sessions;
    // Seven rows, six moments: opportunity 2 ran two completions, and what it
    // became is the second — what the person heard.
    expect(session?.tier1.opportunities).toBe(6);
    expect(session?.tier1.doubleDispatched).toBe(1);
    expect(session?.tier1.silent).toBe(1);
    expect(session?.tier1.silentShare).toBeCloseTo(1 / 6);
  });

  it("reports the error rate over every turn that reached the speaker", () => {
    const [session] = metrics.sessions;
    expect(session?.tier1.errors).toBe(1);
    expect(session?.tier1.errorRate).toBeCloseTo(1 / 8);
  });

  it("leaves the debrief out of the conversation", () => {
    const [session] = metrics.sessions;
    // Ten utterances before the window, one inside it.
    expect(session?.tier2.userUtterances).toBe(10);
    expect(session?.tier3.debriefMs).toBe(120_000);
  });

  it("sees the person re-prompting a system that said nothing", () => {
    const [session] = metrics.sessions;
    expect(session?.tier2.rePrompts).toBe(1);
  });

  it("sees a repeat request and a correction", () => {
    const [session] = metrics.sessions;
    expect(session?.tier2.repeatRequests).toBe(1);
    expect(session?.tier2.corrections.spoken).toBe(1);
    expect(session?.tier2.correctionRate).not.toBeNull();
  });

  it("counts the moments the answer guard had to force", () => {
    // The moment became speech and the person was not left in silence — the
    // guard saw to that. They still waited an extra completion for an answer
    // they had already given, and `forced_answer` is the only trace of it:
    // the refused completion writes no decision at all.
    const [session] = metrics.sessions;
    expect(session?.tier2.unansweredAnswers).toBe(1);
    expect(metrics.tier2.unansweredAnswers).toBe(1);
  });

  it("reports how many stated intents reached the board", () => {
    const [session] = metrics.sessions;
    expect(session?.tier2.intents).toBe(2);
    expect(session?.tier2.intentsRealised).toBe(1);
    expect(session?.tier2.intentThroughput).toBe(0.5);
  });

  it("counts agent speech that landed while they were still talking", () => {
    // The system's own central rule — never interrupt a thought still being
    // formed — as a number, for the first time. It should be at or near zero;
    // this fixture has exactly one so the measure is proved able to see it.
    const [session] = metrics.sessions;
    expect(session?.thinking.intrusions).toBe(1);
    expect(session?.thinking.intrusionRate).toBeCloseTo(1 / 8);
  });

  it("hears them revising their own thought, not the agent's proposal", () => {
    const [session] = metrics.sessions;
    expect(session?.thinking.selfRepairs).toBe(1);
    expect(session?.thinking.selfRepairRate).toBeCloseTo(1 / 10);
    // "Nein, das andere." is the same lexical family and is NOT a self-repair:
    // an agent turn came first, so it is addressed to the agent. The addressee
    // is a fact about the turn structure, not about the words.
    expect(session?.tier2.corrections.spoken).toBe(1);
  });

  it("measures how long they get to think without the agent taking a turn", () => {
    const [session] = metrics.sessions;
    // Three utterances a second apart with nothing in between are ONE run of
    // thinking aloud, not three turns.
    expect(session?.thinking.longestRunMs).toBe(20_000);
    expect(session?.thinking.runs).toBe(8);
    expect(session?.thinking.medianRunMs).toBe(3_000);
    expect(session?.thinking.medianUtteranceWords).toBe(5);
  });

  it("pools the thinking group on counts, not on per-drive rates", () => {
    expect(metrics.thinking.intrusions).toBe(1);
    expect(metrics.thinking.intrusionRate).toBeCloseTo(1 / 8);
    expect(metrics.thinking.selfRepairs).toBe(1);
    // A drive with no intrusions still contributes its turns to the
    // denominator, which is why the denominators are passed in rather than
    // divided back out of the rates.
    expect(metrics.thinking.selfRepairRate).toBeCloseTo(1 / 10);
    expect(metrics.thinking.medianUtteranceWords).toBeNull();
  });

  it("reads the pre/post pair, and the direction that means relief", () => {
    const [session] = metrics.sessions;
    expect(session?.tier3.mentalLoadPre).toBe(6);
    expect(session?.tier3.mentalLoadPost).toBe(4);
    // Negative is the good direction: less held in the head afterwards.
    expect(session?.tier3.mentalLoadDelta).toBe(-2);
    expect(session?.tier3.livenessPerceived).toBe(2);
    expect(session?.tier3.canCorrect).toBe(3);
  });

  it("counts days where the participant is, not where the server is", async () => {
    // The card's ops land at 09:00 UTC on 19 Sep; the open is at 23:30 UTC
    // the same evening, which in Berlin is already the 20th. On UTC days that
    // is not a revisit; on the study's own days it is, and it is the study's
    // days the protocol means.
    await getDb()
      .update(schema.studyEvent)
      .set({ occurredAt: new Date("2026-09-19T23:30:00Z") })
      .where(eq(schema.studyEvent.userId, USER_ID));

    const utc = await participantMetrics(USER_ID, { now: new Date("2026-09-26T09:00:00Z") });
    expect(utc.tier3.revisited).toBe(0);

    const berlin = await participantMetrics(USER_ID, {
      now: new Date("2026-09-26T09:00:00Z"),
      timeZone: "Europe/Berlin",
    });
    expect(berlin.tier3.revisited).toBe(1);

    // Put the fixture back for whatever runs next.
    await getDb()
      .update(schema.studyEvent)
      .set({ occurredAt: new Date("2026-09-22T08:00:00Z") })
      .where(eq(schema.studyEvent.userId, USER_ID));
  });

  it("counts an item opened on a later day as revisited", () => {
    expect(metrics.tier3.cards).toBe(1);
    expect(metrics.tier3.revisited).toBe(1);
    expect(metrics.tier3.revisitRate).toBe(1);
    expect(metrics.tier3.cardOpens).toBe(1);
    expect(metrics.tier3.boardOpens).toBe(1);
  });

  it("reports the lost rate, which is the measure the study turns on", () => {
    expect(metrics.tier3.day7).toMatchObject({ reviewed: 1, done: 0, open: 0, lost: 1 });
    expect(metrics.tier3.day7.lostRate).toBe(1);
  });

  it("pools rates across drives rather than averaging per-drive rates", () => {
    // One drive here, so pooling is only visible in the shape: the pooled
    // median is null on purpose, because a median of medians is not a median.
    expect(metrics.tier1.latencyMsMedian).toBeNull();
    expect(metrics.tier1.opportunities).toBe(6);
    expect(metrics.tier2.rePrompts).toBe(1);
  });
});
