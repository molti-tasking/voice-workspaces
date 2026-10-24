/**
 * The conversation digest: everything the conversation views show beyond the
 * words, written in one go from what was said (`/api/realtime/digest`, read
 * by `apps/web/src/app/record/views/`).
 *
 * ONE DIGEST, EVERY VIEW. The views used to ask for their own summaries — the
 * mirror its points per topic — and each new view would have needed another
 * route, prompt and hook. One call now returns what all of them read:
 *
 * - `now`: one line, where the conversation is (the Now view).
 * - `topics`: per topic, a few points per side, and the ideas the ASSISTANT
 *   brought, each marked taken up or not (the topic line, Uptake, the zoom).
 * - `open`: the questions the conversation has raised, settled or still open
 *   (the Open view).
 *
 * KEPT APART BY WHO SAID IT. "you" is only what the person said, "ai" only
 * what the assistant said, and an idea is only ever the assistant's: whether
 * the person took it up is the point of Uptake.
 *
 * Topics are named to the model by number, so the reply is matched to the
 * screen's topics by ordinal and never by a title the model rephrased.
 *
 * Pure: the messages and the parse, so the route only calls the model.
 */

import type { ChatMessage } from "@voicemural/llm";

/** At most this many points per side of a topic. */
export const DIGEST_MAX_POINTS = 3;
/** At most this many ideas per topic. */
export const DIGEST_MAX_IDEAS = 4;
/** At most this many questions. */
export const DIGEST_MAX_QUESTIONS = 6;
/** Longest point, idea or question kept; longer ones are cut at a word. */
export const DIGEST_MAX_CHARS = 80;
/** Longest `now` line kept. */
export const DIGEST_MAX_NOW_CHARS = 120;

/** The last lines the model sees: bounded, newest last. */
const MAX_LINES = 80;
const MAX_LINE_CHARS = 400;

export interface DigestLine {
  who: "user" | "agent";
  text: string;
  /** The topic it was said under; null before anything was named. */
  ordinal: number | null;
}

export interface DigestTopicInput {
  ordinal: number;
  title: string;
}

export interface DigestIdea {
  text: string;
  /** The person took it up in their own words: chose it, built on it, decided it. */
  takenUp: boolean;
}

export interface DigestTopic {
  ordinal: number;
  you: string[];
  ai: string[];
  ideas: DigestIdea[];
}

export interface DigestQuestion {
  text: string;
  settled: boolean;
  /** The topic it belongs to, when the model named one that exists. */
  ordinal: number | null;
}

export interface ConversationDigest {
  now: string | null;
  topics: DigestTopic[];
  open: DigestQuestion[];
}

export const EMPTY_DIGEST: ConversationDigest = { now: null, topics: [], open: [] };

const SYSTEM = `You digest a spoken conversation between a person and a voice assistant, for a small phone screen that is read at a glance.

Return JSON only, nothing else:
{"now": "...", "topics": [{"n": 1, "you": ["..."], "ai": ["..."], "ideas": [{"text": "...", "takenUp": false}]}], "open": [{"q": "...", "settled": false, "n": 1}]}

- "now": ONE line, at most 14 words: where the conversation is right now and what it is working out. No "you are discussing".
- "topics": one entry per numbered topic that has lines, by its number "n".
  - "you": what the PERSON said, asked or decided on it. "ai": what the ASSISTANT contributed. Never put one side's point under the other. At most 3 each, most recent last, each at most 8 words: a fragment, no full stop.
  - "ideas": the concrete suggestions the ASSISTANT made on it (an option, a recommendation, a plan), at most 4, each at most 8 words. "takenUp": true only when the person afterwards made it their own in their own words — chose it, built on it, restated it adding something, or decided on it. "Okay", "hm" or silence is NOT taking it up.
- "open": the questions this conversation has to answer that came up (where, when, how, how much), at most 6, each a short question of at most 8 words. "settled": true when the person decided it. "n": the topic it belongs to.
- Name the concrete thing — the place, number or option — never "discussed X".
- Only what was actually said. An empty list is better than an invented point.
- In the language of the conversation.`;

