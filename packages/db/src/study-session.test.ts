import { config } from "dotenv";
config({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });

import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { blocksFor, SESSION_CELLS, SESSION_DESIGN, SESSION_VERSION } from "@voicemural/shared";
import { captureSession, studyBlock, studyMoment, studySession, user } from "./schema";
import {
  ARM_TTL_MS,
  armBlock,
  armedBlockFor,
  blockLinked,
  claimSession,
  createSession,
  findBlockByCaptureSession,
  findSessionByUser,
  finishBlock,
  linkArmedBlock,
  saveBlockAnswers,
  saveFinal,
  saveMoment,
} from "./study-session";
import { isDatabaseReachable } from "./testing";
import { closeDb, getDb } from "./index";

const USERS = ["test-ss-a", "test-ss-b", "test-ss-real"];
// This file's own drive ids: another test file's would collide when turbo runs them in parallel.
const DRIVES = [
  "00000000-0000-4000-8000-0000000005a1",
  "00000000-0000-4000-8000-0000000005a2",
  "00000000-0000-4000-8000-0000000005a3",
  "00000000-0000-4000-8000-0000000005a4",
  "00000000-0000-4000-8000-0000000005a5",
];
const REF = "TST-SS-";
const T0 = new Date("2026-10-21T10:00:00Z");
const ANSWERS = {
  summary: "We chose the train to Aarhus; the hotel is still open.",
  follow: 5,
  effort: 3,
  pickup: 4,
  beforeGame: "Where to stay",
  wayBack: "I read the last line.",
  glance: 4,
};
const FINAL = { more: "The game was hard.", contact: false };

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

