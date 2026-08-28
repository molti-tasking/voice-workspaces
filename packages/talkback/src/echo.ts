/**
 * Keeping the system's own voice out of what it reads back.
 *
 * The recorder captures continuously, and when a reply is spoken aloud the
 * microphone hears it. Whisper transcribes it, and it lands in `utterance` — the
 * verbatim ledger — indistinguishable from something the driver said. Left
 * alone, retrieval then feeds the agent its own previous replies as "what you
 * said earlier", and it starts having a conversation with itself. Observed in
 * practice: the system quoted its own invented claim about a PhD back as the
 * user's own words, two turns later.
 *
 * WHY NOT PREVENT IT INSTEAD. Two reasons.
 *
 * Muting the recorder while the system speaks would put holes in the verbatim
 * record, which is the one artefact the whole design refuses to compromise —
 * and a driver talking over the reply would be lost entirely. Echo cancellation
 * helps, but cannot be relied on: it needs a reference signal, and the browser's
 * own speech synthesis does not provide one.
 *
 * So this follows the asymmetry Notes.md sets out: the captured stream stays
 * verbatim and append-only, and correction happens on READ. Nothing here mutates
 * or deletes an utterance. A blemished record is acceptable; a destroyed one is
 * not.
 *
 * Pure, so it can be tested without a database or a microphone.
 */

/** Words too common to carry any signal about whether two lines are the same. */
const NOISE = new Set(["a", "an", "and", "i", "in", "is", "it", "of", "on", "so", "that", "the", "to", "you"]);

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !NOISE.has(word));
}

/**
 * How much of `candidate` also appears in `reference`.
 *
 * Asymmetric on purpose: a short misheard fragment of a long reply — which is
 * what echo usually looks like, since the mic catches it through a speaker and
 * across chunk boundaries — is almost entirely contained in that reply, while
 * covering very little of it. Measuring the other direction, or a symmetric
 * score like Jaccard, would miss exactly that case.
 */
export function containment(candidate: string, reference: string): number {
  const words = tokenise(candidate);
  if (words.length === 0) return 0;

  const reference_ = new Set(tokenise(reference));
  const shared = words.filter((word) => reference_.has(word)).length;
  return shared / words.length;
}

/**
 * Enough overlap to call it echo.
 *
 * Set high. A false positive hides something the driver actually said, which is
 * worse than letting one echoed line through — the ledger keeps everything
 * either way, and the cost of over-filtering is silently losing content.
 */
const ECHO_THRESHOLD = 0.75;

/** Below this, a line is too short for containment to mean anything. */
const MIN_WORDS = 3;

/**
 * Whether this line looks like the system hearing itself.
 *
 * Compared against what the system actually SAID rather than what it generated:
 * a reply cut off by an interruption was never played, so it cannot have echoed.
 */
export function isEcho(text: string, spokenByAgent: string[]): boolean {
  if (tokenise(text).length < MIN_WORDS) return false;
  return spokenByAgent.some((spoken) => containment(text, spoken) >= ECHO_THRESHOLD);
}

/**
 * Drop the system's own voice, and collapse runs of the same line.
 *
 * The repetition is not always echo. Whisper hallucinates on silence and on
 * unclear audio, and its characteristic failure is repeating a plausible phrase
 * — "I'm going to show you how to build a real world computer" appearing four
 * times across a quiet minute. Feeding that to the model as context makes it
 * treat a transcription artefact as the driver's preoccupation, and it will
 * dutifully talk about it.
 */
export function withoutEcho(lines: string[], spokenByAgent: string[]): string[] {
  const keep = new Set(keptIndices(lines, spokenByAgent));
  return lines.filter((_, index) => keep.has(index));
}

/**
 * Which lines survive, BY POSITION.
 *
 * Positions rather than strings, because duplicates are exactly what this
 * removes. A caller that filters its own rows by testing membership in the set
 * of kept *texts* silently undoes the deduplication — both copies of a repeated
 * line match the single kept string and both come back. That is not
 * hypothetical: it is how the first version of this shipped, and the repeated
 * hallucination it was written to remove sailed straight through.
 */
export function keptIndices(lines: string[], spokenByAgent: string[]): number[] {
  const kept: number[] = [];

  for (const [index, line] of lines.entries()) {
    if (isEcho(line, spokenByAgent)) continue;

    // Near-identical to something already kept nearby. Looks back a few lines
    // rather than only at the previous one, because hallucinated repeats
    // interleave with real speech.
    const recent = kept.slice(-4).map((i) => lines[i] ?? "");
    if (recent.some((earlier) => containment(line, earlier) >= 0.9)) continue;

    kept.push(index);
  }

  return kept;
}
