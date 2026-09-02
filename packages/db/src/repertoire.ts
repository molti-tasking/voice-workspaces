/**
 * The repertoire, and the directions that reach it.
 *
 * Queries only. The pure logic — what counts as a direction, what a recurring
 * operation looks like — lives in @voicemural/shared and @voicemural/workspace,
 * so it can be tested without a database.
 */
import { and, asc, count, desc, eq, gte, inArray, isNull, max, sql } from "drizzle-orm";
import { getDb } from "./index";
import {
  audioChunk,
  capability,
  capabilityOrigin,
  capabilityVersion,
  captureSession,
  directive,
  invocation,
  macroProposal,
  utterance,
} from "./schema";

/* ---------------------------------------------------------------------------
 * The repertoire
 * ------------------------------------------------------------------------- */

export interface LoadedCapability {
  id: string;
  type: "mode" | "persona" | "action" | "rule";
  name: string;
  versionId: string;
  version: number;
  markdown: string;
  params: Record<string, unknown>;
  restatement: string | null;
  retiredAt: Date | null;
}

/**
 * A user's live capabilities, each at its newest version.
 *
 * `capability_version` is append-only, so "the current one" is a max over
 * versions rather than a flag — which is what makes an edit measurable instead
 * of destructive. Retired capabilities are excluded here and kept in the table;
 * `listRepertoire` includes them, because "which survived" needs the tombstone.
 */
export async function loadRepertoire(
  userId: string,
  opts: { includeRetired?: boolean } = {},
): Promise<LoadedCapability[]> {
  const db = getDb();

  const newest = db
    .select({
      capabilityId: capabilityVersion.capabilityId,
      version: max(capabilityVersion.version).as("version"),
    })
    .from(capabilityVersion)
    .groupBy(capabilityVersion.capabilityId)
    .as("newest");

  const rows = await db
    .select({
      id: capability.id,
      type: capability.type,
      name: capability.name,
      retiredAt: capability.retiredAt,
      versionId: capabilityVersion.id,
      version: capabilityVersion.version,
      markdown: capabilityVersion.markdown,
      params: capabilityVersion.params,
      restatement: capabilityVersion.restatement,
    })
    .from(capability)
    .innerJoin(newest, eq(newest.capabilityId, capability.id))
    .innerJoin(
      capabilityVersion,
      and(
        eq(capabilityVersion.capabilityId, capability.id),
        eq(capabilityVersion.version, newest.version),
      ),
    )
    .where(
      opts.includeRetired
        ? eq(capability.userId, userId)
        : and(eq(capability.userId, userId), isNull(capability.retiredAt)),
    )
    .orderBy(asc(capability.type), asc(capability.name));

  return rows.map((r) => ({ ...r, retiredAt: r.retiredAt ?? null }));
}

/** Just the names, for the classifier's vocabulary and the directive gate. */
export async function capabilityNames(userId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ name: capability.name })
    .from(capability)
    .where(and(eq(capability.userId, userId), isNull(capability.retiredAt)));
  return rows.map((r) => r.name);
}

/* ---------------------------------------------------------------------------
 * Classification
 * ------------------------------------------------------------------------- */

export interface UnclassifiedChunk {
  chunkId: string;
  userId: string;
}

/**
 * Chunks still holding unclassified speech, oldest first.
 *
 * Grouped by chunk rather than by utterance because that is the batch the
 * classifier is paid for: one model call covering a chunk's worth of lines
 * costs the same as one covering a single line.
 *
 * Only chunks whose transcription has committed are eligible — a chunk still
 * `transcribing` may yet gain utterances, and classifying half of it would
 * leave the rest permanently behind the partial index.
 */
export async function chunksWithUnclassifiedUtterances(
  limit = 50,
): Promise<UnclassifiedChunk[]> {
  const rows = await getDb()
    .select({
      chunkId: utterance.chunkId,
      userId: captureSession.userId,
      earliest: sql<Date>`min(${utterance.createdAt})`,
    })
    .from(utterance)
    .innerJoin(captureSession, eq(utterance.captureSessionId, captureSession.id))
    .innerJoin(audioChunk, eq(utterance.chunkId, audioChunk.id))
    .where(and(eq(utterance.kind, "unclassified"), eq(audioChunk.status, "transcribed")))
    .groupBy(utterance.chunkId, captureSession.userId)
    .orderBy(asc(sql`min(${utterance.createdAt})`))
    .limit(limit);

  return rows.map((r) => ({ chunkId: r.chunkId, userId: r.userId }));
}

export interface ChunkUtterance {
  id: string;
  captureSessionId: string;
  text: string;
}

