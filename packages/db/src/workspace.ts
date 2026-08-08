/**
 * Database layer for the workspace.
 *
 * Everything here is I/O; the folding, prompting and parsing live in
 * @voicemural/workspace, which knows nothing about a database. That split is
 * what lets the workspace toolkit run against any transcript.
 */
import { and, asc, desc, eq, getDb, gt, inArray, isNull, or, sql } from "./index";
import {
  audioChunk,
  captureSession,
  extraction,
  utterance,
  workspaceCursor,
  workspaceOp,
} from "./schema";
import type { StoredOp, TranscriptSegment, WorkspaceOp } from "@voicemural/workspace";

/* ---------------------------------------------------------------------------
 * Reading the log
 * ------------------------------------------------------------------------- */

/** Every op for a user, in `seq` order — the input to `foldWorkspace`. */
export async function loadOps(userId: string): Promise<StoredOp[]> {
  const rows = await getDb()
    .select({
      id: workspaceOp.id,
      seq: workspaceOp.seq,
      occurredAt: workspaceOp.occurredAt,
      type: workspaceOp.type,
      payload: workspaceOp.payload,
      extractionId: workspaceOp.extractionId,
      captureSessionId: workspaceOp.captureSessionId,
      sourceUtteranceIds: workspaceOp.sourceUtteranceIds,
    })
    .from(workspaceOp)
    .where(eq(workspaceOp.userId, userId))
    .orderBy(asc(workspaceOp.seq));

  return rows.map((r) => ({
    id: r.id,
    seq: Number(r.seq),
    occurredAt: r.occurredAt,
    // `type` is stored as a column for indexing and the payload carries the
    // rest; recombining here keeps the pure package's discriminated union intact.
    op: { type: r.type, ...r.payload } as WorkspaceOp,
    extractionId: r.extractionId ?? undefined,
    captureSessionId: r.captureSessionId ?? undefined,
    sourceUtteranceIds: r.sourceUtteranceIds,
  }));
}

/* ---------------------------------------------------------------------------
 * Reading the transcript as segments
 * ------------------------------------------------------------------------- */

/**
 * Transcribed utterances not yet consumed by extraction.
 *
 * `occurredAt` is computed as session start + offset, which is what puts every
 * drive onto one absolute timeline. Ordering is by that timestamp so speech is
 * always processed in the order it was spoken, even when a session's chunks
 * uploaded late after a dead zone.
 */
export async function loadPendingSegments(
  userId: string,
  limit = 400,
): Promise<TranscriptSegment[]> {
  const db = getDb();

  const [cursor] = await db
    .select()
    .from(workspaceCursor)
    .where(eq(workspaceCursor.userId, userId))
    .limit(1);

  const occurredAt = sql<Date>`${captureSession.startedAt} + make_interval(secs => ${utterance.startOffsetMs} / 1000.0)`;

  const rows = await db
    .select({
      id: utterance.id,
      text: utterance.text,
      kind: utterance.kind,
      kindOverride: utterance.kindOverride,
      occurredAt,
      captureSessionId: utterance.captureSessionId,
    })
    .from(utterance)
    .innerJoin(captureSession, eq(utterance.captureSessionId, captureSession.id))
    .where(
      and(
        eq(captureSession.userId, userId),
        cursor?.lastOccurredAt
          ? sql`${occurredAt} > ${cursor.lastOccurredAt.toISOString()}::timestamptz`
          : undefined,
      ),
    )
    .orderBy(asc(occurredAt), asc(utterance.id))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    occurredAt: new Date(r.occurredAt),
    kind: r.kindOverride ?? r.kind,
  }));
}

/** All of a user's transcript as segments, for a full rebuild. */
export async function loadAllSegments(userId: string): Promise<TranscriptSegment[]> {
  const occurredAt = sql<Date>`${captureSession.startedAt} + make_interval(secs => ${utterance.startOffsetMs} / 1000.0)`;

  const rows = await getDb()
    .select({
      id: utterance.id,
      text: utterance.text,
      kind: utterance.kind,
      kindOverride: utterance.kindOverride,
      occurredAt,
    })
    .from(utterance)
    .innerJoin(captureSession, eq(utterance.captureSessionId, captureSession.id))
    .where(eq(captureSession.userId, userId))
    .orderBy(asc(occurredAt), asc(utterance.id));

  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    occurredAt: new Date(r.occurredAt),
    kind: r.kindOverride ?? r.kind,
  }));
}

/** Which session an utterance belongs to, for attributing ops to a drive. */
export async function sessionIdsForUtterances(
  utteranceIds: string[],
): Promise<Map<string, string>> {
  if (utteranceIds.length === 0) return new Map();

  const rows = await getDb()
    .select({ id: utterance.id, captureSessionId: utterance.captureSessionId })
    .from(utterance)
    .where(inArray(utterance.id, utteranceIds));

  return new Map(rows.map((r) => [r.id, r.captureSessionId]));
}

