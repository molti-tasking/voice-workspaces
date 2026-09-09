/**
 * Database layer for the memory index.
 *
 * I/O only. What a passage is, how a topic is rendered and how results are
 * merged live in @voicemural/talkback (`memory.ts`), which knows nothing about
 * a database; the embedding call lives in @voicemural/llm. This file moves rows.
 */
import { and, desc, eq, getDb, isNull, sql } from "./index";
import { agentTurn, captureSession, memoryEntry, utterance } from "./schema";

export type MemoryKind = "passage" | "topic";

/* ---------------------------------------------------------------------------
 * What needs indexing
 * ------------------------------------------------------------------------- */

/**
 * Users with work for the memory job: an ended drive not yet indexed, or a
 * workspace that has moved since its topics were last embedded.
 *
 * Ended drives only. The current drive is covered by the container's running
 * summary, and a passage embedded mid-drive would be re-cut when the drive
 * closed anyway; waiting until the end makes the job idempotent and the cut
 * final.
 */
export async function usersNeedingMemoryIndex(): Promise<string[]> {
  const db = getDb();

  const sessions = await db
    .selectDistinct({ userId: captureSession.userId })
    .from(captureSession)
    .where(and(sql`${captureSession.endedAt} is not null`, isNull(captureSession.memoryIndexedAt)));

  // A user whose newest op is newer than their newest topic entry — or who
  // has ops and no topic entries at all.
  const topics = await db.execute<{ user_id: string }>(sql`
    select o.user_id
    from workspace_op o
    left join (
      select user_id, max(updated_at) as indexed_at
      from memory_entry
      where kind = 'topic'
      group by user_id
    ) m on m.user_id = o.user_id
    group by o.user_id, m.indexed_at
    having m.indexed_at is null or max(o.created_at) > m.indexed_at
  `);

  return [...new Set([...sessions.map((r) => r.userId), ...topics.map((r) => r.user_id)])];
}

/** Ended, unindexed drives for one user, oldest first. */
export async function sessionsAwaitingMemory(userId: string, limit = 20): Promise<string[]> {
  const rows = await getDb()
    .select({ id: captureSession.id })
    .from(captureSession)
    .where(
      and(
        eq(captureSession.userId, userId),
        sql`${captureSession.endedAt} is not null`,
        isNull(captureSession.memoryIndexedAt),
      ),
    )
    .orderBy(captureSession.startedAt)
    .limit(limit);
  return rows.map((r) => r.id);
}

/* ---------------------------------------------------------------------------
 * Reading a drive for indexing
 * ------------------------------------------------------------------------- */

export interface SessionForMemory {
  startedAt: Date;
  utterances: { id: string; startOffsetMs: number; endOffsetMs: number; text: string }[];
  /** What the agent said aloud in this drive — the echo filter's input. */
  spoken: string[];
}

export async function loadSessionForMemory(captureSessionId: string): Promise<SessionForMemory | null> {
  const db = getDb();
  const [session] = await db
    .select({ startedAt: captureSession.startedAt })
    .from(captureSession)
    .where(eq(captureSession.id, captureSessionId))
    .limit(1);
  if (!session) return null;

  const [utterances, turns] = await Promise.all([
    db
      .select({
        id: utterance.id,
        startOffsetMs: utterance.startOffsetMs,
        endOffsetMs: utterance.endOffsetMs,
        text: utterance.text,
      })
      .from(utterance)
      .where(eq(utterance.captureSessionId, captureSessionId))
      .orderBy(utterance.startOffsetMs),
    db
      .select({ text: agentTurn.text })
      .from(agentTurn)
      .where(eq(agentTurn.captureSessionId, captureSessionId)),
  ]);

  return {
    startedAt: session.startedAt,
    utterances,
    spoken: turns.map((t) => t.text).filter((t) => t.trim().length > 0),
  };
}

/* ---------------------------------------------------------------------------
 * Writing
 * ------------------------------------------------------------------------- */

