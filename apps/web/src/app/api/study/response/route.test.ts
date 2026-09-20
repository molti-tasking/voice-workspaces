/**
 * One answer per question, however many taps arrive.
 *
 * The rule looks trivial and is not, because two different unique indexes
 * enforce it: Postgres treats two nulls in a unique index as distinct, so an
 * answer about a DRIVE and an answer about the WEEK — which has no drive —
 * cannot be constrained by the same one. Both shapes of that went wrong on
 * the way here: an update without `captureSessionId is null` in its predicate
 * rewrote a whole week of pre/post answers with one day-7 rating, and the
 * update-then-insert that replaced it raced itself into duplicate rows.
 *
 * Needs the local Postgres; skipped when it is unreachable — check the counts.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "test-study-response-user";
const OTHER_USER_ID = "test-study-response-other";

vi.mock("@/lib/session", () => ({
  currentUserId: async () => USER_ID,
  currentUser: async () => ({ id: USER_ID }),
}));

const { closeDb, eq, getDb } = await import("@voicemural/db");
const { captureSession, studyResponse, user } = await import("@voicemural/db/schema");
const { isDatabaseReachable } = await import("@voicemural/db/testing");
const { POST } = await import("./route");

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

const SESSION = "00000000-0000-4000-8000-00000000c201";

async function seed(opts: { ownedByOther?: boolean } = {}) {
  const db = getDb();
  for (const id of [USER_ID, OTHER_USER_ID]) {
    await db.delete(user).where(eq(user.id, id));
    await db.insert(user).values({ id, name: "S", email: `${id}@test.local` });
  }
  await db.insert(captureSession).values({
    id: SESSION,
    userId: opts.ownedByOther ? OTHER_USER_ID : USER_ID,
    startedAt: new Date("2026-09-20T09:00:00Z"),
  });
}

function answer(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/study/response", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function answers() {
  return getDb()
    .select({
      sessionId: studyResponse.captureSessionId,
      phase: studyResponse.phase,
      item: studyResponse.item,
      value: studyResponse.value,
    })
    .from(studyResponse)
    .where(eq(studyResponse.userId, USER_ID));
}

describeIfDb("POST /api/study/response", () => {
  beforeEach(async () => {
    await seed();
  });

  afterAll(async () => {
    const db = getDb();
    for (const id of [USER_ID, OTHER_USER_ID]) {
      await db.delete(user).where(eq(user.id, id));
    }
    await closeDb();
  });

  it("corrects an answer rather than adding a second one", async () => {
    await answer({ captureSessionId: SESSION, phase: "post", item: "mental_load", value: 4 });
    await answer({ captureSessionId: SESSION, phase: "post", item: "mental_load", value: 5 });
    expect(await answers()).toEqual([
      { sessionId: SESSION, phase: "post", item: "mental_load", value: 5 },
    ]);
  });

  it("keeps the two new thinking items apart from the rest", async () => {
    await answer({ captureSessionId: SESSION, phase: "post", item: "thinking_moved", value: 6 });
    await answer({ captureSessionId: SESSION, phase: "post", item: "did_my_thinking", value: 2 });
    const rows = await answers();
    expect(rows).toHaveLength(2);
    // Two items, opposite directions: `did_my_thinking` is reverse-scored, and
    // `StudyItem.higherIsBetter` is where the analysis reads that from.
    expect(rows.find((r) => r.item === "thinking_moved")?.value).toBe(6);
    expect(rows.find((r) => r.item === "did_my_thinking")?.value).toBe(2);
  });

  it("keeps an answer about the week away from the answers about a drive", async () => {
    await answer({ captureSessionId: SESSION, phase: "pre", item: "mental_load", value: 6 });
    await answer({ captureSessionId: SESSION, phase: "post", item: "mental_load", value: 3 });
    // No session: this one is about the week. It used to rewrite every
    // drive-scoped row for the same item.
    await answer({ phase: "day7", item: "mental_load", value: 2 });

    const rows = await answers();
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.phase === "pre")?.value).toBe(6);
    expect(rows.find((r) => r.phase === "post")?.value).toBe(3);
    expect(rows.find((r) => r.phase === "day7")?.sessionId).toBeNull();
  });

  it("gives the week one answer per question however many arrive at once", async () => {
    await Promise.all([
      answer({ phase: "day7", item: "mental_load", value: 2 }),
      answer({ phase: "day7", item: "mental_load", value: 5 }),
      answer({ phase: "day7", item: "mental_load", value: 7 }),
    ]);
    const rows = await answers();
    expect(rows).toHaveLength(1);
    expect([2, 5, 7]).toContain(rows[0]?.value);
  });

  it("refuses a rating filed against somebody else's drive", async () => {
    await seed({ ownedByOther: true });
    const res = await answer({
      captureSessionId: SESSION,
      phase: "post",
      item: "mental_load",
      value: 4,
    });
    expect(res.status).toBe(403);
    expect(await answers()).toHaveLength(0);
  });

  it("refuses an item nobody asks", async () => {
    const res = await answer({
      captureSessionId: SESSION,
      phase: "post",
      item: "how_do_you_feel",
      value: 4,
    });
    expect(res.status).toBe(400);
  });
});
