/**
 * What goes into the memory index, and how it comes back out.
 *
 * Pure: no I/O, no model call, fully testable. The worker calls `cutPassages`
 * and `renderTopicForMemory` when it indexes; recall calls `mergePassages`
 * when it reads. Everything that touches Postgres or LiteLLM is elsewhere.
 */

import { createHash } from "node:crypto";
import { withoutHallucinatedSentences } from "@voicemural/shared";
import type { Block, Topic } from "@voicemural/workspace";
import { withoutEcho } from "./echo";
import type { Passage } from "./retrieval";

/* ---------------------------------------------------------------------------
 * Passages
 * ------------------------------------------------------------------------- */

export interface MemoryUtterance {
  id: string;
  startOffsetMs: number;
  endOffsetMs: number;
  text: string;
}

export interface MemoryPassage {
  /** `<captureSessionId>:<startOffsetMs>`, the entry's stable ref. */
  refId: string;
  startOffsetMs: number;
  endOffsetMs: number;
  text: string;
  utteranceIds: string[];
}

export interface CutOptions {
  /** A passage closes once it spans this much time. */
  windowMs?: number;
  /** ...or this much text, whichever comes first. */
  maxChars?: number;
  /** A gap in speech this long closes a passage: a new thought, not the same one. */
  gapMs?: number;
}

/**
 * Cut one drive's utterances into passages worth remembering.
 *
 * The unit is a stretch of speech, not a Whisper segment. A segment is three
 * or four words and embeds to nothing in particular; forty seconds of one
 * thought embeds to that thought. This is the same window lexical recall widens
 * a hit into, so both arms quote back the same shape.
 *
 * Cleaned HERE, once, so a read never has to: the agent's own spoken replies
 * are removed by the same `withoutEcho` rule recall applies, and Whisper's
 * invented sign-offs by the same hallucination rule. What is stored is what
 * may be quoted.
 */
export function cutPassages(
  captureSessionId: string,
  utterances: readonly MemoryUtterance[],
  spoken: readonly string[],
  options: CutOptions = {},
): MemoryPassage[] {
  const windowMs = options.windowMs ?? 40_000;
  const maxChars = options.maxChars ?? 700;
  const gapMs = options.gapMs ?? 15_000;

  const ordered = [...utterances].sort((a, b) => a.startOffsetMs - b.startOffsetMs);
  const cleaned = withoutEcho(
    ordered.map((u) => withoutHallucinatedSentences(u.text.trim())),
    [...spoken],
  );
  // `withoutEcho` returns the kept strings; map them back to their rows by
  // walking both lists in order, since it preserves order and only drops.
  const kept: MemoryUtterance[] = [];
  let cursor = 0;
  for (const u of ordered) {
    const text = withoutHallucinatedSentences(u.text.trim());
    if (cursor < cleaned.length && cleaned[cursor] === text && text.length > 0) {
      kept.push({ ...u, text });
      cursor++;
    }
  }

  const passages: MemoryPassage[] = [];
  let current: MemoryUtterance[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const first = current[0]!;
    const last = current[current.length - 1]!;
    const text = current.map((u) => u.text).join(" ").replace(/\s+/g, " ").trim();
    if (text.length > 0) {
      passages.push({
        refId: `${captureSessionId}:${first.startOffsetMs}`,
        startOffsetMs: first.startOffsetMs,
        endOffsetMs: last.endOffsetMs,
        text,
        utteranceIds: current.map((u) => u.id),
      });
    }
    current = [];
  };

  for (const u of kept) {
    if (current.length > 0) {
      const first = current[0]!;
      const last = current[current.length - 1]!;
      const chars = current.reduce((n, x) => n + x.text.length + 1, 0);
      if (
        u.startOffsetMs - first.startOffsetMs >= windowMs ||
        chars + u.text.length > maxChars ||
        u.startOffsetMs - last.endOffsetMs >= gapMs
      ) {
        flush();
      }
    }
    current.push(u);
  }
  flush();

  return passages;
}

/* ---------------------------------------------------------------------------
 * Topics
 * ------------------------------------------------------------------------- */

/**
 * Where things stand on one topic, as the model will read it.
 *
 * Compact and spoken-prompt-shaped rather than the Markdown export: labelled
 * lines, no headings, no checkboxes, no table. Claims first because they are
 * the substance, then what is open, then what is to do. Facts inline as
 * "label: value". Kept short — this is read on every turn it matches.
 */
export function renderTopicForMemory(topic: Topic, blocks: readonly Block[], maxChars = 900): string {
  const lines: string[] = [`Topic: ${topic.title}`];
  const by = (kind: Block["kind"]) => blocks.filter((b) => b.kind === kind);

  for (const b of by("claim")) lines.push(`- ${b.text}`);
  const facts = by("fact");
  if (facts.length) lines.push(`- Details: ${facts.map((f) => `${f.label ?? "—"}: ${f.text}`).join("; ")}`);
  for (const b of by("question")) lines.push(`- Open: ${b.text}`);
  for (const b of by("task")) {
    const state = b.state && b.state !== "open" ? ` (${b.state})` : "";
    lines.push(`- Next: ${b.text}${state}`);
  }

  // Trim from the end: claims come first and matter most.
  const out: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length + 1 > maxChars && out.length > 1) break;
    out.push(line);
    used += line.length + 1;
  }
  return out.join("\n");
}

/** Stable hash of rendered text, to know when a topic needs re-embedding. */
export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

/* ---------------------------------------------------------------------------
 * Merging the two arms of recall
 * ------------------------------------------------------------------------- */

/**
 * Lexical and semantic hits, as one list.
 *
 * Lexical first: an exact word — a name, a project, a number — is what people
 * most often ask to be reminded of, and a lexical hit is never a false friend.
 * Semantic hits fill in behind, skipping anything that overlaps a passage
 * already present (same drive, within a minute) or repeats its opening words.
 */
export function mergePassages(
  lexical: readonly (Passage & { captureSessionId?: string | null })[],
  semantic: readonly (Passage & { captureSessionId?: string | null })[],
  limit = 5,
): Passage[] {
  const out: (Passage & { captureSessionId?: string | null })[] = [...lexical];
  const openings = new Set(out.map((p) => p.text.slice(0, 80)));

  for (const hit of semantic) {
    if (out.length >= limit) break;
    if (openings.has(hit.text.slice(0, 80))) continue;
    const overlaps = out.some(
      (p) =>
        p.captureSessionId &&
        p.captureSessionId === hit.captureSessionId &&
        Math.abs(p.occurredAt.getTime() - hit.occurredAt.getTime()) < 60_000,
    );
    if (overlaps) continue;
    out.push(hit);
    openings.add(hit.text.slice(0, 80));
  }

  return out.slice(0, limit).map(({ occurredAt, text }) => ({ occurredAt, text }));
}
