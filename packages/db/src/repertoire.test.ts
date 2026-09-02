/**
 * Integration tests for the repertoire's writes.
 *
 * These exist because the interesting properties are all guarantees about SQL
 * rather than about TypeScript: that filling `utterance.kind` cannot run twice,
 * that a declined macro is never offered again, that accepting one writes the
 * capability, its first version and its origin together or not at all. None of
 * that is observable without a real database.
 *
 * Skipped when Postgres is unreachable — so check the counts, not the colour.
 */
import { config } from "dotenv";
config({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { closeDb, getDb } from "./index";
import { isDatabaseReachable } from "./testing";
import {
  acceptMacroProposal,
  capabilityNames,
  chunksWithUnclassifiedUtterances,
  declineMacroProposal,
  directivesAwaitingInvocation,
  existingCanonicalForms,
  invocationStats,
  loadRepertoire,
  pendingConfirmation,
  proposeMacro,
  recordClassifications,
  recordInvocation,
  settleInvocation,
  unresolvedDirectives,
} from "./repertoire";
import {
  audioChunk,
  capability,
  capabilityOrigin,
  capabilityVersion,
  captureSession,
  user,
  utterance,
} from "./schema";

const USER_ID = "test-repertoire-user";
const SESSION_A = "00000000-0000-4000-8000-0000000000d1";
const SESSION_B = "00000000-0000-4000-8000-0000000000d2";
const CHUNK_A = "00000000-0000-4000-8000-0000000000da";
const CHUNK_B = "00000000-0000-4000-8000-0000000000db";

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

async function cleanup() {
  await getDb().delete(user).where(inArray(user.id, [USER_ID]));
}

async function seed() {
  const db = getDb();
  await db.insert(user).values({ id: USER_ID, name: "T", email: `${USER_ID}@test.local` });

  for (const [session, chunk, offset] of [
    [SESSION_A, CHUNK_A, 0],
    [SESSION_B, CHUNK_B, 0],
  ] as const) {
    await db.insert(captureSession).values({
      id: session,
      userId: USER_ID,
      startedAt: new Date("2026-03-01T08:00:00Z"),
    });
    await db.insert(audioChunk).values({
      id: chunk,
      captureSessionId: session,
      seq: 0,
      startOffsetMs: offset,
      durationMs: 10_000,
      mimeType: "audio/webm",
      byteSize: 1,
      checksum: "x",
      status: "transcribed",
    });
  }
}

async function addUtterance(id: string, session: string, chunk: string, text: string, at: number) {
  await getDb().insert(utterance).values({
    id,
    captureSessionId: session,
    chunkId: chunk,
    startOffsetMs: at,
    endOffsetMs: at + 1000,
    text,
  });
}

async function addCapability(
  id: string,
  name: string,
  params: Record<string, unknown>,
): Promise<string> {
  const db = getDb();
  await db.insert(capability).values({ id, userId: USER_ID, type: "action", name });
  const [version] = await db
    .insert(capabilityVersion)
    .values({ capabilityId: id, version: 1, markdown: `# ${name}`, params, restatement: name })
    .returning({ id: capabilityVersion.id });
  return version!.id;
}

const U = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
const C = (n: number) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`;

describeIfDb("repertoire", () => {
  beforeEach(async () => {
    await cleanup();
    await seed();
  });

  afterAll(async () => {
    await cleanup();
    await closeDb();
  });

  it("finds chunks holding unclassified speech, and forgets them once filled", async () => {
    await addUtterance(U(1), SESSION_A, CHUNK_A, "Mark that.", 0);
    expect((await chunksWithUnclassifiedUtterances()).map((c) => c.chunkId)).toContain(CHUNK_A);

    await recordClassifications([
      {
        utteranceId: U(1),
        captureSessionId: SESSION_A,
        kind: "content",
        confidence: 40,
      },
    ]);
    expect((await chunksWithUnclassifiedUtterances()).map((c) => c.chunkId)).not.toContain(CHUNK_A);
  });

  /**
   * The guard that lets the classifier write to an append-only ledger at all.
   * A second run must be a no-op, not a correction — otherwise two workers
   * racing would leave a verdict that depends on which finished last.
   */
  it("fills `kind` once and refuses to change it", async () => {
    await addUtterance(U(2), SESSION_A, CHUNK_A, "Mark that.", 0);

    const first = await recordClassifications([
      {
        utteranceId: U(2),
        captureSessionId: SESSION_A,
        kind: "directive",
        confidence: 90,
        verb: "mark",
        object: "that",
        restatement: "Marking that.",
      },
    ]);
    expect(first).toBe(1);

    const second = await recordClassifications([
      { utteranceId: U(2), captureSessionId: SESSION_A, kind: "content", confidence: 10 },
    ]);
    expect(second).toBe(0);

    const [row] = await getDb().select().from(utterance).where(inArray(utterance.id, [U(2)]));
    expect(row?.kind).toBe("directive");
    expect(row?.kindConfidence).toBe(90);
    expect(row?.text).toBe("Mark that.");
  });

  it("does not write a second directive row when it loses the race", async () => {
    await addUtterance(U(3), SESSION_A, CHUNK_A, "Note that.", 0);
    const write = {
      utteranceId: U(3),
      captureSessionId: SESSION_A,
      kind: "directive" as const,
      confidence: 80,
      verb: "note",
      restatement: "Noting that.",
    };
    await recordClassifications([write]);
    await recordClassifications([write]);
    expect(await unresolvedDirectives(USER_ID, new Date(0))).toHaveLength(1);
  });

  it("leaves an unresolved direction for the macro detector", async () => {
    await addUtterance(U(4), SESSION_A, CHUNK_A, "Chase that up.", 0);
    await recordClassifications([
      {
        utteranceId: U(4),
        captureSessionId: SESSION_A,
        kind: "directive",
        confidence: 70,
        verb: "chase",
        object: "that",
        restatement: "Chasing it up.",
      },
    ]);
    const unresolved = await unresolvedDirectives(USER_ID, new Date(0));
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.verb).toBe("chase");
    expect(unresolved[0]?.text).toBe("Chase that up.");
    // Nothing to invoke: an improvised operation has no capability behind it.
    expect(await directivesAwaitingInvocation()).toHaveLength(0);
  });

  it("queues a resolved direction for invocation, then stops once it has one", async () => {
    const versionId = await addCapability(C(1), "mark", { reversible: true, confirm: false });
    await addUtterance(U(5), SESSION_A, CHUNK_A, "Mark that.", 0);
    await recordClassifications([
      {
        utteranceId: U(5),
        captureSessionId: SESSION_A,
        kind: "directive",
        confidence: 90,
        verb: "mark",
        restatement: "Marking that.",
        capabilityId: C(1),
      },
    ]);

    expect(await directivesAwaitingInvocation()).toHaveLength(1);
    await recordInvocation({
      capabilityId: C(1),
      capabilityVersionId: versionId,
      captureSessionId: SESSION_A,
      triggeringUtteranceId: U(5),
      confirmed: true,
    });
    expect(await directivesAwaitingInvocation()).toHaveLength(0);

    const [stat] = await invocationStats(USER_ID);
    expect(stat).toMatchObject({ capabilityId: C(1), fires: 1 });
  });

  it("parks an outbound action and surfaces it as a pending confirmation", async () => {
    const versionId = await addCapability(C(2), "to-doc", { reversible: false, confirm: true });
    await addUtterance(U(6), SESSION_A, CHUNK_A, "Send that to the doc.", 0);
    await recordClassifications([
      {
        utteranceId: U(6),
        captureSessionId: SESSION_A,
        kind: "directive",
        confidence: 85,
        verb: "send",
        restatement: "Sending it to the doc.",
        capabilityId: C(2),
      },
    ]);
    const invocationId = await recordInvocation({
      capabilityId: C(2),
      capabilityVersionId: versionId,
      captureSessionId: SESSION_A,
      triggeringUtteranceId: U(6),
      confirmed: null,
    });

    expect(await pendingConfirmation(SESSION_A)).toMatchObject({
      invocationId,
      restatement: "Sending it to the doc.",
    });

    // A refusal settles it and is kept, not deleted: a capability someone keeps
    // declining is a finding.
    await settleInvocation(invocationId!, false);
    expect(await pendingConfirmation(SESSION_A)).toBeNull();
    expect((await invocationStats(USER_ID))[0]?.fires).toBe(1);
  });

  it("lists live capability names for the classifier's vocabulary", async () => {
    await addCapability(C(3), "mark", { reversible: true, confirm: false });
    expect(await capabilityNames(USER_ID)).toEqual(["mark"]);
    expect(await loadRepertoire(USER_ID)).toHaveLength(1);
  });
});

describeIfDb("macro proposals", () => {
  beforeEach(async () => {
    await cleanup();
    await seed();
  });

  afterAll(async () => {
    await cleanup();
    await closeDb();
  });

  const proposal = {
    userId: USER_ID,
    canonicalForm: "chase|invoice",
    occurrences: [
      {
        utteranceId: U(9),
        captureSessionId: SESSION_A,
        text: "Chase the invoice.",
        occurredAt: new Date().toISOString(),
      },
    ],
    sessionCount: 2,
    proposedName: "chase",
    restatement: "Chases up anything you flagged.",
    markdown: "# chase",
    params: { reversible: true, confirm: false },
  };

  it("offers a form once, however often the detector runs", async () => {
    expect(await proposeMacro(proposal)).toBeTruthy();
    expect(await proposeMacro(proposal)).toBeNull();
    expect(await existingCanonicalForms(USER_ID)).toContain("chase|invoice");
  });

  it("writes capability, first version and origin together on acceptance", async () => {
    const id = await proposeMacro(proposal);
    const accepted = await acceptMacroProposal(USER_ID, id!);
    expect(accepted?.name).toBe("chase");

    const db = getDb();
    const [cap] = await db
      .select()
      .from(capability)
      .where(inArray(capability.id, [accepted!.capabilityId]));
    const versions = await db
      .select()
      .from(capabilityVersion)
      .where(inArray(capabilityVersion.capabilityId, [accepted!.capabilityId]));
    const [origin] = await db
      .select()
      .from(capabilityOrigin)
      .where(inArray(capabilityOrigin.capabilityId, [accepted!.capabilityId]));

    expect(cap?.type).toBe("action");
    expect(versions).toHaveLength(1);
    expect(versions[0]?.version).toBe(1);
    expect(origin?.createdVia).toBe("crystallisation");
    expect(origin?.triggeringSessionId).toBe(SESSION_A);
  });

  it("suffixes rather than failing when the name is already taken", async () => {
    await addCapability(C(4), "chase", { reversible: true, confirm: false });
    const id = await proposeMacro(proposal);
    expect((await acceptMacroProposal(USER_ID, id!))?.name).toBe("chase-2");
  });

  it("accepts a proposal exactly once", async () => {
    const id = await proposeMacro(proposal);
    expect(await acceptMacroProposal(USER_ID, id!)).not.toBeNull();
    expect(await acceptMacroProposal(USER_ID, id!)).toBeNull();
  });

  /**
   * A declined proposal stays in the table. Two reasons, and both matter: the
   * detector must never re-offer it, and "what they tried to add and failed" is
   * a stated field-study measure that only exists if refusals survive.
   */
  it("keeps a declined proposal so it is neither re-offered nor forgotten", async () => {
    const id = await proposeMacro(proposal);
    expect(await declineMacroProposal(USER_ID, id!)).toBe(true);
    expect(await declineMacroProposal(USER_ID, id!)).toBe(false);
    expect(await acceptMacroProposal(USER_ID, id!)).toBeNull();
    expect(await existingCanonicalForms(USER_ID)).toContain("chase|invoice");
  });
});
