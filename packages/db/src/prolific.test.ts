import { config } from "dotenv";
config({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });

import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { chooseArm, isRealProlificPid } from "@voicemural/shared";
import {
  PROLIFIC_PSEUDONYM_PREFIX,
  beginPart2,
  enrollParticipant,
  findParticipantByPid,
  finishPart1,
  markConversationStarted,
  part2StateFor,
  pseudonymFor,
  saveClosing,
  saveFreeRecall,
} from "./prolific";
import { captureSession, prolificParticipant, recallProbe, user } from "./schema";
import { recordSubjectVisit } from "./subjects";
import { isDatabaseReachable } from "./testing";
import { closeDb, getDb } from "./index";

const USERS = ["test-pro-a", "test-pro-b", "test-pro-c", "test-pro-d"];
const PIDS = ["test-pid-a", "test-pid-b", "test-pid-c"];
const SESSION = "00000000-0000-4000-8000-0000000000e1";
const T0 = new Date("2026-10-20T10:00:00Z");

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

describe("pseudonymFor", () => {
  it("is stable, prefixed, and is not the PID", () => {
    const a = pseudonymFor("5f1c0a2b3c4d5e6f7a8b9c0d");
    expect(a).toBe(pseudonymFor("5f1c0a2b3c4d5e6f7a8b9c0d"));
    expect(a.startsWith(PROLIFIC_PSEUDONYM_PREFIX)).toBe(true);
    expect(a).not.toContain("5f1c0a2b");
    expect(pseudonymFor("other")).not.toBe(a);
  });
});