export async function loadChunkUtterances(chunkId: string): Promise<ChunkUtterance[]> {
  return getDb()
    .select({
      id: utterance.id,
      captureSessionId: utterance.captureSessionId,
      text: utterance.text,
    })
    .from(utterance)
    .where(and(eq(utterance.chunkId, chunkId), eq(utterance.kind, "unclassified")))
    .orderBy(asc(utterance.startOffsetMs));
}

export interface ClassificationWrite {
  utteranceId: string;
  captureSessionId: string;
  kind: "content" | "directive";
  confidence: number;
  verb?: string;
  object?: string;
  restatement?: string;
  capabilityId?: string | null;
}

/**
 * Commit a chunk's verdicts.
 *
 * The write to `utterance.kind` is guarded `where kind = 'unclassified'`, which
 * makes it a monotone one-way fill of a derived default rather than an edit:
 * `text` is never touched, a human correction still goes to `kindOverride`, and
 * running the job twice cannot change an answer. That guard is the reason this
 * does not violate the ledger's append-only discipline — see README.
 */
export async function recordClassifications(writes: ClassificationWrite[]): Promise<number> {
  if (writes.length === 0) return 0;
  const db = getDb();

  return db.transaction(async (tx) => {
    let written = 0;

    for (const w of writes) {
      const updated = await tx
        .update(utterance)
        .set({ kind: w.kind, kindConfidence: w.confidence })
        .where(and(eq(utterance.id, w.utteranceId), eq(utterance.kind, "unclassified")))
        .returning({ id: utterance.id });

      // Lost the race with another worker. Its verdict stands; do not also
      // write a `directive` row, or the same line would be recorded twice.
      if (updated.length === 0) continue;
      written += 1;

      if (w.kind !== "directive") continue;

      await tx
        .insert(directive)
        .values({
          utteranceId: w.utteranceId,
          captureSessionId: w.captureSessionId,
          verb: w.verb ?? "",
          object: w.object ?? "",
          restatement: w.restatement ?? w.verb ?? "",
          capabilityId: w.capabilityId ?? null,
          confidence: w.confidence,
        })
        .onConflictDoNothing();
    }

    return written;
  });
}

/* ---------------------------------------------------------------------------
 * Directions and invocations
 * ------------------------------------------------------------------------- */

export interface PendingDirective {
  utteranceId: string;
  captureSessionId: string;
  capabilityId: string;
  verb: string;
  restatement: string;
}

/** Resolved directions with no invocation yet — the invoker's work queue. */
export async function directivesAwaitingInvocation(limit = 50): Promise<PendingDirective[]> {
  const rows = await getDb()
    .select({
      utteranceId: directive.utteranceId,
      captureSessionId: directive.captureSessionId,
      capabilityId: directive.capabilityId,
      verb: directive.verb,
      restatement: directive.restatement,
    })
    .from(directive)
    .leftJoin(invocation, eq(invocation.triggeringUtteranceId, directive.utteranceId))
    .where(and(sql`${directive.capabilityId} is not null`, isNull(invocation.id)))
    .orderBy(asc(directive.createdAt))
    .limit(limit);

  return rows.filter((r): r is PendingDirective => r.capabilityId !== null);
}

export interface RecordInvocationInput {
  capabilityId: string;
  capabilityVersionId: string;
  captureSessionId: string;
  triggeringUtteranceId: string;
  /** Null while awaiting confirmation for an irreversible or outbound action. */
  confirmed: boolean | null;
  latencyMs?: number;
  error?: string;
}

export async function recordInvocation(input: RecordInvocationInput): Promise<string | null> {
  const rows = await getDb()
    .insert(invocation)
    .values({
      capabilityId: input.capabilityId,
      capabilityVersionId: input.capabilityVersionId,
      captureSessionId: input.captureSessionId,
      triggeringUtteranceId: input.triggeringUtteranceId,
      confirmed: input.confirmed,
      latencyMs: input.latencyMs,
      error: input.error,
    })
    .returning({ id: invocation.id });
  return rows[0]?.id ?? null;
}

export interface PendingConfirmation {
  invocationId: string;
  restatement: string;
}

/**
 * The oldest unanswered confirmation in a session, if any.
 *
 * Read on the per-turn context path, so it is deliberately one indexed row and
 * no join beyond the directive that produced it.
 */