/* ---------------------------------------------------------------------------
 * Extractions — the cache
 * ------------------------------------------------------------------------- */

export interface ExtractionRecord {
  id: string;
  inputHash: string;
  promptVersion: string;
  requestedModel: string;
  resolvedModel: string;
  rawResponse: string;
  parseError: string | null;
  totalTokens: number;
  createdAt: Date;
}

/** A previous identical call, if there was one. This is the cache lookup. */
export async function findCachedExtraction(
  userId: string,
  inputHash: string,
): Promise<ExtractionRecord | null> {
  const [row] = await getDb()
    .select({
      id: extraction.id,
      inputHash: extraction.inputHash,
      promptVersion: extraction.promptVersion,
      requestedModel: extraction.requestedModel,
      resolvedModel: extraction.resolvedModel,
      rawResponse: extraction.rawResponse,
      parseError: extraction.parseError,
      totalTokens: extraction.totalTokens,
      createdAt: extraction.createdAt,
    })
    .from(extraction)
    .where(and(eq(extraction.userId, userId), eq(extraction.inputHash, inputHash)))
    .limit(1);

  return row ?? null;
}

export interface NewExtraction {
  userId: string;
  inputHash: string;
  promptVersion: string;
  requestedModel: string;
  resolvedModel: string;
  temperature: number;
  seed?: number;
  inputSegmentIds: string[];
  stateDigest: string;
  requestMessages: { role: string; content: string }[];
  rawResponse: string;
  parseError?: string;
  parseWarnings?: string[];
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs?: number;
}

/**
 * Persist a model call.
 *
 * Written *before* parsing, so a response that fails to parse still leaves a
 * replayable record — the point of storing raw output is that a parser fix must
 * not require paying for the call again.
 */
export async function recordExtraction(input: NewExtraction): Promise<string> {
  const [row] = await getDb()
    .insert(extraction)
    .values({
      userId: input.userId,
      inputHash: input.inputHash,
      promptVersion: input.promptVersion,
      requestedModel: input.requestedModel,
      resolvedModel: input.resolvedModel,
      temperature: String(input.temperature),
      seed: input.seed,
      inputSegmentIds: input.inputSegmentIds,
      stateDigest: input.stateDigest,
      requestMessages: input.requestMessages,
      rawResponse: input.rawResponse,
      parseError: input.parseError,
      parseWarnings: input.parseWarnings ?? [],
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      totalTokens: input.totalTokens,
      latencyMs: input.latencyMs,
    })
    // A concurrent worker may have stored the identical call first.
    .onConflictDoNothing({ target: [extraction.userId, extraction.inputHash] })
    .returning({ id: extraction.id });

  if (row) return row.id;

  const existing = await findCachedExtraction(input.userId, input.inputHash);
  if (!existing) throw new Error("Failed to record or find extraction");
  return existing.id;
}

/** Every stored extraction for a user, oldest first — the input to `reparse`. */
export async function loadExtractions(userId: string) {
  return getDb()
    .select()
    .from(extraction)
    .where(eq(extraction.userId, userId))
    .orderBy(asc(extraction.createdAt), asc(extraction.id));
}

/* ---------------------------------------------------------------------------
 * Writing ops
 * ------------------------------------------------------------------------- */

export interface AppendOpsInput {
  userId: string;
  extractionId: string;
  ops: WorkspaceOp[];
  /** Fallback timeline position — the last segment consumed in this batch. */
  occurredAt: Date;
  /**
   * When each source utterance was spoken.
   *
   * Ops are placed at the time of the *earliest utterance they cite*, not at
   * the end of the batch. Stamping a whole batch with one timestamp made every
   * block in it sort arbitrarily against its siblings, so a topic read in
   * scrambled order — the opening line of a drive could land at the bottom of
   * the card.
   */
  segmentTimes?: Map<string, Date>;
  captureSessionId?: string;
  sourceUtteranceIds: string[];
}

