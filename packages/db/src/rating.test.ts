/**
 * What a rating exchange does to the transcript everything else is derived from.
 *
 * The probe's own correctness is tested in Python (`test_bot.py`); this is the
 * half that cannot be: the capture ledger records "hey, rate this", the number
 * that answers it, and the probe's two lines coming back through the
 * microphone, because the recorder is never told to look away. So extraction
 * has to leave them out on READ — and the only way to know it does is to put
 * an utterance inside a window and ask the loader.
 *
 * The failure this exists to catch is quiet and permanent: a task called
 * "three" on somebody's board, weeks later, with nothing in the transcript to
 * explain it.
 *
 * Skipped when Postgres is unreachable — so check the counts, not the colour.
 */
import { config } from "dotenv";
config({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { audioChunk, captureSession, interactionRating, user, utterance } from "./schema";
import { isDatabaseReachable } from "./testing";
import { loadAllSegments, loadPendingSegments } from "./workspace";
import { closeDb, eq, getDb } from "./index";

const USER_ID = "test-rating-user";
const SESSION_ID = "00000000-0000-4000-8000-0000000000a1";

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

/** A drive with one line before the probe, one inside it, and one after. */
async function seed() {
  const db = getDb();
  await db.delete(user).where(eq(user.id, USER_ID));
  await db.insert(user).values({ id: USER_ID, name: "R", email: `${USER_ID}@test.local` });
  await db.insert(captureSession).values({
    id: SESSION_ID,
    userId: USER_ID,
    startedAt: new Date("2026-09-15T08:00:00Z"),
  });

  const lines: [number, string][] = [
    [10_000, "I need to email William about the ethics form."],
    // Inside the exchange: the trigger, the answer, and the car's own question
    // coming back through the microphone.
    [30_000, "Hey, rate this."],
    [31_000, "How was that? One to five."],
    [34_000, "Three."],
    [36_000, "Three. Noted."],
    // After it. A second and a half of padding either side must not reach this.
    [45_000, "Anyway, the deadline is Tuesday."],
  ];

  for (const [seq, [offset, text]] of lines.entries()) {
    // One chunk per line: `utterance.chunkId` is not null, because every line
    // in the ledger came from a piece of audio that is still on disk.
    const [chunk] = await db
      .insert(audioChunk)
      .values({
        captureSessionId: SESSION_ID,
        seq,
        startOffsetMs: offset,
        durationMs: 2_000,
        mimeType: "audio/webm",
        byteSize: 100,
        checksum: `sum-${seq}`,
        status: "transcribed",
      })
      .returning({ id: audioChunk.id });

    await db.insert(utterance).values({
      captureSessionId: SESSION_ID,
      chunkId: chunk!.id,
      startOffsetMs: offset,
      endOffsetMs: offset + 2_000,
      text,
      kind: "content",
    });
  }
}

async function recordProbe(over: Partial<{ asked: number; ended: number }> = {}) {
  await getDb().insert(interactionRating).values({
    captureSessionId: SESSION_ID,
    seq: 0,
    askedOffsetMs: over.asked ?? 29_500,
    answeredOffsetMs: 34_000,
    endedOffsetMs: over.ended ?? 37_000,
    rating: 3,
    outcome: "rated",
  });
}

describeIfDb("a rating exchange, seen from extraction", () => {
  beforeEach(seed);

  afterAll(async () => {
    await getDb().delete(user).where(eq(user.id, USER_ID));
    await closeDb();
  });

  it("leaves the whole exchange to the probe and passes everything else through", async () => {
    await recordProbe();
    const segments = await loadPendingSegments(USER_ID);

    // Nothing is deleted: the verbatim ledger is untouched and the session page
    // still shows every line.
    expect(segments).toHaveLength(6);

    const withheld = segments.filter((s) => s.handledElsewhere).map((s) => s.text);
    expect(withheld).toEqual([
      "Hey, rate this.",
      "How was that? One to five.",
      "Three.",
      "Three. Noted.",
    ]);

    // Both halves matter: extraction withholds a segment only when it is a
    // direction AND something else handled it.
    expect(segments.filter((s) => s.handledElsewhere).every((s) => s.kind === "directive")).toBe(true);
  });

  it("does not reach the speech either side of the window", async () => {
    await recordProbe();
    const segments = await loadPendingSegments(USER_ID);
    const kept = segments.filter((s) => !s.handledElsewhere).map((s) => s.text);
    expect(kept).toEqual([
      "I need to email William about the ethics form.",
      "Anyway, the deadline is Tuesday.",
    ]);
  });

  it("withholds nothing on a drive where nobody asked to rate", async () => {
    const segments = await loadPendingSegments(USER_ID);
    expect(segments.some((s) => s.handledElsewhere)).toBe(false);
  });

  it("withholds the same speech on a rebuild, which reads every segment again", async () => {
    await recordProbe();
    const all = await loadAllSegments(USER_ID);
    // `workspace:rebuild` re-reads the whole transcript. If this path withheld
    // less than the live one, a rebuild would put the ratings back.
    expect(all.filter((s) => s.handledElsewhere).map((s) => s.text)).toEqual([
      "Hey, rate this.",
      "How was that? One to five.",
      "Three.",
      "Three. Noted.",
    ]);
  });

  it("still covers the exchange when the probe timed out with no answer", async () => {
    await getDb().insert(interactionRating).values({
      captureSessionId: SESSION_ID,
      seq: 0,
      askedOffsetMs: 29_500,
      endedOffsetMs: 37_000,
      outcome: "timeout",
    });

    const segments = await loadPendingSegments(USER_ID);
    // The window is the window. A probe nobody answered still put a question
    // through the speaker, and that question is in the ledger.
    expect(segments.filter((s) => s.handledElsewhere)).toHaveLength(4);
  });
});
