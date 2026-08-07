/**
 * Offset arithmetic.
 *
 * Provenance ("every derived sentence traces back to its offset in the stream")
 * is a claim the paper makes, and off-by-one errors here are silent — a
 * transcript still looks fine while pointing at the wrong second of audio.
 * Everything in this file is pure and unit-tested.
 */

/** A transcript segment as returned by Whisper, relative to the chunk. */
export interface RelativeSegment {
  /** Seconds from the start of the chunk. */
  start: number;
  /** Seconds from the start of the chunk. */
  end: number;
  text: string;
}

/** A segment placed on the session timeline, in milliseconds. */
export interface AbsoluteSegment {
  startOffsetMs: number;
  endOffsetMs: number;
  text: string;
}

/**
 * Lift chunk-relative segments onto the absolute session timeline.
 *
 * Whisper reports seconds relative to the audio file it was given; the chunk
 * knows where it sits in the session. Absolute = chunk start + segment start.
 *
 * Segments with blank text are dropped (Whisper emits them for silence).
 * Zero-length and inverted segments are clamped rather than discarded, since
 * losing an utterance is worse than a slightly wrong boundary.
 */
export function toAbsoluteSegments(
  segments: readonly RelativeSegment[],
  chunkStartOffsetMs: number,
): AbsoluteSegment[] {
  const out: AbsoluteSegment[] = [];
  for (const seg of segments) {
    const text = seg.text.trim();
    if (text === "") continue;

    const startOffsetMs = chunkStartOffsetMs + Math.round(seg.start * 1000);
    const rawEnd = chunkStartOffsetMs + Math.round(seg.end * 1000);
    out.push({
      text,
      startOffsetMs,
      endOffsetMs: Math.max(startOffsetMs, rawEnd),
    });
  }
  return out;
}

/**
 * Where a chunk starts on the session timeline.
 *
 * The recorder is authoritative: it stamps `startOffsetMs` at capture time. We
 * only fall back to accumulating durations when a client omitted it, which
 * drifts if any chunk was dropped — so prefer the recorder's value.
 */
export function chunkStartOffset(
  reported: number | null | undefined,
  precedingDurationsMs: readonly number[],
): number {
  if (typeof reported === "number" && Number.isFinite(reported) && reported >= 0) {
    return Math.round(reported);
  }
  return precedingDurationsMs.reduce((acc, d) => acc + Math.max(0, d), 0);
}

/**
 * Gaps in a session's chunk coverage, in milliseconds.
 *
 * A non-empty result means audio was lost (a dead zone that outlived the retry
 * queue, or a suspended tab). Surfaced in the Workspace so a session with holes
 * is never silently treated as complete.
 */
export function findCoverageGaps(
  chunks: readonly { startOffsetMs: number; durationMs: number }[],
  toleranceMs = 250,
): { fromMs: number; toMs: number }[] {
  const sorted = [...chunks].sort((a, b) => a.startOffsetMs - b.startOffsetMs);
  const gaps: { fromMs: number; toMs: number }[] = [];
  let cursor = 0;

  for (const chunk of sorted) {
    if (chunk.startOffsetMs - cursor > toleranceMs) {
      gaps.push({ fromMs: cursor, toMs: chunk.startOffsetMs });
    }
    cursor = Math.max(cursor, chunk.startOffsetMs + Math.max(0, chunk.durationMs));
  }
  return gaps;
}

/** Format an offset as h:mm:ss for the transcript UI. */
export function formatOffset(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return h > 0
    ? `${h}:${mm}:${String(s).padStart(2, "0")}`
    : `${mm}:${String(s).padStart(2, "0")}`;
}