export interface NewMemoryEntry {
  kind: MemoryKind;
  refId: string;
  captureSessionId?: string | null;
  occurredAt: Date;
  text: string;
  contentHash: string;
  model: string;
  embedding: number[];
  utteranceIds?: string[];
}

/** Insert or replace entries, keyed by (user, kind, ref). */
export async function upsertMemoryEntries(userId: string, entries: NewMemoryEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const now = new Date();
  await getDb()
    .insert(memoryEntry)
    .values(
      entries.map((e) => ({
        userId,
        kind: e.kind,
        refId: e.refId,
        captureSessionId: e.captureSessionId ?? null,
        occurredAt: e.occurredAt,
        text: e.text,
        contentHash: e.contentHash,
        model: e.model,
        embedding: e.embedding,
        utteranceIds: e.utteranceIds ?? [],
        updatedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [memoryEntry.userId, memoryEntry.kind, memoryEntry.refId],
      set: {
        occurredAt: sql`excluded.occurred_at`,
        text: sql`excluded.text`,
        contentHash: sql`excluded.content_hash`,
        model: sql`excluded.model`,
        embedding: sql`excluded.embedding`,
        utteranceIds: sql`excluded.utterance_ids`,
        captureSessionId: sql`excluded.capture_session_id`,
        updatedAt: now,
      },
    });
}

/**
 * A drive's passages, replaced wholesale.
 *
 * Delete-then-insert rather than upsert: a re-cut with a different window
 * would otherwise leave the old cut's passages beside the new one's. All three
 * statements in one transaction so a crash between them cannot mark a drive
 * indexed while its passages are half-written — the sweeper would then never
 * revisit it, and recall would quietly miss the drive forever.
 */
export async function replaceSessionPassages(
  userId: string,
  captureSessionId: string,
  entries: NewMemoryEntry[],
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .delete(memoryEntry)
      .where(and(eq(memoryEntry.kind, "passage"), eq(memoryEntry.captureSessionId, captureSessionId)));
    await tx.insert(memoryEntry).values(
      entries.map((e) => ({
        userId,
        kind: e.kind,
        refId: e.refId,
        captureSessionId: e.captureSessionId ?? null,
        occurredAt: e.occurredAt,
        text: e.text,
        contentHash: e.contentHash,
        model: e.model,
        embedding: e.embedding,
        utteranceIds: e.utteranceIds ?? [],
        updatedAt: new Date(),
      })),
    );
    await tx
      .update(captureSession)
      .set({ memoryIndexedAt: new Date() })
      .where(eq(captureSession.id, captureSessionId));
  });
}

/** Current topic entries' hashes, so only changed topics are re-embedded. */
export async function loadTopicHashes(
  userId: string,
): Promise<Map<string, { contentHash: string; model: string }>> {
  const rows = await getDb()
    .select({ refId: memoryEntry.refId, contentHash: memoryEntry.contentHash, model: memoryEntry.model })
    .from(memoryEntry)
    .where(and(eq(memoryEntry.userId, userId), eq(memoryEntry.kind, "topic")));
  return new Map(rows.map((r) => [r.refId, { contentHash: r.contentHash, model: r.model }]));
}

/** Drop topic entries whose topic no longer exists (merged away). */
export async function deleteTopicEntries(userId: string, topicIds: string[]): Promise<void> {
  if (topicIds.length === 0) return;
  await getDb()
    .delete(memoryEntry)
    .where(
      and(
        eq(memoryEntry.userId, userId),
        eq(memoryEntry.kind, "topic"),
        sql`${memoryEntry.refId} in ${topicIds}`,
      ),
    );
}

/** Touch every topic entry, so the "workspace moved" check settles even when nothing changed. */
export async function touchTopicEntries(userId: string): Promise<void> {
  await getDb()
    .update(memoryEntry)
    .set({ updatedAt: new Date() })
    .where(and(eq(memoryEntry.userId, userId), eq(memoryEntry.kind, "topic")));
}

/* ---------------------------------------------------------------------------
 * Searching
 * ------------------------------------------------------------------------- */

export interface MemoryHit {
  refId: string;
  captureSessionId: string | null;
  occurredAt: Date;
  text: string;
  /** Cosine distance: 0 identical, 2 opposite. */
  distance: number;
}

