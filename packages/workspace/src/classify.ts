/**
 * The expensive half of the Midas-touch split.
 *
 * `isDirectiveCandidate` in @voicemural/shared decides which lines are worth
 * asking about; this decides what the answer is, and — for a direction — what
 * was actually asked for. Splitting it that way is the cost control: the gate
 * is pure and free and rejects almost everything, so a model sees a handful of
 * lines per hour rather than several hundred.
 *
 * Lives in this package, not in the worker, for the same reason `extract.ts`
 * does: prompt and parser are pure, so they can be tested without a database, a
 * queue or a network. Nothing here imports @voicemural/db.
 */

import type { ChatMessage } from "./extract";

/**
 * Cache-invalidation key. Nothing caches classification today — unlike
 * extraction, a re-run is guarded by `where kind = 'unclassified'` and simply
 * never happens twice — but the version is recorded so a corpus can be split by
 * which prompt produced it when the rules change.
 */
export const CLASSIFY_PROMPT_VERSION = "1";
export const CLASSIFY_TEMPERATURE = 0;

/** One line offered to the classifier. */
export interface ClassifyCandidate {
  id: string;
  text: string;
}

export interface Classification {
  id: string;
  kind: "content" | "directive";
  /** 0-100. Low confidence on a directive is still written; the column exists to tune the split. */
  confidence: number;
  /** Normalised operation word, present only for a directive. */
  verb?: string;
  /** What it acted on, in the speaker's own words. */
  object?: string;
  /** One sentence, phrased to be read back aloud. */
  restatement?: string;
  /** A capability name from the offered vocabulary, or absent for an improvised operation. */
  capabilityName?: string;
}

export const CLASSIFY_SYSTEM_PROMPT = `You separate DIRECTIONS from CONTENT in a transcript of someone thinking aloud.

The person is doing something else — driving, walking, washing up — and talking to a system that records everything they say. Almost everything they say is CONTENT: the thinking itself, which is the point of the recording. Occasionally they address the system and ask it to do something. That is a DIRECTION.

# The distinction

CONTENT is anything that contributes to the record, including:
- The thought itself, however half-formed.
- Narrating their own thinking: "let me start again", "where was I".
- Talking ABOUT an operation without asking for it: "I should remember to email him", "we noted that last year", "I want to send her a message at some point".

A DIRECTION is speech addressed to the system, asking it to operate on the record:
- "mark that", "note that down", "remind me to email Niklas"
- "summarise this when I stop", "send that to the doc"
- "make that a thing", "call that the interview problem"
- "scratch that", "switch to sceptical"

# The rule when you are unsure

Say CONTENT.

The record is append-only and artefacts are derived from it, so a direction missed is a small loss. A piece of thinking mislabelled as a direction is worse: it drops out of the workspace, and the person never learns why their own idea vanished.

An imperative verb is not enough on its own. "Remember when we tried this?" is content. Ask whether they are speaking TO the system or in front of it.

# For each direction, also give

- verb: one lower-case word naming the operation — mark, note, remind, summarise, send, rename, undo, switch. Use the closest single word even if they did not use it.
- object: what it acts on, in THEIR words, kept short. Empty string if the verb stands alone.
- restatement: one sentence, second person, that could be read back aloud to confirm. "Marking the bit about the funding." Never longer than fifteen words.
- capability: the name of an existing capability from the list below, if one plainly matches. Omit it otherwise — an operation with no capability is a normal and interesting case, not a failure.

# Output

A JSON object, and nothing else:

{"lines":[{"id":"<id>","kind":"content","confidence":90},{"id":"<id>","kind":"directive","confidence":85,"verb":"mark","object":"the funding bit","restatement":"Marking the bit about the funding.","capability":"mark"}]}

Every id you were given must appear exactly once. confidence is 0-100.`;

