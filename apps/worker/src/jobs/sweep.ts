import { and, eq, getDb, isNull, lt, sql } from "@voicemural/db";
import { audioChunk, captureSession } from "@voicemural/db/schema";
import { getStorage } from "@voicemural/shared/storage";
import { isNotNull } from "drizzle-orm";
import { log } from "../logger";

/** See transcribe-chunk.ts — audio is transient unless this is set. */
const KEEP_AUDIO = process.env.KEEP_AUDIO === "true";

/**
 * A chunk left in `transcribing` for this long is assumed orphaned and returned
 * to the queue.
 *
 * `transcribing` covers both an in-flight attempt and the gaps between pg-boss
 * retries, so this must comfortably exceed the full retry window (currently
 * ~7 minutes: 3 retries at 60s with backoff). Set it too low and the sweep
 * yanks chunks back to `stored` mid-retry, re-queues them, and recreates the
 * very retry storm the backoff exists to prevent.
 */
const STUCK_TRANSCRIBING_MS = 20 * 60 * 1000;

/**
 * A session with no new audio for this long is treated as over.
 *
 * A drive usually ends by arriving somewhere, not by deciding to stop, so the
 * explicit /end call is frequently never made. This is what makes
 * `on-session-end-summarise` fire reliably — the rule cannot depend on the
 * user remembering to close the session.
 */
const SESSION_IDLE_MS = 20 * 60 * 1000;

/** Return chunks orphaned by a crashed worker to the queue. */
export async function requeueStuckChunks(): Promise<number> {
  const cutoff = new Date(Date.now() - STUCK_TRANSCRIBING_MS);

  const rows = await getDb()
    .update(audioChunk)
    .set({ status: "stored", transcribeStartedAt: null })
    .where(
      and(
        eq(audioChunk.status, "transcribing"),
        // Measured from the attempt, not the upload: a chunk can sit queued for
        // hours after an offline drain without being stuck at all.
        lt(audioChunk.transcribeStartedAt, cutoff),
      ),
    )
    .returning({ id: audioChunk.id });

  if (rows.length > 0) log.warn("requeued stuck chunks", { count: rows.length });
  return rows.length;
}

/**
 * Delete audio belonging to chunks that already have a transcript.
 *
 * The transcribe job discards audio inline, so this is a backstop: it catches
 * chunks transcribed before audio became transient, and any delete that failed
 * at the time. Without it, a corpus recorded under the old behaviour would keep
 * its audio forever with nothing ever revisiting it.
 */
export async function discardTranscribedAudio(limit = 200): Promise<number> {
  if (KEEP_AUDIO) return 0;

  const db = getDb();
  const storage = getStorage();

  const rows = await db
    .select({ id: audioChunk.id, storageKey: audioChunk.storageKey })
    .from(audioChunk)
    .where(and(eq(audioChunk.status, "transcribed"), isNotNull(audioChunk.storageKey)))
    .limit(limit);

  let deleted = 0;
  for (const row of rows) {
    if (!row.storageKey) continue;
    try {
      await storage.delete(row.storageKey);
    } catch (err) {
      // Missing file is fine — the row still needs clearing either way.
      log.warn("audio delete failed", {
        chunkId: row.id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
    await db
      .update(audioChunk)
      .set({ storageKey: null, audioDiscardedAt: new Date() })
      .where(eq(audioChunk.id, row.id));
    deleted += 1;
  }

  if (deleted > 0) log.info("discarded transcribed audio", { chunks: deleted });
  return deleted;
}

/**
 * Close sessions that have gone quiet.
 *
 * Only closes a session whose most recent chunk is old enough — a session that
 * is merely mid-dead-zone must not be closed while the phone still holds
 * unuploaded audio for it.
 */
export async function closeIdleSessions(): Promise<string[]> {
  const cutoff = new Date(Date.now() - SESSION_IDLE_MS);

  const rows = await getDb()
    .update(captureSession)
    .set({ endedAt: new Date() })
    .where(
      and(
        isNull(captureSession.endedAt),
        lt(captureSession.startedAt, cutoff),
        // The cutoff is bound as an ISO string with an explicit cast: a raw JS
        // Date inside a sql`` fragment reaches postgres.js untyped and throws,
        // unlike Date values passed through drizzle's column helpers.
        sql`not exists (
          select 1 from ${audioChunk}
          where ${audioChunk.captureSessionId} = ${captureSession.id}
            and ${audioChunk.uploadedAt} > ${cutoff.toISOString()}::timestamptz
        )`,
      ),
    )
    .returning({ id: captureSession.id });

  if (rows.length > 0) {
    log.info("closed idle sessions", { count: rows.length });
  }
  return rows.map((r) => r.id);
}
