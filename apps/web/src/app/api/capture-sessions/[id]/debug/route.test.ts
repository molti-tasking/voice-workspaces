/**
 * The debug export is a whole conversation in plain text, so it must be the
 * owner's only. Needs the local Postgres; skipped when it is unreachable.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const OWNER = "test-debug-export-owner";
const OTHER = "test-debug-export-other";
const SESSION_ID = "00000000-0000-4000-8000-0000000deb01";
let signedIn = OWNER;

vi.mock("@/lib/session", () => ({ currentUserId: async () => signedIn }));

const { agentTurn, closeDb, getDb, inArray } = await import("@voicemural/db");
const { audioChunk, captureSession, user, utterance } = await import("@voicemural/db/schema");
const { isDatabaseReachable } = await import("@voicemural/db/testing");
const { GET } = await import("./route");

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

const get = () => GET(new Request("http://test"), { params: Promise.resolve({ id: SESSION_ID }) });

describeIfDb("GET /api/capture-sessions/[id]/debug", () => {
  beforeEach(async () => {
    signedIn = OWNER;
    const db = getDb();
    await db.delete(user).where(inArray(user.id, [OWNER, OTHER]));
    await db.insert(user).values([
      { id: OWNER, name: "O", email: `${OWNER}@test.local` },
      { id: OTHER, name: "X", email: `${OTHER}@test.local` },
    ]);
    await db.insert(captureSession).values({ id: SESSION_ID, userId: OWNER, startedAt: new Date(), title: "Workshop" });
    const [chunk] = await db
      .insert(audioChunk)
      .values({
        captureSessionId: SESSION_ID,
        seq: 0,
        startOffsetMs: 0,
        durationMs: 10_000,
        mimeType: "audio/webm",
        byteSize: 1,
        checksum: SESSION_ID,
        status: "transcribed",
      })
      .returning({ id: audioChunk.id });
    await db.insert(utterance).values({
      captureSessionId: SESSION_ID,
      chunkId: chunk!.id,
      startOffsetMs: 10_000,
      endOffsetMs: 12_000,
      text: "What should we talk about?",
    });
    await db.insert(agentTurn).values({
      captureSessionId: SESSION_ID,
      seq: 0,
      startOffsetMs: 14_000,
      endOffsetMs: 16_000,
      text: "Let's start simple.",
      generatedText: "Let's start simple.",
      respondingToText: "Mitä luulet?",
      configVersion: "realtime-1",
    });
  });
  afterAll(async () => {
    await getDb().delete(user).where(inArray(user.id, [OWNER, OTHER]));
    await closeDb();
  });

  it("gives the owner the conversation as text", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const text = await res.text();
    expect(text).toContain("[0:10] You: What should we talk about?");
    expect(text).toContain("answering the live transcript: «Mitä luulet?»");
  });

  it("gives anyone else nothing", async () => {
    signedIn = OTHER;
    expect((await get()).status).toBe(404);
  });
});
