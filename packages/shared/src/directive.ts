/**
 * The cheap half of the Midas-touch split.
 *
 * Some speech is destined for the record and some directs the machine that
 * keeps it. Deciding which is a model's job — but asking a model about every
 * line of an hour-long recording is both slow and pointless, because the
 * overwhelming majority of speech is plainly content. This is the gate that
 * decides which lines are worth asking about.
 *
 * It is deliberately over-inclusive. Candidates are batched into ONE model call
 * per chunk, so an extra candidate costs a few tokens; a false negative
 * silently drops a direction the user gave, and they never find out why.
 * Precision is the model's job downstream, recall is this function's.
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
  /^(?:ok(?:ay)?|right|so|and|but|well|erm?|uh|um|hey|please|actually|just|now|yeah|no)\b[\s,]*/i;

/** How far into a line an imperative may start and still be an imperative. */
const OPENER_WINDOW_CHARS = 40;

/**
 * Words that, at the start of a line, mean it is not an instruction.
 *
 * This is the half of the gate that matters for contribution 3. A closed list
 * of known verbs can never admit an operation the user INVENTED — "chase the
 * invoice", "park that for Thursday" — and those are precisely what the macro
 * detector exists to find. So the rule is inverted: an imperative is a short
 * line that does not begin like a statement or a question.
 *
 * Blocking openers rather than admitting verbs also fails in the cheaper
 * direction. A missed opener admits a declarative, which costs part of one
 * batched model call and comes back "content". A missed verb loses a direction
 * the person gave, and they never find out why.
 */
const NON_IMPERATIVE_OPENERS = new Set([
  // Subjects.
  "i", "we", "you", "he", "she", "it", "they", "there", "this", "that", "these",
  "those", "everyone", "nobody", "someone", "something", "nothing",
  // Determiners and quantifiers.
  "the", "a", "an", "my", "our", "his", "her", "their", "its", "some", "any",
  "every", "each", "all", "both", "most", "another", "other",
  // Auxiliaries and copulas — a line opening with one is a question or an
  // inversion, never a bare imperative.
  "is", "was", "are", "were", "am", "be", "been", "being", "do", "does", "did",
  "have", "has", "had", "will", "would", "should", "might", "must", "shall",
  "may", "am", "aint",
  // Wh-words and conjunctions.
  "what", "when", "where", "who", "whom", "whose", "why", "how", "which",
  "because", "if", "unless", "although", "though", "whereas", "while", "since",
  "as", "than", "then", "therefore", "however", "maybe", "perhaps",
  // Prepositions that open a fronted phrase.
  "in", "on", "at", "for", "with", "without", "about", "from", "to", "of",
  "by", "after", "before", "during", "between", "under", "over", "into",
  // Numbers and time words, which open a bare noun phrase rather than an
  // instruction — "three to six months feels right" is a conclusion.
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "first", "second", "third", "next", "last", "yesterday",
  "today", "tomorrow", "half", "couple",
  // Stance adverbs, which introduce an opinion.
  "probably", "obviously", "basically", "honestly", "clearly", "apparently",
  // Whisper's stock artefacts, so a hallucination never costs a model call.
  "thank", "thanks", "bye", "goodbye", "subtitles", "subscribe",
]);

/**
 * Longest a line can be and still read as an instruction.
 *
 * People give directions in a breath — "mark that", "chase the invoice when I
 * get in" — and think aloud in long, hedged, self-correcting sentences. Twelve
 * words separates the two better than any verb list does.
 */
const MAX_IMPERATIVE_WORDS = 12;

/** Polite forms that wrap an imperative in an auxiliary. */
const POLITE_OPENERS = ["can you", "could you", "would you", "will you", "let us", "lets"];

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

  // Repeatedly, because real speech stacks them: "OK, so, right, mark that".
  let stripped = normalised;
  for (let i = 0; i < 4; i += 1) {
    const next = stripped.replace(LEADING_FILLER, "");
    if (next === stripped) break;
    stripped = next;
  }

  const opener = stripped.slice(0, OPENER_WINDOW_CHARS);

  for (const phrase of DIRECTIVE_PHRASES) {
    if (opener.startsWith(phrase) || wordBoundaryIncludes(opener, phrase)) return true;
  }

  for (const polite of POLITE_OPENERS) {
    if (opener.startsWith(polite)) return true;
  }

  const firstWord = opener.split(/[\s,.!?]+/, 1)[0] ?? "";

  // A verb from the list, wherever the line goes afterwards. These are known
  // operations and worth admitting even in a long sentence.
  if ((DIRECTIVE_VERBS as readonly string[]).includes(firstWord)) return true;

  // The open case: a short line that does not open like a statement. This is
  // what lets an operation nobody has named reach the classifier at all.
  const words = stripped.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > MAX_IMPERATIVE_WORDS) return false;
  if (NON_IMPERATIVE_OPENERS.has(firstWord)) return false;
  // A bare noun phrase — "three to six months" — is not an instruction, and
  // numbers are how those usually start.
  if (!/^[\p{L}]{2,}$/u.test(firstWord)) return false;

  return true;
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