export async function pendingConfirmation(
  captureSessionId: string,
): Promise<PendingConfirmation | null> {
  const rows = await getDb()
    .select({ invocationId: invocation.id, restatement: directive.restatement })
    .from(invocation)
    .innerJoin(directive, eq(directive.utteranceId, invocation.triggeringUtteranceId))
    .where(
      and(
        eq(invocation.captureSessionId, captureSessionId),
        isNull(invocation.confirmed),
        eq(invocation.reverted, false),
      ),
    )
    .orderBy(asc(invocation.firedAt))
    .limit(1);

  return rows[0] ?? null;
}

/** Settle a pending confirmation. Never deletes: a refusal is data. */
export async function settleInvocation(
  invocationId: string,
  confirmed: boolean,
): Promise<void> {
  await getDb()
    .update(invocation)
    .set({ confirmed })
    .where(and(eq(invocation.id, invocationId), isNull(invocation.confirmed)));
}

export interface InvocationStat {
  capabilityId: string;
  fires: number;
  lastFiredAt: Date | null;
}

/** Usage counts, which give frequency-ordered presentation for free. */
export async function invocationStats(userId: string): Promise<InvocationStat[]> {
  const rows = await getDb()
    .select({
      capabilityId: invocation.capabilityId,
      fires: count(invocation.id),
      lastFiredAt: max(invocation.firedAt),
    })
    .from(invocation)
    .innerJoin(capability, eq(capability.id, invocation.capabilityId))
    .where(eq(capability.userId, userId))
    .groupBy(invocation.capabilityId);

  return rows.map((r) => ({
    capabilityId: r.capabilityId,
    fires: Number(r.fires),
    lastFiredAt: r.lastFiredAt ?? null,
  }));
}

/* ---------------------------------------------------------------------------
 * Macros
 * ------------------------------------------------------------------------- */

export interface UnresolvedDirective {
  utteranceId: string;
  captureSessionId: string;
  verb: string;
  object: string;
  restatement: string;
  text: string;
  occurredAt: Date;
}

/**
 * Improvised operations: directions that matched no capability.
 *
 * The interesting set, not the failure set. An operation nobody has a
 * capability for is one the user invented, which is exactly what the paper
 * claims cannot be specified in advance.
 */
export async function unresolvedDirectives(
  userId: string,
  since: Date,
): Promise<UnresolvedDirective[]> {
  const occurredAt = sql<Date>`${captureSession.startedAt} + make_interval(secs => ${utterance.startOffsetMs} / 1000.0)`;

  const rows = await getDb()
    .select({
      utteranceId: directive.utteranceId,
      captureSessionId: directive.captureSessionId,
      verb: directive.verb,
      object: directive.object,
      restatement: directive.restatement,
      text: utterance.text,
      occurredAt,
    })
    .from(directive)
    .innerJoin(utterance, eq(utterance.id, directive.utteranceId))
    .innerJoin(captureSession, eq(captureSession.id, directive.captureSessionId))
    .where(
      and(
        eq(captureSession.userId, userId),
        isNull(directive.capabilityId),
        gte(directive.createdAt, since),
      ),
    )
    .orderBy(asc(occurredAt));

  return rows.map((r) => ({ ...r, occurredAt: new Date(r.occurredAt) }));
}

export interface MacroProposalInput {
  userId: string;
  canonicalForm: string;
  occurrences: { utteranceId: string; captureSessionId: string; text: string; occurredAt: string }[];
  sessionCount: number;
  proposedName: string;
  restatement: string;
  markdown: string;
  params: Record<string, unknown>;
  replayArtifactId?: string;
}

/**
 * Offer a macro, once.
 *
 * `onConflictDoNothing` on (userId, canonicalForm) is what stops a declined
 * proposal being offered again every time the detector runs — a system that
 * re-asks is worse than one that never asked.
 */
export async function proposeMacro(input: MacroProposalInput): Promise<string | null> {
  const rows = await getDb()
    .insert(macroProposal)
    .values(input)
    .onConflictDoNothing({ target: [macroProposal.userId, macroProposal.canonicalForm] })
    .returning({ id: macroProposal.id });
  return rows[0]?.id ?? null;
}

export async function listMacroProposals(userId: string, status: "proposed" | "accepted" | "declined" = "proposed") {
  return getDb()
    .select()
    .from(macroProposal)
    .where(and(eq(macroProposal.userId, userId), eq(macroProposal.status, status)))
    .orderBy(desc(macroProposal.createdAt));
}

export async function existingCanonicalForms(userId: string): Promise<Set<string>> {
  const rows = await getDb()
    .select({ canonicalForm: macroProposal.canonicalForm })
    .from(macroProposal)
    .where(eq(macroProposal.userId, userId));
  return new Set(rows.map((r) => r.canonicalForm));
}

