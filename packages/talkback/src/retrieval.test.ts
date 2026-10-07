/**
 * The two transcript searches against a real database: the agent's
 * (`searchTranscripts`, any word) and the person's (`searchConversations`,
 * every word, with a link to the line).
 *
 * Needs the local Postgres; skipped when it is unreachable.
 */
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(new URL("../../../.env", import.meta.url).pathname);
  } catch {
    /* No .env: the suite skips below. */
  }
}

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb, inArray } from "@voicemural/db";
import { audioChunk, captureSession, user, utterance } from "@voicemural/db/schema";
import { isDatabaseReachable } from "@voicemural/db/testing";
import { searchConversations, searchTranscripts } from "./retrieval";

const USER_ID = "test-retrieval-user";
const OTHER_ID = "test-retrieval-other";
const S1 = "00000000-0000-4000-8000-00000000e001";
const S2 = "00000000-0000-4000-8000-00000000e002";
const THEIRS = "00000000-0000-4000-8000-00000000e003";

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

async function drive(id: string, userId: string, startedAt: Date, lines: string[]): Promise<string[]> {
  const db = getDb();
  await db.insert(captureSession).values({ id, userId, startedAt });
  const [chunk] = await db
    .insert(audioChunk)
    .values({
      captureSessionId: id,
      seq: 0,
      startOffsetMs: 0,
      durationMs: 60_000,
      mimeType: "audio/webm",
      byteSize: 1,
      checksum: id,
      status: "transcribed",
    })
    .returning({ id: audioChunk.id });
  const rows = await db
    .insert(utterance)
    .values(
      lines.map((text, i) => ({
        captureSessionId: id,
        chunkId: chunk!.id,
        // Far enough apart that each line is its own window.
        startOffsetMs: i * 30_000,
        endOffsetMs: i * 30_000 + 2_000,
        text,
      })),
    )
    .returning({ id: utterance.id });
  return rows.map((r) => r.id);
}

describeIfDb("transcript search", () => {
  let lines: string[];

  beforeEach(async () => {
    const db = getDb();
    await db.delete(user).where(inArray(user.id, [USER_ID, OTHER_ID]));
    await db.insert(user).values([
      { id: USER_ID, name: "T", email: `${USER_ID}@test.local` },
      { id: OTHER_ID, name: "O", email: `${OTHER_ID}@test.local` },
    ]);
    lines = await drive(S1, USER_ID, new Date("2026-10-01T08:00:00Z"), [
      "I want to learn about research through design",
      "the design review is on Thursday",
    ]);
    await drive(S2, USER_ID, new Date("2026-10-05T08:00:00Z"), ["research methods for the field study"]);
    await drive(THEIRS, OTHER_ID, new Date(), ["research through design is theirs"]);
  });

  afterAll(async () => {
    await getDb().delete(user).where(inArray(user.id, [USER_ID, OTHER_ID]));
    await closeDb();
  });

  it("finds the person's line only when every word they typed is in it, and links to it", async () => {
    const hits = await searchConversations(USER_ID, "research design");

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      captureSessionId: S1,
      utteranceId: lines[0],
      text: "I want to learn about research through design",
    });
  });

  it("never returns another person's drives, and nothing for a query of stopwords", async () => {
    expect((await searchConversations(USER_ID, "theirs")).length).toBe(0);
    expect(await searchConversations(USER_ID, "what was the")).toEqual([]);
  });

  it("still lets the agent's search match on any one word", async () => {
    const passages = await searchTranscripts(USER_ID, "research design", { limit: 10 });
    expect(passages.length).toBe(3);
  });
});
