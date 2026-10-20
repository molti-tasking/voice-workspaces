import { config } from "dotenv";
config({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { captureSession, driveSubject, recallProbe, user } from "./schema";
import { recordSubjectVisit, saveSubjectSignals } from "./subjects";
import { isDatabaseReachable } from "./testing";
import { driveMode, loadWeek } from "./week";
import { closeDb, getDb } from "./index";

const USER_ID = "test-week-user";
const OTHER_ID = "test-week-other";
const OLD = "00000000-0000-4000-8000-000000000081";
const SUGGESTED = "00000000-0000-4000-8000-000000000082";
const CHOSEN = "00000000-0000-4000-8000-000000000083";
const THEIRS = "00000000-0000-4000-8000-000000000084";
const SINCE = new Date("2026-10-12T00:00:00Z");

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

const zero = {
  userWords: 10,
  agentWords: 5,
  pauses: 0,
  pausesBefore: 0,
  fillers: 0,
  selfRepairs: 0,
  hedges: 0,
  settled: null,
  fade: 0,
  sparksShown: [],
  sparksPulled: [],
};

describe("which mode a drive ran in", () => {
  it("reads the frozen condition, and says none when it offered no sparks", () => {
    expect(driveMode({ sparks: true, sparkSelection: "chosen" })).toBe("chosen");
    expect(driveMode({ sparks: true, sparkSelection: "suggested" })).toBe("suggested");
    // Frozen before keeping existed: the signals picked.
    expect(driveMode({ sparks: true })).toBe("suggested");
    expect(driveMode({ sparks: false, sparkSelection: "chosen" })).toBeNull();
    expect(driveMode(null)).toBeNull();
  });
});

describeIfDb("loadWeek", () => {
  beforeEach(async () => {
    const db = getDb();
    await db.delete(user).where(eq(user.id, USER_ID));
    await db.delete(user).where(eq(user.id, OTHER_ID));
    await db.insert(user).values([
      { id: USER_ID, name: "Week", email: `${USER_ID}@test.local` },
      { id: OTHER_ID, name: "Other", email: `${OTHER_ID}@test.local` },
    ]);
    await db.insert(captureSession).values([
      { id: OLD, userId: USER_ID, startedAt: new Date("2026-10-05T08:00:00Z") },
      {
        id: SUGGESTED,
        userId: USER_ID,
        startedAt: new Date("2026-10-13T08:00:00Z"),
        endedAt: new Date("2026-10-13T08:30:00Z"),
        studyCondition: { sparks: true, sparkSelection: "suggested" },
      },
      {
        id: CHOSEN,
        userId: USER_ID,
        startedAt: new Date("2026-10-14T08:00:00Z"),
        studyCondition: { sparks: true, sparkSelection: "chosen" },
      },
      { id: THEIRS, userId: OTHER_ID, startedAt: new Date("2026-10-14T09:00:00Z") },
    ]);
    await recordSubjectVisit({ captureSessionId: SUGGESTED, ordinal: 1, title: "Pilot date", startOffsetMs: 0 });
    await recordSubjectVisit({ captureSessionId: CHOSEN, ordinal: 1, title: "Budget", startOffsetMs: 0 });
    await recordSubjectVisit({ captureSessionId: CHOSEN, ordinal: 2, title: "Flights", startOffsetMs: 60_000 });
    await recordSubjectVisit({ captureSessionId: THEIRS, ordinal: 1, title: "Not yours", startOffsetMs: 0 });
    await saveSubjectSignals(SUGGESTED, [{ ordinal: 1, ...zero, sparksPulled: ["say_back"] }], { final: true });
    await saveSubjectSignals(
      CHOSEN,
      [
        {
          ordinal: 1,
          ...zero,
          sparksPulled: ["decide", "unsure"],
          kept: true,
          keptVia: "voice",
          keptAt: new Date("2026-10-14T08:05:00Z"),
        },
        { ordinal: 2, ...zero },
      ],
      { final: true },
    );
    const [budget] = await db
      .select({ id: driveSubject.id })
      .from(driveSubject)
      .where(eq(driveSubject.captureSessionId, CHOSEN))
      .orderBy(driveSubject.ordinal)
      .limit(1);
    await db.insert(recallProbe).values({
      userId: USER_ID,
      driveSubjectId: budget!.id,
      dueAt: new Date("2026-10-16T08:30:00Z"),
      answeredAt: new Date("2026-10-16T09:00:00Z"),
      confidence: 5,
      selfAccuracy: 5,
    });
  });

  afterAll(async () => {
    await getDb().delete(user).where(eq(user.id, USER_ID));
    await getDb().delete(user).where(eq(user.id, OTHER_ID));
    await closeDb();
  });

  it("gives their own drives since the start of the week, each with its mode and subjects", async () => {
    const week = await loadWeek(USER_ID, SINCE);
    expect(week.map((d) => [d.id, d.mode])).toEqual([
      [SUGGESTED, "suggested"],
      [CHOSEN, "chosen"],
    ]);
    expect(week[0]!.subjects).toEqual([
      { ordinal: 1, title: "Pilot date", kept: false, keptVia: null, sparksPulled: 1, recalled: false },
    ]);
    expect(week[1]!.subjects).toEqual([
      { ordinal: 1, title: "Budget", kept: true, keptVia: "voice", sparksPulled: 2, recalled: true },
      { ordinal: 2, title: "Flights", kept: false, keptVia: null, sparksPulled: 0, recalled: false },
    ]);
    expect(JSON.stringify(week)).not.toContain("Not yours");
  });

  it("answers an empty week with nothing", async () => {
    expect(await loadWeek(USER_ID, new Date("2026-10-20T00:00:00Z"))).toEqual([]);
  });
});
