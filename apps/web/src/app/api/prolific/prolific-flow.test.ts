/**
 * The Prolific study end to end through its three routes: enrol, part 1, and
 * part 2 found by PID alone — with the order the measure depends on (free
 * recall before any probe, confidence before the reveal) refused out of turn.
 *
 * Needs the local Postgres; skipped when it is unreachable — check the counts.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const USER_ID = "test-prolific-flow-user";
const PID = "test-prolific-flow";
const SESSION = "00000000-0000-4000-8000-00000000d401";

// Part 2 opens immediately, so one test can walk through both parts.
process.env.PROLIFIC_RECALL_DELAY_HOURS = "0";

vi.mock("@/lib/session", () => ({
  currentUserId: async () => USER_ID,
  currentUser: async () => ({ id: USER_ID }),
}));

const { closeDb, eq, getDb, inArray } = await import("@voicemural/db");
const { captureSession, prolificParticipant, recallProbe, user, utterance, audioChunk } = await import(
  "@voicemural/db/schema"
);
const { recordSubjectVisit } = await import("@voicemural/db/subjects");
const { isDatabaseReachable } = await import("@voicemural/db/testing");
const enroll = (await import("./enroll/route")).POST;
const part1 = (await import("./part1/route")).POST;
const part2 = (await import("./part2/route")).POST;

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

function call(route: (req: Request) => Promise<Response>, body: Record<string, unknown>) {
  return route(
    new Request("http://localhost/api/prolific", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describeIfDb("the Prolific study routes", () => {
  beforeAll(async () => {
    const db = getDb();
    await db.delete(prolificParticipant).where(eq(prolificParticipant.prolificPid, PID));
    await db.delete(user).where(inArray(user.id, [USER_ID]));
    await db.insert(user).values({ id: USER_ID, name: "Guest", email: `${USER_ID}@test.local`, isAnonymous: true });
  });

  afterAll(async () => {
    await getDb().delete(user).where(eq(user.id, USER_ID));
    await closeDb();
  });

  it("walks through both parts", async () => {
    const db = getDb();

    // Consent, and a pinned arm (allowed outside production).
    const enrolled = await call(enroll, { pid: PID, consent: true, arm: "sparks", studyId: "s1" });
    expect(enrolled.status).toBe(200);
    expect(await enrolled.json()).toMatchObject({ arm: "sparks", task: "heat" });
    const [account] = await db.select().from(user).where(eq(user.id, USER_ID));
    expect(account?.studyCondition).toEqual({ sparks: true });
    expect(account?.boardEnabledAt).toBeNull();

    // Part 2 before part 1 is finished: refused.
    expect((await call(part2, { step: "begin", pid: PID })).status).toBe(409);

    // The drive does not exist yet: the page is told to retry.
    expect((await call(part1, { step: "started", captureSessionId: SESSION })).status).toBe(409);
    await db.insert(captureSession).values({
      id: SESSION,
      userId: USER_ID,
      startedAt: new Date(Date.now() - 16 * 60_000),
      endedAt: new Date(Date.now() - 60_000),
    });
    expect((await call(part1, { step: "started", captureSessionId: SESSION })).status).toBe(200);

    await recordSubjectVisit({ captureSessionId: SESSION, ordinal: 1, title: "Who is at risk", startOffsetMs: 0, endOffsetMs: 60_000 });
    await recordSubjectVisit({ captureSessionId: SESSION, ordinal: 2, title: "Cooling centres", startOffsetMs: 60_000 });
    await db.insert(audioChunk).values({
      id: "00000000-0000-4000-8000-00000000d402",
      captureSessionId: SESSION,
      seq: 0,
      startOffsetMs: 0,
      durationMs: 120_000,
      mimeType: "audio/webm",
      byteSize: 1,
      checksum: "x",
      status: "transcribed",
    });
    await db.insert(utterance).values({
      captureSessionId: SESSION,
      chunkId: "00000000-0000-4000-8000-00000000d402",
      startOffsetMs: 10_000,
      endOffsetMs: 12_000,
      text: "older people who live alone",
    });

    const finished = await call(part1, { step: "finished", judgmentOfLearning: 5 });
    expect(finished.status).toBe(200);
    expect(await finished.json()).toMatchObject({ completionCode: "TEST-PART1" });

    const probes = await db.select().from(recallProbe).where(eq(recallProbe.userId, USER_ID));
    expect(probes).toHaveLength(2);
    const probeId = probes.find((p) => p.driveSubjectId)!.id;

    // Part 2, by PID only.
    expect((await call(part2, { step: "begin", pid: PID, studyId: "s2" })).status).toBe(200);

    // No probe before the free recall.
    expect((await call(part2, { step: "probe_confidence", pid: PID, probeId, confidence: 4 })).status).toBe(409);
    // Too short to count.
    expect((await call(part2, { step: "free_recall", pid: PID, text: "heat", confidence: 3 })).status).toBe(400);
    const recalled = await call(part2, {
      step: "free_recall",
      pid: PID,
      text: "Older people living alone are most at risk; open the library as a cooling centre.",
      confidence: 4,
    });
    expect(recalled.status).toBe(200);

    // Within a probe: no answer before the confidence.
    expect(
      (await call(part2, { step: "probe_answer", pid: PID, probeId, selfAccuracy: 5, provenance: "mine" })).status,
    ).toBe(409);
    const revealed = await call(part2, { step: "probe_confidence", pid: PID, probeId, confidence: 4 });
    expect(revealed.status).toBe(200);
    expect(Array.isArray((await revealed.json()).lines)).toBe(true);
    expect(
      (await call(part2, { step: "probe_answer", pid: PID, probeId, selfAccuracy: 5, provenance: "both" })).status,
    ).toBe(200);

    // Another person's probe is not reachable by this PID.
    expect(
      (await call(part2, { step: "probe_reveal", pid: PID, probeId: "00000000-0000-4000-8000-00000000d499" })).status,
    ).toBe(404);

    const closed = await call(part2, {
      step: "closing",
      pid: PID,
      answers: { tookAway: 5, ownIdeas: 4, assistantThought: 3, cardsHelped: 6, rehearsed: false },
    });
    expect(closed.status).toBe(200);
    expect(await closed.json()).toMatchObject({ completionCode: "TEST-PART2" });

    const [row] = await db.select().from(prolificParticipant).where(eq(prolificParticipant.prolificPid, PID));
    expect(row).toMatchObject({
      arm: "sparks",
      judgmentOfLearning: 5,
      freeRecallConfidence: 4,
      part1StudyId: "s1",
      part2StudyId: "s2",
    });
    expect(row?.part2CompletedAt).not.toBeNull();
    expect(row?.closing).toMatchObject({ cardsHelped: 6 });
  });
});
