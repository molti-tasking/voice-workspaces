/**
 * Recognising what Whisper says when it has nothing to transcribe.
 *
 * On silence, road noise, or the tail of a truncated utterance, Whisper does not
 * return nothing — it returns a fluent sentence from its training distribution.
 * Because that training set is largely YouTube, the sentences are recognisable:
 * sign-offs, subtitle credits, "thanks for watching". A real drive produced
 * "Thank you so much for watching, and I'll see you in the next video." from a
 * driver who said no such thing.
 *
 * This matters more here than in most systems. The ledger is the paper's primary
 * artefact and is meant to be verbatim, so a fabricated sentence sitting in it
 * unmarked is worse than a gap: it reads as something the participant said.
 *
 * NOTHING IS DELETED. Following the same asymmetry as the echo filter, the
 * ledger keeps everything and the marking happens on read — a blemish, never a
 * deletion. This only says "treat this line with suspicion".
 */

/**
 * Phrases Whisper emits on non-speech, matched case- and punctuation-insensitively.
 *
 * Deliberately narrow. A driver could genuinely say "thank you", so only
 * complete, self-contained artefacts are listed — the cost of a false positive
 * is marking real speech as fake, which is worse than missing one.
 */
const ARTEFACTS = [
  "thank you so much for watching and ill see you in the next video",
  "thanks for watching and ill see you in the next video",
  "thank you for watching",
  "thanks for watching",
  // Observed verbatim in this corpus, glued onto the end of real speech.
  "thank you for watching the video today",
  "thanks for watching the video today",
  "ill see you in the next video",
  "see you in the next video",
  "dont forget to subscribe",
  "like and subscribe",
  "subtitles by the amaraorg community",
  "subtitles by",
  "transcription by castingwords",
  "amaraorg",
  "you",
  "bye",
  "thank you",
];

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether a line looks like a transcription artefact rather than speech.
 *
 * Matches the WHOLE line only. "Thanks for watching" as a complete utterance is
 * almost certainly Whisper on silence; the same words inside a longer sentence
 * are someone talking.
 */
export function isLikelyHallucination(text: string): boolean {
  const normalised = normalise(text);
  if (!normalised) return false;
  return ARTEFACTS.includes(normalised);
}

/**
 * The same judgement, applied one sentence at a time.
 *
 * Whisper does not only hallucinate whole utterances — it finishes a real one
 * and then keeps going, so a single `utterance` row arrives as "Hey, can you
 * summarise the previous discussions? Thank you for watching the video today."
 * `isLikelyHallucination` rightly refuses that line, because as a whole it is
 * mostly genuine speech, and dropping it would lose a real question.
 *
 * A sentence is the unit Whisper actually fabricates in, so the whole-line rule
 * is applied per sentence instead. Retrieval uses this rather than the
 * line-level check: what reaches the model should be what the driver said.
 *
 * Returns the surviving text, which may be empty when every sentence was an
 * artefact. Still never mutates the ledger — this is a read-side filter.
 */
export function withoutHallucinatedSentences(text: string): string {
  // Split AFTER terminal punctuation, keeping it, so a sentence is still
  // recognisable to `normalise` and the original reads naturally once rejoined.
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g);
  if (!sentences || sentences.length < 2) {
    return isLikelyHallucination(text) ? "" : text;
  }
  return sentences
    .filter((sentence) => !isLikelyHallucination(sentence))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}