/**
 * Accept a proposal into the repertoire.
 *
 * One transaction, mirroring `seedStarterRepertoire`: capability, version 1,
 * and the origin recording *what triggered it* — which is what answers the
 * paper's "added when, after what episode".
 */
export async function acceptMacroProposal(
  userId: string,
  proposalId: string,
): Promise<{ capabilityId: string; name: string } | null> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [proposal] = await tx
      .select()
      .from(macroProposal)
      .where(
        and(
          eq(macroProposal.id, proposalId),
          eq(macroProposal.userId, userId),
          eq(macroProposal.status, "proposed"),
        ),
      )
      .limit(1);

    if (!proposal) return null;

    // A name collision means the user already has a capability by that name;
    // suffix rather than fail, because the proposal is still worth accepting
    // and refusing would leave it stuck in `proposed` forever.
    const taken = await tx
      .select({ name: capability.name })
      .from(capability)
      .where(eq(capability.userId, userId));
    const names = new Set(taken.map((t) => t.name));
    let name = proposal.proposedName;
    for (let n = 2; names.has(name); n += 1) name = `${proposal.proposedName}-${n}`;

    const [created] = await tx
      .insert(capability)
      .values({ userId, type: "action", name })
      .returning({ id: capability.id });
    if (!created) throw new Error("failed to insert capability");

    await tx.insert(capabilityVersion).values({
      capabilityId: created.id,
      version: 1,
      markdown: proposal.markdown,
      params: proposal.params,
      restatement: proposal.restatement,
    });

    const first = proposal.occurrences[0];
    await tx.insert(capabilityOrigin).values({
      capabilityId: created.id,
      createdVia: "crystallisation",
      triggeringSessionId: first?.captureSessionId ?? null,
      note: `Crystallised from ${proposal.occurrences.length} occurrence(s) of "${proposal.canonicalForm}"`,
    });

    await tx
      .update(macroProposal)
      .set({ status: "accepted", decidedAt: new Date(), capabilityId: created.id })
      .where(eq(macroProposal.id, proposalId));

    return { capabilityId: created.id, name };
  });
}

export async function declineMacroProposal(userId: string, proposalId: string): Promise<boolean> {
  const rows = await getDb()
    .update(macroProposal)
    .set({ status: "declined", decidedAt: new Date() })
    .where(
      and(
        eq(macroProposal.id, proposalId),
        eq(macroProposal.userId, userId),
        eq(macroProposal.status, "proposed"),
      ),
    )
    .returning({ id: macroProposal.id });
  return rows.length > 0;
}

/** Users with improvised directions the detector has not looked at yet. */
export async function usersWithUnresolvedDirectives(
  since: Date,
  minimum: number,
): Promise<string[]> {
  const rows = await getDb()
    .select({ userId: captureSession.userId, n: count(directive.utteranceId) })
    .from(directive)
    .innerJoin(captureSession, eq(captureSession.id, directive.captureSessionId))
    .where(and(isNull(directive.capabilityId), gte(directive.createdAt, since)))
    .groupBy(captureSession.userId)
    .having(sql`count(${directive.utteranceId}) >= ${minimum}`);

  return rows.map((r) => r.userId);
}

/** Origins, for the growth curve's split by how each capability arrived. */
export async function loadCapabilityOrigins(userId: string) {
  return getDb()
    .select({
      capabilityId: capabilityOrigin.capabilityId,
      createdVia: capabilityOrigin.createdVia,
      triggeringSessionId: capabilityOrigin.triggeringSessionId,
      note: capabilityOrigin.note,
      createdAt: capabilityOrigin.createdAt,
    })
    .from(capabilityOrigin)
    .innerJoin(capability, eq(capability.id, capabilityOrigin.capabilityId))
    .where(eq(capability.userId, userId));
}

/** Every version of a user's capabilities, for the append-only history view. */
export async function loadCapabilityVersions(userId: string, capabilityIds: string[]) {
  if (capabilityIds.length === 0) return [];
  return getDb()
    .select({
      id: capabilityVersion.id,
      capabilityId: capabilityVersion.capabilityId,
      version: capabilityVersion.version,
      restatement: capabilityVersion.restatement,
      markdown: capabilityVersion.markdown,
      createdAt: capabilityVersion.createdAt,
    })
    .from(capabilityVersion)
    .innerJoin(capability, eq(capability.id, capabilityVersion.capabilityId))
    .where(and(eq(capability.userId, userId), inArray(capabilityVersion.capabilityId, capabilityIds)))
    .orderBy(asc(capabilityVersion.capabilityId), desc(capabilityVersion.version));
}
