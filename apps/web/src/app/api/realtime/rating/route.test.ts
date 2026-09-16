/**
 * The rating write-back, against a real ledger.
 *
 * What matters is what lands in `interaction_rating` and what cannot: a number
 * with the window it was given in, a probe that produced no number still
 * recorded, a rating outside the scale refused before it reaches the column,
 * and nothing at all written for a ticket belonging to somebody else's drive.
 *
 * Needs the local Postgres; skipped when it is unreachable — check the counts.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeEach, describe, expect, it } from "vitest";

const { asc, closeDb, eq, getDb } = await import("@voicemural/db");
const { agentTurn, captureSession, interactionRating, user } = await import("@voicemural/db/schema");
const { issueTicket } = await import("@voicemural/shared/realtime-ticket");
const { isDatabaseReachable } = await import("@voicemural/db/testing");
const { POST } = await import("./route");

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

const USER_ID = "test-rating-route-user";
const OTHER_ID = "test-rating-route-other";
const SESSION = "00000000-0000-4000-8000-00000000e0a1";

let turnId: string;

async function seed() {
  const db = getDb();
  for (const id of [USER_ID, OTHER_ID]) {
    await db.delete(user).where(eq(user.id, id));
    await db.insert(user).values({ id, name: "R", email: `${id}@test.local` });
  }
  await db.insert(captureSession).values({ id: SESSION, userId: USER_ID, startedAt: new Date() });

  // The turn the rating is about — the last thing the agent said before the
  // probe opened.
  const [turn] = await db
    .insert(agentTurn)
    .values({
      captureSessionId: SESSION,
      seq: 0,
      startOffsetMs: 20_000,
      endOffsetMs: 23_000,
      text: "The Tuesday deadline is the binding one.",
      generatedText: "The Tuesday deadline is the binding one.",
    })
    .returning({ id: agentTurn.id });
  turnId = turn!.id;
}

function post(body: Record<string, unknown>, userId = USER_ID) {
  const { ticket } = issueTicket({ userId, captureSessionId: SESSION }, { ttlMs: 60_000 });
  return POST(
    new Request("http://test/api/realtime/rating", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket, ...body }),
    }),
  );
}

async function rows() {
  return getDb()
    .select()
    .from(interactionRating)
    .where(eq(interactionRating.captureSessionId, SESSION))
    .orderBy(asc(interactionRating.seq));
}

describeIfDb("POST /api/realtime/rating", () => {
  beforeEach(() => seed());

  afterAll(async () => {
    const db = getDb();
    for (const id of [USER_ID, OTHER_ID]) await db.delete(user).where(eq(user.id, id));
    await closeDb();
  });

  it("stores the number with the window it was given in", async () => {
    const res = await post({
      seq: 0,
      askedOffsetMs: 30_000,
      answeredOffsetMs: 34_000,
      endedOffsetMs: 37_000,
      rating: 4,
      outcome: "rated",
      agentTurnId: turnId,
      configVersion: "talkback-10",
    });

    expect(res.status).toBe(200);
    const [row] = await rows();
    expect(row).toMatchObject({
      rating: 4,
      outcome: "rated",
      askedOffsetMs: 30_000,
      answeredOffsetMs: 34_000,
      endedOffsetMs: 37_000,
      agentTurnId: turnId,
      configVersion: "talkback-10",
    });
  });

  it("records a probe that produced no number, because that is the finding", async () => {
    await post({ seq: 0, askedOffsetMs: 10_000, endedOffsetMs: 25_000, outcome: "timeout" });
    await post({ seq: 1, askedOffsetMs: 40_000, endedOffsetMs: 48_000, outcome: "unclear" });

    const stored = await rows();
    expect(stored.map((r) => r.outcome)).toEqual(["timeout", "unclear"]);
    // No number, and no pretending there was one.
    expect(stored.every((r) => r.rating === null && r.answeredOffsetMs === null)).toBe(true);
  });

  it("refuses a number that is not on the scale", async () => {
    for (const rating of [0, 6, 2.5]) {
      const res = await post({
        seq: 0,
        askedOffsetMs: 1_000,
        endedOffsetMs: 2_000,
        rating,
        outcome: "rated",
      });
      expect(res.status).toBe(400);
    }
    expect(await rows()).toHaveLength(0);
  });

  it("stores no rating for an outcome that says there was none", async () => {
    // Belt and braces against a container bug: `cancelled` with a number is a
    // contradiction, and the number is what would end up in the analysis.
    await post({
      seq: 0,
      askedOffsetMs: 1_000,
      endedOffsetMs: 2_000,
      rating: 5,
      outcome: "cancelled",
    });

    const [row] = await rows();
    expect(row).toMatchObject({ outcome: "cancelled", rating: null });
  });

  it("writes nothing for a ticket that is not this drive's owner", async () => {
    const res = await post(
      { seq: 0, askedOffsetMs: 1_000, endedOffsetMs: 2_000, rating: 3, outcome: "rated" },
      OTHER_ID,
    );
    expect(res.status).toBe(403);
    expect(await rows()).toHaveLength(0);
  });

  it("refuses an unsigned body outright", async () => {
    const res = await POST(
      new Request("http://test/api/realtime/rating", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket: "not-a-ticket", seq: 0, askedOffsetMs: 0, endedOffsetMs: 1, outcome: "rated" }),
      }),
    );
    expect(res.status).toBe(401);
    expect(await rows()).toHaveLength(0);
  });
});
