/**
 * Integration tests for the container's title route: a running drive takes
 * the latest live title as its name, and an ended one takes nothing.
 *
 * Needs the local Postgres; skipped when it is unreachable.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, eq, getDb, inArray } from "@voicemural/db";
import { captureSession, user } from "@voicemural/db/schema";
import { isDatabaseReachable } from "@voicemural/db/testing";
import { issueTicket } from "@voicemural/shared/realtime-ticket";
import { POST } from "./route";

const USER_ID = "test-realtime-title-user";
const OTHER_ID = "test-realtime-title-other";
const SESSION_ID = "00000000-0000-4000-8000-0000000e1701";
const ENDED_ID = "00000000-0000-4000-8000-0000000e1702";

process.env.BETTER_AUTH_SECRET ??= "test-secret-for-title-route";

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

async function seed() {
  const db = getDb();
  await db.delete(user).where(inArray(user.id, [USER_ID, OTHER_ID]));
  await db.insert(user).values([
    { id: USER_ID, name: "T", email: `${USER_ID}@test.local` },
    { id: OTHER_ID, name: "O", email: `${OTHER_ID}@test.local` },
  ]);
  await db.insert(captureSession).values({ id: SESSION_ID, userId: USER_ID, startedAt: new Date() });
  await db.insert(captureSession).values({
    id: ENDED_ID,
    userId: USER_ID,
    startedAt: new Date(Date.now() - 400_000),
    endedAt: new Date(Date.now() - 52_000),
  });
}

function post(title: string, sessionId = SESSION_ID, userId = USER_ID) {
  const { ticket } = issueTicket({ userId, captureSessionId: sessionId });
  return POST(
    new Request("http://test/api/realtime/title", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket, title }),
    }),
  );
}

async function titleOf(id: string) {
  const [row] = await getDb()
    .select({ title: captureSession.title })
    .from(captureSession)
    .where(eq(captureSession.id, id));
  return row?.title ?? null;
}

describeIfDb("POST /api/realtime/title", () => {
  beforeEach(seed);
  afterAll(async () => {
    await getDb().delete(user).where(inArray(user.id, [USER_ID, OTHER_ID]));
    await closeDb();
  });

  it("names a running drive by its latest title", async () => {
    expect((await post("AI weaknesses")).status).toBe(200);
    expect((await post("Search tool results")).status).toBe(200);
    expect(await titleOf(SESSION_ID)).toBe("Search tool results");
  });

  it("refuses a drive that has ended, so the container stops", async () => {
    const res = await post("Too late", ENDED_ID);
    expect(res.status).toBe(409);
    expect(await titleOf(ENDED_ID)).toBeNull();
  });

  it("refuses a ticket for someone else's drive", async () => {
    const res = await post("Not yours", SESSION_ID, OTHER_ID);
    expect(res.status).toBe(403);
    expect(await titleOf(SESSION_ID)).toBeNull();
  });
});
