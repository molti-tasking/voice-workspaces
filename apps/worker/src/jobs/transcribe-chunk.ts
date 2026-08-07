import { and, asc, desc, eq, getDb, lt, sql } from "@voicemural/db";
import { audioChunk, utterance } from "@voicemural/db/schema";
import { LiteLLMError, transcribeChunk } from "@voicemural/llm";
import { extensionForMime, toAbsoluteSegments } from "@voicemural/shared";
import { getStorage } from "@voicemural/shared/storage";
import { log } from "../logger";

/** Raised when the failure is transient and pg-boss should retry. */
export class RetryableJobError extends Error {}

/**
 * Transcribe one chunk and append the resulting utterances.
 *
 * Idempotent: if utterances already exist for the chunk it returns early, so a
 * pg-boss retry after a crash mid-write cannot double the transcript.
 */
export async function handleTranscribeChunk(chunkId: string): Promise<void> {
  const db = getDb();

  const [chunk] = await db
    .select()
    .from(audioChunk)
    .where(eq(audioChunk.id, chunkId))
    .limit(1);

  if (!chunk) {
    log.warn("transcribe.chunk: chunk vanished", { chunkId });
    return;
  }

  if (chunk.status === "transcribed") return;

  const [existing] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(utterance)
    .where(eq(utterance.chunkId, chunkId));

  if ((existing?.count ?? 0) > 0) {
    await db
      .update(audioChunk)
      .set({ status: "transcribed", transcribedAt: new Date() })
      .where(eq(audioChunk.id, chunkId));
    return;
  }

  await db
    .update(audioChunk)
    .set({ status: "transcribing", transcribeStartedAt: new Date() })
    .where(eq(audioChunk.id, chunkId));

  try {
    const audio = await getStorage().get(chunk.storageKey);

    // Feed the tail of the previous chunk as a prompt. Whisper uses it for
    // context, which measurably improves continuity across the boundary —
    // words split by a chunk edge are otherwise often mangled.
    const [previous] = await db
      .select({ text: utterance.text })
      .from(utterance)
      .where(
        and(
          eq(utterance.captureSessionId, chunk.captureSessionId),
          lt(utterance.startOffsetMs, chunk.startOffsetMs),
        ),
      )
      .orderBy(desc(utterance.startOffsetMs))
      .limit(1);

    const result = await transcribeChunk(audio, {
      filename: `${chunk.seq}.${extensionForMime(chunk.mimeType)}`,
      mimeType: chunk.mimeType,
      prompt: previous?.text,
    });

    const segments = toAbsoluteSegments(result.segments, chunk.startOffsetMs);

    if (segments.length > 0) {
      await db.insert(utterance).values(
        segments.map((s) => ({
          captureSessionId: chunk.captureSessionId,
          chunkId: chunk.id,
          startOffsetMs: s.startOffsetMs,
          endOffsetMs: s.endOffsetMs,
          text: s.text,
          kind: "unclassified" as const,
        })),
      );
    }

    await db
      .update(audioChunk)
      .set({ status: "transcribed", transcribedAt: new Date(), failureReason: null })
      .where(eq(audioChunk.id, chunk.id));

    log.info("transcribed chunk", {
      chunkId,
      seq: chunk.seq,
      utterances: segments.length,
    });
  } catch (err) {
    const retryable = err instanceof LiteLLMError ? err.retryable : true;
    const reason = err instanceof Error ? err.message : String(err);

    await db
      .update(audioChunk)
      .set({
        // A retryable failure deliberately stays `transcribing`, NOT `stored`.
        //
        // The sweep only queues `stored` chunks, so returning it there would
        // have the sweep mint a fresh job every 5 seconds and pg-boss's
        // exponential backoff would never apply — a LiteLLM outage would turn
        // into a retry storm against an already-struggling service.
        //
        // Leaving it `transcribing` hands retries to pg-boss (which backs off
        // properly), with requeueStuckChunks as the outer safety net once its
        // attempts are exhausted. The audio is kept either way — it is the
        // irreplaceable half.
        status: retryable ? "transcribing" : "failed",
        failureReason: reason.slice(0, 1000),
      })
      .where(eq(audioChunk.id, chunk.id));

    log.error("transcription failed", { chunkId, retryable, reason });
    if (retryable) throw new RetryableJobError(reason);
  }
}

/** Chunks waiting to be transcribed, oldest first. */
export async function findUntranscribedChunks(limit = 50): Promise<string[]> {
  const rows = await getDb()
    .select({ id: audioChunk.id })
    .from(audioChunk)
    .where(eq(audioChunk.status, "stored"))
    .orderBy(asc(audioChunk.uploadedAt))
    .limit(limit);

  return rows.map((r) => r.id);
}
