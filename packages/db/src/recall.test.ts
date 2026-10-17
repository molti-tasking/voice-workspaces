import { config } from "dotenv";
config({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  RECALL_DELAY_HOURS,
  answerRecallProbe,
  countDueProbes,
  loadDueProbes,
  loadProbeSpeech,
  rateRecallConfidence,
  scheduleMissedRecallProbes,
  scheduleRecallProbes,
} from "./recall";
import { agentTurn, audioChunk, captureSession, recallProbe, user, utterance } from "./schema";
import { recordSubjectVisit, saveSubjectSignals } from "./subjects";
import { isDatabaseReachable } from "./testing";
import { closeDb, getDb } from "./index";

const USER_ID = "test-recall-user";
const OTHER_ID = "test-recall-other";
const SESSION = "00000000-0000-4000-8000-0000000000f1";
const CHUNK = "00000000-0000-4000-8000-0000000000f2";
const ENDED = new Date("2026-10-01T08:30:00Z");
const DUE = new Date(ENDED.getTime() + RECALL_DELAY_HOURS * 3_600_000);

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

/** A drive with four subjects; subject 2 had a spark pulled. */
async function seed() {
  const db = getDb();
  await db.delete(user).where(eq(user.id, USER_ID));
  await db.delete(user).where(eq(user.id, OTHER_ID));
  await db.insert(user).values([
    { id: USER_ID, name: "Test", email: `${USER_ID}@test.local` },
    { id: OTHER_ID, name: "Other", email: `${OTHER_ID}@test.local` },
  ]);
  await db.insert(captureSession).values({
    id: SESSION,
    userId: USER_ID,
    startedAt: new Date("2026-10-01T08:00:00Z"),
    endedAt: ENDED,
  });
  const visit = (ordinal: number, title: string, startOffsetMs: number, endOffsetMs?: number) =>
    recordSubjectVisit({ captureSessionId: SESSION, ordinal, title, startOffsetMs, endOffsetMs });
  await visit(1, "Car inspection", 0, 60_000);
  await visit(2, "Paper intro", 60_000, 120_000);
  await visit(3, "Budget", 120_000, 180_000);
  await visit(2, "Paper intro", 180_000);
  await visit(4, "Flights", 240_000);
  const zero = { userWords: 0, agentWords: 0, pauses: 0, pausesBefore: 0, fillers: 0, selfRepairs: 0, hedges: 0, settled: null, fade: 0, sparksShown: [] };
  await saveSubjectSignals(
    SESSION,
    [
      { ordinal: 1, ...zero, sparksPulled: [] },
      { ordinal: 2, ...zero, sparksShown: ["say_back"], sparksPulled: ["say_back"] },
      { ordinal: 3, ...zero, sparksPulled: [] },
      { ordinal: 4, ...zero, sparksPulled: [] },
    ],
    { final: true },
  );
  await db.insert(audioChunk).values({
    id: CHUNK,
    captureSessionId: SESSION,
    seq: 0,
    startOffsetMs: 0,
    durationMs: 300_000,
    mimeType: "audio/webm",
    byteSize: 1,
    checksum: "x",
    status: "transcribed",
  });
  await db.insert(utterance).values([
    { captureSessionId: SESSION, chunkId: CHUNK, startOffsetMs: 10_000, endOffsetMs: 12_000, text: "the car is due" },
    { captureSessionId: SESSION, chunkId: CHUNK, startOffsetMs: 70_000, endOffsetMs: 72_000, text: "the intro opens with cost" },
    { captureSessionId: SESSION, chunkId: CHUNK, startOffsetMs: 200_000, endOffsetMs: 202_000, text: "back to the intro" },
    { captureSessionId: SESSION, chunkId: CHUNK, startOffsetMs: 250_000, endOffsetMs: 252_000, text: "the flights" },
  ]);
  await db.insert(agentTurn).values({
    captureSessionId: SESSION,
    seq: 0,
    startOffsetMs: 80_000,
    endOffsetMs: 82_000,
    kind: "reply",
    text: "Switching costs, then.",
    generatedText: "Switching costs, then.",
  });
}

describeIfDb("the recall probe", () => {
  beforeEach(seed);
  afterAll(async () => {
    await getDb().delete(user).where(eq(user.id, USER_ID));
    await getDb().delete(user).where(eq(user.id, OTHER_ID));
    await closeDb();
  });

  it("asks back three subjects, the pulled one always among them, due after the delay", async () => {
    expect(await scheduleRecallProbes(SESSION, { random: () => 0 })).toBe(3);
    // Idempotent: a drive with probes is left as it is.
    expect(await scheduleRecallProbes(SESSION)).toBe(0);
    const due = await loadDueProbes(USER_ID, DUE);
    expect(due.map((p) => p.title)).toContain("Paper intro");
    expect(due).toHaveLength(3);
    expect(await loadDueProbes(USER_ID, new Date(DUE.getTime() - 1))).toEqual([]);
    expect(await countDueProbes(USER_ID, DUE)).toBe(3);
  });

  it("schedules a drive Stop never reached the first time due probes are looked up", async () => {
    await scheduleMissedRecallProbes(USER_ID, new Date(ENDED.getTime() + 3_600_000));
    expect(await countDueProbes(USER_ID, DUE)).toBe(3);
  });

  it("shows a subject's own speech from every visit, the open one closed at the next", async () => {
    await scheduleRecallProbes(SESSION, { random: () => 0 });
    const [probe] = (await loadDueProbes(USER_ID, DUE)).filter((p) => p.title === "Paper intro");
    const speech = await loadProbeSpeech(probe!.id, USER_ID);
    expect(speech!.lines.map((l) => [l.who, l.text])).toEqual([
      ["user", "the intro opens with cost"],
      ["agent", "Switching costs, then."],
      ["user", "back to the intro"],
    ]);
    expect(await loadProbeSpeech(probe!.id, OTHER_ID)).toBeNull();
  });

  it("takes the answer only after confidence, keeps no words, and counts the delay", async () => {
    await scheduleRecallProbes(SESSION, { random: () => 0 });
    const [probe] = await loadDueProbes(USER_ID, DUE);
    const answer = { selfAccuracy: 5, provenance: "mine" as const };
    expect(await answerRecallProbe(probe!.id, USER_ID, answer, DUE)).toBe(false);
    expect(await rateRecallConfidence(probe!.id, OTHER_ID, 6)).toBe(false);
    expect(await rateRecallConfidence(probe!.id, USER_ID, 6)).toBe(true);
    // The first rating stands.
    expect(await rateRecallConfidence(probe!.id, USER_ID, 2)).toBe(false);
    expect(await answerRecallProbe(probe!.id, USER_ID, answer, DUE)).toBe(true);
    const [row] = await getDb().select().from(recallProbe).where(eq(recallProbe.id, probe!.id));
    expect(row).toMatchObject({ confidence: 6, selfAccuracy: 5, provenance: "mine", delayDays: 2 });
    expect(await countDueProbes(USER_ID, DUE)).toBe(2);
  });
});
