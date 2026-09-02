/**
 * Finding the operations someone invented.
 *
 * The claim the paper rests on is that a voice interface for thinking cannot be
 * designed to fit, because people discover what they want through use. If that
 * is true, the interesting operations are the ones nobody wrote a capability
 * for — improvised, idiosyncratic, low-frequency — and they show up as
 * directions the classifier could not resolve.
 *
 * This mines those for repetition. A thing done once is a whim; a thing done
 * three times across two different sessions is a habit worth a name.
 *
 * Pure: no I/O, no model call, no database. The counting is lexical and
 * structural on purpose — a semantic clustering would find more, but nobody
 * could audit why it grouped what it grouped, and "the repertoire grew" is a
 * claim that has to survive being checked.
 */

import type { ChatMessage } from "./extract";

/** Occurrences of one canonical form before it is worth offering back. */
export const MIN_OCCURRENCES = 3;

/**
 * Distinct sessions it must span.
 *
 * Two, because a thing done three times in one drive is usually one episode —
 * someone marking three points in the same argument — and offering to
 * crystallise that would be reading a moment as a habit.
 */
export const MIN_SESSIONS = 2;

/** How close two directions must be to read as one sequence, in ms. */
export const SEQUENCE_WINDOW_MS = 5 * 60 * 1000;

export interface MinedDirective {
  utteranceId: string;
  captureSessionId: string;
  verb: string;
  object: string;
  text: string;
  occurredAt: Date;
}

export interface MacroCandidate {
  /** `verb|head`, or `verb|head>verb|head` for a recurring pair. */
  canonicalForm: string;
  occurrences: MinedDirective[];
  sessionCount: number;
  /** True when the pattern is two operations that keep happening together. */
  isSequence: boolean;
}

/**
 * Words too common to identify what an operation acted on.
 *
 * A local list rather than `contentWords` from @voicemural/talkback, which is
 * the same idea: that package imports @voicemural/db, and @voicemural/db
 * imports this one, so reaching for it would close a dependency cycle. The
 * duplication is three lines and the alternative is a build graph nobody can
 * reason about.
 */
const STOPWORDS = new Set([
  "the", "a", "an", "that", "this", "it", "its", "those", "these", "there",
  "and", "or", "but", "for", "with", "about", "from", "into", "onto", "to",
  "of", "on", "in", "at", "by", "as", "is", "was", "be", "been", "my", "our",
  "his", "her", "their", "one", "thing", "bit", "part", "down", "up", "just",
  "all", "some", "any", "last", "next", "now", "later", "then",
]);

/**
 * The stable name of an operation.
 *
 * Verb plus the first content word of what it acted on. Deliberately coarse:
 * "mark the funding bit" and "mark that funding question" must land on the same
 * form or nothing will ever reach three occurrences, and a form that never
 * recurs is a form that never proposes anything.
 */
export function canonicalise(verb: string, object: string): string {
  const head = object
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .find((word) => word.length > 2 && !STOPWORDS.has(word));

  return `${verb.toLowerCase()}|${head ?? ""}`;
}

/**
 * Recurring operations, strongest first.
 *
 * Singletons and pairs are mined together and compete on the same thresholds,
 * but a sequence wins the tie: "summarise, then send it to the doc" done three
 * times is a more interesting macro than either half, because the half is
 * already nearly a capability and the pair is the thing nobody wrote down.
 */
export function mineRecurring(
  directives: readonly MinedDirective[],
  opts: { minOccurrences?: number; minSessions?: number } = {},
): MacroCandidate[] {
  const minOccurrences = opts.minOccurrences ?? MIN_OCCURRENCES;
  const minSessions = opts.minSessions ?? MIN_SESSIONS;

  const ordered = [...directives].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );

  const singles = new Map<string, MinedDirective[]>();
  for (const d of ordered) {
    const form = canonicalise(d.verb, d.object);
    const bucket = singles.get(form);
    if (bucket) bucket.push(d);
    else singles.set(form, [d]);
  }

  /* Pairs: two directions in the same session, close enough in time to read as
   * one gesture. Adjacent only — a window over every pair in a drive would
   * manufacture sequences out of two unrelated instructions ten minutes apart
   * that happen to share a verb. */
  const pairs = new Map<string, MinedDirective[]>();
  for (let i = 0; i + 1 < ordered.length; i += 1) {
    const first = ordered[i]!;
    const second = ordered[i + 1]!;
    if (first.captureSessionId !== second.captureSessionId) continue;
    if (second.occurredAt.getTime() - first.occurredAt.getTime() > SEQUENCE_WINDOW_MS) continue;

    const form = `${canonicalise(first.verb, first.object)}>${canonicalise(second.verb, second.object)}`;
    const bucket = pairs.get(form);
    if (bucket) bucket.push(first, second);
    else pairs.set(form, [first, second]);
  }

  const candidates: MacroCandidate[] = [];

  const consider = (form: string, occurrences: MinedDirective[], isSequence: boolean) => {
    // A pair contributes two rows per occurrence, so count gestures not rows.
    const gestures = isSequence ? occurrences.length / 2 : occurrences.length;
    const sessions = new Set(occurrences.map((d) => d.captureSessionId));
    if (gestures < minOccurrences || sessions.size < minSessions) return;
    candidates.push({
      canonicalForm: form,
      occurrences,
      sessionCount: sessions.size,
      isSequence,
    });
  };

  for (const [form, occurrences] of pairs) consider(form, occurrences, true);
  for (const [form, occurrences] of singles) consider(form, occurrences, false);

  return candidates.sort((a, b) => {
    if (a.isSequence !== b.isSequence) return a.isSequence ? -1 : 1;
    if (b.sessionCount !== a.sessionCount) return b.sessionCount - a.sessionCount;
    return b.occurrences.length - a.occurrences.length;
  });
}

