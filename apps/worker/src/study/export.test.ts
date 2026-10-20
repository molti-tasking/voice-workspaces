/**
 * The export's privacy boundary, asserted rather than trusted.
 *
 * /study promises participants that nobody reads their transcripts. The only
 * convincing test of "the export carries no free text" is to put a marker in
 * EVERY free-text column the export reads from — transcript, agent speech, the
 * restatement of a direction, the workspace, the repertoire — and fail if the
 * marker comes out anywhere. A new column added later without a sentinel here
 * is still covered by the export's explicit column lists; this test is what
 * catches someone widening one.
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
const { exportParticipant, invocationStatus } = await import("./export");

const USER_ID = "test-study-export-user";
const SESSION = "00000000-0000-4000-8000-00000000e501";
const CHUNK = "00000000-0000-4000-8000-00000000e502";
const UTTERANCE = "00000000-0000-4000-8000-00000000e503";
const CAPABILITY = "00000000-0000-4000-8000-00000000e504";

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

async function seed() {
  const db = getDb();
  await db.delete(schema.user).where(eq(schema.user.id, USER_ID));
  await db.insert(schema.user).values({
    id: USER_ID,
    name: `${SECRET} name`,
    email: `${USER_ID}@test.local`,
    studyParticipantId: "PTEST",
    studyCondition: { agendaOffers: true },
  });
  await db.insert(schema.captureSession).values({
    id: SESSION,
    userId: USER_ID,
    startedAt: new Date("2026-09-10T07:00:00Z"),
    endedAt: new Date("2026-09-10T07:30:00Z"),
    endedBy: "client",
    setting: "driving",
    studyCondition: { proactiveOffers: true, agendaOffers: true, voiceMacroOffers: false },
    deviceInfo: { userAgent: SECRET },
  });
  await db.insert(schema.audioChunk).values({
    id: CHUNK,
    captureSessionId: SESSION,
    seq: 0,
    startOffsetMs: 0,
    durationMs: 10_000,
    mimeType: "audio/webm",
    byteSize: 1,
    checksum: "x",
    status: "transcribed",
  });
  await db.insert(schema.utterance).values({
    id: UTTERANCE,
    captureSessionId: SESSION,
    chunkId: CHUNK,
    startOffsetMs: 1_000,
    endOffsetMs: 3_000,
    text: `send the ${SECRET} notes to the doc`,
    kind: "directive",
  });
  const [turn] = await db
    .insert(schema.agentTurn)
    .values({
      captureSessionId: SESSION,
      seq: 0,
      startOffsetMs: 4_000,
      endOffsetMs: 5_000,
      kind: "confirmation_request",
      text: `Send ${SECRET} now?`,
      generatedText: `Send ${SECRET} now? Or later.`,
      respondingToText: `the ${SECRET} notes`,
      error: `${SECRET} failure`,
      configVersion: "talkback-8",
      ttftMs: 400,
    })
    .returning({ id: schema.agentTurn.id });
  await db.insert(schema.capability).values({
    id: CAPABILITY,
    userId: USER_ID,
    type: "action",
    name: `to-doc-${SECRET}`,
  });
  const [version] = await db
    .insert(schema.capabilityVersion)
    .values({
      capabilityId: CAPABILITY,
      version: 1,
      markdown: `# ${SECRET}`,
      restatement: `sends ${SECRET}`,
    })
    .returning({ id: schema.capabilityVersion.id });
  await db.insert(schema.directive).values({
    utteranceId: UTTERANCE,
    captureSessionId: SESSION,
    verb: "send",
    object: `${SECRET} notes`,
    restatement: `Sending the ${SECRET} notes.`,
    capabilityId: CAPABILITY,
    confidence: 80,
  });
  const [inv] = await db
    .insert(schema.invocation)
    .values({
      capabilityId: CAPABILITY,
      capabilityVersionId: version!.id,
      captureSessionId: SESSION,
      triggeringUtteranceId: UTTERANCE,
      confirmed: null,
    })
    .returning({ id: schema.invocation.id });
  // TWO completions over ONE moment, which is what Pipecat's aggregator
  // actually produces: a half-finished sentence declined fast, then the whole
  // thing answered. The export has to carry enough for an analysis to count
  // the moment once.
  await db.insert(schema.agentDecision).values([
    {
      captureSessionId: SESSION,
      seq: 0,
      offsetMs: 3_500,
      opportunitySeq: 1,
      attempt: 0,
      trigger: "confirmation",
      outcome: "declined",
      subjectKey: inv!.id,
      latencyMs: 400,
    },
    {
      captureSessionId: SESSION,
      seq: 1,
      offsetMs: 3_500,
      opportunitySeq: 1,
      attempt: 1,
      trigger: "confirmation",
      outcome: "spoke",
      subjectKey: inv!.id,
      agentTurnId: turn!.id,
      latencyMs: 500,
    },
  ]);
  // Who held the floor: the device's remembered Lock at connect, a poke, then
  // Normal. Enums and offsets only, so nothing here can carry the sentinel.
  await db.insert(schema.floorEvent).values([
    { captureSessionId: SESSION, seq: 0, offsetMs: 0, kind: "locked", atConnect: true },
    { captureSessionId: SESSION, seq: 1, offsetMs: 120_000, kind: "poke" },
    { captureSessionId: SESSION, seq: 2, offsetMs: 300_000, kind: "open" },
  ]);
  // Sparks (talkback-21): a subject whose TITLE carries the sentinel — the one
  // field of the subject tables that is content — its visits, its signal, a
  // spark poke on it, and an answered recall probe.
  const [subject] = await db
    .insert(schema.driveSubject)
    .values({ captureSessionId: SESSION, ordinal: 1, title: `${SECRET} subject`, firstOffsetMs: 0 })
    .returning({ id: schema.driveSubject.id });
  await db.insert(schema.driveSubjectSegment).values([
    { driveSubjectId: subject!.id, startOffsetMs: 0, endOffsetMs: 60_000 },
    { driveSubjectId: subject!.id, startOffsetMs: 200_000 },
  ]);
  await db.insert(schema.subjectSignal).values({
    driveSubjectId: subject!.id,
    userWords: 120,
    agentWords: 300,
    pauses: 4,
    pausesBefore: 1,
    fillers: 2,
    selfRepairs: 1,
    hedges: 3,
    settled: false,
    fade: 0.6,
    sparksShown: ["say_back"],
    sparksPulled: ["say_back"],
    kept: true,
    keptVia: "voice",
    keptAt: new Date("2026-09-10T07:10:00Z"),
    final: true,
    signalsVersion: "signals-2",
  });
  await db.insert(schema.agentDecision).values({
    captureSessionId: SESSION,
    seq: 2,
    offsetMs: 120_000,
    opportunitySeq: 2,
    trigger: "poke",
    outcome: "spoke",
    subjectKey: "s1",
    sparkKind: "say_back",
  });
  await db.insert(schema.recallProbe).values({
    userId: USER_ID,
    driveSubjectId: subject!.id,
    dueAt: new Date("2026-09-12T07:30:00Z"),
    answeredAt: new Date("2026-09-12T09:00:00Z"),
    confidence: 6,
    selfAccuracy: 4,
    provenance: "souffleur",
    delayDays: 2,
  });
  await db.insert(schema.macroProposal).values({
    userId: USER_ID,
    canonicalForm: `send|${SECRET}`,
    occurrences: [
      { utteranceId: UTTERANCE, captureSessionId: SESSION, text: SECRET, occurredAt: "2026-09-10T07:00:01Z" },
    ],
    sessionCount: 1,
    proposedName: "send-notes",
    restatement: `Sends ${SECRET}`,
    markdown: `# ${SECRET}`,
  });
  await db.insert(schema.workspaceOp).values([
    {
      userId: USER_ID,
      occurredAt: new Date("2026-09-10T07:00:02Z"),
      captureSessionId: SESSION,
      type: "create_topic",
      payload: { topicId: "t1", title: `${SECRET} project`, icon: "Sparkles" },
      sourceUtteranceIds: [UTTERANCE],
    },
    {
      userId: USER_ID,
      occurredAt: new Date("2026-09-10T07:00:03Z"),
      captureSessionId: SESSION,
      type: "add_block",
      payload: {
        blockId: "b1",
        topicId: "t1",
        kind: "task",
        text: `Write the ${SECRET} intro`,
        label: SECRET,
        state: "next",
        spans: [],
      },
      sourceUtteranceIds: [UTTERANCE],
    },
  ]);
}

describeIfDb("study export", () => {
  beforeAll(seed);

  afterAll(async () => {
    await getDb().delete(schema.user).where(eq(schema.user.id, USER_ID));
    await closeDb();
  });

  it("carries no free text from any table", async () => {
    const records = await exportParticipant(USER_ID);
    expect(JSON.stringify(records)).not.toContain(SECRET);
  });

  it("never carries a subject's title, even when the words are asked for", async () => {
    const records = await exportParticipant(USER_ID, { includeText: true });
    expect(JSON.stringify(records)).not.toContain(`${SECRET} subject`);
  });

  it("carries the sparks by ordinal: visits, signals, the spark a poke carried, and recall", async () => {
    const records = await exportParticipant(USER_ID);
    const of = (type: string) => records.filter((r) => r.type === type);
    expect(records[0]).toMatchObject({ exportVersion: 5 });
    expect(of("drive_subject")).toEqual([
      {
        type: "drive_subject",
        sessionId: SESSION,
        ordinal: 1,
        firstOffsetMs: 0,
        visits: [
          { startOffsetMs: 0, endOffsetMs: 60_000 },
          { startOffsetMs: 200_000, endOffsetMs: null },
        ],
      },
    ]);
    expect(of("subject_signal")[0]).toMatchObject({
      ordinal: 1,
      agentWords: 300,
      pausesBefore: 1,
      settled: false,
      sparksPulled: ["say_back"],
      kept: true,
      keptVia: "voice",
      keptAt: "2026-09-10T07:10:00.000Z",
    });
    expect(of("agent_decision").find((d) => d.trigger === "poke")).toMatchObject({
      subjectKey: "s1",
      sparkKind: "say_back",
    });
    expect(of("recall_probe")).toEqual([
      expect.objectContaining({
        ordinal: 1,
        confidence: 6,
        selfAccuracy: 4,
        provenance: "souffleur",
        delayDays: 2,
      }),
    ]);
  });

  it("still carries what the analysis needs", async () => {
    const records = await exportParticipant(USER_ID, { now: new Date("2026-09-15T00:00:00Z") });
    const byType = (type: string) => records.filter((r) => r.type === type);

    expect(records[0]).toMatchObject({ type: "participant", participantId: "PTEST", includesText: false });
    expect(byType("session")[0]).toMatchObject({
      durationMs: 30 * 60 * 1000,
      studyCondition: { agendaOffers: true },
    });
    expect(byType("utterance")[0]).toMatchObject({ kind: "directive", wordCount: 7 });
    expect(byType("agent_turn")[0]).toMatchObject({
      kind: "confirmation_request",
      spokenWordCount: 3,
      hasError: true,
      ttftMs: 400,
    });
    // The moment under test; the spark poke seeded with the sparks is its own.
    const decisions = byType("agent_decision").filter((d) => d.trigger !== "poke");
    // Both rows are exported — they are both real completions — and they carry
    // the moment they belong to, so 2 rows is 1 opportunity. Counted by row the
    // pilot's decline rate was 69%; counted by moment, 53%.
    expect(decisions).toHaveLength(2);
    expect(new Set(decisions.map((d) => d.opportunitySeq)).size).toBe(1);
    expect(decisions.map((d) => d.attempt)).toEqual([0, 1]);
    // The authoritative outcome of a moment is its LAST attempt.
    expect(decisions.at(-1)).toMatchObject({ trigger: "confirmation", outcome: "spoke" });
    expect(decisions.every((d) => d.forcedPoke === false)).toBe(true);
    expect(byType("floor_event").map((f) => [f.kind, f.atConnect, f.offsetMs])).toEqual([
      ["locked", true, 0],
      ["poke", false, 120_000],
      ["open", false, 300_000],
    ]);
    expect(byType("directive")[0]).toMatchObject({ verb: "send" });
    // Parked, asked once, and the drive ended without an answer.
    expect(byType("invocation")[0]).toMatchObject({ status: "unanswered", timesAsked: 1 });
    expect(byType("capability")[0]).toMatchObject({ versionCount: 1 });
    expect(byType("macro_proposal")[0]).toMatchObject({ proposedName: "send-notes", occurrenceCount: 1 });
    expect(byType("workspace_op").map((o) => o.opType)).toEqual(["create_topic", "add_block"]);
    expect(byType("workspace_op")[1]).toMatchObject({ blockKind: "task", taskState: "next", via: "speech" });
    expect(byType("board_transition")[0]).toMatchObject({ from: null, to: "next", via: "speech" });
  });

  it("includes the words only when asked to", async () => {
    const records = await exportParticipant(USER_ID, { includeText: true });
    expect(JSON.stringify(records)).toContain(SECRET);
  });
});

describe("invocationStatus", () => {
  it("separates a refusal from an error, and waiting from never answered", () => {
    const base = { confirmed: null, reverted: false, hasError: false };
    expect(invocationStatus(base, false)).toBe("pending");
    expect(invocationStatus(base, true)).toBe("unanswered");
    expect(invocationStatus({ ...base, confirmed: false }, true)).toBe("declined");
    expect(invocationStatus({ ...base, confirmed: false, hasError: true }, true)).toBe("error");
    expect(invocationStatus({ ...base, confirmed: true }, true)).toBe("fired");
    expect(invocationStatus({ ...base, confirmed: true, reverted: true }, true)).toBe("reverted");
  });
});