describeIfDb("the Prolific participant", () => {
  const db = () => getDb();
  const enroll = (pid: string, userId: string, extra: Partial<Parameters<typeof enrollParticipant>[0]> = {}) =>
    enrollParticipant({ pid, userId, task: "heat", recallDelayHours: 20, now: T0, ...extra });

  beforeEach(async () => {
    // Only this file's rows: a developer's database may hold real pilot data.
    await db().delete(prolificParticipant).where(inArray(prolificParticipant.prolificPid, PIDS));
    await db().delete(user).where(inArray(user.id, USERS));
    await db()
      .insert(user)
      .values(USERS.map((id) => ({ id, name: "Guest", email: `${id}@test.local`, isAnonymous: true })));
  });

  afterAll(async () => {
    await db().delete(prolificParticipant).where(inArray(prolificParticipant.prolificPid, PIDS));
    await db().delete(user).where(inArray(user.id, USERS));
    await closeDb();
  });

  it("assigns the smaller arm and writes it onto the account", async () => {
    const counts = async () => {
      const rows = (
        await db().select({ arm: prolificParticipant.arm, pid: prolificParticipant.prolificPid }).from(prolificParticipant)
      ).filter((r) => isRealProlificPid(r.pid));
      return {
        control: rows.filter((r) => r.arm === "control").length,
        sparks: rows.filter((r) => r.arm === "sparks").length,
      };
    };
    for (const [i, pid] of PIDS.slice(0, 2).entries()) {
      const before = await counts();
      const result = await enroll(pid, USERS[i]!, { random: () => 0.1 });
      expect(result.ok && result.participant.arm).toBe(chooseArm(before, () => 0.1));
      const [account] = await db().select().from(user).where(eq(user.id, USERS[i]!));
      expect(account?.studyCondition).toEqual({ sparks: result.ok && result.participant.arm === "sparks" });
      expect(account?.studyParticipantId).toBe(pseudonymFor(pid));
    }
  });

  it("returns the same enrolment on a reload", async () => {
    const first = await enroll(PIDS[0]!, USERS[0]!);
    const again = await enroll(PIDS[0]!, USERS[0]!, { arm: first.ok && first.participant.arm === "sparks" ? "control" : "sparks" });
    expect(again.ok && again.created).toBe(false);
    expect(again.ok && again.participant.arm).toBe(first.ok && first.participant.arm);
  });

  it("moves to a second browser before the conversation, and refuses after", async () => {
    await enroll(PIDS[0]!, USERS[0]!, { arm: "sparks" });
    const moved = await enroll(PIDS[0]!, USERS[1]!);
    expect(moved.ok && moved.participant.userId).toBe(USERS[1]);
    const [old] = await db().select().from(user).where(eq(user.id, USERS[0]!));
    expect(old?.studyParticipantId).toBeNull();
    const [now] = await db().select().from(user).where(eq(user.id, USERS[1]!));
    expect(now?.studyCondition).toEqual({ sparks: true });

    await db().insert(captureSession).values({ id: SESSION, userId: USERS[1]!, startedAt: T0 });
    expect(await markConversationStarted(USERS[1]!, SESSION)).toBe(true);
    expect(await enroll(PIDS[0]!, USERS[2]!)).toEqual({ ok: false, reason: "enrolled_elsewhere" });
  });

  it("never enrols a signed-in account", async () => {
    await db().update(user).set({ isAnonymous: false }).where(eq(user.id, USERS[0]!));
    expect(await enroll(PIDS[0]!, USERS[0]!)).toEqual({ ok: false, reason: "not_a_guest" });
    const [account] = await db().select().from(user).where(eq(user.id, USERS[0]!));
    expect(account?.studyCondition).toBeNull();
  });

  it("refuses a second PID on an account that already has one", async () => {
    await enroll(PIDS[0]!, USERS[0]!);
    expect(await enroll(PIDS[1]!, USERS[0]!)).toEqual({ ok: false, reason: "other_participant" });
  });

  it("finishes part 1, schedules the probes with its delay, and opens part 2 then", async () => {
    await enroll(PIDS[2]!, USERS[3]!, { arm: "control" });
    expect(await finishPart1(USERS[3]!, 5, T0)).toBeNull();

    const ended = new Date(T0.getTime() + 15 * 60_000);
    await db().insert(captureSession).values({ id: SESSION, userId: USERS[3]!, startedAt: T0, endedAt: ended });
    await markConversationStarted(USERS[3]!, SESSION);
    await recordSubjectVisit({ captureSessionId: SESSION, ordinal: 1, title: "Who is at risk", startOffsetMs: 0, endOffsetMs: 60_000 });
    await recordSubjectVisit({ captureSessionId: SESSION, ordinal: 2, title: "Cooling centres", startOffsetMs: 60_000 });

    const done = await finishPart1(USERS[3]!, 5, ended);
    expect(done?.judgmentOfLearning).toBe(5);
    const probes = await db().select().from(recallProbe).where(eq(recallProbe.userId, USERS[3]!));
    expect(probes).toHaveLength(2);
    expect(probes[0]!.dueAt.getTime()).toBe(ended.getTime() + 20 * 3_600_000);

    // The first answer stands.
    await finishPart1(USERS[3]!, 2, new Date(ended.getTime() + 1000));
    expect((await findParticipantByPid(PIDS[2]!))?.judgmentOfLearning).toBe(5);

    expect((await part2StateFor(PIDS[2]!, ended)).state).toBe("too_early");
    const later = new Date(ended.getTime() + 21 * 3_600_000);
    const open = await part2StateFor(PIDS[2]!, later);
    expect(open.state).toBe("open");
    expect((await part2StateFor("test-pid-unknown", later)).state).toBe("unknown");

    const id = open.state === "open" ? open.participant.id : "";
    await beginPart2(id, { studyId: "s2" }, later);
    const closing = { tookAway: 4, ownIdeas: 5, assistantThought: 3, cardsHelped: null, rehearsed: false };
    expect(await saveClosing(id, closing, later)).toBe(false);
    expect(await saveFreeRecall(id, "older people living alone, cooling centres in the library", 4, later)).toBe(true);
    expect(await saveFreeRecall(id, "a second try", 7, later)).toBe(false);
    expect(await saveClosing(id, closing, later)).toBe(true);

    const row = await findParticipantByPid(PIDS[2]!);
    expect(row?.freeRecall).toContain("cooling centres");
    expect(row?.freeRecallConfidence).toBe(4);
    expect(row?.part2StudyId).toBe("s2");
    expect(row?.part2CompletedAt).not.toBeNull();
  });
});
