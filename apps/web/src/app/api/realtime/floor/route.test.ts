/**
 * Integration tests for the container's floor route.
 *
 * The same rule as `/decision`, pinned separately because the route is
 * separately reachable: a drive that has ended takes no more rows. A lock
 * written after `ended_at` would put a locked stretch on a drive that was
 * already over, and every "how long was the agent locked" figure taken from it
 * would run past the end of the recording.
 *
 * Needs the local Postgres; skipped when it is unreachable.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, eq, floorEvent, getDb, inArray } from "@voicemural/db";
import { captureSession, user } from "@voicemural/db/schema";
import { isDatabaseReachable } from "@voicemural/db/testing";
import { issueTicket } from "@voicemural/shared/realtime-ticket";
import { POST } from "./route";

const USER_ID = "test-realtime-floor-user";
const SESSION_ID = "00000000-0000-4000-8000-0000000f1001";
const ENDED_ID = "00000000-0000-4000-8000-0000000f1002";

process.env.BETTER_AUTH_SECRET ??= "test-secret-for-floor-route";

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

async function seed() {
  const db = getDb();
  await db.delete(user).where(inArray(user.id, [USER_ID]));
  await db.insert(user).values({ id: USER_ID, name: "F", email: `${USER_ID}@test.local` });
  await db.insert(captureSession).values({ id: SESSION_ID, userId: USER_ID, startedAt: new Date() });
  await db.insert(captureSession).values({
    id: ENDED_ID,
    userId: USER_ID,
    startedAt: new Date(Date.now() - 400_000),
    endedAt: new Date(Date.now() - 30_000),
  });
}

function post(sessionId: string, body: Record<string, unknown>) {
  const { ticket } = issueTicket({ userId: USER_ID, captureSessionId: sessionId });
  return POST(
    new Request("http://test/api/realtime/floor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket, seq: 0, offsetMs: 61_200, ...body }),
    }),
  );
}

describeIfDb("POST /api/realtime/floor", () => {
  beforeEach(seed);
  afterAll(async () => {
    await getDb().delete(user).where(inArray(user.id, [USER_ID]));
    await closeDb();
  });

  it("records the floor a connection started with, apart from a press", async () => {
    expect((await post(SESSION_ID, { kind: "locked", atConnect: true })).status).toBe(200);
    expect((await post(SESSION_ID, { kind: "open", seq: 1, offsetMs: 90_000 })).status).toBe(200);

    const rows = await getDb()
      .select()
      .from(floorEvent)
      .where(eq(floorEvent.captureSessionId, SESSION_ID))
      .orderBy(floorEvent.offsetMs);
    expect(rows.map((r) => [r.kind, r.atConnect])).toEqual([
      ["locked", true],
      ["open", false],
    ]);
  });

  it("refuses anything but the three kinds", async () => {
    expect((await post(SESSION_ID, { kind: "mute" })).status).toBe(400);
  });

  it("refuses a change for a drive that has ended, and writes nothing", async () => {
    const res = await post(ENDED_ID, { kind: "poke" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "session_ended" });

    const rows = await getDb()
      .select()
      .from(floorEvent)
      .where(eq(floorEvent.captureSessionId, ENDED_ID));
    expect(rows).toHaveLength(0);
  });
});