/* ---------------------------------------------------------------------------
 * Induction
 * ------------------------------------------------------------------------- */

export const MACRO_PROMPT_VERSION = "1";

export interface InducedMacro {
  name: string;
  restatement: string;
  markdown: string;
  params: Record<string, unknown>;
}

export const MACRO_SYSTEM_PROMPT = `You turn a repeated improvised instruction into a reusable capability.

Someone has been talking to a system that records what they say while they do something else. Several times, across more than one session, they asked for the same operation — one nobody had written down. Your job is to name it and write it down, so they can ask for it by name from now on.

# What you are given

The verbatim lines they said, oldest first. That is all. Do not invent an operation they did not ask for, and do not generalise past what the lines actually show.

# What to produce

- **name**: one lower-case word, or two joined by a hyphen. It is spoken aloud, so it must be easy to say and hard to mishear. Not a sentence, not a verb phrase.
- **restatement**: one sentence, second person, under fifteen words, that could be read back to them for confirmation. "Pulls out anything you flagged as a risk." They cannot read the file, so this sentence is the whole verification.
- **markdown**: the capability itself. A heading with the name, one or two sentences saying what it does, then a short "## Behaviour" list. Write instructions for whoever executes the operation, not a description of the user. Keep it under 150 words.
- **params**: a JSON object. Always include \`reversible\` (true unless the operation destroys or sends something) and \`confirm\` (true if it is irreversible or leaves the system — outbound anything is always true). Add a parameter for whatever varied between the occurrences: if they named a different document each time, that is a parameter, not part of the name.

# What varied is a parameter, not a new capability

Look at the lines against each other. The part that is the same every time is the capability. The part that changed is an argument. Two capabilities that differ only by an argument is the mistake this is meant to prevent.

# Output

A JSON object and nothing else:

{"name":"...","restatement":"...","markdown":"...","params":{"reversible":true,"confirm":false}}`;

export function buildMacroPrompt(candidate: MacroCandidate): ChatMessage[] {
  const lines = candidate.occurrences
    .map((d, i) => `${i + 1}. "${d.text.trim()}"`)
    .join("\n");

  const shape = candidate.isSequence
    ? "These came in pairs: two operations the person keeps doing together, so the capability is the pair, not either half."
    : "These are the same operation, asked for in different words.";

  return [
    { role: "system", content: MACRO_SYSTEM_PROMPT },
    {
      role: "user",
      content: `${shape}\n\nSaid across ${candidate.sessionCount} separate sessions:\n\n${lines}`,
    },
  ];
}

/** Never throws. An unusable response means no proposal, which is fine. */
export function parseMacroResponse(raw: string): InducedMacro | null {
  let parsed: unknown;
  try {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    parsed = JSON.parse((fenced?.[1] ?? raw).trim());
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const row = parsed as Record<string, unknown>;

  const name = normaliseName(row.name);
  const restatement = asString(row.restatement);
  const markdown = asString(row.markdown);
  if (!name || !restatement || !markdown) return null;

  const given = typeof row.params === "object" && row.params !== null
    ? (row.params as Record<string, unknown>)
    : {};

  return {
    name,
    restatement: restatement.slice(0, 200),
    markdown: markdown.slice(0, 4000),
    params: {
      ...given,
      // Defaulted here rather than trusted from the model. A capability whose
      // author forgot to say asks first, and asking costs a question where
      // guessing wrong costs a message the user never meant to send.
      reversible: given.reversible !== false,
      confirm: given.confirm === true || given.reversible === false,
    },
  };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * A name that can be said aloud and typed into `capability.name`.
 *
 * Rejected rather than mangled when it is a sentence: a capability called
 * "pull-out-anything-flagged-as-a-risk" is unusable by voice, and no proposal
 * is better than one nobody can invoke.
 */
function normaliseName(value: unknown): string | null {
  const raw = asString(value).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "");
  const name = raw.trim().replace(/\s+/g, "-");
  if (!/^[\p{L}][\p{L}\p{N}-]{1,23}$/u.test(name)) return null;
  return name.split("-").length > 2 ? null : name;
}
