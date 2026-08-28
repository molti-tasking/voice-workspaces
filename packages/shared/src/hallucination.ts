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

/**
 * The other family: Whisper narrating a cooking video.
 *
 * Distinct from ARTEFACTS above, which are complete self-contained lines. These
 * are OPENINGS — a hallucinated sentence continues into invented specifics
 * ("...a beautiful and beautiful Christmas tree", "...you will need 1 egg"), so
 * there is no fixed string to match. Anchored to the start of a sentence and
 * kept to phrasings no driver thinking aloud would ever produce, because the
 * cost of a false positive is discarding real speech.
 *
 * All observed verbatim in this corpus, in a single nine-chunk drive.
 */
const NARRATION_OPENINGS = [
  /^hello everyone,? welcome to my channel/i,
  /^welcome (back )?to my channel/i,
  /^today,? i('ll| will| am going to) show you how to make/i,
  /^i('m| am) going to show you how to make/i,
  /* Sentence-initial and bare, with no "today". A judgement call, made
   * deliberately: "I will show you how to make ..." is a presenter addressing
   * an audience, and the speaker here is alone in a car thinking aloud. The
   * asymmetry also runs the other way from the ARTEFACTS list above — this
   * filter governs what the AGENT is shown, not what the ledger keeps, so a
   * false positive costs one sentence of context while a false negative tells
   * the agent the driver was narrating a baking video. */
  /^i('ll| will) show you how to make/i,
  /^in this video,? i/i,
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
  const trimmed = text.trim();
  if (NARRATION_OPENINGS.some((opening) => opening.test(trimmed))) return true;

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
