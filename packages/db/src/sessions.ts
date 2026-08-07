import { count, desc, eq, getDb, inArray, sql, sum } from "./index";
import { audioChunk, captureSession, utterance } from "./schema";

export interface SessionWithStats {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
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
): Promise<SessionWithStats[]> {
  const db = getDb();

  const rows = await db
    .select({
      id: captureSession.id,
      startedAt: captureSession.startedAt,
      endedAt: captureSession.endedAt,
    })
    .from(captureSession)
    .where(eq(captureSession.userId, userId))
    .orderBy(desc(captureSession.startedAt))
    .limit(limit);

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);

  const [chunkStats, utteranceStats] = await Promise.all([
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
  ]);

  const chunksBySession = new Map(chunkStats.map((s) => [s.sessionId, s]));
  const utterancesBySession = new Map(utteranceStats.map((s) => [s.sessionId, s]));

  return rows.map((r) => {
    const c = chunksBySession.get(r.id);
    return {
      ...r,
      chunkCount: c?.chunks ?? 0,
      // sum() returns a numeric string (or null) from postgres.
      recordedMs: Number(c?.recordedMs ?? 0),
      pendingChunks: c?.pending ?? 0,
      utteranceCount: utterancesBySession.get(r.id)?.utterances ?? 0,
    };
  });
}