export function buildClassifyPrompt(
  candidates: readonly ClassifyCandidate[],
  capabilityNames: readonly string[],
): ChatMessage[] {
  const vocabulary =
    capabilityNames.length > 0
      ? `Existing capabilities: ${capabilityNames.join(", ")}.`
      : "This person has no capabilities yet, so never name one.";

  const lines = candidates.map((c) => `[${c.id}] ${c.text}`).join("\n");

  return [
    { role: "system", content: `${CLASSIFY_SYSTEM_PROMPT}\n\n${vocabulary}` },
    { role: "user", content: lines },
  ];
}

export interface ParseClassificationResult {
  classifications: Classification[];
  warnings: string[];
}

/**
 * Parse the response, keeping only what is usable.
 *
 * Never throws. An unparseable response leaves every candidate unclassified,
 * which is a legitimate terminal state — the guard on the write means the
 * sweep will simply try again, and a line that stays `unclassified` reaches the
 * workspace extractor exactly as it does today.
 */
export function parseClassificationResponse(
  raw: string,
  candidates: readonly ClassifyCandidate[],
  capabilityNames: readonly string[] = [],
): ParseClassificationResult {
  const warnings: string[] = [];
  const known = new Map(candidates.map((c) => [c.id, c]));
  const vocabulary = new Set(capabilityNames.map((n) => n.toLowerCase()));

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(raw));
  } catch {
    return { classifications: [], warnings: ["response was not JSON"] };
  }

  const lines = (parsed as { lines?: unknown })?.lines;
  if (!Array.isArray(lines)) {
    return { classifications: [], warnings: ["response had no `lines` array"] };
  }

  const seen = new Set<string>();
  const classifications: Classification[] = [];

  for (const entry of lines) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";

    if (!known.has(id)) {
      warnings.push(`unknown id ${JSON.stringify(id)}`);
      continue;
    }
    if (seen.has(id)) {
      warnings.push(`duplicate id ${id}`);
      continue;
    }
    seen.add(id);

    const kind = row.kind === "directive" ? "directive" : "content";
    const confidence = clampConfidence(row.confidence);

    if (kind === "content") {
      classifications.push({ id, kind, confidence });
      continue;
    }

    const verb = normaliseVerb(row.verb);
    if (!verb) {
      // A direction we cannot name is not actionable and would produce a
      // `directive` row with an empty verb, which the macro detector would then
      // try to canonicalise. Demote rather than half-record it.
      warnings.push(`directive ${id} had no usable verb; recorded as content`);
      classifications.push({ id, kind: "content", confidence });
      continue;
    }

    const capabilityName =
      typeof row.capability === "string" && vocabulary.has(row.capability.toLowerCase())
        ? row.capability.toLowerCase()
        : undefined;

    if (typeof row.capability === "string" && !capabilityName) {
      warnings.push(`invented capability ${JSON.stringify(row.capability)} on ${id}`);
    }

    classifications.push({
      id,
      kind: "directive",
      confidence,
      verb,
      object: trimTo(asString(row.object), 200),
      restatement: trimTo(asString(row.restatement), 200) || fallbackRestatement(verb, row.object),
      capabilityName,
    });
  }

  for (const candidate of candidates) {
    if (!seen.has(candidate.id)) warnings.push(`no verdict for ${candidate.id}`);
  }

  return { classifications, warnings };
}

/** Models wrap JSON in a fence even when asked not to. */
function stripFence(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced?.[1] ?? raw).trim();
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function trimTo(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

function clampConfidence(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** One lower-case word, letters only. Anything else is not a verb. */
function normaliseVerb(value: unknown): string | undefined {
  const word = asString(value).toLowerCase().split(/[\s,._-]+/, 1)[0] ?? "";
  return /^[\p{L}]{2,24}$/u.test(word) ? word : undefined;
}

function fallbackRestatement(verb: string, object: unknown): string {
  const what = asString(object);
  return what ? `${verb} ${what}` : verb;
}
