import { config } from "dotenv";
config({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });

import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { captureSession, driveSubject, driveSubjectSegment, subjectSignal, user } from "./schema";
import { recordSubjectVisit, saveSubjectSignals } from "./subjects";
import { isDatabaseReachable } from "./testing";
import { closeDb, getDb } from "./index";

const USER_ID = "test-subjects-user";
const SESSION = "00000000-0000-4000-8000-0000000000d1";

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

async function segments() {
  return getDb()
    .select({
      ordinal: driveSubject.ordinal,
      start: driveSubjectSegment.startOffsetMs,
      end: driveSubjectSegment.endOffsetMs,
    })
    .from(driveSubjectSegment)
    .innerJoin(driveSubject, eq(driveSubject.id, driveSubjectSegment.driveSubjectId))
    .where(eq(driveSubject.captureSessionId, SESSION))
    .orderBy(asc(driveSubjectSegment.startOffsetMs));
}

describeIfDb("recordSubjectVisit", () => {
  beforeEach(async () => {
    await getDb().delete(user).where(eq(user.id, USER_ID));
    await getDb().insert(user).values({ id: USER_ID, name: "Test", email: `${USER_ID}@test.local` });
    await getDb().insert(captureSession).values({ id: SESSION, userId: USER_ID, startedAt: new Date() });
  });

  afterAll(async () => {
    await getDb().delete(user).where(eq(user.id, USER_ID));
    await closeDb();
  });

  it("creates a subject once, and opens then closes each visit", async () => {
    const base = { captureSessionId: SESSION, title: "Car inspection" };
    await recordSubjectVisit({ ...base, ordinal: 1, startOffsetMs: 0 });
    await recordSubjectVisit({ ...base, ordinal: 2, title: "Paper intro", startOffsetMs: 40_000 });
    await recordSubjectVisit({ ...base, ordinal: 1, startOffsetMs: 0, endOffsetMs: 40_000 });
    await recordSubjectVisit({ ...base, ordinal: 1, startOffsetMs: 90_000 });

    const subjects = await getDb()
      .select({ ordinal: driveSubject.ordinal, title: driveSubject.title, first: driveSubject.firstOffsetMs })
      .from(driveSubject)
      .where(eq(driveSubject.captureSessionId, SESSION))
      .orderBy(asc(driveSubject.ordinal));
    expect(subjects).toEqual([
      { ordinal: 1, title: "Car inspection", first: 0 },
      { ordinal: 2, title: "Paper intro", first: 40_000 },
    ]);
    expect(await segments()).toEqual([
      { ordinal: 1, start: 0, end: 40_000 },
      { ordinal: 2, start: 40_000, end: null },
      { ordinal: 1, start: 90_000, end: null },
    ]);
  });

  it("never reopens a closed visit when the opening post arrives late, and takes a retry as a no-op", async () => {
    const visit = { captureSessionId: SESSION, ordinal: 1, title: "Budget", startOffsetMs: 5_000 };
    await recordSubjectVisit({ ...visit, endOffsetMs: 20_000 });
    await recordSubjectVisit(visit);
    await recordSubjectVisit({ ...visit, endOffsetMs: 20_000 });
    expect(await segments()).toEqual([{ ordinal: 1, start: 5_000, end: 20_000 }]);
  });

  it("keeps the signals Stop wrote over a later best effort, and a judgement over a later blank", async () => {
    await recordSubjectVisit({ captureSessionId: SESSION, ordinal: 1, title: "Budget", startOffsetMs: 0 });
    const signal = {
      ordinal: 1,
      userWords: 80,
      agentWords: 20,
      pauses: 3,
      pausesBefore: 1,
      fillers: 0,
      selfRepairs: 1,
      hedges: 2,
      settled: false as boolean | null,
      fade: 0.4,
      sparksShown: ["decide" as const],
      sparksPulled: [],
    };
    expect(await saveSubjectSignals(SESSION, [signal, { ...signal, ordinal: 9 }], { final: false })).toEqual({
      saved: 1,
      skipped: 1,
    });
    await saveSubjectSignals(SESSION, [{ ...signal, userWords: 90, settled: null }], {
      final: true,
      signalsVersion: "signals-1",
    });
    await saveSubjectSignals(SESSION, [{ ...signal, userWords: 5 }], { final: false });
    const [row] = await getDb().select().from(subjectSignal);
    expect(row).toMatchObject({ userWords: 90, settled: false, final: true, signalsVersion: "signals-1" });
  });
});