/**
 * Nearest entries of one kind to a query vector, for the current model only.
 *
 * Exact scan by design — see the schema note. `maxDistance` is the relevance
 * gate: without it the nearest four rows come back for any question at all,
 * dressed up as relevant, which is the failure lexical search avoids by
 * returning nothing on no match.
 */
export async function searchMemory(
  userId: string,
  kind: MemoryKind,
  vector: number[],
  model: string,
  options: { limit?: number; excludeSessionId?: string; maxDistance?: number } = {},
): Promise<MemoryHit[]> {
  const limit = options.limit ?? 4;
  const maxDistance = options.maxDistance ?? 0.5;
  const literal = `[${vector.join(",")}]`;

  const rows = await getDb()
    .select({
      refId: memoryEntry.refId,
      captureSessionId: memoryEntry.captureSessionId,
      occurredAt: memoryEntry.occurredAt,
      text: memoryEntry.text,
      distance: sql<number>`${memoryEntry.embedding} <=> ${literal}::vector`,
    })
    .from(memoryEntry)
    .where(
      and(
        eq(memoryEntry.userId, userId),
        eq(memoryEntry.kind, kind),
        eq(memoryEntry.model, model),
        options.excludeSessionId
          ? sql`(${memoryEntry.captureSessionId} is null or ${memoryEntry.captureSessionId} <> ${options.excludeSessionId})`
          : sql`true`,
      ),
    )
    .orderBy(sql`${memoryEntry.embedding} <=> ${literal}::vector`)
    .limit(limit);

  return rows
    .map((r) => ({ ...r, distance: Number(r.distance) }))
    .filter((r) => r.distance <= maxDistance);
}

/* ---------------------------------------------------------------------------
 * Maintenance
 * ------------------------------------------------------------------------- */

export interface MemoryStatus {
  userId: string;
  passages: number;
  topics: number;
  models: string[];
  unindexedSessions: number;
}

export async function memoryStatus(): Promise<MemoryStatus[]> {
  const rows = await getDb().execute<{
    user_id: string;
    passages: number;
    topics: number;
    models: string[] | null;
    unindexed: number;
  }>(sql`
    select
      u.id as user_id,
      count(m.id) filter (where m.kind = 'passage')::int as passages,
      count(m.id) filter (where m.kind = 'topic')::int as topics,
      array_remove(array_agg(distinct m.model), null) as models,
      (select count(*)::int from capture_session cs
        where cs.user_id = u.id and cs.ended_at is not null and cs.memory_indexed_at is null) as unindexed
    from "user" u
    left join memory_entry m on m.user_id = u.id
    group by u.id
    having count(m.id) > 0 or exists (select 1 from capture_session cs where cs.user_id = u.id)
    order by u.id
  `);
  return rows.map((r) => ({
    userId: r.user_id,
    passages: r.passages,
    topics: r.topics,
    models: r.models ?? [],
    unindexedSessions: r.unindexed,
  }));
}

/** Forget everything derived, for one user or all, and mark every drive for re-indexing. */
export async function clearMemory(userId?: string): Promise<void> {
  const db = getDb();
  if (userId) {
    await db.delete(memoryEntry).where(eq(memoryEntry.userId, userId));
    await db
      .update(captureSession)
      .set({ memoryIndexedAt: null })
      .where(eq(captureSession.userId, userId));
  } else {
    await db.delete(memoryEntry);
    await db.update(captureSession).set({ memoryIndexedAt: null });
  }
}

/** Newest first, for the admin `show` command. */
export async function listTopicEntries(userId: string): Promise<{ refId: string; text: string; updatedAt: Date }[]> {
  return getDb()
    .select({ refId: memoryEntry.refId, text: memoryEntry.text, updatedAt: memoryEntry.updatedAt })
    .from(memoryEntry)
    .where(and(eq(memoryEntry.userId, userId), eq(memoryEntry.kind, "topic")))
    .orderBy(desc(memoryEntry.updatedAt));
}
