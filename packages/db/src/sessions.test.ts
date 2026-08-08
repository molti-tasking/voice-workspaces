/**
 * Regression tests for the sessions-list aggregate.
 *
 * The bug these exist for was silent, type-safe, and produced perfectly valid
 * SQL: every session reported 0 chunks / 0 utterances while the data was
 * intact. Nothing short of asserting real numbers against a real database
 * would have caught it.
 */
import { config } from "dotenv";
config({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "./index";
import { isDatabaseReachable } from "./testing";
import { listSessionsWithStats } from "./sessions";
import { loadTimelineSessions } from "./workspace";
import { audioChunk, captureSession, user, utterance } from "./schema";

const USER_ID = "test-stats-user";
const OTHER_ID = "test-stats-other";
const S1 = "00000000-0000-4000-8000-0000000000b1";
const S2 = "00000000-0000-4000-8000-0000000000b2";
const S3 = "00000000-0000-4000-8000-0000000000b3";

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

async function cleanup() {
  await getDb().delete(user).where(inArray(user.id, [USER_ID, OTHER_ID]));
}

async function makeUser(id: string) {
  await getDb()
    .insert(user)
    .values({ id, name: "Test", email: `${id}@test.local` });
}

/** One session with `chunkCount` chunks, each carrying `perChunk` utterances. */
async function makeSession(
  sessionId: string,
  userId: string,
  chunkCount: number,
  perChunk: number,
  durationMs = 10_000,
  status: "stored" | "transcribed" = "transcribed",
) {
  const db = getDb();
  await db.insert(captureSession).values({
    id: sessionId,
    userId,
    startedAt: new Date(),
  });

  for (let seq = 0; seq < chunkCount; seq += 1) {
    const [chunk] = await db
      .insert(audioChunk)
      .values({
        captureSessionId: sessionId,
        seq,
        startOffsetMs: seq * durationMs,
        durationMs,
        mimeType: "audio/webm",
        byteSize: 100,
        checksum: `sum-${seq}`,
        storageKey: null,
        status,
      })
      .returning({ id: audioChunk.id });

    for (let u = 0; u < perChunk; u += 1) {
      await db.insert(utterance).values({
        captureSessionId: sessionId,
        chunkId: chunk!.id,
        startOffsetMs: seq * durationMs + u * 100,
        endOffsetMs: seq * durationMs + u * 100 + 50,
        text: `utterance ${seq}-${u}`,
      });
    }
  }
}

describeIfDb("listSessionsWithStats", () => {
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await closeDb();
  });

  it("counts chunks and utterances, and sums recorded time", async () => {
    await makeUser(USER_ID);
    await makeSession(S1, USER_ID, 4, 2, 10_000);

    const [session] = await listSessionsWithStats(USER_ID);

    expect(session?.chunkCount).toBe(4);
    expect(session?.utteranceCount).toBe(8);
    expect(session?.recordedMs).toBe(40_000);
  });

  it("does not multiply recorded time by the utterance count", async () => {
    // The cartesian-product bug: 3 chunks × 5 utterances each would report
    // 150_000ms instead of 30_000ms.
    await makeUser(USER_ID);
    await makeSession(S1, USER_ID, 3, 5, 10_000);

    const [session] = await listSessionsWithStats(USER_ID);

    expect(session?.recordedMs).toBe(30_000);
    expect(session?.utteranceCount).toBe(15);
  });

  it("attributes stats to the right session when several exist", async () => {
    // The unqualified-column bug returned zeros everywhere; a cross-join style
    // mistake would instead smear one session's totals across all of them.
    await makeUser(USER_ID);
    await makeSession(S1, USER_ID, 2, 1, 10_000);
    await makeSession(S2, USER_ID, 5, 3, 4_000);

    const sessions = await listSessionsWithStats(USER_ID);
    const byId = new Map(sessions.map((s) => [s.id, s]));

    expect(byId.get(S1)?.chunkCount).toBe(2);
    expect(byId.get(S1)?.utteranceCount).toBe(2);
    expect(byId.get(S1)?.recordedMs).toBe(20_000);

    expect(byId.get(S2)?.chunkCount).toBe(5);
    expect(byId.get(S2)?.utteranceCount).toBe(15);
    expect(byId.get(S2)?.recordedMs).toBe(20_000);
  });

  it("reports zeros for a session with no chunks yet", async () => {
    await makeUser(USER_ID);
    await getDb()
      .insert(captureSession)
      .values({ id: S3, userId: USER_ID, startedAt: new Date() });

    const [session] = await listSessionsWithStats(USER_ID);

    expect(session?.chunkCount).toBe(0);
    expect(session?.recordedMs).toBe(0);
    expect(session?.utteranceCount).toBe(0);
  });

  it("counts only chunks that are not yet transcribed as pending", async () => {
    await makeUser(USER_ID);
    await makeSession(S1, USER_ID, 3, 1, 10_000, "stored");
    await getDb()
      .update(audioChunk)
      .set({ status: "transcribed" })
      .where(eq(audioChunk.seq, 0));

    const [session] = await listSessionsWithStats(USER_ID);

    expect(session?.chunkCount).toBe(3);
    expect(session?.pendingChunks).toBe(2);
  });

  it("never leaks another user's sessions", async () => {
    await makeUser(USER_ID);
    await makeUser(OTHER_ID);
    await makeSession(S1, USER_ID, 1, 1);
    await makeSession(S2, OTHER_ID, 9, 9);

    const sessions = await listSessionsWithStats(USER_ID);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).toBe(S1);
  });

  it("returns an empty list for a user with no sessions", async () => {
    await makeUser(USER_ID);
    expect(await listSessionsWithStats(USER_ID)).toEqual([]);
  });
});

describeIfDb("loadTimelineSessions", () => {
  beforeEach(cleanup);

  it("returns sessions oldest-first with real counts", async () => {
    // Guards the drizzle projection trap a second time: this once returned an
    // empty list because a correlated subquery reported 0 utterances for every
    // session, so the `> 0` filter discarded all of them.
    await makeUser(USER_ID);
    await makeSession(S1, USER_ID, 2, 3);
    await makeSession(S2, USER_ID, 1, 1);

    const timeline = await loadTimelineSessions(USER_ID);

    expect(timeline.length).toBe(2);
    expect(timeline.every((s) => s.utteranceCount > 0)).toBe(true);
    expect(timeline[0]!.startedAt.getTime()).toBeLessThanOrEqual(
      timeline[1]!.startedAt.getTime(),
    );
  });

  it("omits sessions that recorded nothing", async () => {
    await makeUser(USER_ID);
    await getDb()
      .insert(captureSession)
      .values({ id: S3, userId: USER_ID, startedAt: new Date() });

    expect(await loadTimelineSessions(USER_ID)).toEqual([]);
  });
});
