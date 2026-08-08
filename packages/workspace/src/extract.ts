import { createHash } from "node:crypto";
import { slugify } from "./fold";
import { TOPIC_ICONS, normaliseIcon } from "./icons";
import {
  BlockKind,
  type TranscriptSegment,
  type WorkspaceOp,
  type WorkspaceState,
} from "./types";

/**
 * Cache-invalidation key for extraction.
 *
 * BUMP THIS whenever SYSTEM_PROMPT or the wire format below changes. The
 * extraction cache is keyed on it, so forgetting means silently serving ops
 * derived from an older prompt — a bug with no symptom until the results look
 * subtly wrong. `prompt-version.test.ts` fails if the prompt text drifts
 * without the version moving.
 */
export const PROMPT_VERSION = "3";

/** Fixed seed sent with every request, so a forced re-run is as stable as the backend allows. */
export const EXTRACTION_SEED = 7;
export const EXTRACTION_TEMPERATURE = 0;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/* ---------------------------------------------------------------------------
 * Prompt
 * ------------------------------------------------------------------------- */

export const SYSTEM_PROMPT = `You maintain a WORKSPACE derived from someone thinking aloud while driving.

The transcript is a ledger: every word, in order, as spoken. The workspace is the
balance sheet: a compact, topic-sorted view of what the person currently thinks.
You emit the diff between the current workspace and the new speech.

# THE ONE RULE THAT MATTERS

**Most speech must produce NOTHING.**

Someone thinking aloud repeats themselves, hedges, restates the same idea three
ways, and narrates the act of thinking. A stretch of twenty utterances usually
holds two or three things worth keeping. If you are emitting a block for most
utterances you are transcribing, not extracting, and the workspace becomes a
worse copy of the transcript.

Ask of every candidate block: **would this still be worth reading in a month?**
If not, drop it.

## Never emit a block for
- Reassurance or self-talk: "I think I will be fine", "we'll see", "that's fine".
- Announcing the subject: "I'm thinking about my research stay" — creating the
  topic already captured that. The topic title is not also a block.
- Narrating the thinking: "let me start from the beginning", "so, following up
  on my earlier thought", "where was I".
- Restating something already in the workspace in different words.
- Transcription artefacts: a trailing "Thank you." after silence is a Whisper
  hallucination, not speech.

# Revising — do this far more than you expect

Thinking aloud circles the same idea, each pass sharper than the last. When new
speech says something the workspace already holds — even loosely, even in quite
different words — emit **revise_block**, not add_block.

The workspace shows what the person currently thinks, not the argument that
produced it. Two blocks saying nearly the same thing is a bug.

REVISE (same thought, sharper):
  have: "I don't know exactly what I want, I'm open for anything."
  hear: "I just want a nice university with friendly people, related to my work."
  → revise_block. The second supersedes the first; it is the same thought, resolved.

REVISE (changed mind):
  have: "I want to go to Stanford."
  hear: "Actually no, what matters is who I'd work with, not the name."
  → revise_block.

ADD (genuinely new):
  have: "I want to go somewhere warm."
  hear: "The stay has to be three to six months."
  → add_block. A constraint, not a refinement of the preference.

## Topics
One topic per distinct subject. People jump between topics mid-sentence and
return to them across days.
- REUSE an existing topic whenever the speech belongs to one. Near-duplicate
  topics are the main failure mode after over-adding blocks.
- Create a topic only for a genuinely new subject.
- If two existing topics turn out to be the same thing, merge them.

## Block kinds
- "fact"     — a hard attribute of the subject: a duration, a date, a budget, a
               place, a constraint, a requirement. PREFER THIS over "context"
               whenever the content is a value rather than a sentence, because
               facts render as a table and read far denser than prose.
               Needs a short "label" (1-2 words) and a short "text" value.
- "claim"    — the substance. An assertion, idea, decision or conclusion the
               speaker holds.
- "question" — an unresolved uncertainty they still owe themselves
               ("I don't know where I want to go yet").
- "context"  — background that is genuinely a sentence and does NOT fit a
               label/value pair. Use sparingly; most context is really a fact.
- "meta"     — the speaker commenting on their own content rather than adding to
               it ("that is the abstract", "this is the interesting bit",
               "mark that", "remind me to write this up").

### Facts, because this is the one most often got wrong
"The research stay has to be at least three and at most six months long" is not
a sentence worth keeping — it is a duration.

  bad:  {"kind":"context","text":"The research stay must last three to six months."}
  good: {"kind":"fact","label":"Duration","text":"3-6 months"}

  bad:  {"kind":"context","text":"I'm partly funded from my own job here in Aarhus."}
  good: {"kind":"fact","label":"Funding","text":"Own job salary in Aarhus"}

  bad:  {"kind":"context","text":"Right now I live in Denmark, in Aarhus."}
  good: {"kind":"fact","label":"Based in","text":"Aarhus, Denmark"}

Labels should be reusable across a topic — "Duration", "Funding", "Based in",
"Field", "Deadline", "Budget" — so the table reads as one coherent set of
attributes rather than a list of one-off headings. Values stay short: a few
words, not a clause.

## Writing block text
Short. One clause, at most about fifteen words. No preamble, no hedging, no
narration of where the thought came from.

  bad:  "Following up on my past discussion, I feel like I want to build some
         software as part of my PhD."
  good: "Wants to build software as part of the PhD."

  bad:  "I would like to talk to people and solve a real world problem rather
         than just bullshitting around."
  good: "Wants to solve a real problem with real people."

# Output
Reply with JSON only. No prose, no code fences.

{"ops": [ ... ]}

Ids for EXISTING topics and blocks must be copied exactly from the workspace
given to you. For a NEW topic, invent a handle of the form "new:slug".

{"type":"create_topic","id":"new:research-stay","title":"Research stay","icon":"Plane"}
{"type":"rename_topic","topic":"<topicId>","title":"Better title","icon":"Compass"}
{"type":"merge_topics","from":"<topicId>","into":"<topicId>"}
{"type":"add_block","topic":"<topicId|new:handle>","kind":"claim","text":"...","sources":["<utteranceId>"]}
{"type":"add_block","topic":"<topicId|new:handle>","kind":"fact","label":"Duration","text":"3-6 months","sources":["<utteranceId>"]}
{"type":"revise_block","supersedes":"<blockId>","topic":"<topicId|new:handle>","kind":"claim","text":"...","sources":["<utteranceId>"]}
{"type":"retire_block","block":"<blockId>"}
{"type":"move_block","block":"<blockId>","topic":"<topicId>"}

"icon" must be exactly one of:
${TOPIC_ICONS.join(", ")}

"sources" lists the utterance ids a block came from — always at least one. This
is how the workspace traces back to what was actually said.`;

