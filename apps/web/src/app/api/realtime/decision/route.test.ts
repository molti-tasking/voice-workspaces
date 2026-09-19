/**
 * Integration tests for the container's decision route.
 *
 * Same rule as `/agent-turn`, and pinned separately because the two routes are
 * separately reachable and the container posts to both on nearly every turn: a
 * drive that has ended takes no more rows. The pilot's stray offer wrote one of
 * each, 52 seconds after `ended_at`.
 *
 * Needs the local Postgres; skipped when it is unreachable.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { agentDecision, closeDb, eq, getDb, inArray } from "@voicemural/db";
import { captureSession, user } from "@voicemural/db/schema";
import { isDatabaseReachable } from "@voicemural/db/testing";
import { issueTicket } from "@voicemural/shared/realtime-ticket";
import { POST } from "./route";

const USER_ID = "test-realtime-decision-user";
const SESSION_ID = "00000000-0000-4000-8000-0000000d5001";
const ENDED_ID = "00000000-0000-4000-8000-0000000d5002";

process.env.BETTER_AUTH_SECRET ??= "test-secret-for-decision-route";

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

async function seed() {
  const db = getDb();
  await db.delete(user).where(inArray(user.id, [USER_ID]));
  await db.insert(user).values({ id: USER_ID, name: "D", email: `${USER_ID}@test.local` });
  await db.insert(captureSession).values({ id: SESSION_ID, userId: USER_ID, startedAt: new Date() });
  await db.insert(captureSession).values({
    id: ENDED_ID,
    userId: USER_ID,
    startedAt: new Date(Date.now() - 400_000),
    endedAt: new Date(Date.now() - 52_000),
  });
}

function post(sessionId: string) {
  const { ticket } = issueTicket({ userId: USER_ID, captureSessionId: sessionId });
  return POST(
    new Request("http://test/api/realtime/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticket,
        seq: 0,
        offsetMs: 396_984,
        trigger: "silence_offer",
        outcome: "spoke",
      }),
    }),
  );
}

describeIfDb("POST /api/realtime/decision", () => {
  beforeEach(seed);
  afterAll(async () => {
    await getDb().delete(user).where(inArray(user.id, [USER_ID]));
    await closeDb();
  });

  it("records a decision on a drive that is still running", async () => {
    expect((await post(SESSION_ID)).status).toBe(200);
    const rows = await getDb()
      .select()
      .from(agentDecision)
      .where(eq(agentDecision.captureSessionId, SESSION_ID));
    expect(rows).toHaveLength(1);
  });

  it("refuses a decision for a drive that has ended, and writes nothing", async () => {
    const res = await post(ENDED_ID);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "session_ended" });

    const rows = await getDb()
      .select()
      .from(agentDecision)
      .where(eq(agentDecision.captureSessionId, ENDED_ID));
    expect(rows).toHaveLength(0);
  });
});
