import { audioChunk, captureSession, utterance } from "./schema";
import { and, asc, count, desc, eq, getDb, inArray, sql, sum } from "./index";

export interface SessionWithStats {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  /** The last live topic title, when talk-back named one. See `capture_session.title`. */
  title: string | null;
  /** The drive's first transcribed line, for a drive with no title. */
  firstWords: string | null;
  chunkCount: number;
  recordedMs: number;
  utteranceCount: number;
  pendingChunks: number;
}

/**
 * A user's sessions with their per-session totals.
 *
 * Aggregates are fetched per table and merged here rather than expressed as one
 * clever query. Two earlier attempts were both wrong, and both wrong *silently*:
 *
 *  - Joining chunks AND utterances in a single pass produces a cartesian
 *    product, multiplying recorded time by the utterance count.
 *  - Correlated subqueries written with drizzle's `sql` template inside a
 *    `select({...})` projection render their columns UNQUALIFIED. The condition
 *    `where capture_session_id = id` then resolved BOTH names against
 *    audio_chunk, comparing a chunk's session id to its own id — always false,
 *    always zero, and perfectly valid SQL. Every session showed as empty while
 *    the data was intact.
 *
 * (Note that the same `sql` template inside `.where()` *is* qualified properly;
 * only the projection context drops the table prefix.)
 *
 * Grouping each table on its own keeps every column reference unambiguous.
 */
export async function listSessionsWithStats(
  userId: string,
  limit = 60,
  offset = 0,
): Promise<SessionWithStats[]> {
  const db = getDb();

  const rows = await db
    .select({
      id: captureSession.id,
      startedAt: captureSession.startedAt,
      endedAt: captureSession.endedAt,
      title: captureSession.title,
    })
    .from(captureSession)
    .where(eq(captureSession.userId, userId))
    .orderBy(desc(captureSession.startedAt))
    .limit(limit)
    .offset(offset);

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);

  const [chunkStats, utteranceStats, firstLines] = await Promise.all([
    db
      .select({
        sessionId: audioChunk.captureSessionId,
        chunks: count(),
        recordedMs: sum(audioChunk.durationMs),
        pending: count(sql`case when ${audioChunk.status} <> 'transcribed' then 1 end`),
      })
      .from(audioChunk)
      .where(inArray(audioChunk.captureSessionId, ids))
      .groupBy(audioChunk.captureSessionId),
    db
      .select({
        sessionId: utterance.captureSessionId,
        utterances: count(),
      })
      .from(utterance)
      .where(inArray(utterance.captureSessionId, ids))
      .groupBy(utterance.captureSessionId),
    // The first line of each drive, one query for the page: what names a drive
    // that talk-back never titled.
    db
      .selectDistinctOn([utterance.captureSessionId], {
        sessionId: utterance.captureSessionId,
        text: utterance.text,
      })
      .from(utterance)
      .where(inArray(utterance.captureSessionId, ids))
      .orderBy(utterance.captureSessionId, asc(utterance.startOffsetMs)),
  ]);

  const chunksBySession = new Map(chunkStats.map((s) => [s.sessionId, s]));
  const utterancesBySession = new Map(utteranceStats.map((s) => [s.sessionId, s]));
  const firstLineBySession = new Map(firstLines.map((s) => [s.sessionId, s.text.trim()]));

  return rows.map((r) => {
    const c = chunksBySession.get(r.id);
    return {
      ...r,
      chunkCount: c?.chunks ?? 0,
      // sum() returns a numeric string (or null) from postgres.
      recordedMs: Number(c?.recordedMs ?? 0),
      pendingChunks: c?.pending ?? 0,
      utteranceCount: utterancesBySession.get(r.id)?.utterances ?? 0,
      firstWords: firstLineBySession.get(r.id) || null,
    };
  });
}

/** Longest title kept. The container asks for 2-4 words; this only bounds a runaway. */
export const MAX_SESSION_TITLE_CHARS = 120;

/**
 * Store what a drive is about, replacing whatever was there: the latest live
 * title is the best name for the drive as a whole, because it is what the
 * drive had arrived at. Returns whether a row was updated.
 */
export async function setSessionTitle(captureSessionId: string, title: string): Promise<boolean> {
  const clean = title.replace(/\s+/g, " ").trim().slice(0, MAX_SESSION_TITLE_CHARS);
  if (!clean) return false;
  const updated = await getDb()
    .update(captureSession)
    .set({ title: clean })
    .where(eq(captureSession.id, captureSessionId))
    .returning({ id: captureSession.id });
  return updated.length > 0;
}

/** What a search result needs to say which drive it is from. */
export interface SessionHead {
  id: string;
  startedAt: Date;
  title: string | null;
}

/**
 * Date and title for the given drives, scoped to their owner: a search result
 * is grouped under its drive, and an id the caller passes is never trusted to
 * be theirs.
 */
export async function loadSessionHeads(userId: string, ids: string[]): Promise<SessionHead[]> {
  if (ids.length === 0) return [];
  return getDb()
    .select({ id: captureSession.id, startedAt: captureSession.startedAt, title: captureSession.title })
    .from(captureSession)
    .where(and(eq(captureSession.userId, userId), inArray(captureSession.id, ids)));
}
