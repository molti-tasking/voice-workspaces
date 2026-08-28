/**
 * Tests for the session-completion reporter.
 *
 * The property that matters is exactly-once. `capture_session_completed` is the
 * conversion event for a study whose whole subject is how often people record,
 * so a duplicate inflates the finding and a miss hides it — and neither is
 * visible afterwards by looking at PostHog, because there is nothing to compare
 * against.
 *
 * These run against a real Postgres because the guarantee lives in a single
 * UPDATE ... RETURNING claiming rows, which is precisely the part a mock cannot
 * check.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../.env", import.meta.url).pathname, quiet: true });

import { inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, getDb } from "@voicemural/db";
import { isDatabaseReachable } from "@voicemural/db/testing";
import { audioChunk, captureSession, user, utterance } from "@voicemural/db/schema";

const captured: { event: string; distinctId: string; properties: Record<string, unknown> }[] = [];

vi.mock("@voicemural/telemetry", () => ({
  capture: (distinctId: string, event: string, properties: Record<string, unknown>) => {
    captured.push({ distinctId, event, properties });
  },
  setPersonProperties: () => {},
  log: { info: () => {}, warn: () => {}, error: () => {} },
}));

const { reportCompletedSessions } = await import("./sweep");

const USER_ID = "test-report-user";
const S_CLIENT = "00000000-0000-4000-8000-0000000000d1";
const S_SWEEP = "00000000-0000-4000-8000-0000000000d2";
const S_RECENT = "00000000-0000-4000-8000-0000000000d3";
const S_OPEN = "00000000-0000-4000-8000-0000000000d4";
const S_PENDING = "00000000-0000-4000-8000-0000000000d5";

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

const HOUR_AGO = () => new Date(Date.now() - 60 * 60 * 1000);
const MINUTES_AGO = (n: number) => new Date(Date.now() - n * 60 * 1000);

async function makeSession(
  id: string,
  opts: {
    endedAt: Date | null;
    endedBy?: "client" | "idle_sweep";
    chunkStatus?: "stored" | "transcribed" | "failed";
    chunks?: number;
  },
) {
  const db = getDb();
  await db.insert(captureSession).values({
    id,
    userId: USER_ID,
    startedAt: HOUR_AGO(),
    endedAt: opts.endedAt,
    endedBy: opts.endedBy,
  });

  for (let seq = 0; seq < (opts.chunks ?? 1); seq += 1) {
    const [chunk] = await db
      .insert(audioChunk)
      .values({
        captureSessionId: id,
        seq,
        startOffsetMs: seq * 10_000,
        durationMs: 10_000,
        mimeType: "audio/webm",
        byteSize: 1000,
        checksum: `test-${id}-${seq}`,
        status: opts.chunkStatus ?? "transcribed",
      })
      .returning({ id: audioChunk.id });

    await db.insert(utterance).values({
      captureSessionId: id,
      chunkId: chunk!.id,
      startOffsetMs: seq * 10_000,
      endOffsetMs: seq * 10_000 + 5_000,
      text: "hello",
      kind: "unclassified",
    });
  }
}

describeIfDb("reportCompletedSessions", () => {
  beforeEach(async () => {
    captured.length = 0;
    await getDb().delete(user).where(inArray(user.id, [USER_ID]));
    await getDb()
      .insert(user)
      .values({ id: USER_ID, name: "Test", email: `${USER_ID}@test.local` });
  });

  afterAll(async () => {
    await getDb().delete(user).where(inArray(user.id, [USER_ID]));
    await closeDb();
  });

  it("reports a drive that ended via the explicit /end call", async () => {
    // The case closeIdleSessions can never surface: it filters on endedAt being
    // null, so hanging analytics off it would drop every clean finish and bias
    // the whole dataset towards drives that ended in a dead zone.
    await makeSession(S_CLIENT, { endedAt: MINUTES_AGO(30), endedBy: "client" });

    expect(await reportCompletedSessions()).toBe(1);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.event).toBe("capture_session_completed");
    expect(captured[0]!.properties.closed_by).toBe("client");
    expect(captured[0]!.properties.capture_session_id).toBe(S_CLIENT);
  });

  it("reports a drive closed by the idle sweep", async () => {
    await makeSession(S_SWEEP, { endedAt: MINUTES_AGO(30), endedBy: "idle_sweep" });

    expect(await reportCompletedSessions()).toBe(1);
    expect(captured[0]!.properties.closed_by).toBe("idle_sweep");
  });

  it("never reports the same session twice", async () => {
    await makeSession(S_CLIENT, { endedAt: MINUTES_AGO(30), endedBy: "client" });

    expect(await reportCompletedSessions()).toBe(1);
    expect(await reportCompletedSessions()).toBe(0);
    expect(await reportCompletedSessions()).toBe(0);
    expect(captured).toHaveLength(1);
  });

  it("waits out the settle window before reporting", async () => {
    // A session that ended five minutes ago may still have chunks in flight
    // from a phone that has only just regained signal; reporting now would
    // publish counts for a half-uploaded drive.
    await makeSession(S_RECENT, { endedAt: MINUTES_AGO(5), endedBy: "client" });

    expect(await reportCompletedSessions()).toBe(0);
    expect(captured).toHaveLength(0);
  });

  it("ignores sessions that are still open", async () => {
    await makeSession(S_OPEN, { endedAt: null });

    expect(await reportCompletedSessions()).toBe(0);
  });

  it("holds back a session whose chunks have not finished transcribing", async () => {
    await makeSession(S_PENDING, {
      endedAt: MINUTES_AGO(30),
      endedBy: "client",
      chunkStatus: "stored",
    });

    expect(await reportCompletedSessions()).toBe(0);
    expect(captured).toHaveLength(0);
  });

  it("carries the real counts and the time the drive actually ended", async () => {
    const endedAt = MINUTES_AGO(30);
    await makeSession(S_CLIENT, { endedAt, endedBy: "client", chunks: 3 });

    await reportCompletedSessions();

    const props = captured[0]!.properties;
    expect(props.chunk_count).toBe(3);
    expect(props.utterance_count).toBe(3);
    expect(props.duration_ms).toBe(30_000);
    expect(props.failed_chunk_count).toBe(0);
    expect(captured[0]!.distinctId).toBe(USER_ID);
  });
});