export function digestMessages(
  topics: readonly DigestTopicInput[],
  lines: readonly DigestLine[],
): ChatMessage[] {
  const named = topics.map((t) => `${t.ordinal}. ${t.title}`).join("\n");
  const transcript = lines
    .slice(-MAX_LINES)
    .map((l) => {
      const who = l.who === "agent" ? "Assistant" : "Person";
      return `[${l.ordinal ?? "-"}] ${who}: ${l.text.slice(0, MAX_LINE_CHARS)}`;
    })
    .join("\n");
  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Topics, numbered:\n${named || "(none named yet)"}\n\nThe conversation, each line with its topic's number:\n${transcript || "(nothing transcribed yet)"}`,
    },
  ];
}

function cut(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  let text = raw
    .replace(/^\s*(?:[-•*·]|\d+[.)])\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  if (text.length > max) {
    const head = text.slice(0, max);
    const space = head.lastIndexOf(" ");
    text = `${head.slice(0, space > 20 ? space : head.length)}…`;
  }
  return text;
}

/** A point: a fragment, so no full stop. */
function point(raw: unknown): string | null {
  return cut(raw, DIGEST_MAX_CHARS)?.replace(/[.。]+$/, "") || null;
}

function points(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(point)
    .filter((p): p is string => p !== null)
    .slice(-max);
}

function ideas(raw: unknown): DigestIdea[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((item): DigestIdea[] => {
      const text = point(typeof item === "string" ? item : (item as { text?: unknown } | null)?.text);
      if (!text) return [];
      return [{ text, takenUp: (item as { takenUp?: unknown } | null)?.takenUp === true }];
    })
    .slice(0, DIGEST_MAX_IDEAS);
}

/**
 * The model's reply as a digest, or null when it is not the JSON asked for —
 * a fenced block or a sentence around the object is tolerated. Topics are kept
 * only when their number is one of `ordinals`, so a topic the model invented
 * never reaches the screen. Null means the screen keeps the digest it had.
 */
export function parseDigest(raw: string, ordinals: readonly number[]): ConversationDigest | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const body = parsed as { now?: unknown; topics?: unknown; open?: unknown };
  if (body.now === undefined && !Array.isArray(body.topics) && !Array.isArray(body.open)) return null;

  const known = new Set(ordinals);
  const seen = new Set<number>();
  const topics: DigestTopic[] = [];
  for (const item of Array.isArray(body.topics) ? body.topics : []) {
    if (!item || typeof item !== "object") continue;
    const t = item as { n?: unknown; you?: unknown; ai?: unknown; ideas?: unknown };
    const ordinal = Number(t.n);
    if (!Number.isInteger(ordinal) || !known.has(ordinal) || seen.has(ordinal)) continue;
    seen.add(ordinal);
    topics.push({
      ordinal,
      you: points(t.you, DIGEST_MAX_POINTS),
      ai: points(t.ai, DIGEST_MAX_POINTS),
      ideas: ideas(t.ideas),
    });
  }

  const open: DigestQuestion[] = [];
  for (const item of Array.isArray(body.open) ? body.open : []) {
    if (!item || typeof item !== "object") continue;
    const q = item as { q?: unknown; settled?: unknown; n?: unknown };
    const text = cut(q.q, DIGEST_MAX_CHARS);
    if (!text) continue;
    const ordinal = Number(q.n);
    open.push({
      text,
      settled: q.settled === true,
      ordinal: Number.isInteger(ordinal) && known.has(ordinal) ? ordinal : null,
    });
  }

  return {
    now: cut(body.now, DIGEST_MAX_NOW_CHARS),
    topics,
    open: open.slice(0, DIGEST_MAX_QUESTIONS),
  };
}