describeIfDb("the display study's session", () => {
  const db = () => getDb();
  const make = (n: number, orderIndex?: number) => createSession({ ref: `${REF}${n}`, orderIndex });

  async function clean() {
    await db().delete(studySession).where(like(studySession.ref, `${REF}%`));
    await db().delete(captureSession).where(inArray(captureSession.id, DRIVES));
    await db().delete(user).where(inArray(user.id, USERS));
  }

  /** A drive of `userId`'s, registered, so a block can link to it. */
  async function drive(userId: string, id: string) {
    await db().insert(captureSession).values({ id, userId, startedAt: T0 });
  }

  /** Walk block `position` through to its answers. */
  async function talk(userId: string, position: number, driveId: string) {
    expect(await armBlock(userId, position, T0)).toBe("armed");
    const armed = await armedBlockFor(userId, T0);
    await drive(userId, driveId);
    expect(await linkArmedBlock(armed!, driveId)).toBe(true);
    expect(await finishBlock(userId, position, T0)).toBe(true);
    expect(await saveBlockAnswers(userId, position, ANSWERS, T0)).toBe("saved");
  }

  beforeEach(async () => {
    await clean();
    await db()
      .insert(user)
      .values([
        { id: "test-ss-a", name: "Guest", email: "test-ss-a@test.local", isAnonymous: true },
        { id: "test-ss-b", name: "Guest", email: "test-ss-b@test.local", isAnonymous: true },
        { id: "test-ss-real", name: "Anton", email: "test-ss-real@test.local", isAnonymous: false },
      ]);
  });

  afterAll(async () => {
    await clean();
    await closeDb();
  });

  it("is made in its cell, with its one block and a secret link", async () => {
    const { session, blocks } = await make(1, 2);
    expect(session.orderIndex).toBe(2);
    expect(session.design).toBe(SESSION_DESIGN);
    expect(session.inviteCode).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(blocks.map(({ position, display, task }) => ({ position, display, task }))).toEqual(blocksFor(2));
    await expect(make(1)).rejects.toThrow(/taken/);
  });

  it("takes the next cell in turn, and the next pseudonym, unless pinned", async () => {
    // A session-1 session does not take a turn.
    await db().insert(studySession).values({ ref: `${REF}within`, design: "within", orderIndex: 3 });
    const a = await createSession();
    const b = await createSession();
    try {
      expect(b.session.orderIndex).toBe((a.session.orderIndex + 1) % SESSION_CELLS);
      expect(a.session.ref).toMatch(/^F\d{2,}$/);
      expect(Number(b.session.ref.slice(1))).toBe(Number(a.session.ref.slice(1)) + 1);
    } finally {
      await db().delete(studySession).where(inArray(studySession.id, [a.session.id, b.session.id]));
    }
  });

  it("is claimed by the guest who consents on its link, and a reload changes nothing", async () => {
    const { session } = await make(1);
    const code = session.inviteCode!;
    expect(await claimSession({ code: "no-such-code-at-all", userId: "test-ss-a" })).toEqual({ ok: false, reason: "unknown" });

    const first = await claimSession({ code, userId: "test-ss-a", now: T0 });
    expect(first.ok && first.session.userId).toBe("test-ss-a");
    expect(first.ok && first.session.consentedAt).toEqual(T0);
    const again = await claimSession({ code, userId: "test-ss-a", now: new Date(T0.getTime() + 60_000) });
    expect(again.ok && again.session.consentedAt).toEqual(T0);
  });

  it("refuses a signed-in account unless accounts are allowed", async () => {
    const { session } = await make(1);
    const code = session.inviteCode!;
    expect(await claimSession({ code, userId: "test-ss-real" })).toEqual({ ok: false, reason: "not_a_guest" });
    expect((await claimSession({ code, userId: "test-ss-real", allowAccounts: true })).ok).toBe(true);
  });

  it("refuses a guest that already holds another session", async () => {
    const one = await make(1);
    const two = await make(2);
    await claimSession({ code: one.session.inviteCode!, userId: "test-ss-a" });
    expect(await claimSession({ code: two.session.inviteCode!, userId: "test-ss-a" })).toEqual({
      ok: false,
      reason: "other_session",
    });
  });

  it("moves to a second browser before anything was started, and not after", async () => {
    const { session } = await make(1);
    const code = session.inviteCode!;
    await claimSession({ code, userId: "test-ss-a" });
    const moved = await claimSession({ code, userId: "test-ss-b" });
    expect(moved.ok && moved.session.userId).toBe("test-ss-b");

    // Armed is not started: the brief was open, nothing was recorded.
    expect(await armBlock("test-ss-b", 0, T0)).toBe("armed");
    const back = await claimSession({ code, userId: "test-ss-a" });
    expect(back.ok && back.session.userId).toBe("test-ss-a");

    await armBlock("test-ss-a", 0, T0);
    await drive("test-ss-a", DRIVES[0]!);
    await linkArmedBlock((await armedBlockFor("test-ss-a", T0))!, DRIVES[0]!);
    expect(await claimSession({ code, userId: "test-ss-b" })).toEqual({ ok: false, reason: "claimed_elsewhere" });
  });

  it("arms its one block, and no other", async () => {
    const { session } = await make(1);
    expect(await armBlock("test-ss-a", 0, T0)).toBe("no_session");
    await claimSession({ code: session.inviteCode!, userId: "test-ss-a" });

    expect(await armBlock("test-ss-a", 1, T0)).toBe("no_session");
    expect(await armBlock("test-ss-a", 0, T0)).toBe("armed");
    expect(await armBlock("test-ss-a", 0, T0)).toBe("armed");
    expect((await findSessionByUser("test-ss-a"))!.blocks[0]!.attempts).toBe(0);
  });

  it("hands an armed block to the next drive once, and not after it has waited too long", async () => {
    const { session, blocks } = await make(1);
    await claimSession({ code: session.inviteCode!, userId: "test-ss-a" });
    await armBlock("test-ss-a", 0, T0);

    expect(await armedBlockFor("test-ss-a", new Date(T0.getTime() + ARM_TTL_MS + 1))).toBeNull();
    expect(await armedBlockFor("test-ss-b", T0)).toBeNull();
    const armed = await armedBlockFor("test-ss-a", new Date(T0.getTime() + 5_000));
    expect(armed).toMatchObject({ position: 0, display: blocks[0]!.display, task: blocks[0]!.task });

    await drive("test-ss-a", DRIVES[0]!);
    await drive("test-ss-a", DRIVES[1]!);
    expect(await linkArmedBlock(armed!, DRIVES[0]!)).toBe(true);
    // The second tab's drive finds the arm spent.
    expect(await linkArmedBlock(armed!, DRIVES[1]!)).toBe(false);
    expect(await armedBlockFor("test-ss-a", T0)).toBeNull();

    expect(await findBlockByCaptureSession(DRIVES[0]!)).toMatchObject({ position: 0, display: blocks[0]!.display });
    expect(await findBlockByCaptureSession(DRIVES[1]!)).toBeNull();
    expect(await blockLinked("test-ss-a", 0, DRIVES[0]!)).toBe(true);
    expect(await blockLinked("test-ss-a", 0, DRIVES[1]!)).toBe(false);
  });

  it("links a restarted block to its newest drive", async () => {
    const { session } = await make(1);
    await claimSession({ code: session.inviteCode!, userId: "test-ss-a" });
    for (const id of DRIVES.slice(0, 2)) {
      await armBlock("test-ss-a", 0, T0);
      await drive("test-ss-a", id);
      expect(await linkArmedBlock((await armedBlockFor("test-ss-a", T0))!, id)).toBe(true);
    }
    expect(await blockLinked("test-ss-a", 0, DRIVES[1]!)).toBe(true);
    expect((await findSessionByUser("test-ss-a"))!.blocks[0]!.attempts).toBe(2);
  });

  it("files a moment with the block's current drive, once", async () => {
    const { session } = await make(1);
    await claimSession({ code: session.inviteCode!, userId: "test-ss-a" });
    const esm = { kind: "esm" as const, ordinal: 0, item: "esm_follow", shownOffsetMs: 106_000, answeredOffsetMs: 108_000, value: 5, text: null };
    expect(await saveMoment("test-ss-a", 0, esm)).toBe("no_drive");

    await armBlock("test-ss-a", 0, T0);
    await drive("test-ss-a", DRIVES[0]!);
    await linkArmedBlock((await armedBlockFor("test-ss-a", T0))!, DRIVES[0]!);
    expect(await saveMoment("test-ss-a", 0, esm)).toBe("saved");
    expect(await saveMoment("test-ss-a", 0, { ...esm, value: 1 })).toBe("duplicate");

    // A restarted block's new drive starts its moments over.
    await armBlock("test-ss-a", 0, T0);
    await drive("test-ss-a", DRIVES[1]!);
    await linkArmedBlock((await armedBlockFor("test-ss-a", T0))!, DRIVES[1]!);
    expect(await saveMoment("test-ss-a", 0, { ...esm, value: 3 })).toBe("saved");

    const rows = await db().select().from(studyMoment).where(inArray(studyMoment.captureSessionId, DRIVES));
    expect(rows.map((r) => [r.captureSessionId, r.value]).sort()).toEqual([
      [DRIVES[0], 5],
      [DRIVES[1], 3],
    ]);
  });

  it("finishes and answers a block only once it has a drive, and keeps the first answer", async () => {
    const { session } = await make(1);
    await claimSession({ code: session.inviteCode!, userId: "test-ss-a" });
    expect(await finishBlock("test-ss-a", 0, T0)).toBe(false);
    expect(await saveBlockAnswers("test-ss-a", 0, ANSWERS, T0)).toBe("not_finished");

    await talk("test-ss-a", 0, DRIVES[0]!);
    expect(await armBlock("test-ss-a", 0, T0)).toBe("done");
    expect(await saveBlockAnswers("test-ss-a", 0, { ...ANSWERS, follow: 1 }, T0)).toBe("saved");

    const [row] = await db().select().from(studyBlock).where(eq(studyBlock.captureSessionId, DRIVES[0]!));
    expect(row!.summary).toBe(ANSWERS.summary);
    expect(row!.answers).toEqual({
      follow: 5,
      effort: 3,
      pickup: 4,
      beforeGame: "Where to stay",
      wayBack: "I read the last line.",
      glance: 4,
      version: SESSION_VERSION,
    });
  });

  it("is complete with the last questions, only after its conversation is answered", async () => {
    const { session } = await make(1);
    await claimSession({ code: session.inviteCode!, userId: "test-ss-a" });
    expect(await saveFinal("test-ss-a", FINAL, T0)).toBe("not_done");

    await talk("test-ss-a", 0, DRIVES[0]!);
    expect(await saveFinal("test-ss-a", FINAL, T0)).toBe("saved");
    expect(await saveFinal("test-ss-a", { ...FINAL, contact: true }, T0)).toBe("saved");
    const state = await findSessionByUser("test-ss-a");
    expect(state!.session.completedAt).toEqual(T0);
    expect(state!.session.final).toMatchObject({ more: FINAL.more, contact: false });
    expect(await armedBlockFor("test-ss-a", T0)).toBeNull();
  });
});
