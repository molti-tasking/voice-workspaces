/**
 * Integration tests for retrying a session's failed transcription.
 *
 * A drive on 27 September 2026 lost all 82 chunks to a 415 from the ASR server,
 * under a banner saying they "can be retried" — and nothing could retry them.
 *
 * Needs the local Postgres; skipped when it is unreachable.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "test-retry-user";
const OTHER_ID = "test-retry-other";

vi.mock("@/lib/session", () => ({
  currentUserId: async () => USER_ID,
  currentUser: async () => ({ id: USER_ID }),
}));

const { asc, closeDb, eq, getDb, inArray } = await import("@voicemural/db");
const { audioChunk, captureSession, user } = await import("@voicemural/db/schema");
const { isDatabaseReachable } = await import("@voicemural/db/testing");
const { POST: retry } = await import("./route");

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

const SESSION = "00000000-0000-4000-8000-00000000ab01";
const OTHERS = "00000000-0000-4000-8000-00000000ab02";

function chunk(sessionId: string, seq: number, status: "failed" | "transcribed", storageKey: string | null) {
  return {
    captureSessionId: sessionId,
    seq,
    startOffsetMs: seq * 10_000,
    durationMs: 10_000,
    mimeType: "audio/webm;codecs=opus",
    byteSize: 100,
    checksum: `c${seq}`,
    storageKey,
    status,
    failureReason: status === "failed" ? "LiteLLM failed with 415" : null,
  };
}

async function seed() {
  const db = getDb();
  await db.delete(user).where(inArray(user.id, [USER_ID, OTHER_ID]));
  await db.insert(user).values({ id: USER_ID, name: "R", email: `${USER_ID}@test.local` });
  await db.insert(user).values({ id: OTHER_ID, name: "O", email: `${OTHER_ID}@test.local` });
  await db.insert(captureSession).values({ id: SESSION, userId: USER_ID, startedAt: new Date() });
  await db.insert(captureSession).values({ id: OTHERS, userId: OTHER_ID, startedAt: new Date() });
  await db.insert(audioChunk).values([
    chunk(SESSION, 0, "failed", "sessions/a/000000.webm"),
    chunk(SESSION, 1, "failed", null), // audio already gone
    chunk(SESSION, 2, "transcribed", null),
    chunk(OTHERS, 0, "failed", "sessions/b/000000.webm"),
  ]);
}

function post(id: string) {
  return retry(new Request(`http://test/api/capture-sessions/${id}/retry`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

async function statuses(id: string) {
  const rows = await getDb()
    .select({ status: audioChunk.status, failureReason: audioChunk.failureReason })
    .from(audioChunk)
    .where(eq(audioChunk.captureSessionId, id))
    .orderBy(asc(audioChunk.seq));
  return rows;
}

describeIfDb("retrying failed transcription", () => {
  beforeEach(seed);
  afterAll(async () => {
    await getDb().delete(user).where(inArray(user.id, [USER_ID, OTHER_ID]));
    await closeDb();
  });

  it("puts failed chunks that still have audio back in the queue", async () => {
    const res = await post(SESSION);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: SESSION, requeued: 1 });

    expect(await statuses(SESSION)).toEqual([
      { status: "stored", failureReason: null },
      // Nothing to transcribe any more, so it stays failed and keeps its reason.
      { status: "failed", failureReason: "LiteLLM failed with 415" },
      { status: "transcribed", failureReason: null },
    ]);
  });

  it("cannot touch somebody else's drive", async () => {
    const res = await post(OTHERS);
    expect(res.status).toBe(404);
    expect((await statuses(OTHERS))[0]!.status).toBe("failed");
  });
});
