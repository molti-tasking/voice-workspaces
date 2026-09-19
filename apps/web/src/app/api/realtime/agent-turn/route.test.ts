/**
 * Integration tests for the container's turn route.
 *
 * The property they exist for is the one the first formative pilot broke: a
 * drive that has been stopped is a finished record, and nothing may be written
 * into it. `agent_turn` seq 14 on that session starts 52 seconds after
 * `ended_at` — a `silence_offer` whose timer outlived Stop — and one such row
 * skews every turn count and every duration taken from the session.
 *
 * Needs the local Postgres; skipped when it is unreachable.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { agentTurn, closeDb, eq, getDb, inArray } from "@voicemural/db";
import { captureSession, user } from "@voicemural/db/schema";
import { isDatabaseReachable } from "@voicemural/db/testing";
import { issueTicket } from "@voicemural/shared/realtime-ticket";
import { POST } from "./route";

const USER_ID = "test-realtime-turn-user";
const OTHER_ID = "test-realtime-turn-other";
const SESSION_ID = "00000000-0000-4000-8000-0000000a7001";
const ENDED_ID = "00000000-0000-4000-8000-0000000a7002";
const OTHER_SESSION_ID = "00000000-0000-4000-8000-0000000a7003";

process.env.BETTER_AUTH_SECRET ??= "test-secret-for-agent-turn-route";

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

async function seed() {
  const db = getDb();
  await db.delete(user).where(inArray(user.id, [USER_ID, OTHER_ID]));
  await db.insert(user).values({ id: USER_ID, name: "T", email: `${USER_ID}@test.local` });
  await db.insert(user).values({ id: OTHER_ID, name: "O", email: `${OTHER_ID}@test.local` });
  await db.insert(captureSession).values({ id: SESSION_ID, userId: USER_ID, startedAt: new Date() });
  await db.insert(captureSession).values({
    id: ENDED_ID,
    userId: USER_ID,
    startedAt: new Date(Date.now() - 400_000),
    // Stopped, as `/api/capture-sessions/[id]/end` and the idle sweep both leave it.
    endedAt: new Date(Date.now() - 52_000),
  });
  await db
    .insert(captureSession)
    .values({ id: OTHER_SESSION_ID, userId: OTHER_ID, startedAt: new Date() });
}

function post(body: Record<string, unknown>, sessionId = SESSION_ID, userId = USER_ID) {
  const { ticket } = issueTicket({ userId, captureSessionId: sessionId });
  return POST(
    new Request("http://test/api/realtime/agent-turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket, ...body }),
    }),
  );
}

const TURN = {
  seq: 0,
  startOffsetMs: 1_000,
  endOffsetMs: 2_000,
  text: "The one in Altenholz is open until six.",
  generatedText: "The one in Altenholz is open until six.",
};

describeIfDb("POST /api/realtime/agent-turn", () => {
  beforeEach(seed);
  afterAll(async () => {
    await getDb().delete(user).where(inArray(user.id, [USER_ID, OTHER_ID]));
    await closeDb();
  });

  it("records a turn on a drive that is still running", async () => {
    const res = await post(TURN);
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBeTruthy();

    const rows = await getDb().select().from(agentTurn).where(eq(agentTurn.captureSessionId, SESSION_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toBe(TURN.text);
  });

  it("refuses a turn for a drive that has ended, and writes nothing", async () => {
    const res = await post(TURN, ENDED_ID);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "session_ended" });

    const rows = await getDb().select().from(agentTurn).where(eq(agentTurn.captureSessionId, ENDED_ID));
    expect(rows).toHaveLength(0);
  });

  it("still refuses a drive owned by somebody else, and says so differently", async () => {
    // 403 and 409 are different facts, and the container acts on them
    // differently: one is this request being wrong, the other is the drive
    // being over — which makes every later request pointless too, so the
    // container stops rather than retrying.
    const res = await post(TURN, OTHER_SESSION_ID, USER_ID);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });
});
