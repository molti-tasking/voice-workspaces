import { and, eq, getDb, isNull, lt, sql } from "@voicemural/db";
import {
  account,
  audioChunk,
  captureSession,
  extraction,
  user,
  utterance,
  workspaceOp,
} from "@voicemural/db/schema";
import type { AuthProvider } from "@voicemural/shared";
import { getStorage } from "@voicemural/shared/storage";
import { isNotNull } from "drizzle-orm";
import { capture, setPersonProperties } from "../analytics";
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

  if (rows.length > 0) {
    log.warn("requeued stuck chunks", { count: rows.length });
    // No person behind this one — it is the worker noticing its own orphans —
    // so keep it from minting a profile for a synthetic distinct_id.
    capture("system", "chunk_requeued", { count: rows.length }, { processPerson: false });
  }
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
    .set({ endedAt: new Date(), endedBy: "idle_sweep" })
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

/**
 * A session is only reported once its late chunks have settled.
 *
 * Comfortably past the 20-minute idle threshold, so a session closed by the
 * sweep is never reported while the phone might still be draining a dead zone
 * into it. A drive that ended cleanly waits the same amount of time, which
 * costs nothing — nobody is watching this in real time — and keeps one rule
 * instead of two.
 */
const ANALYTICS_SETTLE_MS = 25 * 60 * 1000;

/**
 * Report finished drives to analytics, exactly once each.
 *
 * This exists as a separate step rather than being folded into
 * `closeIdleSessions` because that function only ever returns sessions it
 * closed itself — its `endedAt is null` filter means a drive that reached the
 * explicit /end call is invisible to it. Emitting from there would silently
 * drop every cleanly-ended drive and leave a dataset biased towards drives that
 * finished in a dead zone.
 *
 * Exactly-once comes from `analyticsEmittedAt` being claimed in the same
 * statement that selects the rows, so two workers, or a crash and a restart,
 * cannot double-report. PostHog's own event deduplication is not sufficient
 * here: it resolves at ClickHouse merge time and is keyed partly on timestamp,
 * so a retry a minute later counts twice.
 */
