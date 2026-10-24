import { config } from "dotenv";
config({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });

import { inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { conversationChain, loadConversation } from "./conversation";
import { agentTurn, captureSession, driveSubject, driveSubjectSegment, subjectSignal, user } from "./schema";
import { isDatabaseReachable } from "./testing";
import { closeDb, getDb } from "./index";

const USERS = ["test-cv-a", "test-cv-b"];
// This file's own drive ids: another test file's would collide when turbo runs them in parallel.
const [D1, D2, D3, OTHER] = [
  "00000000-0000-4000-8000-0000000006c1",
  "00000000-0000-4000-8000-0000000006c2",
  "00000000-0000-4000-8000-0000000006c3",
  "00000000-0000-4000-8000-0000000006c4",
];
const T0 = new Date("2026-10-24T10:00:00Z");

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

describeIfDb("a conversation and the drives that continued it", () => {
  const db = () => getDb();

  async function clean() {
    await db().delete(captureSession).where(inArray(captureSession.id, [D1, D2, D3, OTHER]));
    await db().delete(user).where(inArray(user.id, USERS));
  }

  beforeEach(async () => {
    await clean();
    await db()
      .insert(user)
      .values(USERS.map((id) => ({ id, name: "Guest", email: `${id}@test.local`, isAnonymous: true })));
    const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
    await db().insert(captureSession).values({ id: D1, userId: "test-cv-a", startedAt: at(0), endedAt: at(5), title: "Weekend" });
    await db().insert(captureSession).values({ id: D2, userId: "test-cv-a", startedAt: at(60), continuesId: D1 });
    await db().insert(captureSession).values({ id: D3, userId: "test-cv-a", startedAt: at(120), continuesId: D2 });
    await db().insert(captureSession).values({ id: OTHER, userId: "test-cv-b", startedAt: at(0), continuesId: D3 });
  });

  afterAll(async () => {
    await clean();
    await closeDb();
  });

  it("is one chain from its first drive to its latest, whichever drive is asked for", async () => {
    expect(await conversationChain("test-cv-a", D1)).toEqual([D1, D2, D3]);
    expect(await conversationChain("test-cv-a", D2)).toEqual([D1, D2, D3]);
    expect(await conversationChain("test-cv-a", D3)).toEqual([D1, D2, D3]);
  });

  it("never reaches into somebody else's drives", async () => {
    expect(await conversationChain("test-cv-b", D1)).toEqual([]);
    // Their drive claims to continue ours: it is theirs alone.
    expect(await conversationChain("test-cv-b", OTHER)).toEqual([OTHER]);
    expect(await loadConversation("test-cv-b", D2)).toBeNull();
  });

  it("reads every drive's lines, subject visits and judgements", async () => {
    await db()
      .insert(agentTurn)
      .values({ captureSessionId: D1, seq: 0, startOffsetMs: 1000, endOffsetMs: 3000, text: "Aarhus or Skagen?", generatedText: "Aarhus or Skagen?" });
    const [subject] = await db()
      .insert(driveSubject)
      .values({ captureSessionId: D1, ordinal: 1, title: "Destinations", firstOffsetMs: 500 })
      .returning({ id: driveSubject.id });
    await db().insert(driveSubjectSegment).values({ driveSubjectId: subject!.id, startOffsetMs: 500 });
    await db().insert(subjectSignal).values({
      driveSubjectId: subject!.id,
      userWords: 3,
      agentWords: 3,
      pauses: 0,
      fillers: 0,
      selfRepairs: 0,
      hedges: 0,
      fade: 0,
      settled: true,
      kept: true,
    });

    const drives = await loadConversation("test-cv-a", D3);
    expect(drives?.map((d) => d.id)).toEqual([D1, D2, D3]);
    expect(drives?.[0]?.title).toBe("Weekend");
    expect(drives?.[0]?.lines.map((l) => [l.who, l.text])).toEqual([["agent", "Aarhus or Skagen?"]]);
    expect(drives?.[0]?.visits).toEqual([{ ordinal: 1, title: "Destinations", startMs: 500, endMs: null }]);
    expect(drives?.[0]?.subjects).toEqual([{ ordinal: 1, settled: true, kept: true }]);
    expect(drives?.[1]?.lines).toEqual([]);
  });
});
