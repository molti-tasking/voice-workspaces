/**
 * Did the person get the system to do what they meant?
 *
 * Two of the steerability measures cannot be read off ids and offsets. "They
 * asked it to say that again" and "they told it that was wrong" are things
 * that exist only in what was said, so these classifiers read the transcript —
 * inside the privacy boundary, in the worker, against the database — and the
 * only thing that ever leaves is a count. Nothing here returns, stores or logs
 * a phrase; `metrics.ts` counts trues and throws the text away.
 *
 * GERMAN AND ENGLISH, because the corpus is deliberately mixed and Pilot 01
 * was German. A classifier that only knew English would report a correction
 * rate of zero for the exact participant it was written for, which is worse
 * than no measure at all.
 *
 * LEXICAL AND COARSE, and lopsided on purpose in opposite directions for the
 * two measures:
 *
 * - A repeat request is a distinctive thing to say ("nochmal", "say that
 *   again"), so the patterns can be matched anywhere in the utterance.
 * - A correction is not. "nicht" and "not" are among the commonest words in
 *   either language, and matching them anywhere would classify half of all
 *   thinking aloud as a correction. So a rejection has to OPEN the utterance
 *   — which is how people actually reject a proposal out loud — or be one of
 *   a small number of phrases that cannot mean anything else.
 *
 * Under-counting is the safe direction: the claim these support is that
 * corrections are possible and cheap, and a measure biased towards finding
 * fewer of them cannot manufacture that claim.
 *
 * Pure and dependency-free, so both are testable against fixtures rather than
 * against a database.
 */

/** Lower-cased, punctuation-stripped, single-spaced. German umlauts kept. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:"'`´„“”…—–-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * "Say that again", in either language.
 *
 * Includes the transcriber's own failure modes: automatic transcription turns
 * "can you repeat the question?" into "can I repeat the question?" often
 * enough that the base prompt already has a rule about it, and both readings
 * mean the same thing here.
 */
const REPEAT_PATTERNS: readonly RegExp[] = [
  // German
  /\bnoch ?mal\b/,
  /\bwiederhol/,
  /\bwie bitte\b/,
  /\bhab(e)? ich nicht verstanden\b/,
  /\bnicht verstanden\b/,
  /\bverstehe ich nicht\b/,
  /\bich hab(e)? dich nicht (verstanden|geh(ö|oe)rt)\b/,
  /\bwas hast du gesagt\b/,
  // English
  /\b(say|said) (that|it) again\b/,
  /\brepeat (that|it|the question)\b/,
  /\bcome again\b/,
  /\bpardon\b/,
  /\bdidn t (catch|hear|understand|get) (that|you|it)\b/,
  /\bdid not (catch|hear|understand) (that|you|it)\b/,
  /\bwhat did you say\b/,
  /\bi can t hear you\b/,
];

/** Whether an utterance asks the agent to repeat itself or says it was not understood. */
export function isRepeatRequest(text: string): boolean {
  const said = normalise(text);
  if (!said) return false;
  return REPEAT_PATTERNS.some((pattern) => pattern.test(said));
}

/**
 * Rejections, matched only at the START of an utterance.
 *
 * This is the whole reason the correction measure is usable: "nein", "no" and
 * "falsch" are how somebody rejects something out loud, and they come first
 * when they do. Buried in the middle of a sentence they are ordinary speech.
 */
const REJECTION_OPENERS: readonly RegExp[] = [
  // German
  /^(nein|nee|n(ö|oe)|quatsch|falsch|stopp?|halt)\b/,
  /^nicht (das|die|den|dem)\b/,
  /^(ich meinte|ich meine|eigentlich|besser)\b/,
  // English
  /^(no|nope|nah|wrong|stop|wait)\b/,
  /^(not (that|this|quite|what)|i meant|i mean|actually|rather)\b/,
];

/**
 * Phrases that cannot be anything but a correction, wherever they appear.
 *
 * Kept short deliberately. Every entry here is a licence to match mid-sentence,
 * which is the thing the openers above exist to avoid, so a phrase earns its
 * place only if it has no innocent reading in a person thinking aloud.
 */
const REJECTION_PHRASES: readonly RegExp[] = [
  // German
  /\bdas stimmt nicht\b/,
  /\bdas ist falsch\b/,
  /\bso hab(e)? ich das nicht gesagt\b/,
  /\bmach das r(ü|ue)ckg(ä|ae)ngig\b/,
  /\bnimm das zur(ü|ue)ck\b/,
  // English
  /\bthat s (not right|wrong|not what i)\b/,
  /\bthat is (not right|wrong)\b/,
  /\bundo that\b/,
  /\bput (it|that) back\b/,
  /\bi didn t say that\b/,
];

/**
 * Whether an utterance rejects or amends what the agent just did.
 *
 * Only meaningful when the utterance FOLLOWS an agent turn — a rejection with
 * nothing to reject is somebody disagreeing with themselves — and `metrics.ts`
 * is what applies that window. This function answers the lexical half only.
 */
export function isCorrection(text: string): boolean {
  const said = normalise(text);
  if (!said) return false;
  if (REJECTION_OPENERS.some((pattern) => pattern.test(said))) return true;
  return REJECTION_PHRASES.some((pattern) => pattern.test(said));
}