/** Cap the state passed back in, so the prompt stays bounded as the corpus grows. */
const MAX_TOPICS_IN_PROMPT = 40;
const MAX_BLOCKS_PER_TOPIC_IN_PROMPT = 8;

/**
 * Render the carried-forward balance.
 *
 * Real accounting does not re-add every transaction since inception to compute
 * today's figure, and neither do we: the model sees a compact digest of current
 * state plus only the new speech, which keeps extraction O(n) rather than O(n²)
 * over a growing corpus.
 */
export function renderState(state: WorkspaceState): string {
  if (state.topics.length === 0) return "(empty — no topics yet)";

  const lines: string[] = [];
  for (const topic of state.topics.slice(0, MAX_TOPICS_IN_PROMPT)) {
    lines.push(`## ${topic.title}  [id: ${topic.id}]`);
    const blocks = state.blocksByTopic.get(topic.id) ?? [];
    // Most recent first: what was just said is the likeliest thing to be revised.
    const recent = blocks.slice(-MAX_BLOCKS_PER_TOPIC_IN_PROMPT);
    if (recent.length === 0) lines.push("  (no blocks yet)");
    for (const block of recent) {
      const shown = block.label ? `${block.label}: ${block.text}` : block.text;
      lines.push(`  - (${block.kind}) ${shown}  [id: ${block.id}]`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function renderSegments(segments: readonly TranscriptSegment[]): string {
  return segments
    .map((s) => `[${s.id}] ${s.text}`)
    .join("\n");
}

export function buildExtractionPrompt(
  state: WorkspaceState,
  segments: readonly TranscriptSegment[],
): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        "# Current workspace",
        renderState(state),
        "",
        "# New speech",
        renderSegments(segments),
        "",
        "Emit the ops that bring the workspace up to date. JSON only.",
      ].join("\n"),
    },
  ];
}

