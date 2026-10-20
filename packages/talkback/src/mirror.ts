/**
 * The conversation mirror's bullets: per topic, what the person said and what
 * the assistant said, each as a few short points (`/api/realtime/mirror`, shown
 * by `apps/web/src/app/record/conversation-mirror.tsx`).
 *
 * WHY BULLETS, NOT A TRANSCRIPT. Speech is sequential and gone once said: when
 * the assistant lists three options, the person cannot hold them, and a live
 * transcript only moves the problem to reading. The mirror shows the
 * conversation, not the words — a topic, and a handful of points under it.
 *
 * KEPT APART BY WHO SAID IT. "you" is only what the person said, "ai" only
 * what the assistant said, so the screen can show at a glance how much of a
 * topic is theirs and how much they only heard.
 *
 * Pure: the messages and the parse, so the route only calls the model.
 */

import type { ChatMessage } from "@voicemural/llm";
import type { SparkLine } from "./spark-question";

/** At most this many points per side of a topic. */
export const MIRROR_MAX_BULLETS = 3;
/** Longest point kept; longer ones are cut at a word. */
export const MIRROR_MAX_BULLET_CHARS = 80;

/** The last lines of a topic the model sees: bounded, newest last. */
const MAX_LINES = 24;
const MAX_LINE_CHARS = 500;

const SYSTEM = `You summarise one topic of a spoken conversation between a person and a voice assistant, for a small phone screen that is read at a glance.

Return JSON only, nothing else: {"you": ["..."], "ai": ["..."]}
- "you": what the PERSON said, asked or decided on this topic. "ai": what the ASSISTANT contributed. Never put one side's point under the other.
- At most 3 points per side, most recent last. Each point at most 8 words: a fragment, no full stop.
- Name the concrete thing — the place, number, option or claim — never "discussed X" or "asked about Y".
- Only what was actually said. An empty list is better than an invented point.
- In the language of the conversation.`;

export interface MirrorBullets {
  you: string[];
  ai: string[];
}

export function mirrorMessages(title: string, lines: readonly SparkLine[]): ChatMessage[] {
  const transcript = lines
    .slice(-MAX_LINES)
    .map((l) => `${l.who === "agent" ? "Assistant" : "Person"}: ${l.text.slice(0, MAX_LINE_CHARS)}`)
    .join("\n");
  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Topic: "${title}"\n\nWhat was said on it:\n${transcript || "(nothing transcribed yet)"}`,
    },
  ];
}

function cleanBullet(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let text = raw
    .replace(/^\s*(?:[-•*·]|\d+[.)])\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.。]+$/, "");
  if (!text) return null;
  if (text.length > MIRROR_MAX_BULLET_CHARS) {
    const cut = text.slice(0, MIRROR_MAX_BULLET_CHARS);
    text = `${cut.slice(0, cut.lastIndexOf(" ") > 20 ? cut.lastIndexOf(" ") : cut.length)}…`;
  }
  return text;
}

function cleanSide(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(cleanBullet)
    .filter((b): b is string => b !== null)
    .slice(-MIRROR_MAX_BULLETS);
}

/**
 * The model's reply as bullets, or null when it is not the JSON asked for —
 * a fenced block or a sentence around the object is tolerated. Null means the
 * mirror keeps whatever it showed for the topic before.
 */
export function parseMirrorBullets(raw: string): MirrorBullets | null {
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
  const { you, ai } = parsed as { you?: unknown; ai?: unknown };
  if (!Array.isArray(you) && !Array.isArray(ai)) return null;
  return { you: cleanSide(you), ai: cleanSide(ai) };
}
