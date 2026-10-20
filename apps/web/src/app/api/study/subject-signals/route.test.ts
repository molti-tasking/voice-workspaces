/**
 * The recorder's subject signals, kept at Stop, and the recall probe that
 * Stop schedules — and only for the drive's owner.
 *
 * Needs the local Postgres; skipped when it is unreachable — check the counts.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "test-subject-signals-user";
const OTHER_USER_ID = "test-subject-signals-other";

vi.mock("@/lib/session", () => ({
  currentUserId: async () => USER_ID,
  currentUser: async () => ({ id: USER_ID }),
}));

const { closeDb, eq, getDb } = await import("@voicemural/db");
const { captureSession, driveSubject, recallProbe, subjectSignal, user } = await import("@voicemural/db/schema");
const { recordSubjectVisit } = await import("@voicemural/db/subjects");
const { isDatabaseReachable } = await import("@voicemural/db/testing");
const { POST } = await import("./route");

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

const SESSION = "00000000-0000-4000-8000-00000000c301";

/** This drive's signals only: a local database holds real drives' rows too. */
function signalsOfThisDrive() {
  return getDb()
    .select({ kept: subjectSignal.kept, via: subjectSignal.keptVia, at: subjectSignal.keptAt })
    .from(subjectSignal)
    .innerJoin(driveSubject, eq(driveSubject.id, subjectSignal.driveSubjectId))
    .where(eq(driveSubject.captureSessionId, SESSION));
}

async function seed(owner = USER_ID) {
  const db = getDb();
  for (const id of [USER_ID, OTHER_USER_ID]) {
    await db.delete(user).where(eq(user.id, id));
    await db.insert(user).values({ id, name: "S", email: `${id}@test.local` });
  }
  await db.insert(captureSession).values({
    id: SESSION,
    userId: owner,
    startedAt: new Date("2026-10-10T09:00:00Z"),
  });
  await recordSubjectVisit({ captureSessionId: SESSION, ordinal: 1, title: "Budget", startOffsetMs: 0 });
}

const subject = {
  ordinal: 1,
  userWords: 40,
  agentWords: 90,
  pauses: 1,
  pausesBefore: 0,
  fillers: 0,
  selfRepairs: 0,
  hedges: 2,
  settled: null,
  fade: 0.7,
  sparksShown: ["say_back"],
  sparksPulled: ["say_back"],
};

function send(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/study/subject-signals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describeIfDb("POST /api/study/subject-signals", () => {
  beforeEach(() => seed());
  afterAll(async () => {
    for (const id of [USER_ID, OTHER_USER_ID]) await getDb().delete(user).where(eq(user.id, id));
    await closeDb();
  });

  it("keeps the signals and, at Stop, schedules the recall probe", async () => {
    const res = await send({ captureSessionId: SESSION, final: true, signalsVersion: "signals-1", subjects: [subject] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ saved: 1, skipped: 0 });
    expect(await signalsOfThisDrive()).toHaveLength(1);
    expect(await getDb().select().from(recallProbe).where(eq(recallProbe.userId, USER_ID))).toHaveLength(1);
  });

  it("schedules nothing on a best-effort write", async () => {
    await send({ captureSessionId: SESSION, final: false, subjects: [subject] });
    expect(await getDb().select().from(recallProbe).where(eq(recallProbe.userId, USER_ID))).toHaveLength(0);
  });

  it("refuses someone else's drive, and anything that is not counts", async () => {
    await seed(OTHER_USER_ID);
    expect((await send({ captureSessionId: SESSION, final: true, subjects: [subject] })).status).toBe(403);
    await seed();
    const titled = { ...subject, title: "Budget" };
    // Extra keys are stripped, not stored: there is no column for them.
    expect((await send({ captureSessionId: SESSION, final: false, subjects: [titled] })).status).toBe(200);
    expect((await send({ captureSessionId: SESSION, final: false, subjects: [{ ...subject, fade: 3 }] })).status).toBe(400);
  });

  it("keeps whether they kept a subject, how and when — all three or none", async () => {
    const at = Date.UTC(2026, 9, 19, 9, 30);
    await send({
      captureSessionId: SESSION,
      final: true,
      subjects: [{ ...subject, kept: true, keptVia: "voice", keptAt: at }],
    });
    const [kept] = await signalsOfThisDrive();
    expect(kept).toEqual({ kept: true, via: "voice", at: new Date(at) });

    // A "how" without the keep is not a keep.
    await seed();
    await send({ captureSessionId: SESSION, final: true, subjects: [{ ...subject, kept: false, keptVia: "tap", keptAt: at }] });
    const [held] = await signalsOfThisDrive();
    expect(held).toEqual({ kept: false, via: null, at: null });
  });
});