export async function appendOps(input: AppendOpsInput): Promise<number> {
  if (input.ops.length === 0) return 0;

  // One extraction contributes its ops exactly once.
  //
  // pg-boss `singletonKey` stops two workers colliding, but nothing stopped the
  // worker's sweep and a manual `workspace:rebuild` running at the same moment
  // — which duplicated every op in the log. The fold happens to tolerate it,
  // because deterministic ids make the duplicates collide and get ignored, but
  // the ledger is the record and it should not carry phantom entries.
  const [existing] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(workspaceOp)
    .where(eq(workspaceOp.extractionId, input.extractionId));

  if ((existing?.count ?? 0) > 0) return 0;

  const rows = input.ops.map(({ type, ...payload }) => {
    const spans = (payload as { spans?: { utteranceId: string }[] }).spans ?? [];
    const times = spans
      .map((s) => input.segmentTimes?.get(s.utteranceId))
      .filter((d): d is Date => d instanceof Date);

    return {
      userId: input.userId,
      extractionId: input.extractionId,
      occurredAt:
        times.length > 0
          ? new Date(Math.min(...times.map((d) => d.getTime())))
          : input.occurredAt,
      captureSessionId: input.captureSessionId,
      type,
      payload: payload as Record<string, unknown>,
      sourceUtteranceIds: spans.length > 0
        ? spans.map((s) => s.utteranceId)
        : input.sourceUtteranceIds,
    };
  });

  const inserted = await getDb()
    .insert(workspaceOp)
    .values(rows)
    .returning({ id: workspaceOp.id });

  return inserted.length;
}

/* ---------------------------------------------------------------------------
 * Cursor
 * ------------------------------------------------------------------------- */

export async function advanceCursor(
  userId: string,
  lastUtteranceId: string,
  lastOccurredAt: Date,
): Promise<void> {
  await getDb()
    .insert(workspaceCursor)
    .values({ userId, lastUtteranceId, lastOccurredAt, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: workspaceCursor.userId,
      set: { lastUtteranceId, lastOccurredAt, updatedAt: new Date() },
    });
}

export async function resetCursor(userId: string): Promise<void> {
  await getDb().delete(workspaceCursor).where(eq(workspaceCursor.userId, userId));
}

/** Drop a user's derived workspace. Ops only — the transcript is untouched. */
export async function clearOps(userId: string): Promise<void> {
  await getDb().delete(workspaceOp).where(eq(workspaceOp.userId, userId));
}

/** Drop the extraction cache too, forcing fresh model calls on the next run. */
export async function clearExtractions(userId: string): Promise<void> {
  await getDb().delete(extraction).where(eq(extraction.userId, userId));
}

/* ---------------------------------------------------------------------------
 * Timeline — the ledger, read end to end
 * ------------------------------------------------------------------------- */

export interface TimelineUtterance {
  id: string;
  captureSessionId: string;
  occurredAt: Date;
  text: string;
  kind: "content" | "directive" | "unclassified";
}

export interface TimelineSession {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  utteranceCount: number;
  recordedMs: number;
}

/**
 * A point where the workspace changed, positioned on the transcript.
 *
 * Placed at the last utterance the extraction consumed, because that is the
 * moment in the *speech* after which the workspace held this state — the
 * extraction's own `createdAt` is when the job happened to run, which can be
 * hours later after an offline drain.
 */
export interface TimelineMarker {
  extractionId: string;
  occurredAt: Date;
  /**
   * The previous marker's position, so a link can express "what this batch
   * changed" as a diff window rather than only the state it left behind.
   */
  since?: Date;
  opCount: number;
  addedBlocks: number;
  revisedBlocks: number;
  newTopics: number;
  totalTokens: number;
  resolvedModel: string;
}

/**
 * Sessions oldest-first — the timeline reads forwards, like a journal.
 *
 * Delegates to `listSessionsWithStats` rather than writing the aggregate again.
 * That function exists precisely because correlated subqueries inside a drizzle
 * `select({...})` projection render their columns UNQUALIFIED, silently
 * comparing a chunk's session id against its own and returning zero for
 * everything. Re-deriving the counts here would mean re-deriving that bug.
 */
export async function loadTimelineSessions(userId: string): Promise<TimelineSession[]> {
  const { listSessionsWithStats } = await import("./sessions");
  const sessions = await listSessionsWithStats(userId, 500);

  return sessions
    .filter((s) => s.utteranceCount > 0)
    .map((s) => ({
      id: s.id,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      utteranceCount: s.utteranceCount,
      recordedMs: s.recordedMs,
    }))
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
}

/**
 * Utterances for one session, in the order they were spoken.
 *
 * Paged by session rather than by row: sessions are what the reader actually
 * navigates by, and a 40-minute drive is ~200 rows — a sane unit to fetch. At
 * five weeks of commutes the whole corpus is ~5,000 rows, which is far too many
 * to render at once.
 */
export async function loadSessionUtterances(
  userId: string,
  captureSessionId: string,
): Promise<TimelineUtterance[]> {
  const occurredAt = sql<Date>`${captureSession.startedAt} + make_interval(secs => ${utterance.startOffsetMs} / 1000.0)`;

  const rows = await getDb()
    .select({
      id: utterance.id,
      captureSessionId: utterance.captureSessionId,
      occurredAt,
      text: utterance.text,
      kind: utterance.kind,
      kindOverride: utterance.kindOverride,
    })
    .from(utterance)
    .innerJoin(captureSession, eq(utterance.captureSessionId, captureSession.id))
    .where(
      and(
        eq(captureSession.userId, userId),
        eq(utterance.captureSessionId, captureSessionId),
      ),
    )
    .orderBy(asc(utterance.startOffsetMs), asc(utterance.id));

  return rows.map((r) => ({
    id: r.id,
    captureSessionId: r.captureSessionId,
    occurredAt: new Date(r.occurredAt),
    kind: r.kindOverride ?? r.kind,
    text: r.text,
  }));
}

