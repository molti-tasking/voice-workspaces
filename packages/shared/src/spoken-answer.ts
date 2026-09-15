/**
 * Whether what somebody said, right after being asked "shall I go ahead?", was
 * a yes, a no, or neither.
 *
 * The cheap, lexical half of settling a spoken confirmation. It only ever runs
 * on the ONE transcript that follows a turn the agent spent asking, so the
 * question it answers is narrow: not "is this sentence affirmative" but "did
 * they just answer the question they were asked".
 *
 * Deliberately conservative, and lopsided about it:
 *
 * - An answer is SHORT. A driver who says eight words or more has moved on to
 *   something else, even if one of those words is "okay" — "Okay. That's the
 *   plan for the intro done, I think" answers nothing. Unclear leaves the
 *   action pending, which costs at most one more ask.
 * - A wrong "yes" sends something that cannot be unsent. A wrong "no" is a
 *   refusal kept forever as data. A wrong "unclear" costs a sentence. So
 *   anything mixed ("no, go ahead"), deferring ("not yet", "wait") or merely
 *   polite ("right", "fine" inside a longer line) is unclear.
 * - Bare fillers ("okay", "alright", "sounds good") count as yes only when
 *   they are the whole reply — the one place they cannot be a way of starting
 *   a different sentence.
 *
 * Pure: no I/O, no model call, fully testable.
 */

export type SpokenAnswer = "yes" | "no" | "unclear";

/** Beyond this many words it is not an answer, it is the next thought. */
const MAX_ANSWER_WORDS = 7;

/** Affirmatives that mean yes wherever they sit in a short reply. */
const STRONG_YES = [
  "yes",
  "yeah",
  "yep",
  "yup",
  "sure",
  "go ahead",
  "do it",
  "go for it",
  "please do",
  "send it",
  "absolutely",
  "definitely",
];

/** Words that are only a yes when they are all that was said. */
const BARE_YES = ["ok", "okay", "alright", "all right", "fine", "sounds good", "right", "correct"];

const NO = ["no", "nope", "nah", "don't", "do not", "cancel", "never mind", "forget it", "leave it", "skip it", "scrap it"];

/**
 * Not now, as opposed to not ever. Settling these as a refusal would record a
 * decline the person never made, so they stay pending.
 */
const DEFER = ["not yet", "not now", "later", "wait", "hold on", "hold off", "in a minute"];

function normalise(said: string): string {
  return ` ${said
    .replace(/\[speaker \d+\](?:'s)?/gi, " ")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

function has(text: string, phrases: readonly string[]): boolean {
  return phrases.some((p) => text.includes(` ${p} `));
}

export function resolveSpokenAnswer(said: string): SpokenAnswer {
  const text = normalise(said);
  const words = text.trim() ? text.trim().split(" ").length : 0;
  if (words === 0 || words > MAX_ANSWER_WORDS) return "unclear";

  if (has(text, DEFER)) return "unclear";

  const yes = has(text, STRONG_YES) || BARE_YES.includes(text.trim());
  const no = has(text, NO);

  if (yes && !no) return "yes";
  if (no && !yes) return "no";
  return "unclear";
}
