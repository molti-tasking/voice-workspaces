/**
 * Integration tests for the guest → account upgrade.
 *
 * Runs against the local Postgres from docker-compose. Skipped automatically
 * when DATABASE_URL is absent, so CI without a database still passes.
 *
 * These exist because the failure mode is silent and total: Better Auth deletes
 * the guest user on link, every domain table cascades from `user`, and a
 * mistake here destroys recordings rather than erroring.
 */
import { config } from "dotenv";
config({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "./index";
import { isDatabaseReachable } from "./testing";
import { migrateGuestData } from "./link-guest";
import { seedStarterRepertoire } from "./seed";
import {
  audioChunk,
  capability,
  capabilityVersion,
  captureSession,
  extraction,
  invocation,
  macroProposal,
  memoryEntry,
  user,
  utterance,
  workspaceCursor,
  workspaceOp,
} from "./schema";

const GUEST_ID = "test-guest-user";
const TARGET_ID = "test-target-user";
const SESSION_ID = "00000000-0000-4000-8000-0000000000aa";

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

async function cleanup() {
  const db = getDb();
  await db.delete(user).where(inArray(user.id, [GUEST_ID, TARGET_ID]));
}

async function makeUser(id: string, isAnonymous: boolean) {
  await getDb().insert(user).values({
    id,
    name: isAnonymous ? "Guest" : "Real Person",
    email: `${id}@test.local`,
    isAnonymous,
  });
}

/** A guest who has recorded a session and used a capability. */
async function makeGuestWithHistory() {
  const db = getDb();
  await makeUser(GUEST_ID, true);
  await seedStarterRepertoire(GUEST_ID);

  await db.insert(captureSession).values({
    id: SESSION_ID,
    userId: GUEST_ID,
    startedAt: new Date(),
  });

  const [chunk] = await db
    .insert(audioChunk)
    .values({
      captureSessionId: SESSION_ID,
      seq: 0,
      startOffsetMs: 0,
      durationMs: 10_000,
      mimeType: "audio/webm",
      byteSize: 1234,
      checksum: "deadbeef",
      storageKey: "sessions/test/000000.webm",
      status: "transcribed",
    })
    .returning({ id: audioChunk.id });

  await db.insert(utterance).values({
    captureSessionId: SESSION_ID,
    chunkId: chunk!.id,
    startOffsetMs: 1000,
    endOffsetMs: 4000,
    text: "the asymmetry argument is the interesting one",
    kind: "content",
  });

  // Fire `mark` once, so it is no longer a pristine starter.
  const [mark] = await db
    .select({ id: capability.id })
    .from(capability)
    .where(and(eq(capability.userId, GUEST_ID), eq(capability.name, "mark")))
    .limit(1);

  const [markVersion] = await db
    .select({ id: capabilityVersion.id })
    .from(capabilityVersion)
    .where(eq(capabilityVersion.capabilityId, mark!.id))
    .limit(1);

  await db.insert(invocation).values({
    capabilityId: mark!.id,
    capabilityVersionId: markVersion!.id,
    captureSessionId: SESSION_ID,
    confirmed: true,
  });

  return { markId: mark!.id };
}

describeIfDb("migrateGuestData", () => {
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await closeDb();
  });

  it("moves the guest's recordings onto the real account", async () => {
    await makeGuestWithHistory();
    await makeUser(TARGET_ID, false);
    await seedStarterRepertoire(TARGET_ID);

    const result = await migrateGuestData(GUEST_ID, TARGET_ID);

    expect(result.sessionsMoved).toBe(1);

    const [session] = await getDb()
      .select({ userId: captureSession.userId })
      .from(captureSession)
      .where(eq(captureSession.id, SESSION_ID));

    expect(session?.userId).toBe(TARGET_ID);
  });

  it("survives deletion of the guest user — the whole point", async () => {
    // Better Auth deletes the anonymous user right after linking. Every domain
    // table cascades from `user`, so if migration did not run first this
    // deletion would take the recordings with it.
    await makeGuestWithHistory();
    await makeUser(TARGET_ID, false);
    await seedStarterRepertoire(TARGET_ID);

    await migrateGuestData(GUEST_ID, TARGET_ID);
    await getDb().delete(user).where(eq(user.id, GUEST_ID));

    const sessions = await getDb()
      .select({ id: captureSession.id })
      .from(captureSession)
      .where(eq(captureSession.id, SESSION_ID));
    const utterances = await getDb()
      .select({ id: utterance.id })
      .from(utterance)
      .where(eq(utterance.captureSessionId, SESSION_ID));

    expect(sessions).toHaveLength(1);
    expect(utterances).toHaveLength(1);
  });

  it("keeps the guest's used capability instead of the target's pristine starter", async () => {
    const { markId } = await makeGuestWithHistory();
    await makeUser(TARGET_ID, false);
    await seedStarterRepertoire(TARGET_ID);

    await migrateGuestData(GUEST_ID, TARGET_ID);

    const marks = await getDb()
      .select({ id: capability.id, userId: capability.userId })
      .from(capability)
      .where(and(eq(capability.userId, TARGET_ID), eq(capability.name, "mark")));

    // Exactly one `mark`, and it is the guest's — the one carrying invocations.
    expect(marks).toHaveLength(1);
    expect(marks[0]?.id).toBe(markId);
  });

  it("preserves the invocation history that the growth curve depends on", async () => {
    const { markId } = await makeGuestWithHistory();
    await makeUser(TARGET_ID, false);
    await seedStarterRepertoire(TARGET_ID);

    await migrateGuestData(GUEST_ID, TARGET_ID);
    await getDb().delete(user).where(eq(user.id, GUEST_ID));

    const invocations = await getDb()
      .select({ id: invocation.id })
      .from(invocation)
      .where(eq(invocation.capabilityId, markId));

    expect(invocations).toHaveLength(1);
  });

  it("renames rather than drops a capability the target genuinely owns", async () => {
    await makeGuestWithHistory();
    await makeUser(TARGET_ID, false);
    await seedStarterRepertoire(TARGET_ID);

    // Give the target's `mark` real history too, so it is not displaceable.
    const db = getDb();
    const [targetMark] = await db
      .select({ id: capability.id })
      .from(capability)
      .where(and(eq(capability.userId, TARGET_ID), eq(capability.name, "mark")))
      .limit(1);
    const [v] = await db
      .select({ id: capabilityVersion.id })
      .from(capabilityVersion)
      .where(eq(capabilityVersion.capabilityId, targetMark!.id))
      .limit(1);
    await db.insert(invocation).values({
      capabilityId: targetMark!.id,
      capabilityVersionId: v!.id,
      confirmed: true,
    });

    const result = await migrateGuestData(GUEST_ID, TARGET_ID);

    expect(result.renamedOnCollision).toContain("mark → mark (guest)");

    const marks = await db
      .select({ name: capability.name })
      .from(capability)
      .where(and(eq(capability.userId, TARGET_ID), inArray(capability.name, ["mark", "mark (guest)"])));

    // Both survive. Never lose a capability to a merge.
    expect(marks.map((m) => m.name).sort()).toEqual(["mark", "mark (guest)"]);
  });

  it("is a no-op when the two ids are the same", async () => {
    await makeGuestWithHistory();
    const result = await migrateGuestData(GUEST_ID, GUEST_ID);
    expect(result.sessionsMoved).toBe(0);
    expect(result.capabilitiesMoved).toBe(0);
  });

  /**
   * The tables that are not re-derivable from anything else: the workspace
   * ledger (manual board gestures especially), the extraction cache, declined
   * macro proposals and the memory index. Every one of them cascades from
   * `user`, and none of them was moved before — so the first real sign-in
   * silently destroyed exactly the data the study measures.
   */
  it("moves the workspace ledger, extractions, macro proposals and memory entries", async () => {
    const db = getDb();
    await makeGuestWithHistory();
    await makeUser(TARGET_ID, false);
    await seedStarterRepertoire(TARGET_ID);

    // An extraction the worker paid for, and the ops it appended.
    const [extractionRow] = await db
      .insert(extraction)
      .values({
        userId: GUEST_ID,
        inputHash: "test-input-hash",
        promptVersion: "4",
        requestedModel: "test-model",
        resolvedModel: "test-model",
        temperature: "0",
        stateDigest: "test-digest",
        requestMessages: [{ role: "user", content: "…" }],
        rawResponse: "{}",
      })
      .returning({ id: extraction.id });

    await db.insert(workspaceOp).values([
      {
        userId: GUEST_ID,
        extractionId: extractionRow!.id,
        captureSessionId: SESSION_ID,
        occurredAt: new Date(),
        type: "create_topic",
        payload: { id: "t1", title: "Guest topic" },
      },
      // The manual board gesture — `via: 'user'` — the acceptance measure
      // counts reversals from. Not derivable from the transcript.
      {
        userId: GUEST_ID,
        occurredAt: new Date(),
        type: "move_block",
        payload: { blockId: "b1", to: "done", via: "user" },
      },
    ]);

    await db.insert(workspaceCursor).values({
      userId: GUEST_ID,
      lastOccurredAt: new Date(),
    });

    await db.insert(macroProposal).values({
      userId: GUEST_ID,
      canonicalForm: "chase|invoice",
      proposedName: "chase the invoice",
      restatement: "Chasing the invoice.",
      markdown: "Chase the invoice.",
      sessionCount: 2,
      status: "declined",
      decidedAt: new Date(),
    });

    await db.insert(memoryEntry).values({
      userId: GUEST_ID,
      kind: "passage",
      refId: `${SESSION_ID}:0`,
      captureSessionId: SESSION_ID,
      occurredAt: new Date(),
      text: "a passage of the guest's drive",
      contentHash: "hash",
      model: "test-embed",
      embedding: [0.1, 0.2],
    });

    await migrateGuestData(GUEST_ID, TARGET_ID);
    // Better Auth deletes the guest row immediately after linking.
    await db.delete(user).where(eq(user.id, GUEST_ID));

    const ops = await db.select().from(workspaceOp).where(eq(workspaceOp.userId, TARGET_ID));
    expect(ops).toHaveLength(2);

    const [cursor] = await db
      .select()
      .from(workspaceCursor)
      .where(eq(workspaceCursor.userId, TARGET_ID));
    expect(cursor).toBeDefined();

    const extractions = await db
      .select()
      .from(extraction)
      .where(eq(extraction.userId, TARGET_ID));
    expect(extractions).toHaveLength(1);

    // Declined proposals are stated field-study data; they must survive too.
    const proposals = await db
      .select()
      .from(macroProposal)
      .where(eq(macroProposal.userId, TARGET_ID));
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.status).toBe("declined");

    const entries = await db
      .select()
      .from(memoryEntry)
      .where(eq(memoryEntry.userId, TARGET_ID));
    expect(entries).toHaveLength(1);
  });
});