/* ---------------------------------------------------------------------------
 * Hashing — the cache key
 * ------------------------------------------------------------------------- */

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * A stable fingerprint of the state the model was conditioned on.
 *
 * Hashes exactly what `renderState` shows, so two runs that would produce the
 * same prompt hash the same — no more, no less.
 */
export function stateDigest(state: WorkspaceState): string {
  return sha256(renderState(state));
}

export function computeInputHash(params: {
  promptVersion: string;
  model: string;
  temperature: number;
  segments: readonly TranscriptSegment[];
  stateDigest: string;
}): string {
  const segmentPart = params.segments
    .map((s) => `${s.id} ${s.text}`)
    .join("");

  return sha256(
    [
      params.promptVersion,
      params.model,
      String(params.temperature),
      params.stateDigest,
      segmentPart,
    ].join(""),
  );
}

/**
 * A UUID derived from its inputs rather than randomness.
 *
 * Ids must be a pure function of the extraction input: `workspace:reparse`
 * re-derives ops from stored responses, and if it minted fresh ids each run,
 * every reparse would orphan the previous blocks and the determinism guarantee
 * would be worthless.
 *
 * Shaped as a v4-looking UUID so it drops into a `uuid` column unchanged.
 */
export function deterministicId(...parts: string[]): string {
  const h = sha256(parts.join(" "));
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `4${h.slice(13, 16)}`,
    ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20),
    h.slice(20, 32),
  ].join("-");
}

/* ---------------------------------------------------------------------------
 * Parsing
 * ------------------------------------------------------------------------- */

export interface ParseResult {
  ops: WorkspaceOp[];
  /** Set when nothing could be parsed at all. */
  error?: string;
  /** Individual ops that were dropped, with the reason. */
  warnings: string[];
}

/**
 * Pull the JSON object out of a model response.
 *
 * Models wrap JSON in code fences, prefix it with "Here are the ops:", or
 * append a closing remark, whatever the instructions say. Scanning for the
 * outermost balanced braces is far more reliable than trusting the format.
 */