export async function reportCompletedSessions(limit = 50): Promise<number> {
  const db = getDb();
  const settleCutoff = new Date(Date.now() - ANALYTICS_SETTLE_MS);

  // Claim first. Anything selected here is ours to report and nobody else's,
  // even if the capture below throws.
  const claimed = await db
    .update(captureSession)
    .set({ analyticsEmittedAt: new Date() })
    .where(
      and(
        isNull(captureSession.analyticsEmittedAt),
        isNotNull(captureSession.endedAt),
        lt(captureSession.endedAt, settleCutoff),
        // Never report while chunks are still working through the pipeline, or
        // the counts below would describe a partially-transcribed drive.
        sql`not exists (
          select 1 from ${audioChunk}
          where ${audioChunk.captureSessionId} = ${captureSession.id}
            and ${audioChunk.status} in ('stored', 'transcribing')
        )`,
        sql`${captureSession.id} in (
          select ${captureSession.id} from ${captureSession}
          where ${captureSession.analyticsEmittedAt} is null
            and ${captureSession.endedAt} is not null
            and ${captureSession.endedAt} < ${settleCutoff.toISOString()}::timestamptz
          limit ${limit}
        )`,
      ),
    )
    .returning({
      id: captureSession.id,
      userId: captureSession.userId,
      startedAt: captureSession.startedAt,
      endedAt: captureSession.endedAt,
      endedBy: captureSession.endedBy,
    });

  if (claimed.length === 0) return 0;

  for (const session of claimed) {
    try {
      const [chunks] = await db
        .select({
          total: sql<number>`count(*)::int`,
          failed: sql<number>`count(*) filter (where ${audioChunk.status} = 'failed')::int`,
          recordedMs: sql<number>`coalesce(sum(${audioChunk.durationMs}), 0)::int`,
        })
        .from(audioChunk)
        .where(eq(audioChunk.captureSessionId, session.id));

      const [utterances] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(utterance)
        .where(eq(utterance.captureSessionId, session.id));

      capture(
        session.userId,
        "capture_session_completed",
        {
          capture_session_id: session.id,
          duration_ms: chunks?.recordedMs ?? 0,
          chunk_count: chunks?.total ?? 0,
          failed_chunk_count: chunks?.failed ?? 0,
          utterance_count: utterances?.total ?? 0,
          // Older rows predate the column; they were all closed by the sweep,
          // which was the only path that set endedAt automatically.
          closed_by: session.endedBy ?? "idle_sweep",
        },
        // When the drive actually ended, not when the sweep noticed. Otherwise
        // every session lands on a five-second sweep boundary up to 25 minutes
        // after the fact.
        { timestamp: session.endedAt ?? undefined },
      );

      await refreshPersonProperties(session.userId);
    } catch (err) {
      // The row stays claimed. Losing one analytics event is much cheaper than
      // risking a duplicate, and the underlying data is still in Postgres.
      log.error("failed to report completed session", {
        captureSessionId: session.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log.info("reported completed sessions", { count: claimed.length });
  return claimed.length;
}

/**
 * Recompute a participant's person properties from the database.
 *
 * Counted from Postgres rather than accumulated from events on purpose.
 * PostHog has no atomic increment for person properties, so anything counted
 * from the event stream drifts the first time an event is lost — and in this
 * app events are lost by design, every time a phone enters a tunnel. These
 * properties are what surveys target, so they have to be right.
 */
/**
 * ISO string from an aggregate timestamp, whatever the driver handed back.
 *
 * `sql<Date>` is only a type assertion — it converts nothing — and postgres.js
 * returns `min()`/`max()` over a timestamp as a **string**. So the previous
 * `sessions.lastAt.toISOString()` threw on every run, and because the throw
 * happened while building the argument, `setPersonProperties` was never reached:
 * no person property has ever actually been set from here. The caller logs and
 * swallows it, which is why it went unnoticed.
 */
function isoOrUndefined(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

async function refreshPersonProperties(userId: string): Promise<void> {
  const db = getDb();

  const [sessions] = await db
    .select({
      total: sql<number>`count(*)::int`,
      // Typed as it actually arrives, not as we would like it to.
      firstAt: sql<Date | string | null>`min(${captureSession.startedAt})`,
      lastAt: sql<Date | string | null>`max(${captureSession.startedAt})`,
    })
    .from(captureSession)
    .where(eq(captureSession.userId, userId));

  const [chunks] = await db
    .select({
      total: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where ${audioChunk.status} = 'failed')::int`,
      recordedMs: sql<number>`coalesce(sum(${audioChunk.durationMs}), 0)::bigint`,
    })
    .from(audioChunk)
    .innerJoin(captureSession, eq(audioChunk.captureSessionId, captureSession.id))
    .where(eq(captureSession.userId, userId));

  const [ops] = await db
    .select({
      topics: sql<number>`count(*) filter (where ${workspaceOp.type} = 'create_topic')::int`,
      blocks: sql<number>`count(*) filter (where ${workspaceOp.type} = 'add_block')::int`,
    })
    .from(workspaceOp)
    .where(eq(workspaceOp.userId, userId));

  const [extractions] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(extraction)
    .where(eq(extraction.userId, userId));

  const [userRow] = await db
    .select({ isAnonymous: user.isAnonymous })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  // Read the provider rather than guessing it from `isAnonymous`. A guest has no
  // `account` row at all; a signed-in user has one per linked provider, and the
  // most recent is the one they last used. Inferring "github" for everyone who
  // is not a guest mislabelled every Google account.
  const providerRows = await db
    .select({ providerId: account.providerId })
    .from(account)
    .where(eq(account.userId, userId))
    .orderBy(account.createdAt);

  const latestProvider = providerRows.at(-1)?.providerId;
  const authProvider: AuthProvider =
    latestProvider === "github" || latestProvider === "google"
      ? latestProvider
      : "anonymous";

  const isGuest = userRow?.isAnonymous === true;
  const totalChunks = chunks?.total ?? 0;
  const lastSessionAt = isoOrUndefined(sessions?.lastAt);
  const firstSessionAt = isoOrUndefined(sessions?.firstAt);

  setPersonProperties(
    userId,
    {
      is_guest: isGuest,
      auth_provider: authProvider,
      sessions_count: sessions?.total ?? 0,
      total_recorded_ms: Number(chunks?.recordedMs ?? 0),
      failed_chunk_rate: totalChunks > 0 ? (chunks?.failed ?? 0) / totalChunks : 0,
      topics_count: ops?.topics ?? 0,
      blocks_count: ops?.blocks ?? 0,
      extractions_count: extractions?.total ?? 0,
      ...(lastSessionAt ? { last_session_at: lastSessionAt } : {}),
    },
    firstSessionAt ? { first_session_at: firstSessionAt } : undefined,
  );
}
