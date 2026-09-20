/**
 * Integration tests for the post-drive debrief window.
 *
 * The property they exist for is the privacy boundary. `/study` promises that
 * nobody on the research team listens to a drive or reads its transcript, and
 * names one exception: the three questions answered after Stop. That makes the
 * readable channel an INTERVAL inside a recording, so these two offsets are
 * what an export has to be able to read — and a debrief whose start never
 * landed must leave nothing readable at all.
 *
 * The other property is that the recording does not end here. The first
 * formative pilot's best material — the accent observation, the request for a
 * filler phrase while a search runs, "ist jetzt die App ausgegangen?" — all
 * happened after `ended_at`, and exists only because somebody was filming.
 *
 * Needs the local Postgres; skipped when it is unreachable.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "test-debrief-user";
const OTHER_ID = "test-debrief-other";

vi.mock("@/lib/session", () => ({
  currentUserId: async () => USER_ID,
  currentUser: async () => ({ id: USER_ID }),
}));

const { closeDb, eq, getDb, inArray } = await import("@voicemural/db");
const { captureSession, user } = await import("@voicemural/db/schema");
const { isDatabaseReachable } = await import("@voicemural/db/testing");
const { POST: markDebrief } = await import("./route");
const { POST: endSession } = await import("../end/route");

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

const SESSION = "00000000-0000-4000-8000-0000000deb01";
const OTHERS = "00000000-0000-4000-8000-0000000deb02";

async function seed() {
  const db = getDb();
  await db.delete(user).where(inArray(user.id, [USER_ID, OTHER_ID]));
  await db.insert(user).values({ id: USER_ID, name: "D", email: `${USER_ID}@test.local` });
  await db.insert(user).values({ id: OTHER_ID, name: "O", email: `${OTHER_ID}@test.local` });
  await db.insert(captureSession).values({ id: SESSION, userId: USER_ID, startedAt: new Date() });
  await db.insert(captureSession).values({ id: OTHERS, userId: OTHER_ID, startedAt: new Date() });
}

function mark(id: string, body: unknown) {
  return markDebrief(
    new Request(`http://test/api/capture-sessions/${id}/debrief`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function end(id: string, body?: unknown) {
  return endSession(
    new Request(`http://test/api/capture-sessions/${id}/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ id }) },
  );
}

async function row(id: string) {
  const [found] = await getDb()
    .select({
      endedAt: captureSession.endedAt,
      startedOffsetMs: captureSession.debriefStartedOffsetMs,
      endedOffsetMs: captureSession.debriefEndedOffsetMs,
    })
    .from(captureSession)
    .where(eq(captureSession.id, id));
  return found!;
}

describeIfDb("the post-drive debrief window", () => {
  beforeEach(seed);
  afterAll(async () => {
    await getDb().delete(user).where(inArray(user.id, [USER_ID, OTHER_ID]));
    await closeDb();
  });

  it("marks where it starts and leaves the recording running", async () => {
    const res = await mark(SESSION, { startedOffsetMs: 344_000 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: SESSION, marked: true });

    const after = await row(SESSION);
    expect(after.startedOffsetMs).toBe(344_000);
    // THE POINT OF THE WHOLE THING: the session is still open, so the chunk
    // loop carries on and the answers land in the ledger like any other speech.
    expect(after.endedAt).toBeNull();
  });

  it("closes the window when the participant taps Done", async () => {
    await mark(SESSION, { startedOffsetMs: 344_000 });
    const res = await end(SESSION, { debriefEndedOffsetMs: 401_000 });
    expect(res.status).toBe(200);

    const after = await row(SESSION);
    expect(after.endedAt).not.toBeNull();
    expect(after.endedOffsetMs).toBe(401_000);
  });

  it("leaves the end open when a drive ends any other way", async () => {
    // A phone put down, a dead zone, the idle sweep. The window then reads as
    // running to the end of the recording, which can only make the readable
    // stretch smaller than the truth — never larger.
    await mark(SESSION, { startedOffsetMs: 344_000 });
    await end(SESSION);

    const after = await row(SESSION);
    expect(after.endedAt).not.toBeNull();
    expect(after.endedOffsetMs).toBeNull();
  });

  it("cannot be moved once set", async () => {
    await mark(SESSION, { startedOffsetMs: 344_000 });
    const second = await mark(SESSION, { startedOffsetMs: 10_000 });
    expect(await second.json()).toEqual({ id: SESSION, marked: false });
    expect((await row(SESSION)).startedOffsetMs).toBe(344_000);
  });

  it("cannot be opened on a drive that has already ended", async () => {
    await end(SESSION);
    const res = await mark(SESSION, { startedOffsetMs: 1_000 });
    expect(await res.json()).toEqual({ id: SESSION, marked: false });
    expect((await row(SESSION)).startedOffsetMs).toBeNull();
  });

  it("cannot be opened on somebody else's drive", async () => {
    const res = await mark(OTHERS, { startedOffsetMs: 1_000 });
    expect(await res.json()).toEqual({ id: OTHERS, marked: false });
    expect((await row(OTHERS)).startedOffsetMs).toBeNull();
  });

  it("refuses a body that does not name an offset", async () => {
    expect((await mark(SESSION, {})).status).toBe(400);
    expect((await mark(SESSION, { startedOffsetMs: -1 })).status).toBe(400);
  });
});
