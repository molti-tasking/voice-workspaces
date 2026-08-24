import { and, asc, desc, eq, getDb, lt, sql } from "@voicemural/db";
import { audioChunk, captureSession, utterance } from "@voicemural/db/schema";
import { LiteLLMError, collapseRepeats, isDegenerate, transcribeChunk } from "@voicemural/llm";
import { extensionForMime, toAbsoluteSegments } from "@voicemural/shared";
import { getStorage } from "@voicemural/shared/storage";
import { capture, log } from "@voicemural/telemetry";

/** Raised when the failure is transient and pg-boss should retry. */
export class RetryableJobError extends Error {}

/**
 * Retain audio after transcription. Off by default — only the transcript is
 * the record of interest.
 *
 * Turn this on before changing chunk length or the transcription model: once
 * audio is gone, a corpus cannot be re-derived, and the transcript becomes the
 * only thing you can ever analyse.
 */
const KEEP_AUDIO = process.env.KEEP_AUDIO === "true";

/**
 * Transcribe one chunk and append the resulting utterances.
 *
 * Idempotent: if utterances already exist for the chunk it returns early, so a
 * pg-boss retry after a crash mid-write cannot double the transcript.
 */
export async function handleTranscribeChunk(chunkId: string, attempt = 1): Promise<void> {
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

  if (!chunk.storageKey) {
    // Audio discarded without a transcript. Unrecoverable, so mark it rather
    // than retrying forever against a file that will never come back.
    await db
      .update(audioChunk)
      .set({ status: "failed", failureReason: "audio discarded before transcription" })
      .where(eq(audioChunk.id, chunkId));
    log.error("chunk has no audio and no transcript", { chunkId, seq: chunk.seq });
    return;
  }

  await db
    .update(audioChunk)
    .set({ status: "transcribing", transcribeStartedAt: new Date() })
    .where(eq(audioChunk.id, chunkId));

  const storageKey = chunk.storageKey;

  try {
    const audio = await getStorage().get(storageKey);

    // Feed the tail of the previous chunk as a prompt. Whisper uses it for
    // context, which measurably improves continuity across the boundary —
    // words split by a chunk edge are otherwise often mangled.
    //
    // This is also a foot-gun, and the reason for the degeneracy check below:
    // if the previous chunk looped, handing that loop back to Whisper makes it
    // loop again, and the failure propagates for the rest of the drive. An
    // observed session lost three consecutive chunks that way.
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

    /* Do not hand a looping transcript back to Whisper.
     *
     * This is the line that was missing. `collapseRepeats` repairs a loop WITHIN
     * a chunk, and the degeneracy was even being logged — but the repaired text
     * was still passed forward as the next chunk's prompt, so the model was
     * re-primed with its own artefact and looped again. An observed drive lost
     * six consecutive chunks to "It's been a while since I filmed a video",
     * repeated across every one of them, from a driver who said it never.
     *
     * Checked against the STORED text, which is already repaired: if repairing
     * it again still shortens it, the phrase is repetitive and unsafe to carry.
     * Dropping the prompt costs a little continuity across one boundary and
     * stops the cascade dead. */
    const carryForward =
      previous?.text && !isDegenerate(previous.text, collapseRepeats(previous.text))
        ? previous.text
        : undefined;

    if (previous?.text && !carryForward) {
      log.warn("not carrying a repetitive transcript into the next chunk", {
        chunkId,
        seq: chunk.seq,
        previous: previous.text.slice(0, 80),
      });
    }

    // The owning user, for attribution. Transcription is the only model
    // surface with no row of its own, so this is the sole chance to record who
    // a call was made for.
    const [owner] = await db
      .select({ userId: captureSession.userId })
      .from(captureSession)
      .where(eq(captureSession.id, chunk.captureSessionId))
      .limit(1);

    const result = await transcribeChunk(audio, {
      filename: `${chunk.seq}.${extensionForMime(chunk.mimeType)}`,
      mimeType: chunk.mimeType,
      prompt: carryForward,
      context: {
        userId: owner?.userId,
        // One trace per call. The drive goes in sessionId instead: a long drive
        // is hundreds of chunks, and collapsing them into one trace yields a
        // pseudo-trace whose latency is their sum over several hours.
        traceId: chunk.id,
        sessionId: chunk.captureSessionId,
        attempt,
        extra: { chunk_seq: chunk.seq, capture_session_id: chunk.captureSessionId },
      },
    });

    if (result.degenerate) {
      // Kept, not dropped: `collapseRepeats` has already reduced the loop to a
      // single occurrence, so what lands in the ledger is a plausible
      // transcription rather than hundreds of invented words. Worth logging
      // because a run of these says something about the audio — usually near
      // silence, or a reply being overheard through a speaker.
      log.warn("transcription degenerated into repetition", {
        chunkId,
        seq: chunk.seq,
        captureSessionId: chunk.captureSessionId,
        repaired: result.text.slice(0, 120),
      });
    }

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

    // Discard the audio now that the transcript is committed. Doing it here,
    // after the utterance insert, means a crash mid-job can only ever leave
    // audio behind — never a chunk with neither audio nor transcript.
    let discarded = false;
    if (!KEEP_AUDIO) {
      try {
        await getStorage().delete(storageKey);
        discarded = true;
      } catch (err) {
        // Not fatal: the sweep retries orphaned files.
        log.warn("could not delete audio", {
          chunkId,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await db
      .update(audioChunk)
      .set({
        status: "transcribed",
        transcribedAt: new Date(),
        failureReason: null,
        ...(discarded ? { storageKey: null, audioDiscardedAt: new Date() } : {}),
      })
      .where(eq(audioChunk.id, chunk.id));

    log.info("transcribed chunk", {
      chunkId,
      seq: chunk.seq,
      utterances: segments.length,
      audioDiscarded: discarded,
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
    capture(
      // The chunk's owner is not always resolvable on this path — the failure
      // may be the lookup itself — so fall back to the session id and drop the
      // person profile rather than minting one for a synthetic distinct_id.
      chunk.captureSessionId,
      "transcription_failed",
      {
        chunk_id: chunkId,
        capture_session_id: chunk.captureSessionId,
        retryable,
        reason: reason.slice(0, 200),
      },
      { processPerson: false },
    );
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