/**
 * Every extraction as a marker on the timeline.
 *
 * Includes extractions that produced no ops: a batch that changed nothing is
 * still a point on the ledger, and hiding it would make the workspace look like
 * it updated less often than it did. The UI renders those dimmed.
 */
export async function loadTimelineMarkers(userId: string): Promise<TimelineMarker[]> {
  const db = getDb();

  const extractions = await db
    .select({
      id: extraction.id,
      inputSegmentIds: extraction.inputSegmentIds,
      totalTokens: extraction.totalTokens,
      resolvedModel: extraction.resolvedModel,
    })
    .from(extraction)
    .where(eq(extraction.userId, userId));

  if (extractions.length === 0) return [];

  const opRows = await db
    .select({
      extractionId: workspaceOp.extractionId,
      type: workspaceOp.type,
      occurredAt: workspaceOp.occurredAt,
    })
    .from(workspaceOp)
    .where(eq(workspaceOp.userId, userId));

  // Absolute time of every utterance an extraction might cite, so a marker can
  // be placed even when it produced no ops to take a timestamp from.
  const lastIds = extractions
    .map((e) => e.inputSegmentIds.at(-1))
    .filter((id): id is string => Boolean(id));

  const times = new Map<string, Date>();
  if (lastIds.length > 0) {
    const occurredAt = sql<Date>`${captureSession.startedAt} + make_interval(secs => ${utterance.startOffsetMs} / 1000.0)`;
    const rows = await db
      .select({ id: utterance.id, occurredAt })
      .from(utterance)
      .innerJoin(captureSession, eq(utterance.captureSessionId, captureSession.id))
      .where(inArray(utterance.id, lastIds));
    for (const r of rows) times.set(r.id, new Date(r.occurredAt));
  }

  const byExtraction = new Map<string, typeof opRows>();
  for (const op of opRows) {
    if (!op.extractionId) continue;
    const list = byExtraction.get(op.extractionId);
    if (list) list.push(op);
    else byExtraction.set(op.extractionId, [op]);
  }

  const markers: TimelineMarker[] = [];
  for (const e of extractions) {
    const ops = byExtraction.get(e.id) ?? [];
    const lastId = e.inputSegmentIds.at(-1);
    const occurredAt =
      (lastId ? times.get(lastId) : undefined) ??
      // Fall back to the ops' own position if the utterance is gone.
      (ops.length > 0
        ? new Date(Math.min(...ops.map((o) => o.occurredAt.getTime())))
        : undefined);

    if (!occurredAt) continue;

    markers.push({
      extractionId: e.id,
      occurredAt,
      opCount: ops.length,
      addedBlocks: ops.filter((o) => o.type === "add_block").length,
      revisedBlocks: ops.filter((o) => o.type === "revise_block").length,
      newTopics: ops.filter((o) => o.type === "create_topic").length,
      totalTokens: e.totalTokens,
      resolvedModel: e.resolvedModel,
    });
  }

  markers.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  // Chain each marker to its predecessor, which gives every one a diff window.
  for (let i = 1; i < markers.length; i += 1) {
    markers[i]!.since = markers[i - 1]!.occurredAt;
  }

  return markers;
}

/** Users with transcribed speech that extraction has not yet consumed. */
export async function usersWithPendingSpeech(minSegments: number): Promise<string[]> {
  const occurredAt = sql`${captureSession.startedAt} + make_interval(secs => ${utterance.startOffsetMs} / 1000.0)`;

  const rows = await getDb()
    .select({
      userId: captureSession.userId,
      pending: sql<number>`count(*)::int`,
      sessionEnded: sql<boolean>`bool_or(${captureSession.endedAt} is not null)`,
    })
    .from(utterance)
    .innerJoin(captureSession, eq(utterance.captureSessionId, captureSession.id))
    .leftJoin(workspaceCursor, eq(workspaceCursor.userId, captureSession.userId))
    .where(
      or(
        isNull(workspaceCursor.lastOccurredAt),
        sql`${occurredAt} > ${workspaceCursor.lastOccurredAt}`,
      ),
    )
    .groupBy(captureSession.userId);

  // Extract once a batch has built up, or as soon as a drive has ended — a
  // closed session will never accumulate more, so waiting would strand it.
  return rows
    .filter((r) => r.pending >= minSegments || r.sessionEnded)
    .map((r) => r.userId);
}
