/**
 * The cheap half of the Midas-touch split.
 *
 * Some speech is destined for the record and some directs the machine that
 * keeps it. Deciding which is a model's job — but asking a model about every
 * line of an hour-long recording is both slow and pointless, because the
 * overwhelming majority of speech is plainly content. This is the gate that
 * decides which lines are worth asking about.
 *
 * It is deliberately over-inclusive. A false positive costs one cheap `fast`
 * call that answers "content"; a false negative silently drops a direction the
 * user gave, which is the failure they would notice. Precision is the model's
 * job downstream, recall is this function's.
 *
 * Pure: no I/O, no model call, fully testable.
 */

/**
 * Verbs that plausibly open an instruction to the system.
 *
 * Short on purpose. Every entry here is a verb that, in the imperative, asks
 * for an operation on the record rather than contributing to it. Verbs that
 * are common in ordinary narration ("think", "want", "need", "go") are
 * excluded even though they appear in real directions, because including them
 * would send most of the transcript to the model and buy almost nothing.
 */
const DIRECTIVE_VERBS = [
  "mark",
  "note",
  "flag",
  "remind",
  "remember",
  "summarise",
  "summarize",
  "send",
  "save",
  "file",
  "add",
  "delete",
  "drop",
  "skip",
  "undo",
  "revert",
  "cancel",
  "confirm",
  "rename",
  "call",
  "name",
  "tag",
  "list",
  "repeat",
  "read",
  "switch",
  "stop",
  "start",
] as const;

/**
 * Multi-word openers that carry the intent without a verb from the list above.
 *
 * "make that a thing" is the retrospective-crystallisation phrase from
 * Notes.md, and it has to survive the gate or the paper's own walkthrough does
 * not work.
 */
const DIRECTIVE_PHRASES = [
  "make that",
  "call that",
  "put that",
  "write that",
  "take a note",
  "make a note",
  "add that",
  "keep that",
  "hold on to that",
  "turn that into",
  "from now on",
  "switch to",
  "go back to",
  "never mind",
  "forget that",
  "scratch that",
] as const;

/** Politeness wrappers stripped before looking for an imperative opener. */
const LEADING_FILLER =
  /^(?:ok(?:ay)?|right|so|and|but|well|erm?|uh|um|hey|please|actually|just|now)\b[\s,]*/i;

/** How far into a line an imperative may start and still be an imperative. */
const OPENER_WINDOW_CHARS = 40;

export interface DirectiveGateOptions {
  /**
   * The user's own capability names — `mark`, `diary`, and anything they have
   * crystallised. Naming a capability is the least ambiguous direction there
   * is, and it is the one signal that grows as the repertoire does.
   */
  capabilityNames?: readonly string[];
}

/**
 * Whether this line is worth asking a model about.
 *
 * Returns false for the vast majority of speech, and that "no" is final: the
 * caller writes `content` without a model call.
 */
export function isDirectiveCandidate(
  text: string,
  options: DirectiveGateOptions = {},
): boolean {
  const normalised = normalise(text);
  if (normalised.length === 0) return false;

  // A capability name anywhere in a short line. Not window-limited, because
  // "can you diary this one" puts the name in the middle, and a user who has
  // authored a capability uses its name deliberately.
  for (const name of options.capabilityNames ?? []) {
    const term = normalise(name);
    if (term.length >= 3 && wordBoundaryIncludes(normalised, term)) return true;
  }

  const opener = normalised.replace(LEADING_FILLER, "").slice(0, OPENER_WINDOW_CHARS);

  for (const phrase of DIRECTIVE_PHRASES) {
    if (opener.startsWith(phrase) || wordBoundaryIncludes(opener, phrase)) return true;
  }

  // A bare imperative: the verb is the first word after any filler. Checking
  // only the opener is what keeps "I should remember to call him" — narration
  // about remembering — out of the candidate set.
  const firstWord = opener.split(/[\s,.!?]+/, 1)[0] ?? "";
  return (DIRECTIVE_VERBS as readonly string[]).includes(firstWord);
}

/** Lower case, punctuation-tolerant, single-spaced. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Substring match that will not fire `mark` inside `market`. */
function wordBoundaryIncludes(haystack: string, needle: string): boolean {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;
    const before = at === 0 ? " " : haystack[at - 1]!;
    const afterAt = at + needle.length;
    const after = afterAt >= haystack.length ? " " : haystack[afterAt]!;
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return true;
    from = at + 1;
  }
}