export function extractJsonObject(raw: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = fenced?.[1] ?? raw;

  const start = candidate.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < candidate.length; i += 1) {
    const ch = candidate[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  return null; // truncated mid-object
}

interface WireOp {
  type?: unknown;
  id?: unknown;
  topic?: unknown;
  title?: unknown;
  icon?: unknown;
  label?: unknown;
  from?: unknown;
  into?: unknown;
  kind?: unknown;
  text?: unknown;
  block?: unknown;
  supersedes?: unknown;
  sources?: unknown;
}

/**
 * Turn a model response into ops.
 *
 * Never throws. A malformed response yields zero ops and an `error`, because a
 * bad extraction must not wedge the queue — the raw response is stored either
 * way, so it can be re-parsed later once the parser improves.
 *
 * `idSeed` should be the extraction's `inputHash`: it makes generated ids a pure
 * function of the input, which is what makes reparse deterministic.
 */
export function parseExtractionResponse(
  raw: string,
  opts: { idSeed: string; knownTopicIds?: Set<string>; knownBlockIds?: Set<string> },
): ParseResult {
  const warnings: string[] = [];

  const json = extractJsonObject(raw);
  if (!json) {
    return { ops: [], error: "no JSON object found in response", warnings };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return {
      ops: [],
      error: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      warnings,
    };
  }

  const rawOps = (parsed as { ops?: unknown })?.ops;
  if (!Array.isArray(rawOps)) {
    return { ops: [], error: "response has no `ops` array", warnings };
  }

  const ops: WorkspaceOp[] = [];
  /** Handles the model invented ("new:foo") mapped to the ids we mint for them. */
  const handleToId = new Map<string, string>();
  let counter = 0;

  const resolveTopicRef = (ref: unknown): string | undefined => {
    if (typeof ref !== "string" || ref.length === 0) return undefined;
    if (handleToId.has(ref)) return handleToId.get(ref);
    if (ref.startsWith("new:")) {
      const id = deterministicId(opts.idSeed, "topic", ref);
      handleToId.set(ref, id);
      return id;
    }
    return ref;
  };

  for (const entry of rawOps) {
    const w = entry as WireOp;
    const type = typeof w.type === "string" ? w.type : "";
    counter += 1;

    try {
      switch (type) {
        case "create_topic": {
          const title = str(w.title);
          const ref = str(w.id) ?? str(w.topic);
          if (!title || !ref) throw new Error("create_topic needs id and title");
          const topicId = resolveTopicRef(ref)!;
          ops.push({
            type: "create_topic",
            topicId,
            title,
            slug: slugify(title),
            // Coerced here, not validated: an off-list icon is a cosmetic slip
            // and dropping the whole topic over it would be absurd.
            icon: normaliseIcon(w.icon),
          });
          break;
        }

        case "rename_topic": {
          const topicId = resolveTopicRef(w.topic);
          const title = str(w.title);
          if (!topicId || !title) throw new Error("rename_topic needs topic and title");
          ops.push({
            type: "rename_topic",
            topicId,
            title,
            // Only when supplied, so a rename cannot silently reset the icon.
            ...(w.icon !== undefined ? { icon: normaliseIcon(w.icon) } : {}),
          });
          break;
        }

        case "merge_topics": {
          const fromTopicId = resolveTopicRef(w.from);
          const intoTopicId = resolveTopicRef(w.into);
          if (!fromTopicId || !intoTopicId) throw new Error("merge_topics needs from and into");
          if (fromTopicId === intoTopicId) throw new Error("merge_topics into itself");
          ops.push({ type: "merge_topics", fromTopicId, intoTopicId });
          break;
        }

        case "add_block": {
          const topicId = resolveTopicRef(w.topic);
          const text = str(w.text);
          const kind = BlockKind.safeParse(w.kind);
          if (!topicId) throw new Error("add_block needs topic");
          if (!text) throw new Error("add_block needs text");
          if (!kind.success) throw new Error(`unknown block kind ${String(w.kind)}`);
          ops.push({
            type: "add_block",
            blockId: deterministicId(opts.idSeed, "block", String(counter), text),
            topicId,
            kind: kind.data,
            ...labelFor(kind.data, w.label),
            text,
            spans: toSpans(w.sources),
          });
          break;
        }

        case "revise_block": {
          const supersedesBlockId = str(w.supersedes) ?? str(w.block);
          const text = str(w.text);
          const kind = BlockKind.safeParse(w.kind);
          if (!supersedesBlockId) throw new Error("revise_block needs supersedes");
          if (!text) throw new Error("revise_block needs text");
          if (!kind.success) throw new Error(`unknown block kind ${String(w.kind)}`);
          const topicId = resolveTopicRef(w.topic);
          if (!topicId) throw new Error("revise_block needs topic");
          ops.push({
            type: "revise_block",
            blockId: deterministicId(opts.idSeed, "block", String(counter), text),
            supersedesBlockId,
            topicId,
            kind: kind.data,
            ...labelFor(kind.data, w.label),
            text,
            spans: toSpans(w.sources),
          });
          break;
        }

        case "retire_block": {
          const blockId = str(w.block) ?? str(w.id);
          if (!blockId) throw new Error("retire_block needs block");
          ops.push({ type: "retire_block", blockId });
          break;
        }

        case "move_block": {
          const blockId = str(w.block) ?? str(w.id);
          const toTopicId = resolveTopicRef(w.topic);
          if (!blockId || !toTopicId) throw new Error("move_block needs block and topic");
          ops.push({ type: "move_block", blockId, toTopicId });
          break;
        }

        default:
          throw new Error(`unknown op type ${JSON.stringify(w.type)}`);
      }
    } catch (err) {
      // One bad op must not discard the rest of a good extraction.
      warnings.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { ops, warnings };
}

/**
 * A label, but only where one means anything.
 *
 * Kept off non-fact blocks entirely: a stray label on a claim would otherwise
 * change its op payload and therefore its identity, for no visible effect.
 */
function labelFor(kind: string, value: unknown): { label?: string } {
  if (kind !== "fact") return {};
  const label = str(value);
  return label ? { label: label.slice(0, 40) } : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function toSpans(sources: unknown): { utteranceId: string }[] {
  if (!Array.isArray(sources)) return [];
  return sources
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .map((utteranceId) => ({ utteranceId }));
}
